import { error, fail } from '@sveltejs/kit'; 
import type { Actions, PageServerLoad } from './$types';
import type { HousesResponse, RoomsResponse, BedsResponse } from '$lib/pocketbase-types';

export const load: PageServerLoad = async ({ params, locals }) => {
  // Sicherheitscheck
  if (!locals.pb.authStore.isValid) throw error(403, 'Unauthorized');

  const houseId = params.id;

  try {
      // 1. Haus laden
      const house = await locals.pb.collection('houses').getOne<HousesResponse>(houseId);

      // 2. Räume laden
      const rooms = await locals.pb.collection('rooms').getFullList<RoomsResponse>({
        filter: `house = "${houseId}"`,
        sort: 'room_number',
      });

      // 3. Betten laden (für alle Räume dieses Hauses)
      const beds = await locals.pb.collection('beds').getFullList<BedsResponse>({
        filter: `room.house = "${houseId}"`,
      });

      // 4. Statistik mappen
      const roomsWithStats = rooms.map((room) => {
        const roomBeds = beds.filter((b) => b.room === room.id);
        const occupied = roomBeds.filter((b) => b.occupied).length;
        
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
  } catch (err) {
      console.error(err);
      throw error(404, 'Haus nicht gefunden');
  }
};

export const actions: Actions = {
  createRoom: async ({ request, locals, params }) => {
    // SICHERHEITS-CHECK
    if (!locals.pb.authStore.model?.verified) {
        return fail(403, { message: 'Nur verifizierte Nutzer dürfen Räume erstellen.' });
    }

    const data = await request.formData();
    const houseId = params.id; 

    try {
        await locals.pb.collection('rooms').create({
          name: data.get('name'),
          room_number: parseInt(data.get('room_number') as string),
          amount_beds: parseInt(data.get('amount_beds') as string || '0'),
          house: houseId
        });
    } catch (err) {
        console.error(err);
        return fail(500, { error: true });
    }
  },

  deleteRoom: async ({ request, locals }) => {
    // SICHERHEITS-CHECK
    if (!locals.pb.authStore.model?.verified) {
        return fail(403, { message: 'Nur verifizierte Nutzer dürfen Räume löschen.' });
    }

    const data = await request.formData();
    const id = data.get('id') as string;
    
    try {
        if (id) await locals.pb.collection('rooms').delete(id);
    } catch (err) {
        console.error(err);
        return fail(500, { error: true });
    }
  }
};