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
        if (!locals.pb.authStore.model?.verified) return;
        const data = await request.formData();
        const id = data.get('id') as string;
        const x = parseFloat(data.get('x') as string);
        const y = parseFloat(data.get('y') as string);
        
        // Safeguard: Check occupancy
        const beds = await locals.pb.collection('beds').getFullList({
            filter: locals.pb.filter('room.house = {:id} && occupied = true', { id })
        });
        
        if (beds.length > 0) {
            return fail(400, { error: 'Cannot move house: It has active bookings!' });
        }

        await locals.pb.collection('houses').update(id, { x, y });
    },
    deleteHouse: async ({ locals, request }) => {
        if (!locals.pb.authStore.model?.verified) return;
        const data = await request.formData();
        const id = data.get('id') as string;
        
        // Safeguard: Check occupancy
        const beds = await locals.pb.collection('beds').getFullList({
            filter: locals.pb.filter('room.house = {:id} && occupied = true', { id })
        });
        
        if (beds.length > 0) {
            return fail(400, { error: 'Cannot delete: House has active bookings!' });
        }
        
        // PocketBase will handle cascading delete if configured, 
        // but we manually delete to be safe or just delete the house.
        await locals.pb.collection('houses').delete(id);
    },
    renameHouse: async ({ locals, request }) => {
        if (!locals.pb.authStore.model?.verified) return;
        const data = await request.formData();
        const id = data.get('id') as string;
        const name = data.get('name') as string;
        
        await locals.pb.collection('houses').update(id, { name });
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
    const occupiedBeds = bedsInHouse.filter((b: BedsResponse) => b.occupied).length;
    const freeBeds = totalBeds - occupiedBeds;
    const occupancyRate = totalBeds > 0 ? Math.round((occupiedBeds / totalBeds) * 100) : 0;

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