import { InventoryService } from '$lib/server/inventory';
import { pb } from '$lib/pocketbase';
import type { Actions, PageServerLoad } from './$types';

// 1. DATEN LADEN
export const load: PageServerLoad = async () => {
    // Der Service liefert uns die fertige Baumstruktur
    const houses = await InventoryService.getFullTree();
    return { houses };
};

// 2. DATEN SCHREIBEN (ACTIONS)
export const actions: Actions = {
    // Haus Aktionen
    createHouse: async ({ request }) => {
        const data = await request.formData();
        const name = data.get('name') as string;
        await pb.collection('houses').create({ name, occupied: false });
    },
    deleteHouse: async ({ request }) => {
        const data = await request.formData();
        await pb.collection('houses').delete(data.get('id') as string);
    },

    // Zimmer Aktionen
    createRoom: async ({ request }) => {
        const data = await request.formData();
        await pb.collection('rooms').create({
            name: data.get('name') || '',
            room_number: data.get('room_number'),
            house: data.get('house_id'),
            amount_beds: 0,
            occupied: false
        });
    },
    deleteRoom: async ({ request }) => {
        const data = await request.formData();
        await pb.collection('rooms').delete(data.get('id') as string);
    },

    // Bett Aktionen
    createBed: async ({ request }) => {
        const data = await request.formData();
        await pb.collection('beds').create({
            label: data.get('label'),
            room: data.get('room_id'),
            occupied: false
        });
    },
    deleteBed: async ({ request }) => {
        const data = await request.formData();
        await pb.collection('beds').delete(data.get('id') as string);
    }
};