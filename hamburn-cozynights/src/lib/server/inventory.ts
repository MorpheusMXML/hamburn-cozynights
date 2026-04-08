import type { TypedPocketBase, HousesResponse, RoomsResponse, BedsResponse } from '$lib/pocketbase-types';

// Extended types for tree structure (Plain objects for SvelteKit compatibility)
export type BedData = BedsResponse;
export type RoomData = RoomsResponse & { beds: BedData[] };
export type HouseData = HousesResponse & { 
    rooms: RoomData[];
    totalBeds: number;
    occupiedBeds: number;
};

export class InventoryService {
    constructor(private pb: TypedPocketBase) {}

    /**
     * Fetches the entire house/room/bed hierarchy with statistics.
     */
    async getFullTree(): Promise<HouseData[]> {
        // Fetch all data in parallel
        const [housesRaw, roomsRaw, bedsRaw] = await Promise.all([
            this.pb.collection('houses').getFullList({ sort: 'name' }),
            this.pb.collection('rooms').getFullList({ sort: 'room_number' }),
            this.pb.collection('beds').getFullList({ sort: 'label' })
        ]);

        // Serialize everything to plain objects to ensure compatibility
        const houses = housesRaw.map(h => ({ ...h }));
        const rooms = roomsRaw.map(r => ({ ...r }));
        const beds = bedsRaw.map(b => ({ ...b }));

        // Build the hierarchy
        return houses.map(house => {
            const houseRooms = rooms
                .filter(room => room.house === house.id)
                .map(room => {
                    const roomBeds = beds.filter(bed => bed.room === room.id);
                    return {
                        ...room,
                        beds: roomBeds
                    };
                });

            // Calculate stats for the house
            const allBedsInHouse = houseRooms.flatMap(r => r.beds);
            const totalBeds = allBedsInHouse.length;
            const occupiedBeds = allBedsInHouse.filter(b => b.occupied).length;

            return {
                ...house,
                rooms: houseRooms,
                totalBeds,
                occupiedBeds
            };
        });
    }

    /**
     * Fetches a single house with its rooms and beds.
     */
    async getHouse(houseId: string): Promise<HouseData | null> {
        try {
            const [houseRaw, roomsRaw, bedsRaw] = await Promise.all([
                this.pb.collection('houses').getOne(houseId),
                this.pb.collection('rooms').getFullList({ 
                    filter: this.pb.filter('house = {:id}', { id: houseId }), 
                    sort: 'room_number' 
                }),
                this.pb.collection('beds').getFullList({ 
                    filter: this.pb.filter('room.house = {:id}', { id: houseId }),
                    sort: 'label'
                })
            ]);

            const houseRooms = roomsRaw.map(room => {
                const roomBeds = bedsRaw.filter(bed => bed.room === room.id);
                return {
                    ...room,
                    beds: roomBeds.map(b => ({ ...b }))
                };
            });

            const totalBeds = bedsRaw.length;
            const occupiedBeds = bedsRaw.filter(b => b.occupied).length;

            return {
                ...houseRaw,
                rooms: houseRooms,
                totalBeds,
                occupiedBeds
            };
        } catch (error) {
            console.error(`Error fetching house ${houseId}:`, error);
            return null;
        }
    }
}