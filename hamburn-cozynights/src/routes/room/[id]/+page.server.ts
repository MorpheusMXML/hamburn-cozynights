import { pb } from '$lib/pocketbase';
import type { Actions, PageServerLoad } from './$types';
import { error, fail } from '@sveltejs/kit';
// Types importieren (Passe den Pfad ggf. an)
import type { RoomsResponse, BedsResponse, OrdersResponse } from '$lib/pocketbase-types';

export const load: PageServerLoad = async ({ params }) => {
  try {
    const room = await pb.collection('rooms').getOne<RoomsResponse>(params.id);
    
    // Wir laden Betten UND expandieren die Order, falls vorhanden
    const beds = await pb.collection('beds').getFullList<BedsResponse<{ order?: OrdersResponse }>>({
      filter: `room = "${params.id}"`,
      sort: 'label',
      expand: 'order' 
    });

    return { room, beds };
  } catch (e) {
    throw error(404, 'Raum nicht gefunden');
  }
};

export const actions: Actions = {
  bookBed: async ({ request }) => {
    const formData = await request.formData();
    const bedId = formData.get('bedId') as string;
    const guestName = formData.get('guestName') as string;

    if (!guestName || !bedId) {
      return fail(400, { missing: true });
    }

    try {
      // 1. Order erstellen
      // Hinweis: 'orders' Collection muss customer_name Feld haben
      const order = await pb.collection('orders').create({
        customer_name: guestName,
        order_number: `ORD-${Date.now()}` // Simple Order Number Generation
      });

      // 2. Bett updaten (Occupied + Link zur Order)
      await pb.collection('beds').update(bedId, {
        occupied: true,
        order: order.id
      });

      return { success: true };
    } catch (err) {
      console.error(err);
      return fail(500, { error: 'Datenbankfehler beim Buchen.' });
    }
  }
};