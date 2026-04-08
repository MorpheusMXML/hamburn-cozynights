import { redirect, error, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import type { HousesResponse, BedsResponse, RoomsResponse } from '$lib/pocketbase-types';

type HouseStats = HousesResponse & {
  totalBeds: number;
  occupiedBeds: number;
  freeBeds: number;
  occupancyRate: number;
};

export const actions = {
    togglePhase: async ({ locals }) => {
        if (!locals.pb.authStore.model?.verified) return;
        
        const settings = await locals.pb.collection('app_settings').getOne('abcsettings123').catch(() => null);
        if (settings) {
            await locals.pb.collection('app_settings').update('abcsettings123', {
                is_booking_active: !settings.is_booking_active
            });
        } else {
            await locals.pb.collection('app_settings').create({
                id: 'abcsettings123',
                is_booking_active: true
            });
        }
    },
    setUnlockTimer: async ({ locals, request }) => {
        if (!locals.pb.authStore.model?.verified) return;
        const data = await request.formData();
        const date = data.get('unlockAt') as string;
        
        await locals.pb.collection('app_settings').update('abcsettings123', {
            booking_unlock_at: date ? new Date(date).toISOString() : ""
        });
    },
    cancelUnlockTimer: async ({ locals }) => {
        if (!locals.pb.authStore.model?.verified) return;
        await locals.pb.collection('app_settings').update('abcsettings123', {
            booking_unlock_at: ""
        });
    },
    updateHouseCoords: async ({ locals, request }) => {
        if (!locals.pb.authStore.model?.verified) return fail(403, { error: 'Unauthorized' });
        const data = await request.formData();
        const id = data.get('id') as string;
        const x = parseFloat(data.get('x') as string);
        const y = parseFloat(data.get('y') as string);
        
        try {
            const settings = await locals.pb.collection('app_settings').getOne('abcsettings123').catch(() => ({ is_booking_active: false }));
            if (settings.is_booking_active) {
                // Safeguard: Check occupancy only in LIVE mode
                const occupiedBeds = await locals.pb.collection('beds').getFullList({
                    filter: locals.pb.filter('room.house = {:id} && occupied = true', { id })
                });
                
                if (occupiedBeds.length > 0) {
                    return fail(400, { error: 'Cannot move house: It has active bookings in LIVE mode! 🔒' });
                }
            }

            await locals.pb.collection('houses').update(id, { x, y });
            console.log(`[Action] House ${id} coordinates synced: ${x}, ${y}`);
            return { success: true };
        } catch (err) {
            console.error(`[Action] Coord sync failed for ${id}:`, err);
            return fail(500, { error: 'Sync failed.' });
        }
    },
    deleteHouse: async ({ locals, request }) => {
        if (!locals.pb.authStore.model?.verified) return fail(403, { error: 'Unauthorized' });
        
        const data = await request.formData();
        const id = data.get('id') as string;
        
        console.log(`[Action] Attempting to vanish house: ${id}`);

        try {
            // 1. Check current phase
            const settings = await locals.pb.collection('app_settings').getOne('abcsettings123').catch(() => ({ is_booking_active: false }));
            const isLive = settings.is_booking_active;

            // 2. Check occupancy
            const occupiedBeds = await locals.pb.collection('beds').getFullList({
                filter: locals.pb.filter('room.house = {:id} && occupied = true', { id }),
                expand: 'room'
            });

            if (occupiedBeds.length > 0) {
                console.log(`[Action] Occupancy detected in House ${id}:`, 
                    occupiedBeds.map((b: any) => `Bed ${b.label} (Room ${b.expand?.room?.room_number})`).join(', ')
                );
                
                if (isLive) {
                    console.warn(`[Action] Vanish blocked: House ${id} has ${occupiedBeds.length} active bookings in LIVE mode.`);
                    return fail(400, { error: 'The playa says NO! 🛑 Cannot vanish a house with active bookings in LIVE mode.' });
                } else {
                    console.log(`[Action] Staging Mode: Clearing ${occupiedBeds.length} test bookings before vanishing house ${id}.`);
                    // In Staging Mode, we auto-clear test bookings before deletion
                    for (const bed of occupiedBeds) {
                        await locals.pb.collection('beds').update(bed.id, { occupied: false, order: null });
                    }
                }
            }

            // 3. Vanish the house and all linked modules
            // Note: We delete beds first, then rooms, then house to avoid foreign key violations
            const rooms = await locals.pb.collection('rooms').getFullList({
                filter: locals.pb.filter('house = {:id}', { id })
            });

            for (const room of rooms) {
                const beds = await locals.pb.collection('beds').getFullList({
                    filter: locals.pb.filter('room = {:id}', { id: room.id })
                });
                for (const bed of beds) {
                    await locals.pb.collection('beds').delete(bed.id);
                }
                await locals.pb.collection('rooms').delete(room.id);
            }

            await locals.pb.collection('houses').delete(id);
            console.log(`[Action] House ${id} fully evaporated from the playa. 🌪️`);
            
            return { success: true };

        } catch (err) {
            console.error(`[Action] Vanish failed for house ${id}:`, err);
            // PocketBase errors can be complex, let's extract the message
            return fail(500, { error: 'Vanish failed. The playa resisted your command.' });
        }
    },
    renameHouse: async ({ locals, request }) => {
        if (!locals.pb.authStore.model?.verified) return fail(403, { error: 'Unauthorized' });
        const data = await request.formData();
        const id = data.get('id') as string;
        const name = data.get('name') as string;
        
        if (!name) return fail(400, { error: 'Name is required' });

        try {
            await locals.pb.collection('houses').update(id, { name });
            console.log(`[Action] House ${id} renamed to: ${name}`);
            return { success: true };
        } catch (err) {
            console.error(`[Action] Rename failed for ${id}:`, err);
            return fail(500, { error: 'Update failed.' });
        }
    }
};

export const load: PageServerLoad = async ({ locals }) => {
  if (!locals.pb.authStore.isValid) {
      console.warn('[Security] Unauthorized access attempt detected on Admin Dashboard.');
      throw redirect(303, '/admin/login');
  }

  console.log(`[Dashboard] Initializing data for admin: ${locals.pb.authStore.model?.email}`);

  const [houses, allBeds, settings] = await Promise.all([
    locals.pb.collection('houses').getFullList<HousesResponse>({ sort: 'name' }),
    locals.pb.collection('beds').getFullList<BedsResponse<{ room: RoomsResponse }>>({ expand: 'room' }),
    locals.pb.collection('app_settings').getOne('abcsettings123').catch(() => ({ is_booking_active: false, booking_unlock_at: "" }))
  ]);

  // SELF-HEALING / AUDIT: Detect data inconsistencies 🛠️
  houses.forEach(house => {
      const bedsInHouse = allBeds.filter(b => b.expand?.room?.house === house.id);
      if (bedsInHouse.length === 0) {
          console.warn(`[Audit] Sanctuary "${house.name}" (${house.id}) has NO active beds/modules. Deployment incomplete.`);
      }
      if (house.x === 0 && house.y === 0) {
          console.warn(`[Audit] Sanctuary "${house.name}" (${house.id}) is located at ground zero (0,0). Manual relocation recommended.`);
      }
  });

  const housesWithStats: HouseStats[] = houses.map((house: HousesResponse) => {
    const bedsInHouse = allBeds.filter((b: BedsResponse<{ room: RoomsResponse }>) => {
        return b.expand?.room?.house === house.id;
    });

    const totalBeds = bedsInHouse.length;
    const occupiedBeds = bedsInHouse.filter((b: BedsResponse) => b.occupied === true).length;
    const freeBeds = Math.max(0, totalBeds - occupiedBeds);
    const occupancyRate = totalBeds > 0 ? Math.round((occupiedBeds / totalBeds) * 100) : 0;

    console.log(`[Dashboard] House ${house.name}: ${occupiedBeds}/${totalBeds} modules occupied.`);

    return {
      ...structuredClone(house),
      totalBeds,
      occupiedBeds,
      freeBeds,
      occupancyRate
    };
  });

  return { 
    houses: housesWithStats,
    isBookingActive: settings.is_booking_active,
    bookingUnlockAt: settings.booking_unlock_at || ""
  };
};