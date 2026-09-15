import { InventoryService } from '$lib/server/inventory';
import type { PageServerLoad } from './$types';
import { APP_SETTINGS_ID } from '$lib/server/constants';

export const load: PageServerLoad = async ({ locals }) => {
	const inventory = new InventoryService(locals.pb);
	let houses = await inventory.getFullTree();
	const settings = await locals.pb
		.collection('app_settings')
		.getOne(APP_SETTINGS_ID)
		.catch(() => ({ is_booking_active: false, booking_unlock_at: '' }));

	if (settings.is_booking_active) {
		// Filter out unconfigured houses from public map during live booking
		houses = houses.filter((h) => h.isBookable);
	}

	console.log(
		`[MapServer] Loading map. Active: ${settings.is_booking_active}, Houses: ${houses.length}`
	);

	return {
		houses,
		isBookingActive: !!settings.is_booking_active,
		bookingUnlockAt: settings.booking_unlock_at || ''
	};
};
