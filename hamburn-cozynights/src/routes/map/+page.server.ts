import { error, redirect } from '@sveltejs/kit';
import { InventoryService } from '$lib/server/inventory';
import type { PageServerLoad } from './$types';
import type { OrdersResponse } from '$lib/pocketbase-types';
import { BookingService } from '$lib/server/booking';
import { signInUrl } from '$lib/server/guest-session';
import { getBookingSettings } from '$lib/server/settings';
import { findRequest } from '$lib/server/special-requests';
import { passSummary } from '$lib/server/pass';
import { openingCountdownAt } from '$lib/booking-phase';

/**
 * The signed-in ticket — read once per request in hooks.server.ts — and
 * whether it has a special-needs request. Both optional for the map.
 */
async function signedInTicket(locals: App.Locals) {
	const order = locals.order;
	if (!order) return null;
	try {
		return { order, requestSent: !!(await findRequest(locals.adminPb, order.id)) };
	} catch (err) {
		console.error('[Map] Special-needs request lookup failed:', (err as Error)?.message);
		return { order, requestSent: false };
	}
}

/** Closed: the ticket's spot as a small booking pass, or that it holds none. Optional too. */
async function closedPanelPass(locals: App.Locals, order: OrdersResponse) {
	try {
		const bed = await new BookingService(locals.adminPb).getBedForOrder(order.id);
		return { pass: bed ? await passSummary(locals.adminPb, order, bed) : null, noSpot: !bed };
	} catch (err) {
		console.error('[Map] Booking pass failed:', (err as Error)?.message);
		return { pass: null, noSpot: false };
	}
}

export const load: PageServerLoad = async ({ locals }) => {
	// The ticket list or the booking round ended this session: say so on the
	// start page instead of showing the map as if nobody had ever signed in.
	if (locals.guestSignOut) throw redirect(303, signInUrl(locals));

	try {
		// The service account reads the beds (their rules are admin-only since
		// beds carry is_special, order and booked_at); getFullTree strips all of it.
		const inventory = new InventoryService(locals.adminPb);
		let houses = await inventory.getFullTree();
		const [{ isBookingActive, phase, guestPhase, next, requestsOpen }, ticket] = await Promise.all([
			getBookingSettings(locals.pb),
			signedInTicket(locals)
		]);

		if (phase !== 'staging') {
			// The layout is final: leave out unconfigured houses (live and closed).
			houses = houses.filter((h) => h.isBookable);
		}

		// Closed: the panel over the map shows the guest's spot as a small booking pass.
		const { pass, noSpot } =
			phase === 'closed' && ticket
				? await closedPanelPass(locals, ticket.order)
				: { pass: null, noSpot: false };

		return {
			houses,
			isBookingActive,
			phase,
			// what the boxes and banners say; the phase itself still decides what is allowed
			guestPhase,
			// only an armed opening still ahead: a paused or elapsed time shows no countdown
			bookingUnlockAt: openingCountdownAt(phase, next),
			// the "special-needs spot" link: while requests are open, or to see one's own
			specialNeeds: { open: requestsOpen, requestSent: !!ticket?.requestSent },
			pass,
			noSpot
		};
	} catch (err) {
		console.error('[Map] Load failed:', (err as Error)?.message);
		throw error(503, 'The map could not be loaded right now. Please try again in a minute.');
	}
};
