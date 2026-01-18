import { pb } from '$lib/pocketbase';
import type { PageServerLoad } from './$types';
import type { HousesResponse } from '$lib/pocketbase-types';

export const load: PageServerLoad = async () => {
  // Lade alle Häuser mit Koordinaten
  const houses = await pb.collection('houses').getFullList<HousesResponse>({
    sort: 'name',
  });

  return { houses };
};