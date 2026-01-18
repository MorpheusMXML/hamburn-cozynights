import { pb } from '$lib/pocketbase';
import type { Actions, PageServerLoad } from './$types';
import type { HousesResponse, RoomsResponse, BedsResponse } from '$lib/pocketbase-types';

export const load: PageServerLoad = async ({ params }) => {
  const houseId = params.id;

  // 1. Haus laden
  const house = await pb.collection('houses').getOne<HousesResponse>(houseId);

  // 2. Räume laden
  const rooms = await pb.collection('rooms').getFullList<RoomsResponse>({
    filter: `house = "${houseId}"`,
    sort: 'room_number',
  });

  // 3. Betten laden (nur um die Auslastung pro Zimmer zu berechnen)
  const beds = await pb.collection('beds').getFullList<BedsResponse>({
    filter: `room.house = "${houseId}"`,
  });

  // 4. Statistik mappen: Wir fügen jedem Raum die Info hinzu, wie viele Betten belegt sind
  const roomsWithStats = rooms.map(room => {
    const roomBeds = beds.filter(b => b.room === room.id);
    const occupied = roomBeds.filter(b => b.occupied).length;
    return {
      ...room,
      stats: {
        total: roomBeds.length,
        occupied: occupied,
        free: roomBeds.length - occupied
      }
    };
  });

  return { house, rooms: roomsWithStats };
};

export const actions: Actions = {
  createRoom: async ({ request }) => {
    const data = await request.formData();
    const houseId = data.get('houseId') as string;

    await pb.collection('rooms').create({
      name: data.get('name'),
      room_number: parseInt(data.get('room_number') as string),
      amount_beds: parseInt(data.get('amount_beds') as string) || 0,
      house: houseId,
      occupied: false
    });
  },

  deleteRoom: async ({ request }) => {
    const data = await request.formData();
    await pb.collection('rooms').delete(data.get('id') as string);
  }
};