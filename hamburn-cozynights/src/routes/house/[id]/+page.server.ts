// src/routes/house/[id]/+page.server.ts
import { error, fail, redirect } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import type { HousesResponse, RoomsResponse, BedsResponse } from '$lib/pocketbase-types';
import { BookingService } from '$lib/server/booking';

export const load: PageServerLoad = async ({ params, locals }) => {
  if (!locals.orderNumber) throw redirect(303, '/');
  
  const bookingService = new BookingService(locals.adminPb);
  const order = await bookingService.getOrderByNumber(locals.orderNumber);
  
  if (!order) {
      console.error('[Security] House load: Order not found for code:', locals.orderNumber);
      throw redirect(303, '/');
  }

  try {
    const [house, rooms, beds, settings, userBed] = await Promise.all([
        locals.pb.collection('houses').getOne<HousesResponse>(params.id),
        locals.pb.collection('rooms').getFullList<RoomsResponse>({
            filter: locals.pb.filter('house = {:id}', { id: params.id }),
            sort: 'room_number'
        }),
        locals.pb.collection('beds').getFullList<BedsResponse>({
            filter: locals.pb.filter('room.house = {:id}', { id: params.id })
        }),
        locals.pb.collection('app_settings').getOne('abcsettings123').catch(() => ({ is_booking_active: false, booking_unlock_at: "" })),
        bookingService.getBedForOrder(order.id)
    ]);

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
        if (!locals.adminPb.authStore.isValid) {
            console.error('[Security] House unbookBed: Admin auth invalid.');
            return fail(500, { error: 'System authentication failed.' });
        }

        const settings = await locals.pb.collection('app_settings').getOne('abcsettings123').catch(() => ({ is_booking_active: false }));
        if (!settings.is_booking_active) return fail(403, { error: 'Bookings are locked.' });

        if (!locals.orderNumber) return fail(401);

        const bookingService = new BookingService(locals.adminPb);
        const order = await bookingService.getOrderByNumber(locals.orderNumber);
        if (!order) return fail(404, { error: 'Order not found.' });

        try {
            await bookingService.unbookOrder(order.id);
            return { success: true };
        } catch (err: any) {
            console.error('[Security] House unbookBed failed:', err);
            return fail(500, { error: `Spot release failed: ${err.message}` });
        }
    }
};
