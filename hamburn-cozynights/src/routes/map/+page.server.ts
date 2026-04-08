import { InventoryService } from '$lib/server/inventory';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
    const inventory = new InventoryService(locals.pb);
    const houses = await inventory.getFullTree();

    return {
        houses
    };
};