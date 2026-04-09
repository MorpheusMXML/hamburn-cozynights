import type { TypedPocketBase } from '$lib/pocketbase-types';
import type { HouseData } from '$lib/types';

export class InventoryService {
    constructor(private pb: TypedPocketBase) {}

    /**
     * Fetches the entire house/room/bed hierarchy with statistics. 🛰️📊
     */
    async getFullTree(): Promise<HouseData[]> {
        console.log('[Inventory] Fetching full tree...');
        try {
            // Fetch all data in parallel
            const [housesRaw, roomsRaw, bedsRaw] = await Promise.all([
                this.pb.collection('houses').getFullList({ sort: 'name' }),
                this.pb.collection('rooms').getFullList({ sort: 'room_number' }),
                this.pb.collection('beds').getFullList({ sort: 'label' })
            ]);

            console.log(`[Inventory] Raw data fetched: ${housesRaw.length} houses, ${roomsRaw.length} rooms, ${bedsRaw.length} beds.`);
            
            if (housesRaw.length > 0) {
                console.log(`[Inventory] Sample house: ${housesRaw[0].name} (ID: ${housesRaw[0].id}) at ${housesRaw[0].x},${housesRaw[0].y}`);
            }

            // Serialize everything to plain objects to ensure compatibility
            const houses = housesRaw.map(h => ({ ...h }));
            const rooms = roomsRaw.map(r => ({ ...r }));
            const beds = bedsRaw.map(b => ({ ...b }));

            // Build the hierarchy
            const tree = houses.map(house => {
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

                // A house is bookable ONLY if it has at least one room AND at least one bed
                const isBookable = houseRooms.length > 0 && totalBeds > 0;

                return {
                    ...house,
                    rooms: houseRooms,
                    totalBeds,
                    occupiedBeds,
                    isBookable
                };
            });

            console.log(`[Inventory] Tree built with ${tree.length} houses.`);
            return tree;
        } catch (err) {
            console.error('[Inventory] getFullTree failed:', err);
            return [];
        }
    }

    /**
     * Fetches a single house with its rooms and beds. 🏠🚪🛌
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