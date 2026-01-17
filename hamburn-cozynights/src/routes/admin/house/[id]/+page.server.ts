import { pb } from '$lib/pocketbase';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
  const houseId = params.id;
  
  // Haus Infos laden (für den Titel)
  const house = await pb.collection('houses').getOne(houseId);
  // Alle Räume dieses Hauses laden
  const rooms = await pb.collection('rooms').getFullList({
    filter: `link = "${houseId}"`,
    sort: 'room_number'
  });

  return { house, rooms };
};

export const actions: Actions = {
  create: async ({ request, params }) => {
    const data = await request.formData();
    const name = data.get('name');
    const room_number = data.get('room_number');
    
    await pb.collection('rooms').create({
      name,
      room_number,
      link: params.id, // Verknüpfung zum aktuellen Haus
      occupied: false,
      amount_beds: 0
    });
  },
  delete: async ({ request }) => {
    const data = await request.formData();
    await pb.collection('rooms').delete(data.get('id') as string);
  }
};

