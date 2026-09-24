/**
 * The camp as the Control Center (/admin) and the map editor (/admin/camp)
 * load it: the houses with their spot numbers, the live numbers the Intel
 * panel and the poll start from, and what the layout still lacks.
 *
 * Both pages read the records fresh (not the shared stats snapshot): after an
 * action reloads the page, the numbers must show what the action did.
 */
import type { BedsResponse, HousesResponse, RoomsResponse } from '$lib/pocketbase-types';
import type { LiveStats } from '$lib/live-stats';
import { deriveLiveStats, opsSnapshot } from '$lib/server/stats';
import { getBookingSettings } from '$lib/server/settings';
import { crewBookedBeds } from '$lib/server/special-requests';

export type HouseStats = HousesResponse & {
	totalBeds: number;
	occupiedBeds: number;
	freeBeds: number;
	/** Booked spots whose guest the crew checked in at arrival. */
	checkedInBeds: number;
	occupancyRate: number;
};

export interface SanityWarning {
	id: string;
	name: string;
	noRooms: boolean;
	roomsWithNoBeds: {
		id: string;
		name: string;
		number: number;
		bedCount: number;
		hasNoBeds: boolean;
	}[];
}

/** Houses without rooms and rooms without spots: guests can't book there. */
export function sanityWarningsOf(
	houses: Pick<HousesResponse, 'id' | 'name'>[],
	rooms: Pick<RoomsResponse, 'id' | 'house' | 'name' | 'room_number'>[],
	beds: Pick<BedsResponse, 'room'>[]
): SanityWarning[] {
	return houses
		.map((house) => {
			const houseRooms = rooms.filter((r) => r.house === house.id);
			const roomsWithIssues = houseRooms
				.map((room) => {
					const roomBeds = beds.filter((b) => b.room === room.id);
					return {
						id: room.id,
						name: room.name,
						number: room.room_number,
						bedCount: roomBeds.length,
						hasNoBeds: roomBeds.length === 0
					};
				})
				.filter((r) => r.hasNoBeds);

			return {
				id: house.id,
				name: house.name,
				noRooms: houseRooms.length === 0,
				roomsWithNoBeds: roomsWithIssues
			};
		})
		.filter((w) => w.noRooms || w.roomsWithNoBeds.length > 0);
}

export async function readCamp(locals: App.Locals) {
	// The camp-wide counts (tickets, messages, requests, crew) for the Intel
	// panel come from the cache the live endpoint shares; asked in parallel.
	const opsRead = opsSnapshot(locals.adminPb).catch((err) => {
		console.error('[Admin] Operations counts could not be read:', (err as Error)?.message);
		return null;
	});

	const [houses, allRooms, allBeds, settings] = await Promise.all([
		locals.pb.collection('houses').getFullList<HousesResponse>({ sort: 'name' }),
		locals.pb.collection('rooms').getFullList<RoomsResponse>(),
		// No `expand: 'room'`: the rooms are already here, and the spot rows are
		// the biggest answer on this page — a camp with 400 spots used to carry
		// a copy of its room record on every one of them.
		locals.pb.collection('beds').getFullList<BedsResponse>(),
		getBookingSettings(locals.pb)
	]);

	// Spots the crew booked for approved special-needs requests: they survive a
	// switch back to Staging and "clear all bookings", so the dialogs say so.
	const crewBooked = await crewBookedBeds(locals.adminPb).catch((err) => {
		console.error('[Admin] crew-booked spots could not be read:', (err as Error)?.message);
		return new Map<string, string>();
	});
	const crewBookedSpots = allBeds.filter(
		(bed) => !!bed.order && crewBooked.get(bed.id) === bed.order
	).length;

	// The same derivation the live endpoint (/admin/api/stats) runs, so the
	// first paint and every poll afterwards count spots identically. The spots
	// come from the reads above, fresh after every action.
	const live = deriveLiveStats(houses, allRooms, allBeds);
	const liveByHouse = new Map(live.houses.map((house) => [house.id, house]));
	const ops = await opsRead;

	const housesWithStats: HouseStats[] = houses.map((house: HousesResponse) => {
		const spots = liveByHouse.get(house.id);
		const total = spots?.total ?? 0;
		return {
			...structuredClone(house),
			totalBeds: total,
			occupiedBeds: spots?.occupied ?? 0,
			freeBeds: spots?.free ?? 0,
			checkedInBeds: spots?.checkedIn ?? 0,
			occupancyRate: total > 0 ? Math.round(((spots?.occupied ?? 0) / total) * 100) : 0
		};
	});

	const stats: LiveStats = { changedAt: new Date().toISOString(), ...live, ops };

	return {
		houses: housesWithStats,
		crewBookedSpots,
		sanityWarnings: sanityWarningsOf(houses, allRooms, allBeds),
		stats,
		settings
	};
}
