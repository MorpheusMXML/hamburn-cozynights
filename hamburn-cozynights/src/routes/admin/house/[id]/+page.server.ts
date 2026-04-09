import { error, fail } from '@sveltejs/kit'; 
import type { Actions, PageServerLoad } from './$types';
import type { HousesResponse, RoomsResponse, BedsResponse } from '$lib/pocketbase-types';

export const load: PageServerLoad = async ({ params, locals }) => {
  // Security check 🛡️
  if (!locals.pb.authStore.isValid) throw error(403, 'Unauthorized');

  const houseId = params.id;

  try {
      // 1. Fetch house data 🏠
      const house = await locals.pb.collection('houses').getOne<HousesResponse>(houseId);

      // 2. Fetch rooms in this house 🚪
      const rooms = await locals.pb.collection('rooms').getFullList<RoomsResponse>({
        filter: locals.pb.filter('house = {:id}', { id: houseId }),
        sort: 'room_number',
      });

      // 3. Fetch all beds for these rooms 🛌
      const beds = await locals.pb.collection('beds').getFullList<BedsResponse>({
        filter: locals.pb.filter('room.house = {:id}', { id: houseId }),
      });

      // 4. Fetch app settings for booking status
      const settings = await locals.pb.collection('app_settings').getOne('abcsettings123').catch(() => ({ is_booking_active: false }));

      // 5. Map statistics 📊
      const roomsWithStats = rooms.map((room) => {
        const roomBeds = beds.filter((b) => b.room === room.id && b.enabled !== false);
        const occupied = roomBeds.filter((b) => b.occupied).length;
        
        return {
          ...room,
          stats: {
            total: roomBeds.length,
            occupied: occupied,
            free: roomBeds.length - occupied
          }
        };
      });

      return { house, rooms: roomsWithStats, isBookingActive: !!settings.is_booking_active };
  } catch (err) {
      console.error(err);
      throw error(404, 'House not found.');
  }
};

export const actions: Actions = {
  createRoom: async ({ request, locals, params }) => {
    const settings = await locals.pb.collection('app_settings').getOne('abcsettings123').catch(() => ({ is_booking_active: false }));
    if (settings.is_booking_active) return fail(403, { message: 'Management locked during live booking.' });

    console.log(`[Action:createRoom] User: ${locals.pb.authStore.model?.email}, Verified: ${locals.pb.authStore.model?.verified}, House: ${params.id}`);
    
    if (!locals.pb.authStore.model?.verified) {
        console.error('[Action:createRoom] BLOCKED: User not verified.');
        return fail(403, { message: 'Only verified crew members can create rooms.' });
    }

    const data = await request.formData();
    const houseId = params.id; 
    const amountBeds = parseInt(data.get('amount_beds') as string || '0');

    try {
        const room = await locals.pb.collection('rooms').create({
          name: data.get('name'),
          room_number: parseInt(data.get('room_number') as string),
          amount_beds: amountBeds,
          house: houseId
        });

        // Automatically create bed templates
        if (amountBeds > 0) {
            for (let i = 1; i <= amountBeds; i++) {
                await locals.pb.collection('beds').create({
                    label: `Spot ${i}`,
                    room: room.id,
                    enabled: false,
                    occupied: false
                });
            }
        }

        console.log('[Action:createRoom] SUCCESS.');
    } catch (err) {
        console.error('[Action:createRoom] FAILED:', err);
        return fail(500, { error: true });
    }
  },

  deleteRoom: async ({ request, locals }) => {
    const settings = await locals.pb.collection('app_settings').getOne('abcsettings123').catch(() => ({ is_booking_active: false }));
    if (settings.is_booking_active) return fail(403, { message: 'Management locked during live booking.' });

    console.log(`[Action:deleteRoom] User: ${locals.pb.authStore.model?.email}`);
    
    if (!locals.pb.authStore.model?.verified) {
        console.error('[Action:deleteRoom] BLOCKED: User not verified.');
        return fail(403, { message: 'Only verified crew members can delete rooms.' });
    }

    const data = await request.formData();
    const id = data.get('id') as string;
    
    try {
        if (id) await locals.pb.collection('rooms').delete(id);
        console.log(`[Action:deleteRoom] SUCCESS for ${id}`);
    } catch (err) {
        console.error(`[Action:deleteRoom] FAILED for ${id}:`, err);
        return fail(500, { error: true });
    }
  }
};