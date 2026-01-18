// src/routes/admin/room/[id]/+page.server.ts
import { pb } from '$lib/pocketbase';
import { error } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
  const roomId = params.id;

  try {
    // 1. Zimmer-Infos laden
    const room = await pb.collection('rooms').getOne(roomId);

    // 2. Betten laden
    const beds = await pb.collection('beds').getFullList({
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
  // WICHTIG: Muss 'createBed' heißen, passend zu action="?/createBed" im Formular
  createBed: async ({ request, params }) => {
    const data = await request.formData();
    
    // guest_name entfernt, da nicht im Schema vorhanden
    await pb.collection('beds').create({
      label: data.get('label'),
      room: params.id, // ID aus der URL
      occupied: false
    });
  },

  // Wir nennen das hier auch spezifisch 'deleteBed'
  deleteBed: async ({ request }) => {
    const data = await request.formData();
    await pb.collection('beds').delete(data.get('id') as string);
  }
};