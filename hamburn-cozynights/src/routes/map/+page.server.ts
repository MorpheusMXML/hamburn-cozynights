import { InventoryService } from '$lib/server/inventory';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
    const inventory = new InventoryService(locals.pb);
    const houses = await inventory.getFullTree();
    const settings = await locals.pb.collection('app_settings').getOne('abcsettings123').catch(() => ({ is_booking_active: false, booking_unlock_at: "" }));

    return {
        houses,
        isBookingActive: settings.is_booking_active,
        bookingUnlockAt: settings.booking_unlock_at || ""
    };
};