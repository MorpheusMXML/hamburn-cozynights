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
        console.log(`[Action:togglePhase] User: ${locals.pb.authStore.model?.email}, Verified: ${locals.pb.authStore.model?.verified}`);
        if (!locals.pb.authStore.model?.verified) {
            console.error('[Action:togglePhase] BLOCKED: User not verified.');
            return fail(403, { error: 'Unauthorized' });
        }
        
        try {
            const settings = await locals.pb.collection('app_settings').getOne('abcsettings123').catch(() => null);
            if (settings) {
                console.log(`[Action:togglePhase] Updating existing settings. Current: ${settings.is_booking_active}`);
                await locals.pb.collection('app_settings').update('abcsettings123', {
                    is_booking_active: !settings.is_booking_active
                });
            } else {
                console.log('[Action:togglePhase] Creating initial settings.');
                await locals.pb.collection('app_settings').create({
                    id: 'abcsettings123',
                    is_booking_active: true
                });
            }
            console.log('[Action:togglePhase] SUCCESS.');
        } catch (err) {
            console.error('[Action:togglePhase] FAILED:', err);
            return fail(500, { error: 'Toggle failed' });
        }
    },
    setUnlockTimer: async ({ locals, request }) => {
        console.log(`[Action:setUnlockTimer] User: ${locals.pb.authStore.model?.email}`);
        if (!locals.pb.authStore.model?.verified) return fail(403);
        const data = await request.formData();
        const date = data.get('unlockAt') as string;
        
        try {
            await locals.pb.collection('app_settings').update('abcsettings123', {
                booking_unlock_at: date ? new Date(date).toISOString() : ""
            });
            console.log(`[Action:setUnlockTimer] SUCCESS. Target: ${date}`);
        } catch (err) {
            console.error('[Action:setUnlockTimer] FAILED:', err);
            return fail(500);
        }
    },
    cancelUnlockTimer: async ({ locals }) => {
        console.log(`[Action:cancelUnlockTimer] User: ${locals.pb.authStore.model?.email}`);
        if (!locals.pb.authStore.model?.verified) return fail(403);
        try {
            await locals.pb.collection('app_settings').update('abcsettings123', {
                booking_unlock_at: ""
            });
            console.log('[Action:cancelUnlockTimer] SUCCESS.');
        } catch (err) {
            console.error('[Action:cancelUnlockTimer] FAILED:', err);
            return fail(500);
        }
    },
    updateHouseCoords: async ({ locals, request }) => {
        const data = await request.formData();
        const id = data.get('id') as string;
        const x = parseFloat(data.get('x') as string);
        const y = parseFloat(data.get('y') as string);
        
        console.log(`[Action:updateHouseCoords] User: ${locals.pb.authStore.model?.email}, ID: ${id}, New: (${x}, ${y})`);
        
        if (!locals.pb.authStore.model?.verified) {
            console.error('[Action:updateHouseCoords] BLOCKED: User not verified.');
            return fail(403, { error: 'Unauthorized' });
        }
        
        try {
            const settings = await locals.pb.collection('app_settings').getOne('abcsettings123').catch(() => ({ is_booking_active: false }));
            if (settings.is_booking_active) {
                const occupiedBeds = await locals.pb.collection('beds').getFullList({
                    filter: locals.pb.filter('room.house = {:id} && occupied = true', { id })
                });
                
                if (occupiedBeds.length > 0) {
                    console.warn(`[Action:updateHouseCoords] BLOCKED: House ${id} is occupied in LIVE mode.`);
                    return fail(400, { error: 'Cannot move house: It has active bookings in LIVE mode! 🔒' });
                }
            }

            await locals.pb.collection('houses').update(id, { x, y });
            console.log(`[Action:updateHouseCoords] SUCCESS for ${id}`);
            return { success: true };
        } catch (err) {
            console.error(`[Action:updateHouseCoords] FAILED for ${id}:`, err);
            return fail(500, { error: 'Sync failed.' });
        }
    },
    deleteHouse: async ({ locals, request }) => {
        const data = await request.formData();
        const id = data.get('id') as string;
        
        console.log(`[Action:deleteHouse] User: ${locals.pb.authStore.model?.email}, ID: ${id}`);
        
        if (!locals.pb.authStore.model?.verified) {
            console.error('[Action:deleteHouse] BLOCKED: User not verified.');
            return fail(403, { error: 'Unauthorized' });
        }
        
        try {
            const settings = await locals.pb.collection('app_settings').getOne('abcsettings123').catch(() => ({ is_booking_active: false }));
            const isLive = settings.is_booking_active;

            const occupiedBeds = await locals.pb.collection('beds').getFullList({
                filter: locals.pb.filter('room.house = {:id} && occupied = true', { id }),
                expand: 'room'
            });

            if (occupiedBeds.length > 0) {
                console.log(`[Action:deleteHouse] Occupancy detected in House ${id}:`, 
                    occupiedBeds.map((b: any) => `Bed ${b.label} (Room ${b.expand?.room?.room_number})`).join(', ')
                );
                
                if (isLive) {
                    console.warn(`[Action:deleteHouse] BLOCKED: House ${id} has active bookings in LIVE mode.`);
                    return fail(400, { error: 'The playa says NO! 🛑 Cannot vanish a house with active bookings in LIVE mode.' });
                } else {
                    console.log(`[Action:deleteHouse] Staging Mode: Auto-clearing ${occupiedBeds.length} test bookings.`);
                    for (const bed of occupiedBeds) {
                        await locals.pb.collection('beds').update(bed.id, { occupied: false, order: null });
                    }
                }
            }

            const rooms = await locals.pb.collection('rooms').getFullList({
                filter: locals.pb.filter('house = {:id}', { id })
            });

            console.log(`[Action:deleteHouse] Vanishing ${rooms.length} modules...`);
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
            console.log(`[Action:deleteHouse] SUCCESS. House ${id} evaporated.`);
            return { success: true };

        } catch (err) {
            console.error(`[Action:deleteHouse] FAILED for ${id}:`, err);
            return fail(500, { error: 'Vanish failed.' });
        }
    },
    renameHouse: async ({ locals, request }) => {
        const data = await request.formData();
        const id = data.get('id') as string;
        const name = data.get('name') as string;
        
        console.log(`[Action:renameHouse] User: ${locals.pb.authStore.model?.email}, ID: ${id}, New Name: ${name}`);
        
        if (!locals.pb.authStore.model?.verified) {
            console.error('[Action:renameHouse] BLOCKED: User not verified.');
            return fail(403, { error: 'Unauthorized' });
        }
        
        if (!name) return fail(400, { error: 'Name is required' });

        try {
            await locals.pb.collection('houses').update(id, { name });
            console.log(`[Action:renameHouse] SUCCESS for ${id}`);
            return { success: true };
        } catch (err) {
            console.error(`[Action:renameHouse] FAILED for ${id}:`, err);
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