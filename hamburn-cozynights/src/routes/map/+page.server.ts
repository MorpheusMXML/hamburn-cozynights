import { InventoryService } from '$lib/server/inventory';
import type { PageServerLoad } from './$types';
import { getBookingSettings } from '$lib/server/settings';

export const load: PageServerLoad = async ({ locals }) => {
	const inventory = new InventoryService(locals.pb);
	let houses = await inventory.getFullTree();
	const { isBookingActive, bookingUnlockAt } = await getBookingSettings(locals.pb);

	if (isBookingActive) {
		// Filter out unconfigured houses from public map during live booking
		houses = houses.filter((h) => h.isBookable);
	}

	console.log(`[MapServer] Loading map. Active: ${isBookingActive}, Houses: ${houses.length}`);

	return { houses, isBookingActive, bookingUnlockAt };
};
