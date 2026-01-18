import { pb } from '$lib/pocketbase';
import type { PageServerLoad } from './$types';
import type { HousesResponse, BedsResponse, RoomsResponse } from '$lib/pocketbase-types';

// Wir definieren einen erweiterten Typ für unser Frontend,
// damit TypeScript genau weiß, was wir berechnet haben.
type HouseStats = HousesResponse & {
  totalBeds: number;
  occupiedBeds: number;
  freeBeds: number;
  occupancyRate: number; // Prozentwert 0-100
};

export const load: PageServerLoad = async () => {
  // 1. Alle Häuser laden
  const houses = await pb.collection('houses').getFullList<HousesResponse>({
    sort: 'name',
  });

  // 2. Alle Betten laden und den Raum dazu holen (damit wir wissen, zu welchem Haus das Bett gehört)
  // 'expand' ist hier wichtig: Wir brauchen die Daten des Raumes (room), um an die House-ID zu kommen.
  const allBeds = await pb.collection('beds').getFullList<BedsResponse<{ room: RoomsResponse }>>({
    expand: 'room',
  });

  // 3. Statistik berechnen
  // Wir mappen über die Häuser und zählen die passenden Betten zusammen
  const housesWithStats: HouseStats[] = houses.map((house) => {
    // Finde alle Betten, die zu Räumen in diesem Haus gehören
    // Hinweis: bed.expand?.room gibt uns Zugriff auf den verknüpften Raum
    const bedsInHouse = allBeds.filter(b => b.expand?.room?.house === house.id);

    const totalBeds = bedsInHouse.length;
    const occupiedBeds = bedsInHouse.filter(b => b.occupied).length;
    const freeBeds = totalBeds - occupiedBeds;
    
    // Vermeidung von Division durch Null
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