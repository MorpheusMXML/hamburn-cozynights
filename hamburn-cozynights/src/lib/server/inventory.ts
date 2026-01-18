import { pb } from '$lib/pocketbase';
import type { HousesResponse, RoomsResponse, BedsResponse } from '$lib/pocketbase-types';

// Erweiterte Typen für die Baumstruktur (OOP-ähnlich)
export type Bed = BedsResponse;

export type Room = RoomsResponse & {
    items: Bed[]; // Ein Raum "hat" Betten
};

export type House = HousesResponse & {
    items: Room[]; // Ein Haus "hat" Räume
};

export class InventoryService {
    
    // Lädt die komplette Hierarchie
    static async getFullTree(): Promise<House[]> {
        // 1. Alle Daten parallel laden (Performance!)
        const [housesRaw, roomsRaw, bedsRaw] = await Promise.all([
            pb.collection('houses').getFullList({ sort: 'name' }),
            pb.collection('rooms').getFullList({ sort: 'room_number' }),
            pb.collection('beds').getFullList({ sort: 'label' })
        ]);

        // 2. Objekte verknüpfen (Mapping)
        const tree: House[] = housesRaw.map(house => {
            // Finde alle Räume für dieses Haus
            const myRooms = roomsRaw
                .filter(room => room.house === house.id)
                .map(room => {
                    // Finde alle Betten für diesen Raum
                    const myBeds = bedsRaw.filter(bed => bed.room === room.id);
                    
                    // Rückgabe Raum-Objekt mit Kinder-Elementen
                    return {
                        ...room,
                        items: myBeds
                    } as Room;
                });

            // Rückgabe Haus-Objekt mit Kinder-Elementen
            return {
                ...house,
                items: myRooms
            } as House;
        });

        return tree;
    }
}