import { error, fail } from '@sveltejs/kit'; 
import type { Actions, PageServerLoad } from './$types';
import type { HousesResponse, RoomsResponse, BedsResponse } from '$lib/pocketbase-types';

export const load: PageServerLoad = async ({ params, locals }) => {
  // Security check 🛡️
  if (!locals.pb.authStore.isValid) throw error(403, 'Unauthorized');

  const houseId = params.id;

  try {
      // 1. Fetch house data 🏠
      const house = await locals.pb.collection('houses').getOne<HousesResponse>(houseId);

      // 2. Fetch rooms in this house 🚪
      const rooms = await locals.pb.collection('rooms').getFullList<RoomsResponse>({
        filter: locals.pb.filter('house = {:id}', { id: houseId }),
        sort: 'room_number',
      });

      // 3. Fetch all beds for these rooms 🛌
      const beds = await locals.pb.collection('beds').getFullList<BedsResponse>({
        filter: locals.pb.filter('room.house = {:id}', { id: houseId }),
      });

      // 4. Map statistics 📊
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
      throw error(404, 'Sanctuary not found.');
  }
};

export const actions: Actions = {
  createRoom: async ({ request, locals, params }) => {
    // SECURITY CHECK: Only verified burners can expand the sanctuary 🛡️
    if (!locals.pb.authStore.model?.verified) {
        return fail(403, { message: 'Only verified crew members can create rooms.' });
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
    // SECURITY CHECK: Only verified burners can remove rooms 🛡️
    if (!locals.pb.authStore.model?.verified) {
        return fail(403, { message: 'Only verified crew members can delete rooms.' });
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