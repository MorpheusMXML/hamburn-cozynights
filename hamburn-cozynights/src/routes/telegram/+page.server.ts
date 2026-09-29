// src/routes/telegram/+page.server.ts — a guest's updates on Telegram
// (docs/admin/notifications.md): connect the chat, see that it is on, turn it
// off. Confirmation e-mails, the pass page and the wallet passes link here.
//
// It takes the ticket code (the guest session), never the pass code: the
// messages tell the crew's decision on a special-needs request, and a pass
// link or QR code gets shown and passed around.
import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { BookingService } from '$lib/server/booking';
import { clearGuestSession, signInUrl } from '$lib/server/guest-session';
import {
	disconnectTelegram,
	getGuestNotifyStatus,
	startTelegramLink,
	TELEGRAM_LINK_MINUTES
} from '$lib/server/notifications';
import { passSummary } from '$lib/server/pass';
import { getBookingSettings } from '$lib/server/settings';
import type { PassSummary } from '$lib/pass';

const UNAVAILABLE = 'The booking system is not reachable right now. Please try again in a minute.';
const SIGNED_OUT =
	'You are not signed in anymore. Go to the start page and enter your ticket code again.';
const CODE_UNKNOWN = 'Your ticket code was not found. Go to the start page and enter it again.';

export const load: PageServerLoad = async ({ locals, cookies, setHeaders }) => {
	if (!locals.orderNumber) throw redirect(303, signInUrl(locals, '/telegram'));
	setHeaders({ 'cache-control': 'no-store' });

	const booking = new BookingService(locals.adminPb);
	let order = locals.order ?? null;
	try {
		if (!order) order = await booking.getOrderByNumber(locals.orderNumber);
	} catch (err) {
		console.error('[Telegram] Order lookup failed:', (err as Error)?.message);
		throw error(503, UNAVAILABLE);
	}
	if (!order) {
		clearGuestSession(cookies);
		throw redirect(303, '/?login=expired');
	}

	try {
		const [settings, bed] = await Promise.all([
			getBookingSettings(locals.pb),
			booking.getBedForOrder(order.id)
		]);
		const [notify, pass] = await Promise.all([
			getGuestNotifyStatus(locals.adminPb, order, settings),
			bed
				? passSummary(locals.adminPb, order, bed).catch((err): null => {
						console.error('[Telegram] Booking pass failed:', (err as Error)?.message);
						return null;
					})
				: Promise.resolve(null as PassSummary | null)
		]);
		return {
			bot: notify.telegram?.bot ?? '',
			connected: !!notify.telegram?.connected,
			email: notify.email,
			pass,
			roomId: bed?.room ?? null,
			linkMinutes: TELEGRAM_LINK_MINUTES
		};
	} catch (err) {
		console.error('[Telegram] Load failed:', (err as Error)?.message);
		throw error(503, UNAVAILABLE);
	}
};

export const actions: Actions = {
	/**
	 * Opens Telegram with a one-time link; START there links the chat to this
	 * ticket (pb_hooks/lib/notify.js). A plain form post answered with a
	 * redirect to t.me, so it works without JavaScript and from other pages'
	 * forms (the room page, the roulette's card) into a new tab.
	 */
	connect: async ({ locals }) => {
		if (!locals.orderNumber) throw redirect(303, signInUrl(locals, '/telegram'));
		const { telegramBot } = await getBookingSettings(locals.pb);
		if (!telegramBot) return fail(400, { error: 'Telegram updates are not available right now.' });

		let link: string;
		try {
			const order = await new BookingService(locals.adminPb).getOrderByNumber(locals.orderNumber);
			if (!order) return fail(404, { error: CODE_UNKNOWN });
			link = await startTelegramLink(locals.adminPb, order.id, telegramBot);
		} catch (err) {
			console.error('[Telegram] Link failed:', (err as Error)?.message);
			return fail(500, { error: 'Telegram could not be connected right now. Please try again.' });
		}
		throw redirect(303, link);
	},

	disconnect: async ({ locals }) => {
		if (!locals.orderNumber) return fail(401, { error: SIGNED_OUT });
		try {
			const order = await new BookingService(locals.adminPb).getOrderByNumber(locals.orderNumber);
			if (!order) return fail(404, { error: CODE_UNKNOWN });
			await disconnectTelegram(locals.adminPb, order.id);
			return { success: true, disconnected: true };
		} catch (err) {
			console.error('[Telegram] Disconnect failed:', (err as Error)?.message);
			return fail(500, { error: 'Telegram updates could not be turned off. Please try again.' });
		}
	}
};
