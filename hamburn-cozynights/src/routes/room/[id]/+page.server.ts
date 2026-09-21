// src/routes/room/[id]/+page.server.ts
import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import type { RoomsResponse, BedsResponse, OrdersResponse } from '$lib/pocketbase-types';
import { decrypt } from '$lib/server/crypto';
import {
	BookingService,
	BedUnavailableError,
	BookingClosedError,
	CheckedInError,
	ReleaseFailedError,
	isBedBookable,
	randomBurnerName
} from '$lib/server/booking';
import { clearGuestSession, signInUrl } from '$lib/server/guest-session';
import { getBookingSettings } from '$lib/server/settings';
import { bookingRefusal } from '$lib/booking-phase';
import {
	disconnectTelegram,
	getGuestNotifyStatus,
	startTelegramLink,
	type GuestNotifyStatus
} from '$lib/server/notifications';
import { passSummary } from '$lib/server/pass';
import { isSpotFixed, SPOT_FIXED_MESSAGE } from '$lib/server/special-requests';
import type { PassSummary } from '$lib/pass';

const UNAVAILABLE = 'The booking system is not reachable right now. Please try again in a minute.';
const SIGNED_OUT =
	'You are not signed in anymore. Go to the start page and enter your ticket code again.';
const CODE_UNKNOWN = 'Your ticket code was not found. Go to the start page and enter it again.';

/** Burner names are shown to everyone in the room: one line, no stray whitespace. */
function cleanBurnerName(raw: FormDataEntryValue | null): string {
	return (typeof raw === 'string' ? raw : '').replace(/\s+/g, ' ').trim().slice(0, 80);
}

export const load: PageServerLoad = async ({ params, locals, cookies }) => {
	if (!locals.orderNumber) throw redirect(303, signInUrl(locals));

	// Always use the adminPb instance for backend operations
	const bookingService = new BookingService(locals.adminPb);
	// hooks.server.ts read the ticket for this request already; it only looks it
	// up here when PocketBase couldn't answer there.
	let order = locals.order ?? null;
	try {
		if (!order) order = await bookingService.getOrderByNumber(locals.orderNumber);
	} catch (err) {
		console.error('[Room] Order lookup failed:', (err as Error)?.message);
		throw error(503, UNAVAILABLE);
	}

	if (!order) {
		console.warn('[Security] Room load: unknown ticket code in cookie.');
		clearGuestSession(cookies);
		throw redirect(303, '/?login=expired');
	}

	try {
		const [settings, userBed, room, beds] = await Promise.all([
			getBookingSettings(locals.pb),
			bookingService.getBedForOrder(order.id),
			locals.pb.collection('rooms').getOne<RoomsResponse>(params.id),
			locals.adminPb.collection('beds').getFullList<BedsResponse<{ order?: OrdersResponse }>>({
				filter: locals.adminPb.filter('room = {:roomId}', { roomId: params.id }),
				sort: 'label',
				expand: 'order'
			})
		]);

		// Only these fields reach the browser. The expanded orders carry other
		// guests' ticket codes and customer names and must never be serialized.
		// `bookable` only matters for free spots: for a taken one it would tell
		// whether it is locked or a special-needs spot, next to the burner name.
		const safeBeds = beds.map((bed) => {
			let burnerName = '';
			if (bed.occupied && bed.expand?.order?.burner_name) {
				try {
					burnerName = decrypt(bed.expand.order.burner_name);
				} catch {
					/* unreadable name: show the default */
				}
			}
			return {
				id: bed.id,
				label: bed.label,
				occupied: !!bed.occupied,
				bookable: !bed.occupied && isBedBookable(bed, { allowLocked: !!locals.admin }),
				burnerName
			};
		});

		// Where confirmations go, the booking pass, and whether the crew picked the
		// spot (special-needs request). Optional: the page works without them.
		let notify: GuestNotifyStatus | null = null;
		let pass: PassSummary | null = null;
		let spotFixed = false;
		if (userBed) {
			[notify, pass, spotFixed] = await Promise.all([
				getGuestNotifyStatus(locals.adminPb, order, settings).catch((err) => {
					console.error('[Room] Notification status failed:', (err as Error)?.message);
					return null;
				}),
				passSummary(locals.adminPb, order, userBed).catch((err) => {
					console.error('[Room] Booking pass failed:', (err as Error)?.message);
					return null;
				}),
				isSpotFixed(locals.adminPb, order.id, userBed.id).catch((err) => {
					console.error('[Room] Special-needs request lookup failed:', (err as Error)?.message);
					return false;
				})
			]);
		}

		return {
			notify,
			pass,
			spotFixed,
			// The crew checked the guest in at arrival: only the crew changes the spot now.
			checkedIn: !!userBed?.checked_in_at,
			room: { id: room.id, name: room.name, room_number: room.room_number, house: room.house },
			beds: safeBeds,
			userBedId: userBed?.id || null,
			isBookingActive: settings.isBookingActive,
			phase: settings.phase,
			// what the banners say; what is allowed still follows `phase`
			guestPhase: settings.guestPhase,
			bookingUnlockAt: settings.bookingUnlockAt
		};
	} catch (err: any) {
		if (err?.status === 404) {
			throw error(404, "This room doesn't exist (anymore). Pick another one on the map.");
		}
		console.error('[Room] Load failed:', (err as Error)?.message);
		throw error(503, UNAVAILABLE);
	}
};

