import { error, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import type { RoomsResponse, BedsResponse, HousesResponse } from '$lib/pocketbase-types';

// 1. Define the type including "expand" for related records 🔗
type RoomWithHouse = RoomsResponse<{ house: HousesResponse }>;

export const load: PageServerLoad = async ({ params, locals }) => {
  if (!locals.pb.authStore.isValid) throw error(403, 'Unauthorized');

  const roomId = params.id;

  try {
    // 2. Fetch room with its parent house expanded 🏠
    const room = await locals.pb.collection('rooms').getOne<RoomWithHouse>(roomId, {
        expand: 'house' 
    });

    // 3. Fetch all beds in this house room 🛌
    const beds = await locals.pb.collection('beds').getFullList<BedsResponse>({
      filter: locals.pb.filter('room = {:roomId}', { roomId: roomId }), 
      sort: 'label'
    });

    return { room, beds };

  } catch (err) {
    console.error("Error fetching house spots:", err);
    throw error(404, 'House room lost in the dust.');
  }
};

export const actions: Actions = {
  createBed: async ({ request, params, locals }) => {
    console.log(`[Action:createBed] User: ${locals.pb.authStore.model?.email}, Room: ${params.id}`);
    
    if (!locals.pb.authStore.model?.verified) {
        console.error('[Action:createBed] BLOCKED: User not verified.');
        return fail(403, { message: 'Only verified crew members can add spots.' });
    }

    const data = await request.formData();
    
    try {
        await locals.pb.collection('beds').create({
            label: data.get('label'),
            room: params.id, 
            occupied: false
        });
        console.log('[Action:createBed] SUCCESS.');
    } catch (err) {
        console.error('[Action:createBed] FAILED:', err);
        return fail(500, { error: true });
    }
  },

  deleteBed: async ({ request, locals }) => {
    console.log(`[Action:deleteBed] User: ${locals.pb.authStore.model?.email}`);
    
    if (!locals.pb.authStore.model?.verified) {
        console.error('[Action:deleteBed] BLOCKED: User not verified.');
        return fail(403, { message: 'Only verified crew members can delete spots.' });
    }

    const data = await request.formData();
    const id = data.get('id') as string;
    
    try {
        if (id) await locals.pb.collection('beds').delete(id);
        console.log(`[Action:deleteBed] SUCCESS for ${id}`);
    } catch (err) {
        console.error(`[Action:deleteBed] FAILED for ${id}:`, err);
        return fail(500);
    }
  },
  
  toggleOccupied: async ({ request, locals }) => {
      const data = await request.formData();
      const id = data.get('id') as string;
      const occupied = data.get('occupied') === 'true';
      
      console.log(`[Action:toggleOccupied] User: ${locals.pb.authStore.model?.email}, ID: ${id}, Target: ${!occupied}`);
      
      try {
          await locals.pb.collection('beds').update(id, { occupied: !occupied });
          console.log('[Action:toggleOccupied] SUCCESS.');
      } catch (err) {
          console.error('[Action:toggleOccupied] FAILED:', err);
      }
  }
};