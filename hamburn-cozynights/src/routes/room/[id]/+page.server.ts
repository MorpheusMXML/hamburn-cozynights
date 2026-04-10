// src/routes/room/[id]/+page.server.ts
import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import type { RoomsResponse, BedsResponse, OrdersResponse } from '$lib/pocketbase-types';
import { encrypt, decrypt, createLookupHash } from '$lib/server/crypto';

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
        const orderHash = createLookupHash(locals.orderNumber);
        const settings = await locals.pb.collection('app_settings').getOne('abcsettings123').catch(() => ({ is_booking_active: false, booking_unlock_at: "" }));

        // Use adminPb to find order (try hash first, then raw number)
        let order;
        try {
            order = await locals.adminPb.collection('orders').getFirstListItem<OrdersResponse>(
                locals.adminPb.filter('order_hash = {:orderHash}', { orderHash })
            );
        } catch (hashErr: any) {
            // If field doesn't exist (400) or not found (404), fall back to order_number
            try {
                order = await locals.adminPb.collection('orders').getFirstListItem<OrdersResponse>(
                    locals.adminPb.filter('order_number = {:orderNumber}', { orderNumber: locals.orderNumber })
                );
                
                // Optional: Try to auto-migrate if field exists
                await locals.adminPb.collection('orders').update(order.id, { order_hash: orderHash }).catch(() => {
                    // Silently ignore if field missing in DB schema
                });
            } catch (numErr) {
                throw error(404, 'Buchungscode ungültig oder nicht gefunden.');
            }
        }

        const userBed = await locals.adminPb.collection('beds').getFirstListItem(
            locals.adminPb.filter('order = {:orderId}', { orderId: order.id })
        ).catch(() => null);

        const room = await locals.pb.collection('rooms').getOne<RoomsResponse>(params.id);

        // Fetch beds and expand order (via adminPb to get expanded order data)
        const beds = await locals.adminPb.collection('beds').getFullList<BedsResponse<{ order?: OrdersResponse }>>({
            filter: locals.adminPb.filter('room = {:roomId}', { roomId: params.id }),
            sort: 'label',
            expand: 'order'
        });

        // Decrypt burner names for display
        const decryptedBeds = beds.map(bed => {
            if (bed.expand?.order?.burner_name) {
                try {
                    bed.expand.order.burner_name = decrypt(bed.expand.order.burner_name);
                } catch { /* skip if not encrypted */ }
            }
            return bed;
        });

        return {
            room,
            beds: decryptedBeds,
            userBedId: userBed?.id || null,
            currentOrderNumber: locals.orderNumber,
            isBookingActive: settings.is_booking_active,
            bookingUnlockAt: settings.booking_unlock_at || ""
        };
    } catch (err: any) {
        console.error('[Security] Room load failed:', err);
        if (err?.status === 404 && err?.message?.includes('rooms')) {
            throw error(404, 'Raum nicht gefunden.');
        }
        throw error(404, 'Raum nicht gefunden oder Buchungscode ungültig');
    }
};

export const actions: Actions = {
    bookBed: async ({ request, locals }) => {
        const settings = await locals.pb.collection('app_settings').getOne('abcsettings123').catch(() => ({ is_booking_active: false, booking_unlock_at: "" }));
        if (!settings.is_booking_active) return fail(403, { error: 'Bookings are not open yet.' });

        const formData = await request.formData();
        const bedId = formData.get('bedId') as string;
        let guestName = formData.get('guestName') as string;

        if (!locals.orderNumber) return fail(401, { error: 'Sitzung abgelaufen' });

        if (!guestName || guestName.trim() === '') {
            guestName = getRandomName();
        }

        try {
            const orderHash = createLookupHash(locals.orderNumber);
            let order;
            try {
                order = await locals.adminPb.collection('orders').getFirstListItem<OrdersResponse>(
                    locals.adminPb.filter('order_hash = {:orderHash}', { orderHash })
                );
            } catch (hashErr) {
                // Fallback to order_number
                order = await locals.adminPb.collection('orders').getFirstListItem<OrdersResponse>(
                    locals.adminPb.filter('order_number = {:orderNumber}', { orderNumber: locals.orderNumber })
                );
                // Try to migrate
                await locals.adminPb.collection('orders').update(order.id, { order_hash: orderHash }).catch(() => {});
            }
            
            // Check if bed exists and is available
            const bed = await locals.adminPb.collection('beds').getOne<BedsResponse>(bedId);
            
            // SECURITY: Check if bed is locked by admin
            if (bed.is_locked && !locals.user?.verified) {
                return fail(403, { error: 'This bed is currently under maintenance or blocked by an admin.' });
            }

            if (bed.occupied && bed.order !== order.id) {
                return fail(400, { error: 'This spot is already claimed by another soul.' });
            }

            // 1. Release previous bookings 🕊️
            const previousBeds = await locals.adminPb.collection('beds').getFullList({
                filter: locals.adminPb.filter('order = {:orderId}', { orderId: order.id })
            });
            for (const prevBed of previousBeds) {
                if (prevBed.id !== bedId) {
                    await locals.adminPb.collection('beds').update(prevBed.id, { occupied: false, order: null });
                }
            }

            // 2. Update Order with new encrypted burner name 📛
            await locals.adminPb.collection('orders').update(order.id, { 
                burner_name: encrypt(guestName) 
            });

            // 3. Claim the new spot ✨
            await locals.adminPb.collection('beds').update(bedId, {
                occupied: true,
                order: order.id
            });

            return { success: true };
        } catch (err) {
            console.error('[Security] bookBed failed:', err);
            return fail(500, { error: 'The database turned into dust.' });
        }
    },

    unbookBed: async ({ locals }) => {
        const settings = await locals.pb.collection('app_settings').getOne('abcsettings123').catch(() => ({ is_booking_active: false, booking_unlock_at: "" }));
        if (!settings.is_booking_active) return fail(403, { error: 'Bookings are locked.' });

        if (!locals.orderNumber) return fail(401);
        try {
            const orderHash = createLookupHash(locals.orderNumber);
            let order;
            try {
                order = await locals.adminPb.collection('orders').getFirstListItem<OrdersResponse>(
                    locals.adminPb.filter('order_hash = {:orderHash}', { orderHash })
                );
            } catch (hashErr) {
                // Fallback to order_number
                order = await locals.adminPb.collection('orders').getFirstListItem<OrdersResponse>(
                    locals.adminPb.filter('order_number = {:orderNumber}', { orderNumber: locals.orderNumber })
                );
                // Try to migrate
                await locals.adminPb.collection('orders').update(order.id, { order_hash: orderHash }).catch(() => {});
            }
            const beds = await locals.adminPb.collection('beds').getFullList({ 
                filter: locals.adminPb.filter('order = {:orderId}', { orderId: order.id }) 
            });
            
            for (const bed of beds) {
                await locals.adminPb.collection('beds').update(bed.id, { occupied: false, order: null });
            }
            return { success: true };
        } catch (err: any) {
            console.error('[Security] unbookBed failed:', err);
            return fail(500, { error: `Spot release failed: ${err.message || 'Database error'}` });
        }
    }
};
