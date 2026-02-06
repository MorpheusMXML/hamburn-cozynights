// src/routes/room/[id]/+page.server.ts
import { pb } from '$lib/pocketbase';
import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import type { RoomsResponse, BedsResponse, OrdersResponse } from '$lib/pocketbase-types';

const burnerNames = [
    "Dusty Nomad", "Neon Shaman", "Sparkle Pony", "Fire Weaver", "LED Lizard", 
    "Gifting Goblin", "Moop Master", "Temple Guardian", "Solar Sprite", "Disco Druid",
    "Radical Robot", "Dust Bunny", "Prism Pilot", "Bass Beast", "Infinite Improviser"
];

function getRandomName(): string {
    const randomIndex = Math.floor(Math.random() * burnerNames.length);
    const randomSuffix = Math.floor(100 + Math.random() * 900); 
    return `${burnerNames[randomIndex]} #${randomSuffix}`;
}

export const load: PageServerLoad = async ({ params, locals }) => {
    if (!locals.orderNumber) throw redirect(303, '/');

    try {
        const order = await pb.collection('orders').getFirstListItem(`order_number = "${locals.orderNumber}"`);
        const userBed = await pb.collection('beds').getFirstListItem(`order = "${order.id}"`).catch(() => null);
        
        const room = await pb.collection('rooms').getOne<RoomsResponse>(params.id);
        const beds = await pb.collection('beds').getFullList<BedsResponse<{ order?: OrdersResponse }>>({
            filter: `room = "${params.id}"`,
            sort: 'label',
            expand: 'order' 
        });

        return { 
            room, 
            beds, 
            userBedId: userBed?.id || null, 
            currentOrderNumber: locals.orderNumber 
        };
    } catch {
        throw error(404, 'Raum nicht gefunden');
    }
};

export const actions: Actions = {
    bookBed: async ({ request, locals }) => {
        const formData = await request.formData();
        const bedId = formData.get('bedId') as string;
        let guestName = formData.get('guestName') as string;

        if (!locals.orderNumber) return fail(401, { error: 'Sitzung abgelaufen' });

        if (!guestName || guestName.trim() === '') {
            guestName = getRandomName();
        }

        try {
            const order = await pb.collection('orders').getFirstListItem(`order_number = "${locals.orderNumber}"`);

            // 1. Alte Buchungen lösen
            const previousBeds = await pb.collection('beds').getFullList({
                filter: `order = "${order.id}"`
            });
            for (const prevBed of previousBeds) {
                await pb.collection('beds').update(prevBed.id, { occupied: false, order: null });
            }

            // 2. Update Order: Dank Schritt 1 kennt TypeScript jetzt 'burner_name'
            // Kein 'as any' mehr nötig!
            await pb.collection('orders').update(order.id, { 
                burner_name: guestName 
            });

            // 3. Neues Bett buchen
            await pb.collection('beds').update(bedId, {
                occupied: true,
                order: order.id
            });

            return { success: true };
        } catch (err) {
            console.error(err);
            return fail(500, { error: 'Datenbankfehler.' });
        }
    },

    unbookBed: async ({ locals }) => {
        if (!locals.orderNumber) return fail(401);
        try {
            const order = await pb.collection('orders').getFirstListItem(`order_number = "${locals.orderNumber}"`);
            const beds = await pb.collection('beds').getFullList({ filter: `order = "${order.id}"` });
            
            for (const bed of beds) {
                await pb.collection('beds').update(bed.id, { occupied: false, order: null });
            }
            return { success: true };
        } catch {
            return fail(500);
        }
    }
};