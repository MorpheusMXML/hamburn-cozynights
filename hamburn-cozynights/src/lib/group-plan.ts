// src/lib/group-plan.ts
/**
 * The planner of a request group on the requests page (docs/admin/special-needs.md,
 * "Groups"): where the group could sleep, and a first proposal of one free
 * spot per member, which the crew changes or books as it is. Pure code
 * without I/O, shared by the admin page (also in the browser) and the unit
 * tests. Deterministic: the same group and the same spots always give the
 * same proposal.
 */
import { MATCHED_BY_HAND, factsOf, matchNeeds } from './accommodation';
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
	/** It fits only by giving ♿ spots to members who need nothing ("uses ♿"). */
	usesSpecial: boolean;
	/** It fits only by using spots the crew locked 🔒 ("uses 🔒"). */
	usesLocked: boolean;
}

export const ANYWHERE = 'Anywhere: the best free spot for each';

/** The members the planner books a spot for: not declined, no spot from the crew yet. */
export function toPlace(members: PlanMember[]): PlanMember[] {
	return members.filter((member) => !member.declined && !member.crewSpotLabel);
}

/** The camp's natural order: house, room, spot. */
export const bySpot = (a: SpotInfo, b: SpotInfo) =>
	compareNatural(a.house, b.house) ||
	compareNatural(a.room, b.room) ||
	compareNatural(a.spot, b.spot);

/**
 * What a ♿ spot adds to how well it fits someone: a little for a member who
 * needs something (it is kept for them), a lot less for anyone else. The
 * planner and the spot picker rank with it.
 */
export function specialPull(spot: Pick<SpotInfo, 'special'>, access: boolean): number {
	return spot.special ? (access ? 0.5 : -2) : 0;
}

/**
 * What a spot the crew locked 🔒 adds to how well it fits: so much less that
 * the plan takes one only when nothing else is left (the crew may hold it
 * back for a reason, or it is broken). The crew can still pick it by hand.
 */
export function lockedPull(spot: Pick<SpotInfo, 'locked'>): number {
	return spot.locked ? -100 : 0;
}

interface Place {
	kind: 'room' | 'house';
	key: string;
	name: string;
	house: string;
	room: string;
	free: number;
	special: number;
	/** Free spots the crew locked 🔒. */
	locked: number;
	/** How many of the locked ones are ♿ spots. */
	lockedSpecial: number;
}

function describe(
	name: string,
	free: number,
	special: number,
	size: number,
	flags: { usesSpecial: boolean; usesLocked: boolean }
): string {
	return (
		`${name} — ${free} free` +
		(special > 0 ? ` (♿ ${special})` : '') +
		(free >= size ? ` · fits all ${size}` : ' · too small') +
		(flags.usesSpecial ? ' · uses ♿' : '') +
		(flags.usesLocked ? ' · uses 🔒' : '')
	);
}

/**
 * Every room and every house with free spots, plus "Anywhere" first. Then the
 * rooms that fit everyone, the snuggest first; then the houses that fit,
 * also the snuggest first; then the rest, the roomiest first. A place that
 * only fits by giving ♿ spots to members who need nothing comes after the
 * places that fit without (rooms, then houses), marked "uses ♿"; one that
 * only fits by using spots the crew locked 🔒 comes after those, marked
 * "uses 🔒".
 * @param spots the free spots an admin can book (listAssignableSpots)
 * @param size how many members need a spot (toPlace)
 * @param accessCount how many of them need something (requestKinds().access):
 *   the ♿ spots a place may give the group without wasting one
 */