export const actions: Actions = {
	bookBed: async ({ request, locals }) => {
		// PRIO 1: Security & Auth Checks
		if (!locals.adminPb.authStore.isValid) {
			console.error('[Security] bookBed: Master Key (Admin Auth) is invalid.');
			return fail(500, {
				error:
					'The booking system has a technical problem. Nothing was booked. Please tell the crew.'
			});
		}

		const { isBookingActive, phase } = await getBookingSettings(locals.pb);
		// Closed: nothing changes any more, not even a name. Outside Live Booking
		// only the burner name of the spot the ticket already holds may change
		// (decided below, once that spot is known): a handed-over ticket comes
		// without a name, and booking may not have opened yet.
		if (phase === 'closed') return fail(403, { error: bookingRefusal(phase) });

		const formData = await request.formData();
		const bedId = formData.get('bedId') as string;
		const guestName = cleanBurnerName(formData.get('guestName')) || randomBurnerName();

		if (!locals.orderNumber) return fail(401, { error: SIGNED_OUT });
		if (!bedId) {
			return fail(400, { error: 'No spot was selected. Close this window and tap a free spot.' });
		}

		const bookingService = new BookingService(locals.adminPb);

		try {
			const order = await bookingService.getOrderByNumber(locals.orderNumber);
			if (!order) {
				console.warn('[Security] bookBed: unknown ticket code in cookie.');
				return fail(404, { error: CODE_UNKNOWN });
			}

			const currentBed = await bookingService.getBedForOrder(order.id);
			const renaming = !!currentBed && currentBed.id === bedId;
			if (!renaming && !isBookingActive) return fail(403, { error: bookingRefusal(phase) });
			if (currentBed && currentBed.id !== bedId) {
				// A spot the crew picked for a special-needs request stays where it
				// is; giving it a new burner name is fine.
				if (await isSpotFixed(locals.adminPb, order.id, currentBed.id)) {
					return fail(409, { error: SPOT_FIXED_MESSAGE });
				}
				// One ticket, one spot: the page asks to release first, and so does
				// the server — a stale tab or a hand-made request must not move a
				// booking on the quiet.
				return fail(409, {
					error: `Your ticket already holds ${currentBed.label ? `spot ${currentBed.label}` : 'a spot'}. Release it first, then pick this one.`
				});
			}

			// Availability (free, enabled, not locked unless admin) is checked
			// authoritatively inside bookBed, under per-order and per-bed locks —
			// and so is the phase, which can close while this waits for them.
			await bookingService.bookBed(order, bedId, guestName, {
				allowLocked: !!locals.admin,
				requireLivePhase: true
			});
			return { success: true };
		} catch (err: any) {
			if (err instanceof BedUnavailableError) {
				return fail(409, { error: `${err.message} Please pick another spot.`, bedTaken: true });
			}
			if (err instanceof ReleaseFailedError || err instanceof CheckedInError) {
				return fail(409, { error: err.message });
			}
			if (err instanceof BookingClosedError) return fail(403, { error: err.message });
			if (err?.status === 404) {
				return fail(404, {
					error: "This spot doesn't exist anymore. Please pick another one.",
					bedTaken: true
				});
			}
			console.error('[Security] bookBed critical failure:', err?.message);
			return fail(500, {
				error:
					'Something went wrong while booking. Check whether the spot shows as yours. If not, please try again.'
			});
		}
	},

	/**
	 * Opens Telegram with a one-time link; tapping START there links the chat
	 * to this ticket (pb_hooks/lib/notify.js). A plain form post answered with a
	 * redirect to t.me, so it works without JavaScript and in a new tab.
	 */
	connectTelegram: async ({ locals }) => {
		if (!locals.orderNumber) return fail(401, { error: SIGNED_OUT });
		const { telegramBot } = await getBookingSettings(locals.pb);
		if (!telegramBot) {
			return fail(400, { error: 'Telegram updates are not available right now.' });
		}

		let link: string;
		try {
			const order = await new BookingService(locals.adminPb).getOrderByNumber(locals.orderNumber);
			if (!order) return fail(404, { error: CODE_UNKNOWN });
			link = await startTelegramLink(locals.adminPb, order.id, telegramBot);
		} catch (err) {
			console.error('[Room] Telegram link failed:', (err as Error)?.message);
			return fail(500, { error: 'Telegram could not be connected right now. Please try again.' });
		}
		throw redirect(303, link);
	},

	disconnectTelegram: async ({ locals }) => {
		if (!locals.orderNumber) return fail(401, { error: SIGNED_OUT });
		try {
			const order = await new BookingService(locals.adminPb).getOrderByNumber(locals.orderNumber);
			if (!order) return fail(404, { error: CODE_UNKNOWN });
			await disconnectTelegram(locals.adminPb, order.id);
			return { success: true, telegramDisconnected: true };
		} catch (err) {
			console.error('[Room] Telegram disconnect failed:', (err as Error)?.message);
			return fail(500, { error: 'Telegram updates could not be turned off. Please try again.' });
		}
	},

	unbookBed: async ({ locals }) => {
		if (!locals.adminPb.authStore.isValid) {
			console.error('[Security] unbookBed: Master Key (Admin Auth) is invalid.');
			return fail(500, {
				error:
					'The booking system has a technical problem. Your spot was not released. Please tell the crew.'
			});
		}

		const { isBookingActive } = await getBookingSettings(locals.pb);
		if (!isBookingActive) {
			return fail(403, {
				error:
					'Booking is closed right now, so your spot cannot be released. It stays reserved for you.'
			});
		}

		if (!locals.orderNumber) return fail(401, { error: SIGNED_OUT });

		const bookingService = new BookingService(locals.adminPb);

		try {
			const order = await bookingService.getOrderByNumber(locals.orderNumber);
			if (!order) return fail(404, { error: CODE_UNKNOWN });
			if (await isSpotFixed(locals.adminPb, order.id)) {
				return fail(409, { error: SPOT_FIXED_MESSAGE });
			}

			await bookingService.unbookOrder(order.id);
			return { success: true, released: true };
		} catch (err: any) {
			if (err instanceof CheckedInError) return fail(409, { error: err.message });
			console.error('[Security] unbookBed failed:', err?.message);
			return fail(500, {
				error: 'Your spot could not be released. It is still reserved for you. Please try again.'
			});
		}
	}
};
