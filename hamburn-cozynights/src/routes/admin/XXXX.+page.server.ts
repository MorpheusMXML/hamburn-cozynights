// src/routes/admin/+page.server.ts
import { pb } from '$lib/pocketbase';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
  try {
    // Versuch, die Daten zu laden
    const houses = await pb.collection('houses').getFullList({ sort: 'name' });
    return { houses };
  } catch (err) {
    console.error("PocketBase Fehler:", err);
    // Gib ein leeres Array zurück, damit die Seite trotzdem lädt
    return { houses: [], error: 'Datenbank nicht erreichbar oder leer.' };
  }
}

export const actions: Actions = {
  create: async ({ request }) => {
    const data = await request.formData();
    const name = data.get('name');
    
    // Neues Haus erstellen (Default x/y Koordinaten)
    await pb.collection('houses').create({
      name,
      occupied: false,
      x: 100, 
      y: 100
    });
  },
  delete: async ({ request }) => {
    const data = await request.formData();
    const id = data.get('id') as string;
    await pb.collection('houses').delete(id);
  }
};