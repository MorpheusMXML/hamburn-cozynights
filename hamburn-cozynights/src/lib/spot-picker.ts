// src/lib/spot-picker.ts
/**
 * The spot picker of the requests page (docs/admin/special-needs.md, "Decide
 * and book"): the free spots laid out as houses, rooms and beds, so the crew
 * sees the camp, narrows it down and picks one — for a single request, or a
 * room for a whole request group ($lib/group-plan proposes who sleeps where).
 * Pure code without I/O, shared by the admin page (also in the browser) and
 * the unit tests.
 */
import {
	MATCHED_BY_HAND,
	factsOf,
	matchNeeds,
	spotMatchesFilter,
	type NeedMatch,
	type SpotFilter
} from './accommodation';
import { groupBunks } from './bunks';
import { bySpot, specialPull, type PlanMember } from './group-plan';
import { requestKinds, type SpecialNeed, type SpotInfo } from './special-needs';

/** One card in a room: a free spot on its own, or a bunk bed with both levels free. */
export type PickerUnit =
	{ kind: 'single'; spot: SpotInfo } | { kind: 'bunk'; lower: SpotInfo; upper: SpotInfo };

export interface PickerRoom {
	roomId: string;
	/** "Dorm #2": the words the spot labels use. */
	name: string;
	/** The room's kind from the catalogue ('' when not set). */
	kind: string;
	/** Active spots in the room, free or not. */
	size: number;
	/** Free spots in it, whatever the filters show. */
	free: number;
	/** How many of the free ones are ♿ spots. */
	special: number;
	/** What the room offers (SpotInfo.roomFeatures). */
	features: string[];
	/** The cards the filters let through, in the room's order. */
	units: PickerUnit[];
}

export interface PickerHouse {
	houseId: string;
	name: string;
	kind: string;
	/** Free spots in the house, whatever the filters show. */
	free: number;
	special: number;
	rooms: PickerRoom[];
}

/**
 * The free spots as houses → rooms → cards, all in the camp's natural order.
 * A bunk bed is one card when both its levels are shown, else each level
 * that is shown is a card of its own. Rooms and houses without a card left
 * are left out; their counts always cover every free spot.
 * @param sizes room id → active spots (countRoomSpots); a room that isn't in
 *   it counts its free spots
 * @param keep the filter: which spots get a card (all when left out)
 */
export function buildPlaces(
	spots: readonly SpotInfo[],
	sizes: Readonly<Record<string, number>> = {},
	keep: (spot: SpotInfo) => boolean = () => true
): PickerHouse[] {
	const houses = new Map<string, { house: PickerHouse; rooms: Map<string, SpotInfo[]> }>();
	for (const spot of [...spots].sort(bySpot)) {
		let entry = houses.get(spot.houseId);
		if (!entry) {
			entry = {
				house: {
					houseId: spot.houseId,
					name: spot.house || 'No house',
					kind: spot.houseKind ?? '',
					free: 0,
					special: 0,
					rooms: []
				},
				rooms: new Map()
			};
			houses.set(spot.houseId, entry);
		}
		entry.house.free += 1;
		if (spot.special) entry.house.special += 1;
		const list = entry.rooms.get(spot.roomId) ?? [];
		list.push(spot);
		entry.rooms.set(spot.roomId, list);
	}

	const result: PickerHouse[] = [];
	for (const { house, rooms } of houses.values()) {
		for (const [roomId, list] of rooms) {
			const shown = list.filter(keep);
			if (shown.length === 0) continue;
			const first = list[0];
			house.rooms.push({
				roomId,
				name: first.room || 'Room',
				kind: first.roomKind ?? '',
				size: Math.max(sizes[roomId] ?? 0, list.length),
				free: list.length,
				special: list.filter((spot) => spot.special).length,
				features: first.roomFeatures ?? [],
				units: unitsOf(shown)
			});
		}
		if (house.rooms.length > 0) result.push(house);
	}
	return result;
}

function unitsOf(spots: SpotInfo[]): PickerUnit[] {
	const bunks = spots.map((spot) => ({
		id: spot.bedId,
		label: spot.spot,
		bed_type: spot.bedType,
		bunk_partner: spot.bunkPartner ?? '',
		spot
	}));
	return groupBunks(bunks).map((unit): PickerUnit =>
		unit.kind === 'bunk'
			? { kind: 'bunk', lower: unit.lower.spot, upper: unit.upper.spot }
			: { kind: 'single', spot: unit.spot.spot }
	);
}

/** The spots of a card, top to bottom: a bunk bed's upper level first. */
export function unitSpots(unit: PickerUnit): SpotInfo[] {
	return unit.kind === 'bunk' ? [unit.upper, unit.lower] : [unit.spot];
}

/** What the crew narrows the picker down with. */
export interface PickerFilter {
	/** Words to find in the house, room and spot names. */
	query: string;
	/** One house ('' for all). */
	houseId: string;
	/** Wishes like the map's filters (SPOT_FILTERS): every one must hold. */
	wishes: SpotFilter[];
	/** Only spots that answer every need the layout can tell (SpotFit.all). */
	fitting: boolean;
	/** Only ♿ spots. */
	special: boolean;
}

