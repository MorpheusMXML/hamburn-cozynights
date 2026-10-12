// src/lib/group-plan.ts
/**
 * The planner of a request group on the requests page (docs/admin/special-needs.md,
 * "Groups"): where the group could sleep, and a first proposal of one free
 * spot per member, which the crew changes or books as it is. Pure code
 * without I/O, shared by the admin page (also in the browser) and the unit
 * tests. Deterministic: the same group and the same spots always give the
 * same proposal.
 *
 * Max's rules (2026-10-12, v1.32.3): a group sleeps in one room; the ♿ spots
 * are the pool for special-needs requests, so a plan fills them first (the
 * members who need something get the fitting ones); a spot the crew locked 🔒
 * is out of service — never planned, never counted as free, only picked by
 * hand on purpose.
 */
import { MATCHED_BY_HAND, factsOf, matchNeeds } from './accommodation';
import { requestKinds, type SpecialNeed, type SpotInfo } from './special-needs';
import { compareNatural } from './template';

/** A member of the group, as the planner needs it. */
export interface PlanMember {
	requestId: string;
	name: string;
	needs: readonly SpecialNeed[];
	declined: boolean;
	/** The spot the crew booked for the request ('' for none): the member keeps it. */
	crewSpotLabel: string;
	/** The room of that spot ('' or left out for none): the rest of the group belongs there. */
	crewRoomId?: string;
	/** The room the member sleeps in now, booked by anyone ('' or left out for none). */
	roomId?: string;
}

