import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import type { HousesResponse, RoomsResponse, BedsResponse } from '$lib/pocketbase-types';

export const load: PageServerLoad = async ({ params, locals }) => {
  try {
    const house = await locals.pb.collection('houses').getOne<HousesResponse>(params.id);
    const rooms = await locals.pb.collection('rooms').getFullList<RoomsResponse>({
      filter: locals.pb.filter('house = {:id}', { id: params.id }),
      sort: 'room_number'
    });
    
    // Betten laden für Statistik
    const beds = await locals.pb.collection('beds').getFullList<BedsResponse>({
      filter: locals.pb.filter('room.house = {:id}', { id: params.id })
    });

    // Statistik berechnen
    const roomsWithStats = rooms.map(room => {
      const roomBeds = beds.filter(b => b.room === room.id);
      const freeCount = roomBeds.filter(b => !b.occupied).length;
      return { ...room, freeCount, totalCount: roomBeds.length };
    });

    return { house, rooms: roomsWithStats };
  } catch {
    throw error(404, 'Haus nicht gefunden');
  }
};