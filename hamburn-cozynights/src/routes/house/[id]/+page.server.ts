import { pb } from '$lib/pocketbase';
import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import type { HousesResponse, RoomsResponse, BedsResponse } from '$lib/pocketbase-types';

export const load: PageServerLoad = async ({ params }) => {
  try {
    const house = await pb.collection('houses').getOne<HousesResponse>(params.id);
    const rooms = await pb.collection('rooms').getFullList<RoomsResponse>({
      filter: `house = "${params.id}"`,
      sort: 'room_number'
    });
    
    // Betten laden für Statistik
    const beds = await pb.collection('beds').getFullList<BedsResponse>({
      filter: `room.house = "${params.id}"`
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