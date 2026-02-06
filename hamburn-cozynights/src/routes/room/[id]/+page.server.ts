// src/routes/room/[id]/+page.server.ts
import { pb } from '$lib/pocketbase';
import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import type { RoomsResponse, BedsResponse, OrdersResponse } from '$lib/pocketbase-types';

export const load: PageServerLoad = async ({ params, locals }) => {
  // If the user isn't logged in with a code, send them back to home
  if (!locals.orderNumber) throw redirect(303, '/');

  try {
    const room = await pb.collection('rooms').getOne<RoomsResponse>(params.id);
    const beds = await pb.collection('beds').getFullList<BedsResponse<{ order?: OrdersResponse }>>({
      filter: `room = "${params.id}"`,
      sort: 'label',
      expand: 'order' 
    });

    return { room, beds };
  } catch {
    throw error(404, 'Room not found');
  }
};

export const actions: Actions = {
  bookBed: async ({ request, locals }) => {
    const formData = await request.formData();
    const bedId = formData.get('bedId') as string;
    const guestName = formData.get('guestName') as string;

    if (!locals.orderNumber) return fail(401, { error: 'Session expired' });

    try {
        // 1. Get the existing Order ID using the persistent booking code
        const order = await pb.collection('orders').getFirstListItem(`order_number = "${locals.orderNumber}"`);

        // 2. Clear any existing bed linked to this Order (to allow moving beds)
        const previousBeds = await pb.collection('beds').getFullList({
            filter: `order = "${order.id}"`
        });
        
        for (const prevBed of previousBeds) {
            await pb.collection('beds').update(prevBed.id, { occupied: false, order: null });
        }

        // 3. Update the customer name on the existing order
        if (guestName) {
            await pb.collection('orders').update(order.id, { customer_name: guestName });
        }

        // 4. Link the new bed to the existing order
        await pb.collection('beds').update(bedId, {
            occupied: true,
            order: order.id
        });

        return { success: true };
    } catch (err) {
        console.error(err);
        return fail(500, { error: 'Database error during booking.' });
    }
  }
};