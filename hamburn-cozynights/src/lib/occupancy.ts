import type { BedsResponse } from '$lib/pocketbase-types';

export interface SpotCounts {
	/** Active spots. Deactivated spots don't count anywhere. */
	total: number;
	/** Active spots that are taken (booked or marked as taken). */
	occupied: number;
	/** Active spots guests can still book: neither taken, locked nor special-needs spots. */
	free: number;
	/** Active spots whose guest the crew checked in at arrival (part of `occupied`). */
	checkedIn: number;
}

/** Occupancy of a set of spots, as the admin views count it. */
export function countSpots(
	beds: (Pick<BedsResponse, 'enabled' | 'occupied' | 'is_locked'> & {
		is_special?: boolean;
		order?: string;
		checked_in_at?: string;
	})[]
): SpotCounts {
	const active = beds.filter((bed) => bed.enabled !== false);
	return {
		total: active.length,
		occupied: active.filter((bed) => bed.occupied).length,
		free: active.filter((bed) => !bed.occupied && !bed.is_locked && !bed.is_special).length,
		checkedIn: active.filter((bed) => !!bed.order && !!bed.checked_in_at).length
	};
}

export type HouseMarkerStatus = 'empty' | 'available' | 'full';

/** Map pin of a house: no active spots yet, spots left to book, or none left. */
export function houseMarkerStatus(house: {
	totalBeds: number;
	freeBeds: number;
}): HouseMarkerStatus {
	if (house.totalBeds === 0) return 'empty';
	return house.freeBeds > 0 ? 'available' : 'full';
}
