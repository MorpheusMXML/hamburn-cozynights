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
	/** Free-standing spots the crew holds back (locked, not taken). */
	locked: number;
	/** ♿ spots kept for special-needs requests (not taken, not locked). */
	special: number;
	/** Switched-off spots. Outside `total`: they exist but count nowhere else. */
	deactivated: number;
}

/**
 * Occupancy of a set of spots, as the admin views count it.
 *
 * `occupied`, `free`, `locked` and `special` partition `total`, so a live
 * dashboard can show them as the slices of one ring without the rest ever
 * going negative.
 */
export function countSpots(
	beds: (Pick<BedsResponse, 'enabled' | 'occupied' | 'is_locked'> & {
		is_special?: boolean;
		order?: string;
		checked_in_at?: string;
	})[]
): SpotCounts {
	const active = beds.filter((bed) => bed.enabled !== false);
	const untaken = active.filter((bed) => !bed.occupied);
	const locked = untaken.filter((bed) => bed.is_locked);
	return {
		total: active.length,
		occupied: active.filter((bed) => bed.occupied).length,
		free: untaken.filter((bed) => !bed.is_locked && !bed.is_special).length,
		checkedIn: active.filter((bed) => !!bed.order && !!bed.checked_in_at).length,
		locked: locked.length,
		special: untaken.filter((bed) => !bed.is_locked && bed.is_special).length,
		deactivated: beds.length - active.length
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

/**
 * The four states a house can be in, as the badges, the legend and the live
 * statistics all read them. One vocabulary: the list view used to call a house
 * with free spots "green" while the legend counted the same house as "empty".
 */
export type HouseState = 'unconfigured' | 'open' | 'filling' | 'full';

export function houseState(house: {
	totalBeds: number;
	occupiedBeds: number;
	freeBeds: number;
}): HouseState {
	if (house.totalBeds === 0) return 'unconfigured';
	if (house.freeBeds === 0) return 'full';
	return house.occupiedBeds > 0 ? 'filling' : 'open';
}

/** Badge text of a house state; `free` makes "1 spot free" read right. */
export function houseStateLabel(state: HouseState, free: number): string {
	if (state === 'unconfigured') return 'Not setup';
	if (state === 'full') return 'Fully booked';
	return free === 1 ? '1 spot free' : `${free} spots free`;
}
