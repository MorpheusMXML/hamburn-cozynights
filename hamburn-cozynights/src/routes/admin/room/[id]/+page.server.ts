import { error } from '@sveltejs/kit'; // "pb" Import entfernen!
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals }) => {
  // Sicherheitscheck
  if (!locals.pb.authStore.isValid) throw error(403, 'Unauthorized');

  const roomId = params.id;

  try {
    // 1. Zimmer-Infos laden (locals.pb nutzen!)
    const room = await locals.pb.collection('rooms').getOne(roomId, {
        expand: 'house' // Nützlich für Breadcrumbs
    });

    // 2. Betten laden
    const beds = await locals.pb.collection('beds').getFullList({
      filter: `room = "${roomId}"`, 
      sort: 'label'
    });

    return { room, beds };

  } catch (err) {
    console.error("Fehler beim Laden der Betten:", err);
    throw error(404, 'Zimmer nicht gefunden oder Datenbank-Fehler');
  }
};

export const actions: Actions = {
  createBed: async ({ request, params, locals }) => {
    const data = await request.formData();
    
    await locals.pb.collection('beds').create({
      label: data.get('label'),
      room: params.id, 
      occupied: false
    });
  },

  deleteBed: async ({ request, locals }) => {
    const data = await request.formData();
    const id = data.get('id') as string;
    if (id) await locals.pb.collection('beds').delete(id);
  }
};