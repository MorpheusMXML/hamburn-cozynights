// src/routes/swaps/+page.server.ts — the guest's swap requests (docs/guide/booking.md
// "Swap spots"): the ones waiting for their answer, and their own.
import { error, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { BookingService } from '$lib/server/booking';
import { clearGuestSession, signInUrl } from '$lib/server/guest-session';
import { getBookingSettings } from '$lib/server/settings';
import { passSummary } from '$lib/server/pass';
import { guestSwaps, swapPause } from '$lib/server/swaps';
import {
	acceptSwapAction,
	declineSwapAction,
	pauseSwapsAction,
	withdrawSwapAction
} from '$lib/server/swap-actions';

const UNAVAILABLE = 'The booking system is not reachable right now. Please try again in a minute.';

export const load: PageServerLoad = async ({ locals, cookies, setHeaders }) => {
	if (!locals.orderNumber) throw redirect(303, signInUrl(locals, '/swaps'));
	// What guests wrote to each other: never kept by a cache.
	setHeaders({ 'cache-control': 'no-store' });

	const booking = new BookingService(locals.adminPb);
	let order = locals.order ?? null;
	try {
		if (!order) order = await booking.getOrderByNumber(locals.orderNumber);
	} catch (err) {
		console.error('[Swaps] Order lookup failed:', (err as Error)?.message);
		throw error(503, UNAVAILABLE);
	}
	if (!order) {
		console.warn('[Security] Swaps load: unknown ticket code in cookie.');
		clearGuestSession(cookies);
		throw redirect(303, '/?login=expired');
	}

	try {
		const [settings, swaps, myBed] = await Promise.all([
			getBookingSettings(locals.pb),
			guestSwaps(locals.adminPb, order),
			booking.getBedForOrder(order.id)
		]);
		const pass = myBed
			? await passSummary(locals.adminPb, order, myBed).catch((err) => {
					console.error('[Swaps] Booking pass failed:', (err as Error)?.message);
					return null;
				})
			: null;
		return {
			...swaps,
			pause: swapPause(settings),
			hasSpot: !!myBed,
			myRoomId: myBed?.room ?? '',
			passCode: pass?.code ?? ''
		};
	} catch (err) {
		console.error('[Swaps] Load failed:', (err as Error)?.message);
		throw error(503, UNAVAILABLE);
	}
};

export const actions: Actions = {
	/** Yes: the two spots swap (the hold button posts this). */
	accept: async ({ request, locals }) => acceptSwapAction(locals, request),
	/** No thanks; `pause=true` also pauses swap requests to this guest. */
	decline: async ({ request, locals }) => declineSwapAction(locals, request),
	/** Takes the guest's own open request back. */
	withdraw: async ({ request, locals }) => withdrawSwapAction(locals, request),
	/** Pauses (paused=true) or resumes swap requests to this guest. */
	pause: async ({ request, locals }) => pauseSwapsAction(locals, request)
};
