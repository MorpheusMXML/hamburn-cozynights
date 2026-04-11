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
	isBookable?: boolean;
};

/**
 * @deprecated Use HouseData instead to align with the database and server logic.
 */
export type House = HouseData;
