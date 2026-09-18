import { error } from '@sveltejs/kit';
import { InventoryService } from '$lib/server/inventory';
import type { PageServerLoad } from './$types';
import { BookingService } from '$lib/server/booking';
import { getBookingSettings } from '$lib/server/settings';
import { findRequest } from '$lib/server/special-requests';

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
		const inventory = new InventoryService(locals.pb);
		let houses = await inventory.getFullTree();
		const [{ isBookingActive, bookingUnlockAt, requestsOpen }, requestSent] = await Promise.all([
			getBookingSettings(locals.pb),
			hasRequest(locals)
		]);

		if (isBookingActive) {
			// Filter out unconfigured houses from public map during live booking
			houses = houses.filter((h) => h.isBookable);
		}

		return {
			houses,
			isBookingActive,
			bookingUnlockAt,
			// the "special-needs spot" link: while requests are open, or to see one's own
			specialNeeds: { open: requestsOpen, requestSent }
		};
	} catch (err) {
		console.error('[Map] Load failed:', (err as Error)?.message);
		throw error(503, 'The map could not be loaded right now. Please try again in a minute.');
	}
};
