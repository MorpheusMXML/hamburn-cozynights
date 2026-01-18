import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import type { HousesResponse, BedsResponse, RoomsResponse } from '$lib/pocketbase-types';

type HouseStats = HousesResponse & {
  totalBeds: number;
  occupiedBeds: number;
  freeBeds: number;
  occupancyRate: number;
};

export const actions = {
    logout: async ({ locals }) => {
        locals.pb.authStore.clear();
        throw redirect(303, '/admin/login');
    }
};

export const load: PageServerLoad = async ({ locals }) => {
  
  // Sicherheitscheck
  if (!locals.pb.authStore.isValid) {
      throw redirect(303, '/admin/login');
  }

  // 1. Alle Häuser laden
  const houses = await locals.pb.collection('houses').getFullList<HousesResponse>({
    sort: 'name',
  });

  // 2. Alle Betten laden (mit expand für den Raum, damit wir die House-ID finden)
  const allBeds = await locals.pb.collection('beds').getFullList<BedsResponse<{ room: RoomsResponse }>>({
    expand: 'room',
  });

  // 3. Statistik berechnen
  const housesWithStats: HouseStats[] = houses.map((house: HousesResponse) => {
    
    // Filter: Welches Bett gehört zu diesem Haus?
    // Hier prüfen wir, ob die House-ID des Raumes mit dem aktuellen Haus übereinstimmt
    const bedsInHouse = allBeds.filter((b: BedsResponse<{ room: RoomsResponse }>) => {
        return b.expand?.room?.house === house.id;
    });

    const totalBeds = bedsInHouse.length;
    // Hier typisieren wir 'b' explizit, damit TypeScript zufrieden ist
    const occupiedBeds = bedsInHouse.filter((b: BedsResponse) => b.occupied).length;
    const freeBeds = totalBeds - occupiedBeds;
    
    const occupancyRate = totalBeds > 0 ? Math.round((occupiedBeds / totalBeds) * 100) : 0;

    return {
      ...house,
      totalBeds,
      occupiedBeds,
      freeBeds,
      occupancyRate
    };
  });

  return { houses: housesWithStats };
};