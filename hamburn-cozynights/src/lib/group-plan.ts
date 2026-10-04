// src/lib/group-plan.ts
/**
 * The planner of a request group on the requests page (docs/admin/special-needs.md,
 * "Groups"): where the group could sleep, and a first proposal of one free
 * spot per member, which the crew changes or books as it is. Pure code
 * without I/O, shared by the admin page (also in the browser) and the unit
 * tests. Deterministic: the same group and the same spots always give the
 * same proposal.
 */
import { factsOf, matchNeeds } from './accommodation';
import { isAccessNeed, requestKinds, type SpecialNeed, type SpotInfo } from './special-needs';
import { compareNatural } from './template';

/** A member of the group, as the planner needs it. */
export interface PlanMember {
	requestId: string;
	name: string;
	needs: readonly SpecialNeed[];
	declined: boolean;
	/** The spot the crew booked for the request ('' for none): the member keeps it. */
	crewSpotLabel: string;
}

/** A place the group could sleep in, for the planner's "Where:" choice. */
export interface PlaceOption {
	/** '' (anywhere), 'room:<id>' or 'house:<id>' */
	key: string;
	label: string;
	/** Free spots there (♿ spots included). */
	free: number;
	/** How many of them are ♿ spots. */
	special: number;
	/** Enough free spots for everyone to place. */
	fits: boolean;
}

export const ANYWHERE = 'Anywhere: the best free spot for each';

/** The members the planner books a spot for: not declined, no spot from the crew yet. */
export function toPlace(members: PlanMember[]): PlanMember[] {
	return members.filter((member) => !member.declined && !member.crewSpotLabel);
}

const bySpot = (a: SpotInfo, b: SpotInfo) =>
	compareNatural(a.house, b.house) ||
	compareNatural(a.room, b.room) ||
	compareNatural(a.spot, b.spot);

interface Place {
	kind: 'room' | 'house';
	key: string;
	name: string;
	house: string;
	room: string;
	free: number;
	special: number;
}

function describe(
	name: string,
	free: number,
	special: number,
	size: number,
	usable: number
): string {
	return (
		`${name} — ${free} free` +
		(special > 0 ? ` (♿ ${special})` : '') +
		(free >= size ? ` · fits all ${size}` : ' · too small') +
		(usable < size && free >= size ? ' · uses ♿' : '')
	);
}

/**
 * Every room and every house with free spots, plus "Anywhere" first. Then the
 * rooms that fit everyone, the snuggest first; then the houses that fit,
 * also the snuggest first; then the rest, the roomiest first. A place that
 * only fits by giving ♿ spots to members who need nothing comes after the
 * places that fit without (rooms, then houses), marked "uses ♿".
 * @param spots the free spots an admin can book (listAssignableSpots)
 * @param size how many members need a spot (toPlace)
 * @param accessCount how many of them need something (requestKinds().access):
 *   the ♿ spots a place may give the group without wasting one
 */
