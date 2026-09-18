import { error } from '@sveltejs/kit';
import { InventoryService } from '$lib/server/inventory';
import type { PageServerLoad } from './$types';
import { getBookingSettings } from '$lib/server/settings';

export const load: PageServerLoad = async ({ locals }) => {
	try {
		const inventory = new InventoryService(locals.pb);
		let houses = await inventory.getFullTree();
		const { isBookingActive, bookingUnlockAt } = await getBookingSettings(locals.pb);

		if (isBookingActive) {
			// Filter out unconfigured houses from public map during live booking
			houses = houses.filter((h) => h.isBookable);
		}

		return { houses, isBookingActive, bookingUnlockAt };
	} catch (err) {
		console.error('[Map] Load failed:', (err as Error)?.message);
		throw error(503, 'The map could not be loaded right now. Please try again in a minute.');
	}
};
