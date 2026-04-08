// src/routes/room/[id]/+page.server.ts
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
        const settings = await locals.pb.collection('app_settings').getOne('abcsettings123').catch(() => ({ is_booking_active: false }));
        const order = await locals.pb.collection('orders').getFirstListItem(locals.pb.filter('order_number = {:orderNumber}', { orderNumber: locals.orderNumber }));
        const userBed = await locals.pb.collection('beds').getFirstListItem(locals.pb.filter('order = {:orderId}', { orderId: order.id })).catch(() => null);
        
        const room = await locals.pb.collection('rooms').getOne<RoomsResponse>(params.id);
        const beds = await locals.pb.collection('beds').getFullList<BedsResponse<{ order?: OrdersResponse }>>({
            filter: locals.pb.filter('room = {:roomId}', { roomId: params.id }),
            sort: 'label',
            expand: 'order' 
        });

        return { 
            room, 
            beds, 
            userBedId: userBed?.id || null, 
            currentOrderNumber: locals.orderNumber,
            isBookingActive: settings.is_booking_active
        };
    } catch {
        throw error(404, 'Raum nicht gefunden');
    }
};

export const actions: Actions = {
    bookBed: async ({ request, locals }) => {
        const settings = await locals.pb.collection('app_settings').getOne('abcsettings123').catch(() => ({ is_booking_active: false }));
        if (!settings.is_booking_active) return fail(403, { error: 'Bookings are not open yet.' });

        const formData = await request.formData();
        const bedId = formData.get('bedId') as string;
        let guestName = formData.get('guestName') as string;

        if (!locals.orderNumber) return fail(401, { error: 'Sitzung abgelaufen' });

        if (!guestName || guestName.trim() === '') {
            guestName = getRandomName();
        }

        try {
            const order = await locals.pb.collection('orders').getFirstListItem(locals.pb.filter('order_number = {:orderNumber}', { orderNumber: locals.orderNumber }));
            
            // Check if bed exists and is available
            const bed = await locals.pb.collection('beds').getOne<BedsResponse>(bedId);
            if (bed.occupied && bed.order !== order.id) {
                return fail(400, { error: 'This spot is already claimed by another soul.' });
            }

            // 1. Release previous bookings 🕊️
            const previousBeds = await locals.pb.collection('beds').getFullList({
                filter: locals.pb.filter('order = {:orderId}', { orderId: order.id })
            });
            for (const prevBed of previousBeds) {
                if (prevBed.id !== bedId) {
                    await locals.pb.collection('beds').update(prevBed.id, { occupied: false, order: null });
                }
            }

            // 2. Update Order with new burner name 📛
            await locals.pb.collection('orders').update(order.id, { 
                burner_name: guestName 
            });

            // 3. Claim the new spot ✨
            await locals.pb.collection('beds').update(bedId, {
                occupied: true,
                order: order.id
            });

            return { success: true };
        } catch (err) {
            console.error(err);
            return fail(500, { error: 'The database turned into dust.' });
        }
    },

    unbookBed: async ({ locals }) => {
        const settings = await locals.pb.collection('app_settings').getOne('abcsettings123').catch(() => ({ is_booking_active: false }));
        if (!settings.is_booking_active) return fail(403, { error: 'Bookings are locked.' });

        if (!locals.orderNumber) return fail(401);
        try {
            const order = await locals.pb.collection('orders').getFirstListItem(locals.pb.filter('order_number = {:orderNumber}', { orderNumber: locals.orderNumber }));
            const beds = await locals.pb.collection('beds').getFullList({ filter: locals.pb.filter('order = {:orderId}', { orderId: order.id }) });
            
            for (const bed of beds) {
                await locals.pb.collection('beds').update(bed.id, { occupied: false, order: null });
            }
            return { success: true };
        } catch {
            return fail(500);
        }
    }
};