export function placeOptions(spots: SpotInfo[], size: number, accessCount = 0): PlaceOption[] {
	const places = new Map<string, Place>();
	const count = (key: string, spot: SpotInfo, make: () => Omit<Place, 'free' | 'special'>) => {
		const place = places.get(key) ?? { ...make(), free: 0, special: 0 };
		place.free += 1;
		if (spot.special) place.special += 1;
		places.set(key, place);
	};
	for (const spot of spots) {
		if (spot.roomId) {
			count(`room:${spot.roomId}`, spot, () => ({
				kind: 'room',
				key: `room:${spot.roomId}`,
				name: [spot.room || 'Room', spot.house].filter(Boolean).join(' · '),
				house: spot.house,
				room: spot.room
			}));
		}
		if (spot.houseId) {
			count(`house:${spot.houseId}`, spot, () => ({
				kind: 'house',
				key: `house:${spot.houseId}`,
				name: `${spot.house || 'House'}, whole house`,
				house: spot.house,
				room: ''
			}));
		}
	}

	/** The spots there for this group: the plain ones, and ♿ ones for who needs something. */
	const usable = (place: Place) =>
		place.free - place.special + Math.min(place.special, accessCount);
	const rank = (place: Place) => {
		const room = place.kind === 'room' ? 0 : 1;
		if (usable(place) >= size) return room;
		return place.free >= size ? 2 + room : 4;
	};
	const sorted = [...places.values()].sort(
		(a, b) =>
			rank(a) - rank(b) ||
			(rank(a) < 4 ? usable(a) - usable(b) || a.free - b.free : b.free - a.free) ||
			(a.kind === b.kind ? 0 : a.kind === 'room' ? -1 : 1) ||
			compareNatural(a.house, b.house) ||
			compareNatural(a.room, b.room)
	);

	const special = spots.filter((spot) => spot.special).length;
	return [
		{ key: '', label: ANYWHERE, free: spots.length, special, fits: spots.length >= size },
		...sorted.map((place) => ({
			key: place.key,
			label: describe(place.name, place.free, place.special, size, usable(place)),
			free: place.free,
			special: place.special,
			fits: place.free >= size
		}))
	];
}

/**
 * The spots of a place, in the order the proposal tries them: natural order;
 * in a whole house the rooms with the most free spots first, so the group
 * packs into the fewest rooms.
 */
function candidates(spots: SpotInfo[], placeKey: string): SpotInfo[] {
	if (!placeKey) return [...spots].sort(bySpot);
	const [, kind, id] = /^(room|house):(.+)$/.exec(placeKey) ?? [];
	if (kind === 'room') return spots.filter((spot) => spot.roomId === id).sort(bySpot);
	if (kind !== 'house') return [];
	const inHouse = spots.filter((spot) => spot.houseId === id);
	const free = new Map<string, number>();
	for (const spot of inHouse) free.set(spot.roomId, (free.get(spot.roomId) ?? 0) + 1);
	return inHouse.sort(
		(a, b) =>
			(free.get(b.roomId) ?? 0) - (free.get(a.roomId) ?? 0) ||
			compareNatural(a.room, b.room) ||
			compareNatural(a.roomId, b.roomId) ||
			compareNatural(a.spot, b.spot)
	);
}

/**
 * One spot per member to place, from the place's free spots: request id →
 * bed id, '' for a member that keeps their spot, is declined, or finds no
 * spot left. Members with an access need choose first (the most needs at the
 * top), each the best remaining spot by matchNeeds; a ♿ spot counts extra
 * for a member who needs something and against one who doesn't. A tie goes
 * to the place order, which keeps bunk pairs together.
 */
export function proposePlan(
	members: PlanMember[],
	spots: SpotInfo[],
	placeKey: string
): Record<string, string> {
	const plan: Record<string, string> = {};
	for (const member of members) plan[member.requestId] = '';

	const pool = candidates(spots, placeKey);
	const facts = pool.map((spot) => factsOf(spot.bedType, spot.features));
	const taken = new Set<number>();
	const queue = toPlace(members)
		.map((member, index) => ({
			member,
			index,
			access: requestKinds(member.needs).access,
			accessNeeds: member.needs.filter(isAccessNeed).length
		}))
		.sort(
			(a, b) =>
				Number(b.access) - Number(a.access) || b.accessNeeds - a.accessNeeds || a.index - b.index
		);

	for (const { member, access } of queue) {
		let best = -1;
		let bestScore = -Infinity;
		pool.forEach((spot, index) => {
			if (taken.has(index)) return;
			const score =
				matchNeeds(member.needs, facts[index]).score + (spot.special ? (access ? 0.5 : -2) : 0);
			if (score > bestScore) {
				best = index;
				bestScore = score;
			}
		});
		if (best < 0) continue;
		taken.add(best);
		plan[member.requestId] = pool[best].bedId;
	}
	return plan;
}
