import { error } from '@sveltejs/kit';
import { InventoryService } from '$lib/server/inventory';
import type { PageServerLoad } from './$types';
import { BookingService } from '$lib/server/booking';
import { getBookingSettings } from '$lib/server/settings';
import { findRequest } from '$lib/server/special-requests';
import { openingCountdownAt } from '$lib/booking-phase';

/** Whether the signed-in ticket has a special-needs request. Optional for the map. */
async function hasRequest(locals: App.Locals): Promise<boolean> {
	if (!locals.orderNumber) return false;
	try {
		const order = await new BookingService(locals.adminPb).getOrderByNumber(locals.orderNumber);
		return !!order && !!(await findRequest(locals.adminPb, order.id));
	} catch (err) {
		console.error('[Map] Special-needs request lookup failed:', (err as Error)?.message);
		return false;
	}
}

export const load: PageServerLoad = async ({ locals }) => {
	try {
		// The service account reads the beds (their rules are admin-only since
		// beds carry is_special, order and booked_at); getFullTree strips all of it.
		const inventory = new InventoryService(locals.adminPb);
		let houses = await inventory.getFullTree();
		const [{ isBookingActive, phase, next, requestsOpen }, requestSent] = await Promise.all([
			getBookingSettings(locals.pb),
			hasRequest(locals)
		]);

		if (phase !== 'staging') {
			// The layout is final: leave out unconfigured houses (live and closed).
			houses = houses.filter((h) => h.isBookable);
		}

		return {
			houses,
			isBookingActive,
			phase,
			// only an armed opening still ahead: a paused or elapsed time shows no countdown
			bookingUnlockAt: openingCountdownAt(phase, next),
			// the "special-needs spot" link: while requests are open, or to see one's own
			specialNeeds: { open: requestsOpen, requestSent }
		};
	} catch (err) {
		console.error('[Map] Load failed:', (err as Error)?.message);
		throw error(503, 'The map could not be loaded right now. Please try again in a minute.');
	}
};
