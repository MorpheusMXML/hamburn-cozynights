import { pb } from '$lib/pocketbase';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
    // Wir holen die Liste ohne Cache-Verzögerung
    const records = await pb.collection('houses').getFullList({
        sort: 'name',
    });

    return {
        // Das JSON.parse(JSON.stringify()) ist ESSENZIELL für SvelteKit Navigation,
        // da Pocketbase-Klassen-Objekte beim clientseitigen Routing oft "sterben".
        houses: JSON.parse(JSON.stringify(records))
    };
};