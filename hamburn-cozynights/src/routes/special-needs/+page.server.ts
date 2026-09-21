// src/routes/special-needs/+page.server.ts
import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import type { OrdersResponse } from '$lib/pocketbase-types';
import { BookingService } from '$lib/server/booking';
import { getBookingSettings } from '$lib/server/settings';
import {
	disconnectTelegram,
	getGuestNotifyStatus,
	startTelegramLink,
	type GuestNotifyStatus
} from '$lib/server/notifications';
import { ensurePassCode } from '$lib/server/pass';
import { FailureRateLimiter } from '$lib/server/rate-limit';
import {
	getGuestRequest,
	getSpotForOrder,
	isSpotFixed,
	RequestError,
	saveRequest,
	withdrawRequest
} from '$lib/server/special-requests';
import { formatPassCode } from '$lib/pass';
import { parseRequestForm } from '$lib/special-needs';

const UNAVAILABLE = 'The booking system is not reachable right now. Please try again in a minute.';
const SIGNED_OUT =
	'You are not signed in anymore. Go to the start page and enter your ticket code again.';
const CODE_UNKNOWN = 'Your ticket code was not found. Go to the start page and enter it again.';

// Sending or changing a request: a few times per ticket and hour is plenty,
// and every new request is a message to the crew.
const SENDS_PER_HOUR = 10;
const sends = new FailureRateLimiter(SENDS_PER_HOUR, 60 * 60 * 1000);

/** The ticket of this session, or a failure to return. Never trusts the form. */
async function sessionOrder(
	locals: App.Locals
): Promise<{ order: OrdersResponse } | { failure: ReturnType<typeof fail> }> {
	if (!locals.orderNumber) return { failure: fail(401, { error: SIGNED_OUT }) };
	try {
		const order = await new BookingService(locals.adminPb).getOrderByNumber(locals.orderNumber);
		return order ? { order } : { failure: fail(404, { error: CODE_UNKNOWN }) };
	} catch (err) {
		console.error('[SpecialNeeds] Order lookup failed:', (err as Error)?.message);
		return { failure: fail(503, { error: UNAVAILABLE }) };
	}
}

export const load: PageServerLoad = async ({ locals, cookies, setHeaders }) => {
	if (!locals.orderNumber) throw redirect(303, '/?login=required');
	// The page shows what the guest wrote about their needs: never keep it in a cache.
	setHeaders({ 'cache-control': 'no-store' });

	let order;
	try {
		order = await new BookingService(locals.adminPb).getOrderByNumber(locals.orderNumber);
	} catch (err) {
		console.error('[SpecialNeeds] Order lookup failed:', (err as Error)?.message);
		throw error(503, UNAVAILABLE);
	}
	if (!order) {
		console.warn('[Security] Special needs load: unknown ticket code in cookie.');
		cookies.delete('bookingCode', { path: '/' });
		throw redirect(303, '/?login=expired');
	}

	try {
		const [settings, request, spot] = await Promise.all([
			getBookingSettings(locals.pb),
			getGuestRequest(locals.adminPb, order.id),
			getSpotForOrder(locals.adminPb, order.id)
		]);

		// Where messages go, the pass of a spot, and whether the crew booked that
		// spot for the request. Optional: the page works without them.
		const [notify, passCode, fixed] = await Promise.all([
			getGuestNotifyStatus(locals.adminPb, order, settings).catch((err): null => {
				console.error('[SpecialNeeds] Notification status failed:', (err as Error)?.message);
				return null;
			}) as Promise<GuestNotifyStatus | null>,
			spot
				? ensurePassCode(locals.adminPb, order)
						.then(formatPassCode)
						.catch((err): null => {
							console.error('[SpecialNeeds] Booking pass failed:', (err as Error)?.message);
							return null;
						})
				: Promise.resolve(null),
			spot
				? isSpotFixed(locals.adminPb, order.id, spot.bedId).catch((err): boolean => {
						console.error('[SpecialNeeds] Fixed-spot check failed:', (err as Error)?.message);
						return false;
					})
				: Promise.resolve(false)
		]);

		return {
			request,
			requestsOpen: settings.requestsOpen,
			isBookingActive: settings.isBookingActive,
			spot: spot ? { label: spot.label, roomId: spot.roomId, fixed } : null,
			passCode,
			notify
		};
	} catch (err) {
		console.error('[SpecialNeeds] Load failed:', (err as Error)?.message);
		throw error(503, UNAVAILABLE);
	}
};

export const actions: Actions = {
	save: async ({ request, locals }) => {
		const parsed = parseRequestForm(await request.formData());
		// Sent back on failure so nothing typed is lost (it's the guest's own text).
		const values = {
			needs: parsed.value.needs,
			text: parsed.value.text,
			burnerName: parsed.value.burnerName
		};

		const session = await sessionOrder(locals);
		if ('failure' in session) return session.failure;
		const { order } = session;

		const { requestsOpen } = await getBookingSettings(locals.pb);
		if (!requestsOpen) {
			return fail(403, {
				error:
					'Special-needs requests are closed right now, so nothing was sent. If you need help, please contact the crew.',
				values
			});
		}
		if (!parsed.ok) return fail(400, { errors: parsed.errors, values });

		if (sends.isBlocked(order.id)) {
			return fail(429, {
				error: `You sent your request ${SENDS_PER_HOUR} times within an hour. Please wait a while, then try again.`,
				values
			});
		}
		sends.recordFailure(order.id);

		try {
			const outcome = await saveRequest(locals.adminPb, order, parsed.value);
			return { success: true, saved: outcome };
		} catch (err) {
			if (err instanceof RequestError) return fail(err.status, { error: err.message, values });
			// Never log what the guest wrote.
			console.error('[SpecialNeeds] Saving failed:', (err as Error)?.message);
			return fail(500, {
				error: 'Your request could not be saved. Please try again in a minute.',
				values
			});
		}
	},

	/** Deletes the request and what the guest wrote. Always possible (withdrawing consent). */
	withdraw: async ({ locals }) => {
		const session = await sessionOrder(locals);
		if ('failure' in session) return session.failure;
		try {
			await withdrawRequest(locals.adminPb, session.order.id);
			return { success: true, withdrawn: true };
		} catch (err) {
			console.error('[SpecialNeeds] Withdrawing failed:', (err as Error)?.message);
			return fail(500, { error: 'Your request could not be withdrawn. Please try again.' });
		}
	},

	/** Like on the room page: a plain post, answered with a redirect to t.me. */
	connectTelegram: async ({ locals }) => {
		const session = await sessionOrder(locals);
		if ('failure' in session) return session.failure;
		const { telegramBot } = await getBookingSettings(locals.pb);
		if (!telegramBot) {
			return fail(400, { error: 'Telegram updates are not available right now.' });
		}

		let link: string;
		try {
			link = await startTelegramLink(locals.adminPb, session.order.id, telegramBot);
		} catch (err) {
			console.error('[SpecialNeeds] Telegram link failed:', (err as Error)?.message);
			return fail(500, { error: 'Telegram could not be connected right now. Please try again.' });
		}
		throw redirect(303, link);
	},

	disconnectTelegram: async ({ locals }) => {
		const session = await sessionOrder(locals);
		if ('failure' in session) return session.failure;
		try {
			await disconnectTelegram(locals.adminPb, session.order.id);
			return { success: true, telegramDisconnected: true };
		} catch (err) {
			console.error('[SpecialNeeds] Telegram disconnect failed:', (err as Error)?.message);
			return fail(500, { error: 'Telegram updates could not be turned off. Please try again.' });
		}
	}
};
