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

    // 3. Fetch all beds in this sanctuary room 🛌
    const beds = await locals.pb.collection('beds').getFullList<BedsResponse>({
      filter: locals.pb.filter('room = {:roomId}', { roomId: roomId }), 
      sort: 'label'
    });

    return { room, beds };

  } catch (err) {
    console.error("Error fetching sanctuary spots:", err);
    throw error(404, 'Sanctuary room lost in the dust.');
  }
};

export const actions: Actions = {
  createBed: async ({ request, params, locals }) => {
    // SECURITY CHECK: Only verified burners can expand the sanctuary 🛡️
    if (!locals.pb.authStore.model?.verified) {
        return fail(403, { message: 'Only verified crew members can add spots.' });
    }

    const data = await request.formData();
    
    try {
        await locals.pb.collection('beds').create({
            label: data.get('label'),
            room: params.id, 
            occupied: false
        });
    } catch {
        return fail(500, { error: true });
    }
  },

  deleteBed: async ({ request, locals }) => {
    // SECURITY CHECK: Only verified burners can remove spots 🛡️
    if (!locals.pb.authStore.model?.verified) {
        return fail(403, { message: 'Only verified crew members can delete spots.' });
    }

    const data = await request.formData();
    const id = data.get('id') as string;
    
    if (id) await locals.pb.collection('beds').delete(id);
  },
  
  toggleOccupied: async ({ request, locals }) => {
      const data = await request.formData();
      const id = data.get('id') as string;
      const occupied = data.get('occupied') === 'true';
      
      await locals.pb.collection('beds').update(id, { occupied: !occupied });
  }
};