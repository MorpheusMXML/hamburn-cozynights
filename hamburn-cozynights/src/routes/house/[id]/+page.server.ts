import { error, fail, redirect } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import type { HousesResponse, RoomsResponse, BedsResponse, OrdersResponse } from '$lib/pocketbase-types';
import { createLookupHash } from '$lib/server/crypto';

export const load: PageServerLoad = async ({ params, locals }) => {
  if (!locals.orderNumber) throw redirect(303, '/');

  try {
    const orderHash = createLookupHash(locals.orderNumber);
    const [house, rooms, beds, settings] = await Promise.all([
        locals.pb.collection('houses').getOne<HousesResponse>(params.id),
        locals.pb.collection('rooms').getFullList<RoomsResponse>({
            filter: locals.pb.filter('house = {:id}', { id: params.id }),
            sort: 'room_number'
        }),
        locals.pb.collection('beds').getFullList<BedsResponse>({
            filter: locals.pb.filter('room.house = {:id}', { id: params.id })
        }),
        locals.pb.collection('app_settings').getOne('abcsettings123').catch(() => ({ is_booking_active: false, booking_unlock_at: "" }))
    ]);

    // Check if user has a bed in ANY house/room
    const userBed = await locals.adminPb.collection('beds').getFirstListItem(
        locals.adminPb.filter('order.order_hash = {:orderHash}', { orderHash })
    ).catch(() => null);

    // Calculate occupancy 👥
    const roomsWithStats = rooms.map(room => {
      const roomBeds = beds.filter(b => b.room === room.id);
      const freeCount = roomBeds.filter(b => !b.occupied).length;
      return { ...room, freeCount, totalCount: roomBeds.length };
    });

    return { 
        house, 
        rooms: roomsWithStats,
        userBedId: userBed?.id || null,
        isBookingActive: settings.is_booking_active,
        bookingUnlockAt: settings.booking_unlock_at || ""
    };
  } catch (err) {
    console.error('[Security] House load failed:', err);
    throw error(404, 'House not found in the dust.');
  }
};

export const actions: Actions = {
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
                order = await locals.adminPb.collection('orders').getFirstListItem<OrdersResponse>(
                    locals.adminPb.filter('order_number = {:orderNumber}', { orderNumber: locals.orderNumber })
                );
                await locals.adminPb.collection('orders').update(order.id, { order_hash: orderHash });
            }
            const beds = await locals.adminPb.collection('beds').getFullList({ 
                filter: locals.adminPb.filter('order = {:orderId}', { orderId: order.id }) 
            });

            for (const bed of beds) {
                await locals.adminPb.collection('beds').update(bed.id, { occupied: false, order: null });
            }
            return { success: true };
        } catch (err: any) {
            console.error('[Security] House unbookBed failed:', err);
            return fail(500, { error: `Spot release failed: ${err.message || 'Database error'}` });
        }
    }
};