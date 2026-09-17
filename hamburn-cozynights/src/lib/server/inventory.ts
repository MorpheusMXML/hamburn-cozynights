import type { TypedPocketBase } from '$lib/pocketbase-types';
import type { HouseData } from '$lib/types';
import { countSpots } from '$lib/occupancy';

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

			console.log(
				`[Inventory] Raw data fetched: ${housesRaw.length} houses, ${roomsRaw.length} rooms, ${bedsRaw.length} beds.`
			);

			if (housesRaw.length > 0) {
				console.log(
					`[Inventory] Sample house: ${housesRaw[0].name} (ID: ${housesRaw[0].id}) at ${housesRaw[0].x},${housesRaw[0].y}`
				);
			}

			// Serialize everything to plain objects to ensure compatibility.
			// This tree is the public guest map: deactivated beds are left out,
			// locked beds show as taken, and the booking's order id is not exposed.
			const houses = housesRaw.map((h) => ({ ...h }));
			const rooms = roomsRaw.map((r) => ({ ...r }));
			const beds = bedsRaw
				.filter((b) => b.enabled !== false)
				.map((b) => ({ ...b, occupied: !!b.occupied || !!b.is_locked, order: '' }));

			// Build the hierarchy
			const tree = houses.map((house) => {
				const houseRooms = rooms
					.filter((room) => room.house === house.id)
					.map((room) => {
						const roomBeds = beds.filter((bed) => bed.room === room.id);
						return {
							...room,
							beds: roomBeds
						};
					});

				// Calculate stats for the house (locked beds already count as taken here)
				const allBedsInHouse = houseRooms.flatMap((r) => r.beds);
				const totalBeds = allBedsInHouse.length;
				const occupiedBeds = allBedsInHouse.filter((b) => b.occupied).length;
				const freeBeds = totalBeds - occupiedBeds;

				// A house is bookable ONLY if it has at least one room AND at least one bed
				const isBookable = houseRooms.length > 0 && totalBeds > 0;

				return {
					...house,
					rooms: houseRooms,
					totalBeds,
					occupiedBeds,
					freeBeds,
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

			const houseRooms = roomsRaw.map((room) => {
				const roomBeds = bedsRaw.filter((bed) => bed.room === room.id);
				return {
					...room,
					beds: roomBeds.map((b) => ({ ...b }))
				};
			});

			const spots = countSpots(bedsRaw);

			return {
				...houseRaw,
				rooms: houseRooms,
				totalBeds: spots.total,
				occupiedBeds: spots.occupied,
				freeBeds: spots.free
			};
		} catch (error) {
			console.error(`Error fetching house ${houseId}:`, error);
			return null;
		}
	}
}
