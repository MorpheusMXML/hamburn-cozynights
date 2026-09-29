import type { TypedPocketBase } from '$lib/pocketbase-types';
import type { HouseData } from '$lib/types';

export class InventoryService {
	constructor(private pb: TypedPocketBase) {}

	/**
	 * Fetches the entire house/room/bed hierarchy with statistics. 🛰️📊
	 * Runs on every guest map request, so it logs nothing but failures.
	 */
	async getFullTree(): Promise<HouseData[]> {
		try {
			// Fetch all data in parallel
			const [housesRaw, roomsRaw, bedsRaw] = await Promise.all([
				this.pb.collection('houses').getFullList({ sort: 'name' }),
				this.pb.collection('rooms').getFullList({ sort: 'room_number' }),
				this.pb.collection('beds').getFullList({ sort: 'label' })
			]);

			// Serialize everything to plain objects to ensure compatibility.
			// This tree is the public guest map: deactivated beds are left out,
			// locked and special-needs beds show as taken, and neither the booking's
			// order id nor why a bed is taken is exposed: together with the burner
			// names on the room pages, a lock or special-needs flag would tell who
			// has special needs.
			// Timestamps go too: `booked_at` (and `updated`) of a crew-booked spot
			// would date the special-needs assignment, and the check-in (when a
			// guest arrived, which admin checked them in) is for the crew only.
			const blank = '' as HouseData['created'];
			const houses = housesRaw.map((h) => ({ ...h, created: blank, updated: blank }));
			const rooms = roomsRaw.map((r) => ({ ...r, created: blank, updated: blank }));
			const beds = bedsRaw
				.filter((b) => b.enabled !== false)
				.map((b) => ({
					...b,
					occupied: !!b.occupied || !!b.is_locked || !!b.is_special,
					order: '',
					is_locked: false,
					is_special: false,
					booked_at: '',
					checked_in_at: '',
					checked_in_by: '',
					created: blank,
					updated: blank
				}));

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

				// Calculate stats for the house (locked and special beds already count as taken here)
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

			return tree;
		} catch (err) {
			console.error('[Inventory] getFullTree failed:', err);
			return [];
		}
	}
}