export function placeOptions(spots: SpotInfo[], size: number, accessCount = 0): PlaceOption[] {
	const places = new Map<string, Place>();
	const count = (
		key: string,
		spot: SpotInfo,
		make: () => Omit<Place, 'free' | 'special' | 'locked' | 'lockedSpecial'>
	) => {
		const place = places.get(key) ?? {
			...make(),
			free: 0,
			special: 0,
			locked: 0,
			lockedSpecial: 0
		};
		place.free += 1;
		if (spot.special) place.special += 1;
		if (spot.locked) place.locked += 1;
		if (spot.special && spot.locked) place.lockedSpecial += 1;
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

	/** The open spots there: plain ones, and ♿ ones nobody locked. */
	const open = (place: Place) => {
		const special = place.special - place.lockedSpecial;
		return { plain: place.free - place.locked - special, special };
	};
	/** What the group can take there without a problem: plain spots, ♿ ones for who needs something. */
	const usable = (place: Place) => {
		const { plain, special } = open(place);
		return plain + Math.min(special, accessCount);
	};
	/**
	 * What the proposal would have to do there, counted the way proposePlan
	 * chooses: members who need something take the open ♿ spots first, then
	 * plain ones; the others plain ones first, then the open ♿ ones; a locked
	 * spot only when nothing else is left (lockedPull).
	 */
	const flags = (place: Place) => {
		if (place.free < size) return { usesSpecial: false, usesLocked: false };
		const { plain, special } = open(place);
		const needers = Math.min(accessCount, size);
		const neederSpecial = Math.min(special, needers);
		const neederPlain = Math.min(plain, needers - neederSpecial);
		const otherPlain = Math.min(plain - neederPlain, size - needers);
		const otherSpecial = Math.min(special - neederSpecial, size - needers - otherPlain);
		const onLocked = size - neederSpecial - neederPlain - otherPlain - otherSpecial;
		return { usesSpecial: otherSpecial > 0, usesLocked: onLocked > 0 };
	};
	const rank = (place: Place) => {
		const room = place.kind === 'room' ? 0 : 1;
		if (place.free < size) return 6;
		const { usesSpecial, usesLocked } = flags(place);
		if (usesLocked) return 4 + room;
		return usesSpecial ? 2 + room : room;
	};
	const sorted = [...places.values()].sort(
		(a, b) =>
			rank(a) - rank(b) ||
			(rank(a) < 6 ? usable(a) - usable(b) || a.free - b.free : b.free - a.free) ||
			(a.kind === b.kind ? 0 : a.kind === 'room' ? -1 : 1) ||
			compareNatural(a.house, b.house) ||
			compareNatural(a.room, b.room)
	);

	const special = spots.filter((spot) => spot.special).length;
	return [
		{
			key: '',
			label: ANYWHERE,
			free: spots.length,
			special,
			fits: spots.length >= size,
			usesSpecial: false,
			usesLocked: false
		},
		...sorted.map((place) => ({
			key: place.key,
			label: describe(place.name, place.free, place.special, size, flags(place)),
			free: place.free,
			special: place.special,
			fits: place.free >= size,
			...flags(place)
		}))
	];
}

/**
 * The spots of a place, in the order the proposal tries them: natural order;
 * in a whole house the rooms with the most open (not locked) free spots
 * first, so the group packs into the fewest rooms, and each room's locked
 * spots after its open ones.
 */
function candidates(spots: SpotInfo[], placeKey: string): SpotInfo[] {
	if (!placeKey) return [...spots].sort(bySpot);
	const [, kind, id] = /^(room|house):(.+)$/.exec(placeKey) ?? [];
	if (kind === 'room') return spots.filter((spot) => spot.roomId === id).sort(bySpot);
	if (kind !== 'house') return [];
	const inHouse = spots.filter((spot) => spot.houseId === id);
	const free = new Map<string, number>();
	const open = new Map<string, number>();
	for (const spot of inHouse) {
		free.set(spot.roomId, (free.get(spot.roomId) ?? 0) + 1);
		if (!spot.locked) open.set(spot.roomId, (open.get(spot.roomId) ?? 0) + 1);
	}
	const count = (counts: Map<string, number>, spot: SpotInfo) => counts.get(spot.roomId) ?? 0;
	return inHouse.sort(
		(a, b) =>
			count(open, b) - count(open, a) ||
			count(free, b) - count(free, a) ||
			compareNatural(a.room, b.room) ||
			compareNatural(a.roomId, b.roomId) ||
			Number(a.locked) - Number(b.locked) ||
			compareNatural(a.spot, b.spot)
	);
}

/**
 * One spot per member to place, from the place's free spots: request id →
 * bed id, '' for a member that keeps their spot, is declined, or finds no
 * spot left. Members with an access need choose first (the most needs at the
 * top), each the best remaining spot by matchNeeds; a ♿ spot counts extra
 * for a member who needs something and against one who doesn't, and a spot
 * the crew locked 🔒 is taken only when nothing else is left (lockedPull). A
 * tie goes to the place order, which keeps bunk pairs together.
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
				matchNeeds(member.needs, facts[index]).score + specialPull(spot, access) + lockedPull(spot);
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

/** How well a place answers what the members need (needsMet). */
export interface NeedsMet {
	/** Members whose proposed spot there answers everything the layout can tell of theirs. */
	met: number;
	/** Members to place who ticked something the layout can tell (lower bunk, step-free, …). */
	of: number;
}

/**
 * Whether the proposal for a place gives the members what they need: of the
 * members to place who ticked something the layout can answer (not the
 * MATCHED_BY_HAND ones), how many get a spot there that answers all of it.
 */
export function needsMet(members: PlanMember[], spots: SpotInfo[], placeKey: string): NeedsMet {
	const plan = proposePlan(members, spots, placeKey);
	const byId = new Map(spots.map((spot) => [spot.bedId, spot]));
	const result: NeedsMet = { met: 0, of: 0 };
	for (const member of toPlace(members)) {
		const checkable = [...new Set(member.needs)].filter((need) => !MATCHED_BY_HAND.includes(need));
		if (checkable.length === 0) continue;
		result.of += 1;
		const spot = byId.get(plan[member.requestId]);
		if (!spot) continue;
		const { fits } = matchNeeds(checkable, factsOf(spot.bedType, spot.features));
		if (fits.length === checkable.length) result.met += 1;
	}
	return result;
}

/**
 * The places to suggest first, from placeOptions' list: the places that fit
 * everyone — those that need no spot the crew locked 🔒 first, then those
 * that answer every member's needs ahead of the rest, each in placeOptions'
 * order (the snuggest first, sparing the ♿ spots). "Anywhere" is not among
 * them.
 */
export function rankPlaces(
	options: PlaceOption[],
	members: PlanMember[],
	spots: SpotInfo[]
): (PlaceOption & { needs: NeedsMet })[] {
	const full = (needs: NeedsMet) => (needs.of === 0 || needs.met === needs.of ? 1 : 0);
	// sort() is stable: places that answer the needs equally keep placeOptions' order.
	return options
		.filter((option) => option.key && option.fits)
		.map((option) => ({ ...option, needs: needsMet(members, spots, option.key) }))
		.sort(
			(a, b) =>
				Number(a.usesLocked) - Number(b.usesLocked) ||
				full(b.needs) - full(a.needs) ||
				b.needs.met - a.needs.met
		);
}

/**
 * The rooms to recommend for a group, best first: rooms that fit everyone,
 * ranked by rankPlaces (none of the crew's locked 🔒 spots needed, then the
 * members' needs, then the snuggest). A group sleeps in one room (Max,
 * 2026-10-12): houses and "anywhere" are no recommendation — when no room
 * fits everyone, the crew picks the spots one by one.
 */
export function recommendRooms(
	options: PlaceOption[],
	members: PlanMember[],
	spots: SpotInfo[]
): (PlaceOption & { needs: NeedsMet })[] {
	return rankPlaces(options, members, spots).filter((option) => option.key.startsWith('room:'));
}

/**
 * Where the plan starts: the best room that fits everyone (recommendRooms),
 * or null when no room does — then there is no plan, and the crew picks a
 * spot for each member.
 */
export function defaultPlace(
	options: PlaceOption[],
	members: PlanMember[],
	spots: SpotInfo[]
): string | null {
	return recommendRooms(options, members, spots)[0]?.key ?? null;
}

/**
 * A row of the plan gets another spot (the picker's "Use this spot"). When
 * another member is planned on that spot, the two swap — or, when this
 * member had no spot in the plan, the other one goes back to "Keep as is".
 * @param plan request id → bed id as the rows show it now ('' = keep as is)
 * @returns the rows that change, and the member that lost their spot
 *   without getting one back ('' for none)
 */
export function repick(
	plan: Readonly<Record<string, string>>,
	requestId: string,
	bedId: string
): { changes: Record<string, string>; bumped: string } {
	const mine = plan[requestId] ?? '';
	const changes: Record<string, string> = { [requestId]: bedId };
	const other = Object.keys(plan).find((id) => id !== requestId && bedId && plan[id] === bedId);
	if (!other) return { changes, bumped: '' };
	changes[other] = mine;
	return { changes, bumped: mine ? '' : other };
}
