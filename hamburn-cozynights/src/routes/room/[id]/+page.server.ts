import { pb } from '$lib/pocketbase';
import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import type { RoomsResponse, BedsResponse, OrdersResponse } from '$lib/pocketbase-types';

export const load: PageServerLoad = async ({ params, locals }) => {
  // Security check: Redirect to home if no booking code is present in cookies
  if (!locals.orderNumber) {
    throw redirect(303, '/');
  }

  try {
    // 1. Fetch the room details
    const room = await pb.collection('rooms').getOne<RoomsResponse>(params.id);
    
    // 2. Fetch all beds in this room and expand their associated orders
    const beds = await pb.collection('beds').getFullList<BedsResponse<{ order?: OrdersResponse }>>({
      filter: `room = "${params.id}"`,
      sort: 'label',
      expand: 'order' 
    });

    // These values populate the 'data' prop in your +page.svelte
    return { 
      room, 
      beds, 
      currentOrderCode: locals.orderNumber 
    };
  } catch {
    throw error(404, 'Room not found');
  }
};

export const actions: Actions = {
  bookBed: async ({ request, locals }) => {
    const formData = await request.formData();
    const bedId = formData.get('bedId') as string;
    const guestName = formData.get('guestName') as string;

    if (!locals.orderNumber) {
        return fail(401, { error: 'No booking code found.' });
    }

    try {
        const order = await pb.collection('orders').getFirstListItem(`order_number = "${locals.orderNumber}"`);

        // Clear any previous bed linked to this specific order ID
        const previousBeds = await pb.collection('beds').getFullList({
            filter: `order = "${order.id}"`
        });
        
        for (const prevBed of previousBeds) {
            await pb.collection('beds').update(prevBed.id, { occupied: false, order: null });
        }

        // Update the name on the existing order
        if (guestName) {
            await pb.collection('orders').update(order.id, { customer_name: guestName });
        }

        // Link the new bed to the existing order
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