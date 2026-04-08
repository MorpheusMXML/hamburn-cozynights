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
  if (!locals.pb.authStore.isValid) {
      throw redirect(303, '/admin/login');
  }

  const houses = await locals.pb.collection('houses').getFullList<HousesResponse>({
    sort: 'name',
  });

  const allBeds = await locals.pb.collection('beds').getFullList<BedsResponse<{ room: RoomsResponse }>>({
    expand: 'room',
  });

  const housesWithStats: HouseStats[] = houses.map((house: HousesResponse) => {
    const bedsInHouse = allBeds.filter((b: BedsResponse<{ room: RoomsResponse }>) => {
        return b.expand?.room?.house === house.id;
    });

    const totalBeds = bedsInHouse.length;
    const occupiedBeds = bedsInHouse.filter((b: BedsResponse) => b.occupied).length;
    const freeBeds = totalBeds - occupiedBeds;
    const occupancyRate = totalBeds > 0 ? Math.round((occupiedBeds / totalBeds) * 100) : 0;

    // KORREKTUR: structuredClone stellt sicher, dass 'house' ein reines Datenobjekt ist
    return {
      ...structuredClone(house),
      totalBeds,
      occupiedBeds,
      freeBeds,
      occupancyRate
    };
  });

  return { houses: housesWithStats };
};