export const NO_FILTER: PickerFilter = {
	query: '',
	houseId: '',
	wishes: [],
	fitting: false,
	special: false
};

/** Lower case, no accents, single spaces: "Wälderhaus" is found with "walder". */
export function normalize(text: string): string {
	return text
		.normalize('NFD')
		.replace(/\p{M}/gu, '')
		.replace(/ß/g, 'ss')
		.toLowerCase()
		.replace(/\s+/g, ' ')
		.trim();
}

/** True when every word of the query is in the spot's house, room or name. */
export function matchesQuery(spot: SpotInfo, query: string): boolean {
	const words = normalize(query).split(' ').filter(Boolean);
	if (words.length === 0) return true;
	const text = normalize(`${spot.house} ${spot.room} ${spot.spot}`);
	return words.every((word) => text.includes(word));
}

/** The needs the layout can answer: everything but MATCHED_BY_HAND. */
export function checkableNeeds(needs: readonly SpecialNeed[]): SpecialNeed[] {
	return needs.filter((need) => !MATCHED_BY_HAND.includes(need));
}

/** How a spot answers one request. */
export interface SpotFit {
	match: NeedMatch;
	/** The request has needs the layout can answer, and the spot answers every one. */
	all: boolean;
	/** For the order: matchNeeds' score plus the pull of a ♿ spot (specialPull). */
	score: number;
}

export function fitOf(needs: readonly SpecialNeed[], spot: SpotInfo): SpotFit {
	const match = matchNeeds(needs, factsOf(spot.bedType, spot.features));
	const checkable = checkableNeeds(needs).length;
	return {
		match,
		all: checkable > 0 && match.fits.length >= checkable,
		score: match.score + specialPull(spot, requestKinds(needs).access)
	};
}

/** Whether a spot gets a card under this filter, for a request with these needs. */
export function passes(
	spot: SpotInfo,
	filter: PickerFilter,
	needs: readonly SpecialNeed[] = []
): boolean {
	if (filter.houseId && spot.houseId !== filter.houseId) return false;
	if (filter.special && !spot.special) return false;
	if (filter.wishes.length > 0) {
		const facts = factsOf(spot.bedType, spot.features);
		if (!filter.wishes.every((wish) => spotMatchesFilter(wish, facts))) return false;
	}
	if (filter.fitting && !fitOf(needs, spot).all) return false;
	return matchesQuery(spot, filter.query);
}

/** True when the filter shows less than everything. */
export function isFiltered(filter: PickerFilter): boolean {
	return (
		!!filter.query.trim() ||
		!!filter.houseId ||
		filter.wishes.length > 0 ||
		filter.fitting ||
		filter.special
	);
}

/**
 * The few spots that answer a request best, for the strip above the houses:
 * no clear mismatch, and at least one need answered — or a ♿ spot, for a
 * request with something the guest needs. Never a spot the crew locked 🔒
 * (it stays in its room, marked). Best first; a tie keeps the camp's order.
 * Empty for a request only a person can match (a project, a group only).
 */
export function bestFits(
	spots: readonly SpotInfo[],
	needs: readonly SpecialNeed[],
	limit = 6
): SpotInfo[] {
	const access = requestKinds(needs).access;
	if (!access && checkableNeeds(needs).length === 0) return [];
	return spots
		.map((spot) => ({ spot, fit: fitOf(needs, spot) }))
		.filter(
			({ spot, fit }) =>
				!spot.locked &&
				fit.match.conflicts.length === 0 &&
				(fit.match.fits.length > 0 || (access && spot.special))
		)
		.sort((a, b) => b.fit.score - a.fit.score || bySpot(a.spot, b.spot))
		.slice(0, limit)
		.map(({ spot }) => spot);
}

/**
 * What the requests page asks the picker for:
 * - spot: one spot for one person — a request's card (books right away, a
 *   confirmation follows) or a row of a group's plan (only fills the row);
 * - group: a room for a whole request group; $lib/group-plan proposes who
 *   sleeps where, then the crew books it or edits the plan.
 * The page wraps `resolve` so the picker closes first; null = closed without
 * a choice.
 */
export type PickerRequest =
	| {
			mode: 'spot';
			/** Whom the spot is for. */
			who: string;
			needs: SpecialNeed[];
			/** Where the guest sleeps now ('' for nowhere), for the line "Now: …". */
			current: string;
			/** The spots the other members of the group are planned on: bed id → their name. */
			planned?: Record<string, string>;
			/** The spot to show as picked when the picker opens. */
			selected?: string;
			/** The label of the button that takes the pick ("Approve & book", "Use this spot"). */
			action: string;
			resolve: (bedId: string | null) => void;
	  }
	| {
			mode: 'group';
			/** The group's name. */
			name: string;
			/** Every member (PlanMember); only those toPlace() returns get a spot. */
			members: PlanMember[];
			/** The room the plan proposes now ('room:<id>'), '' for none. */
			place: string;
			/** `book`: book the proposal right away (a confirmation follows); else only plan it. */
			resolve: (choice: { place: string; book: boolean } | null) => void;
	  };
