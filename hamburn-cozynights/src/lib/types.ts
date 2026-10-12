import type { BedsResponse, RoomsResponse, HousesResponse } from './pocketbase-types';

// Extended types for tree structure (Plain objects for SvelteKit compatibility)
export type BedData = BedsResponse;

export type RoomData = RoomsResponse & {
	beds: BedData[];
};

export type HouseData = HousesResponse & {
	rooms: RoomData[];
	totalBeds: number;
	occupiedBeds: number;
	freeBeds: number;
	isBookable?: boolean;
	/**
	 * Free spots that fit the wishes the guest picked on the map, while the map
	 * is filtered. The map page sends it on its own per-house summary (MapHouse
	 * in src/routes/map/+page.server.ts), which Map.svelte reads like this type.
	 */
	fittingFree?: number;
	/** The signed-in guest's spot is in this house (getFullTree with an orderId). */
	mine?: boolean;
};

/**
 * @deprecated Use HouseData instead to align with the database and server logic.
 */
export type House = HouseData;
