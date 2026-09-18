import { error } from '@sveltejs/kit';
import { InventoryService } from '$lib/server/inventory';
import type { PageServerLoad } from './$types';
import { getBookingSettings } from '$lib/server/settings';

export const load: PageServerLoad = async ({ locals }) => {
	try {
		const inventory = new InventoryService(locals.pb);
		let houses = await inventory.getFullTree();
		const { isBookingActive, phase, bookingUnlockAt } = await getBookingSettings(locals.pb);

		if (phase !== 'staging') {
			// The layout is final: leave out unconfigured houses (live and closed).
			houses = houses.filter((h) => h.isBookable);
		}

		return { houses, isBookingActive, phase, bookingUnlockAt };
	} catch (err) {
		console.error('[Map] Load failed:', (err as Error)?.message);
		throw error(503, 'The map could not be loaded right now. Please try again in a minute.');
	}
};
