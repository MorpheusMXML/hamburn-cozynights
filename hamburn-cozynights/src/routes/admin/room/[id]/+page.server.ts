// src/routes/admin/room/[id]/+page.server.ts
import { pb } from '$lib/pocketbase';
import { error } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
  const roomId = params.id;

  try {
    // 1. Zimmer-Infos laden (für Überschrift/Zurück-Button)
    const room = await pb.collection('rooms').getOne(roomId);

    // 2. Betten laden, die zu diesem Zimmer gehören
    // Wir filtern nach dem Feld "room" (das wir oben in Schritt 1 angelegt haben)
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

// Aktionen zum Erstellen/Löschen von Betten
export const actions: Actions = {
  create: async ({ request, params }) => {
    const data = await request.formData();
    await pb.collection('beds').create({
      label: data.get('label'),
      room: params.id, // Verknüpfung zum aktuellen Zimmer
      occupied: false,
      guest_name: ''
    });
  },
  delete: async ({ request }) => {
    const data = await request.formData();
    await pb.collection('beds').delete(data.get('id') as string);
  }
};