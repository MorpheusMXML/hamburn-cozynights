import { error, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import type { RoomsResponse, BedsResponse, HousesResponse } from '$lib/pocketbase-types';

// 1. Definiere den Typ inkl. "expand"
type RoomWithHouse = RoomsResponse<{ house: HousesResponse }>;

export const load: PageServerLoad = async ({ params, locals }) => {
  if (!locals.pb.authStore.isValid) throw error(403, 'Unauthorized');

  const roomId = params.id;

  try {
    // 2. Nutze den Typ beim Laden: getOne<RoomWithHouse>
    const room = await locals.pb.collection('rooms').getOne<RoomWithHouse>(roomId, {
        expand: 'house' 
    });

    // Betten laden
    const beds = await locals.pb.collection('beds').getFullList<BedsResponse>({
      filter: `room = "${roomId}"`, 
      sort: 'label'
    });

    return { room, beds };

  } catch (err) {
    console.error("Fehler beim Laden der Betten:", err);
    throw error(404, 'Zimmer nicht gefunden');
  }
};

export const actions: Actions = {
  createBed: async ({ request, params, locals }) => {
    // SICHERHEITS-CHECK
    if (!locals.pb.authStore.model?.verified) {
        return fail(403, { message: 'Nur verifizierte Nutzer dürfen Betten hinzufügen.' });
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
    // SICHERHEITS-CHECK
    if (!locals.pb.authStore.model?.verified) {
        return fail(403, { message: 'Nur verifizierte Nutzer dürfen Betten löschen.' });
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