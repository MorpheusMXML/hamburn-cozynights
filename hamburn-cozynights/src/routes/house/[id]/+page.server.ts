import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import type { HousesResponse, RoomsResponse, BedsResponse } from '$lib/pocketbase-types';

export const load: PageServerLoad = async ({ params, locals }) => {
  try {
    const [house, rooms, beds, settings] = await Promise.all([
        locals.pb.collection('houses').getOne<HousesResponse>(params.id),
        locals.pb.collection('rooms').getFullList<RoomsResponse>({
            filter: locals.pb.filter('house = {:id}', { id: params.id }),
            sort: 'room_number'
        }),
        locals.pb.collection('beds').getFullList<BedsResponse>({
            filter: locals.pb.filter('room.house = {:id}', { id: params.id })
        }),
        locals.pb.collection('app_settings').getOne('abcsettings123').catch(() => ({ is_booking_active: false }))
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
        isBookingActive: settings.is_booking_active,
        bookingUnlockAt: settings.booking_unlock_at
    };
  } catch {
    throw error(404, 'House not found in the dust.');
  }
};