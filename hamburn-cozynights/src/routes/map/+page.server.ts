import { error } from '@sveltejs/kit';
import { InventoryService } from '$lib/server/inventory';
import type { PageServerLoad } from './$types';
import type { OrdersResponse } from '$lib/pocketbase-types';
import { BookingService } from '$lib/server/booking';
import { getBookingSettings } from '$lib/server/settings';
import { findRequest } from '$lib/server/special-requests';
import { passSummary } from '$lib/server/pass';
import { openingCountdownAt } from '$lib/booking-phase';
import { readFilters, spotFacts, spotMatchesFilters, type SpotFilter } from '$lib/accommodation';

/** Free spots of a house that answer every wish the guest picked. */
function countFitting(house: { features?: string[]; rooms: any[] }, wishes: SpotFilter[]): number {
	return house.rooms.reduce(
		(sum, room) =>
			sum +
			room.beds.filter(
				(bed: { occupied?: boolean; bed_type?: string; features?: string[] }) =>
					!bed.occupied &&
					spotMatchesFilters(
						wishes,
						spotFacts({
							bedType: bed.bed_type,
							house: house.features,
							room: room.features,
							spot: bed.features
						})
					)
			).length,
		0
	);
}

/** The signed-in ticket and whether it has a special-needs request. Optional for the map. */
async function signedInTicket(locals: App.Locals) {
	if (!locals.orderNumber) return null;
	try {
		const order = await new BookingService(locals.adminPb).getOrderByNumber(locals.orderNumber);
		return order ? { order, requestSent: !!(await findRequest(locals.adminPb, order.id)) } : null;
	} catch (err) {
		console.error('[Map] Special-needs request lookup failed:', (err as Error)?.message);
		return null;
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

export const load: PageServerLoad = async ({ locals, url }) => {
	try {
		// The service account reads the beds (their rules are admin-only since
		// beds carry is_special, order and booked_at); getFullTree strips all of it.
		const inventory = new InventoryService(locals.adminPb);
		let houses = await inventory.getFullTree();
		const [{ isBookingActive, phase, next, requestsOpen }, ticket] = await Promise.all([
			getBookingSettings(locals.pb),
			signedInTicket(locals)
		]);

		if (phase !== 'staging') {
			// The layout is final: leave out unconfigured houses (live and closed).
			houses = houses.filter((h) => h.isBookable);
		}

		// What the guest is looking for. Strict on purpose: a spot nobody described
		// never matches, so a wish never promises something the crew never wrote down.
		const wishes = readFilters(url.searchParams.get('w'));
		if (wishes.length > 0) {
			houses = houses.map((house) => ({ ...house, fittingFree: countFitting(house, wishes) }));
		}

		// Closed: the panel over the map shows the guest's spot as a small booking pass.
		const { pass, noSpot } =
			phase === 'closed' && ticket
				? await closedPanelPass(locals, ticket.order)
				: { pass: null, noSpot: false };

		return {
			houses,
			wishes,
			isBookingActive,
			phase,
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