/** A place the group could sleep in, for the planner's "Where:" choice. */
export interface PlaceOption {
	/** '' (anywhere), 'room:<id>' or 'house:<id>' */
	key: string;
	label: string;
	/** Free spots there that a plan may use: none the crew locked 🔒 (♿ spots included). */
	free: number;
	/** How many of them are ♿ spots. */
	special: number;
	/** Free spots the crew locked 🔒: out of service, never counted as free. */
	locked: number;
	/** Enough free spots for everyone to place. */
	fits: boolean;
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

/** A spot a plan may use: free and not locked 🔒 (out of service). */
export const plannable = (spot: Pick<SpotInfo, 'locked'>) => !spot.locked;

interface Place {
	kind: 'room' | 'house';
	key: string;
	name: string;
	house: string;
	room: string;
	free: number;
	special: number;
	locked: number;
}

function describe(name: string, free: number, special: number, size: number): string {
	return (
		`${name} — ${free} free` +
		(special > 0 ? ` (♿ ${special})` : '') +
		(free >= size ? ` · fits all ${size}` : ' · too small')
	);
}

/**
 * Every room and every house with free spots, plus "Anywhere" first. Then the
 * rooms that fit everyone — the most ♿ spots for the group first, then the
 * snuggest; then the houses that fit, the same way; then the rest, the
 * roomiest first. Spots the crew locked 🔒 count for nothing: a place fits
 * with its other free spots, or not at all.
 * @param spots the free spots an admin can book (listAssignableSpots)
 * @param size how many members need a spot (toPlace)
 */
export function placeOptions(spots: SpotInfo[], size: number): PlaceOption[] {
	const places = new Map<string, Place>();
	const count = (
		key: string,
		spot: SpotInfo,
		make: () => Omit<Place, 'free' | 'special' | 'locked'>
	) => {
		const place = places.get(key) ?? { ...make(), free: 0, special: 0, locked: 0 };
		if (!plannable(spot)) place.locked += 1;
		else {
			place.free += 1;
			if (spot.special) place.special += 1;
		}
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

	const rank = (place: Place) => (place.free < size ? 2 : place.kind === 'room' ? 0 : 1);
	const sorted = [...places.values()]
		.filter((place) => place.free > 0)
		.sort(
			(a, b) =>
				rank(a) - rank(b) ||
				(rank(a) < 2
					? specialCover(b, size) - specialCover(a, size) || a.free - b.free
					: b.free - a.free) ||
				(a.kind === b.kind ? 0 : a.kind === 'room' ? -1 : 1) ||
				compareNatural(a.house, b.house) ||
				compareNatural(a.room, b.room)
		);

	const open = spots.filter(plannable);
	return [
		{
			key: '',
			label: ANYWHERE,
			free: open.length,
			special: open.filter((spot) => spot.special).length,
			locked: spots.length - open.length,
			fits: open.length >= size
		},
		...sorted.map((place) => ({
			key: place.key,
			label: describe(place.name, place.free, place.special, size),
			free: place.free,
			special: place.special,
			locked: place.locked,
			fits: place.free >= size
		}))
	];
}

/** How many of the group a place's free ♿ spots take: the pool for special-needs requests. */
export function specialCover(place: Pick<PlaceOption, 'special'>, size: number): number {
	return Math.min(place.special, size);
}

/**
 * The spots of a place a plan may use, in the order the proposal tries them
 * (after the ♿ spots, proposePlan): natural order; in a whole house the
 * rooms with the most free spots first, so the group packs into the fewest
 * rooms. Never a spot the crew locked 🔒.
 */
function candidates(spots: SpotInfo[], placeKey: string): SpotInfo[] {
	const open = spots.filter(plannable);
	if (!placeKey) return open.sort(bySpot);
	const [, kind, id] = /^(room|house):(.+)$/.exec(placeKey) ?? [];
	if (kind === 'room') return open.filter((spot) => spot.roomId === id).sort(bySpot);
	if (kind !== 'house') return [];
	const inHouse = open.filter((spot) => spot.houseId === id);
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

/** A member to place, with what the plan compares (proposePlan). */
interface Placing {
	member: PlanMember;
	index: number;
	/** Each need once: stored needs aren't deduplicated. */
	needs: SpecialNeed[];
	/** The needs the layout can answer (not MATCHED_BY_HAND), like needsMet counts them. */
	checkable: SpecialNeed[];
	/** A personal need (requestKinds): among the ♿ spots, these come first. */
	access: boolean;
}

type Facts = ReturnType<typeof factsOf>;

/**
 * How well a spot suits a member, for the first pick: no clear mismatch
 * first, then a ♿ spot (the pool for special-needs requests), then the most
 * needs it answers (matchNeeds).
 */
function suits(needs: readonly SpecialNeed[], spot: SpotInfo, facts: Facts) {
	const match = matchNeeds(needs, facts);
	return [match.conflicts.length === 0 ? 1 : 0, spot.special ? 1 : 0, match.score];
}

/**
 * What one member on one spot adds to a plan, to compare two plans field by
 * field (more is better): no clear mismatch (✗), a ♿ spot, everything the
 * layout can tell of the member's needs answered (like needsMet), the needs
 * it answers, a ♿ spot for a member with a personal need.
 */
function worth(placing: Placing, spot: SpotInfo, facts: Facts): number[] {
	const match = matchNeeds(placing.needs, facts);
	const met =
		placing.checkable.length > 0 && placing.checkable.every((need) => match.fits.includes(need));
	return [
		match.conflicts.length > 0 ? -1 : 0,
		spot.special ? 1 : 0,
		met ? 1 : 0,
		match.fits.length,
		placing.access && spot.special ? 1 : 0
	];
}

function better(a: number[], b: number[]): boolean {
	for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] > b[i];
	return false;
}

const plus = (a: number[], b: number[]) => a.map((value, i) => value + b[i]);

/**
 * One spot per member to place, from the place's free spots: request id →
 * bed id, '' for a member that keeps their spot, is declined, or finds no
 * spot left. Never a spot the crew locked 🔒. What makes a plan better, in
 * this order: fewer clear mismatches (✗); more members on ♿ spots, the pool
 * for every special-needs request; more members whose needs the layout can
 * tell are all answered; more needs answered; the ♿ spots with the members
 * who have a personal need (worth). First each member picks in turn — those
 * with needs the layout can check first, then the other personal needs,
 * then everyone else — and then the plan repairs what that order got wrong:
 * a member moves to a spot nobody has, or two members swap, whenever that
 * makes the plan better. In a whole house a ♿ spot comes first whichever
 * room it is in. A tie goes to the place order, which keeps bunk pairs
 * together.
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
	const queue: Placing[] = toPlace(members)
		.map((member, index) => {
			const needs = [...new Set(member.needs)];
			return {
				member,
				index,
				needs,
				checkable: needs.filter((need) => !MATCHED_BY_HAND.includes(need)),
				access: requestKinds(needs).access
			};
		})
		.sort(
			(a, b) =>
				b.checkable.length - a.checkable.length ||
				Number(b.access) - Number(a.access) ||
				a.index - b.index
		);

	// The first pick: one member after the other, each the best spot left.
	const at: number[] = queue.map(() => -1);
	const used = new Set<number>();
	queue.forEach((placing, q) => {
		let best = -1;
		let bestSuit: number[] = [];
		pool.forEach((spot, index) => {
			if (used.has(index)) return;
			const suit = suits(placing.needs, spot, facts[index]);
			if (best < 0 || better(suit, bestSuit)) {
				best = index;
				bestSuit = suit;
			}
		});
		if (best < 0) return;
		used.add(best);
		at[q] = best;
	});

	// The repair: each change makes the plan strictly better, so it ends.
	const known = new Map<number, number[]>();
	const value = (q: number, j: number) => {
		const key = q * pool.length + j;
		let found = known.get(key);
		if (!found) {
			found = worth(queue[q], pool[j], facts[j]);
			known.set(key, found);
		}
		return found;
	};
	const repairOnce = (): boolean => {
		for (let q = 0; q < queue.length; q++) {
			const j = at[q];
			if (j < 0) continue;
			for (let k = 0; k < pool.length; k++) {
				if (used.has(k) || !better(value(q, k), value(q, j))) continue;
				used.delete(j);
				used.add(k);
				at[q] = k;
				return true;
			}
			for (let r = q + 1; r < queue.length; r++) {
				const k = at[r];
				if (k < 0) continue;
				if (!better(plus(value(q, k), value(r, j)), plus(value(q, j), value(r, k)))) continue;
				at[q] = k;
				at[r] = j;
				return true;
			}
		}
		return false;
	};
	while (repairOnce());

	queue.forEach((placing, q) => {
		if (at[q] >= 0) plan[placing.member.requestId] = pool[at[q]].bedId;
	});
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
 * everyone — the most of the group on ♿ spots first, then those that answer
 * every member's needs, then the most needs answered, each in placeOptions'
 * order (the snuggest first). "Anywhere" is not among them.
 */
export function rankPlaces(
	options: PlaceOption[],
	members: PlanMember[],
	spots: SpotInfo[]
): (PlaceOption & { needs: NeedsMet })[] {
	const size = toPlace(members).length;
	const full = (needs: NeedsMet) => (needs.of === 0 || needs.met === needs.of ? 1 : 0);
	// sort() is stable: places that answer the needs equally keep placeOptions' order.
	return options
		.filter((option) => option.key && option.fits)
		.map((option) => ({ ...option, needs: needsMet(members, spots, option.key) }))
		.sort(
			(a, b) =>
				specialCover(b, size) - specialCover(a, size) ||
				full(b.needs) - full(a.needs) ||
				b.needs.met - a.needs.met
		);
}

/**
 * The rooms to recommend for a group, best first: rooms that fit everyone,
 * ranked by rankPlaces (the most ♿ spots for the group, then the members'
 * needs, then the snuggest). A group sleeps in one room (Max, 2026-10-12):
 * houses and "anywhere" are no recommendation — when no room fits everyone,
 * the crew picks the spots one by one. Any room that fits stays the crew's
 * to choose; this is only the order.
 */
export function recommendRooms(
	options: PlaceOption[],
	members: PlanMember[],
	spots: SpotInfo[]
): (PlaceOption & { needs: NeedsMet })[] {
	const rooms = rankPlaces(options, members, spots).filter((option) =>
		option.key.startsWith('room:')
	);
	// Where members sleep already (a spot the crew booked) comes first: the
	// rest of the group joins them there.
	const anchors = anchorRooms(members);
	const order = (key: string) => {
		const index = anchors.indexOf(key.slice('room:'.length));
		return index < 0 ? anchors.length : index;
	};
	return anchors.length === 0 ? rooms : rooms.sort((a, b) => order(a.key) - order(b.key));
}

/** The rooms where members sleep in a spot the crew booked, most members first. */
function anchorRooms(members: PlanMember[]): string[] {
	const counts = new Map<string, number>();
	for (const member of members) {
		if (member.declined || !member.crewSpotLabel || !member.crewRoomId) continue;
		counts.set(member.crewRoomId, (counts.get(member.crewRoomId) ?? 0) + 1);
	}
	return [...counts.entries()]
		.sort((a, b) => b[1] - a[1] || compareNatural(a[0], b[0]))
		.map(([roomId]) => roomId);
}

/**
 * Where the plan starts: the best room that fits everyone (recommendRooms),
 * or null when no room does — then there is no plan, and the crew picks a
 * spot for each member. When the crew booked some members already, only a
 * room they sleep in can take the rest (else null: the rows start on Keep as
 * is), so the plan never splits a group that has started in one room.
 */
export function defaultPlace(
	options: PlaceOption[],
	members: PlanMember[],
	spots: SpotInfo[]
): string | null {
	const rooms = recommendRooms(options, members, spots);
	const anchors = anchorRooms(members);
	if (anchors.length === 0) return rooms[0]?.key ?? null;
	return rooms.find((option) => anchors.includes(option.key.slice('room:'.length)))?.key ?? null;
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

/** "Ada", "Ada and Bo", "Ada, Bo and Cy". */
function joinNames(names: string[]): string {
	return names.length <= 1
		? (names[0] ?? '')
		: `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/**
 * Why there is no plan, for the line on the group's card ('' when there is
 * one): no room has space for everyone — or one does, but the plan stays
 * with the room where the crew booked members already, and that one has no
 * space for the rest ("is full" only when it has no free spot at all).
 */
export function noPlanNote(
	options: PlaceOption[],
	members: PlanMember[],
	spots: SpotInfo[]
): string {
	if (defaultPlace(options, members, spots) !== null) return '';
	const rest = toPlace(members).length;
	const anchors = anchorRooms(members);
	if (anchors.length > 0 && recommendRooms(options, members, spots).length > 0) {
		const names = members
			.filter((m) => !m.declined && m.crewSpotLabel && anchors.includes(m.crewRoomId ?? ''))
			.map((m) => m.name);
		const who = joinNames(names);
		const free = (roomId: string) =>
			options.find((option) => option.key === `room:${roomId}`)?.free ?? 0;
		const one = anchors.length === 1;
		const where = one
			? `The room where ${who} ${names.length === 1 ? 'sleeps' : 'sleep'}`
			: `The rooms where ${who} sleep`;
		const then = 'choose a room for the rest, or pick each with Change.';
		if (anchors.every((roomId) => free(roomId) === 0)) {
			return `${where} ${one ? 'is' : 'are'} full: ${then}`;
		}
		const left = one ? ` (${free(anchors[0])} free)` : '';
		return `${where} ${one ? 'has' : 'have'} no space for all ${rest} others${left}: ${then}`;
	}
	return `No room has ${rest} free spots together: pick a spot for each with Change.`;
}

/**
 * How many spots of a room other guests booked: its bookings minus the
 * members of the group who sleep there. Booking a group into such a room is
 * fine — nobody is moved — the picker and the dialog only say so.
 * @param booked room id → booked spots (countRoomSpots)
 */
export function othersBooked(
	roomId: string,
	booked: Readonly<Record<string, number>>,
	members: Pick<PlanMember, 'roomId'>[]
): number {
	const ours = members.filter((member) => member.roomId === roomId).length;
	return Math.max(0, (booked[roomId] ?? 0) - ours);
}
