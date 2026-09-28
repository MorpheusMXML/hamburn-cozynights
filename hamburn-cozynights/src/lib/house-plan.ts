// src/lib/house-plan.ts
/**
 * The house generator's plan (docs/admin/camp-layout.md): rooms entered as
 * size rows — "4 rooms × 6 beds 🪜", "2 rooms × 8 beds" — instead of one by
 * one. Pure code, shared by the size rows in the browser (live totals and
 * room numbers) and the server actions that create the rooms and spots
 * (src/lib/server/house-generator.ts), so both count the same way.
 *
 * "Beds" in a row are sleeping places, i.e. spots: a 6-bed room of bunk beds
 * is three bunk beds. Spots are labelled B1, B2, … like every generated spot.
 */
import { TEMPLATE_LIMITS } from './template';
import { BUNK_LEVEL_TYPE } from './bunks';

export interface RoomSize {
	/** How many rooms of this size. */
	rooms: number;
	/** Spots per room. */
	beds: number;
	/** The spots are stacked in pairs into bunk beds: B1 + B2, B3 + B4, … */
	bunks: boolean;
}

export interface RoomPlan {
	sizes: RoomSize[];
	/** Every size row starts its own block of room numbers: 1–4, then 11–16, then 21–… */
	floors: boolean;
	/** The first new room's number; null: the next free one. */
	firstNumber: number | null;
}

export const PLAN_LIMITS = {
	sizes: 10,
	roomsPerHouse: TEMPLATE_LIMITS.roomsPerHouse,
	bedsPerRoom: TEMPLATE_LIMITS.bedsPerRoom,
	roomNumber: TEMPLATE_LIMITS.roomNumber,
	/** Spots in one go: a slip like 50 × 50 must not keep the server busy for minutes. */
	spots: 500
} as const;

/** What the first row of a new house starts with. */
export const DEFAULT_SIZE: RoomSize = { rooms: 4, beds: 4, bunks: false };

/** What "+ another size" adds: a copy of the row above, the likeliest next floor. */
export function nextSize(sizes: readonly RoomSize[]): RoomSize {
	const last = sizes[sizes.length - 1];
	return last ? { ...last } : { ...DEFAULT_SIZE };
}

/**
 * The size a house page's form starts with: one more room like the ones
 * the house has most of (bunk beds or not), or the default for an empty house.
 */
export function suggestSize(rooms: readonly { spots: number; bunks: boolean }[]): RoomSize {
	const counts = new Map<string, { size: RoomSize; n: number }>();
	for (const room of rooms) {
		if (room.spots < 1 || room.spots > PLAN_LIMITS.bedsPerRoom) continue;
		const key = `${room.spots}${room.bunks ? 'b' : ''}`;
		const entry = counts.get(key) ?? {
			size: { rooms: 1, beds: room.spots, bunks: room.bunks },
			n: 0
		};
		entry.n++;
		counts.set(key, entry);
	}
	let best: { size: RoomSize; n: number } | null = null;
	for (const entry of counts.values()) if (!best || entry.n > best.n) best = entry;
	return best ? { ...best.size } : { ...DEFAULT_SIZE };
}

export interface PlanTotals {
	rooms: number;
	spots: number;
	bunkBeds: number;
}

export function planTotals(sizes: readonly RoomSize[]): PlanTotals {
	const totals: PlanTotals = { rooms: 0, spots: 0, bunkBeds: 0 };
	for (const size of sizes) {
		totals.rooms += size.rooms;
		totals.spots += size.rooms * size.beds;
		if (size.bunks) totals.bunkBeds += size.rooms * Math.floor(size.beds / 2);
	}
	return totals;
}

/** A block of ten, or of a hundred once the numbers have three digits: 101…, 201… */
function blockSize(first: number): number {
	return first >= 100 ? 100 : 10;
}

/** The start of the block after `number`: 4 → 11, 10 → 11, 16 → 21, 104 → 201 (blocks of 100). */
export function nextBlock(number: number, size: number): number {
	return (Math.floor((number - 1) / size) + 1) * size + 1;
}

/**
 * Where numbering starts when the admin leaves it open: 1 in an empty house,
 * else right after its highest number — or at the next block, with floors.
 */
export function defaultFirstNumber(existing: readonly number[], floors: boolean): number {
	const highest = Math.max(0, ...existing.filter((n) => Number.isFinite(n)));
	if (highest === 0) return 1;
	return floors ? nextBlock(highest, blockSize(highest)) : highest + 1;
}

export interface PlannedRoom {
	number: number;
	spots: number;
	bunks: boolean;
	/** The size row it comes from. */
	size: number;
}

/**
 * The rooms of a plan with their numbers. Numbers count up from the first
 * one and skip every number the house uses already; with floors every size
 * row starts at the next block of ten (of a hundred from #100 on).
 */
export function planRooms(plan: RoomPlan, existing: readonly number[] = []): PlannedRoom[] {
	const taken = new Set(existing);
	const first = plan.firstNumber ?? defaultFirstNumber(existing, plan.floors);
	const block = blockSize(first);
	const rooms: PlannedRoom[] = [];
	let next = first;
	plan.sizes.forEach((size, index) => {
		if (index > 0 && plan.floors && rooms.length > 0) {
			next = nextBlock(rooms[rooms.length - 1].number, block);
		}
		for (let i = 0; i < size.rooms; i++) {
			while (taken.has(next)) next++;
			rooms.push({ number: next, spots: size.beds, bunks: size.bunks, size: index });
			taken.add(next);
			next++;
		}
	});
	return rooms;
}

/** "#1–4 · #11–16 · #21": the numbers as runs, for the summary line. */
export function numberRanges(numbers: readonly number[]): string {
	const sorted = [...numbers].sort((a, b) => a - b);
	const runs: string[] = [];
	for (let i = 0; i < sorted.length;) {
		let j = i;
		while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
		runs.push(j === i ? `#${sorted[i]}` : `#${sorted[i]}–${sorted[j]}`);
		i = j + 1;
	}
	return runs.join(' · ');
}

export interface PlannedSpot {
	label: string;
	bed_type: '' | 'bunk_lower' | 'bunk_upper';
	/** The other spot of its bunk bed, as an index into the room's list. */
	partner: number | null;
}

/**
 * A new room's spots: B1 … Bn; with bunk beds B1 + B2 are the lower and
 * upper bunk of the first bed, B3 + B4 of the next, and a last odd spot
 * stands alone with no bed type (like SPOT TYPES → bunk beds on a room page).
 */
export function planSpots(count: number, bunks: boolean): PlannedSpot[] {
	return Array.from({ length: count }, (_, i) => {
		const label = `B${i + 1}`;
		if (!bunks || (i % 2 === 0 && i === count - 1)) return { label, bed_type: '', partner: null };
		return i % 2 === 0
			? { label, bed_type: BUNK_LEVEL_TYPE.lower, partner: i + 1 }
			: { label, bed_type: BUNK_LEVEL_TYPE.upper, partner: i - 1 };
	});
}

export interface PlanProblem {
	message: string;
	/** The size row it is about, when it is about one. */
	row?: number;
	field?: 'rooms' | 'beds' | 'firstNumber';
}

export interface PlanContext {
	/** Room numbers the house has already. */
	existing?: readonly number[];
	/** A new house may start without rooms; adding rooms needs at least one. */
	allowEmpty?: boolean;
	/** What a room is called in this house: "room", "hut", "tent". */
	word?: string;
	plural?: string;
}

const whole = (n: number) => Number.isInteger(n);

/** Why the plan can't be built, or null. The messages are written for the crew. */
export function planProblem(plan: RoomPlan, context: PlanContext = {}): PlanProblem | null {
	const existing = context.existing ?? [];
	const word = context.word ?? 'room';
	const plural = context.plural ?? `${word}s`;
	const { sizes } = plan;

	if (sizes.length === 0 && !context.allowEmpty) {
		return { message: `Add at least one ${word} size.` };
	}
	if (sizes.length > PLAN_LIMITS.sizes) {
		return { message: `Use at most ${PLAN_LIMITS.sizes} sizes in one go.` };
	}
	for (const [row, size] of sizes.entries()) {
		if (!whole(size.rooms) || size.rooms < 1 || size.rooms > PLAN_LIMITS.roomsPerHouse) {
			return {
				message: `Each size needs 1 to ${PLAN_LIMITS.roomsPerHouse} ${plural}.`,
				row,
				field: 'rooms'
			};
		}
		if (!whole(size.beds) || size.beds < 1 || size.beds > PLAN_LIMITS.bedsPerRoom) {
			return {
				message: `A ${word} holds 1 to ${PLAN_LIMITS.bedsPerRoom} beds.`,
				row,
				field: 'beds'
			};
		}
	}

	const totals = planTotals(sizes);
	if (existing.length + totals.rooms > PLAN_LIMITS.roomsPerHouse) {
		const left = PLAN_LIMITS.roomsPerHouse - existing.length;
		const most = `A house holds up to ${PLAN_LIMITS.roomsPerHouse} ${plural}`;
		return {
			message:
				existing.length === 0
					? `${most}, this plan has ${totals.rooms}.`
					: left > 0
						? `${most}. This one has ${existing.length}, so ${left} more at most.`
						: `${most}, and this one has ${existing.length} already.`
		};
	}
	if (totals.spots > PLAN_LIMITS.spots) {
		return {
			message: `That's ${totals.spots} spots in one go; the generator makes at most ${PLAN_LIMITS.spots}. Split it into two steps.`
		};
	}

	const first = plan.firstNumber;
	if (first !== null && (!whole(first) || first < 1 || first > PLAN_LIMITS.roomNumber)) {
		return {
			message: `${capitalize(word)} numbers run from 1 to ${PLAN_LIMITS.roomNumber}.`,
			field: 'firstNumber'
		};
	}
	const rooms = planRooms(plan, existing);
	const highest = rooms.reduce((max, room) => Math.max(max, room.number), 0);
	if (highest > PLAN_LIMITS.roomNumber) {
		return {
			message: `The numbers would run up to #${highest}, the highest is ${PLAN_LIMITS.roomNumber}. Start lower${plan.floors ? ' or switch off floor blocks' : ''}.`,
			field: 'firstNumber'
		};
	}
	return null;
}

function capitalize(word: string): string {
	return word.charAt(0).toUpperCase() + word.slice(1);
}

/** The sizes as the form sends them: "4x6b,2x8" (b = bunk beds). */
export function formatSizes(sizes: readonly RoomSize[]): string {
	return sizes.map((size) => `${size.rooms}x${size.beds}${size.bunks ? 'b' : ''}`).join(',');
}

/** "4x6b,2x8" back into sizes; null when it isn't written like that. Limits: planProblem. */
export function parseSizes(text: string): RoomSize[] | null {
	const trimmed = text.trim();
	if (!trimmed) return [];
	const sizes: RoomSize[] = [];
	for (const part of trimmed.split(',')) {
		const match = /^\s*(\d{1,4})\s*[x×]\s*(\d{1,4})\s*(b?)\s*$/i.exec(part);
		if (!match) return null;
		sizes.push({ rooms: Number(match[1]), beds: Number(match[2]), bunks: match[3] !== '' });
	}
	return sizes;
}

export type PlanFormResult = { ok: true; plan: RoomPlan } | { ok: false; error: string };

/** Reads the generator's fields: `sizes`, `floors` and `first_number`. */
export function readPlanForm(form: FormData): PlanFormResult {
	const sizes = parseSizes(String(form.get('sizes') ?? ''));
	if (!sizes) {
		return { ok: false, error: 'The room sizes could not be read. Reload the page and try again.' };
	}
	const floors = ['on', 'true', '1'].includes(String(form.get('floors') ?? ''));
	const firstInput = String(form.get('first_number') ?? '').trim();
	if (firstInput !== '' && !/^\d{1,4}$/.test(firstInput)) {
		return { ok: false, error: `Room numbers run from 1 to ${PLAN_LIMITS.roomNumber}.` };
	}
	const firstNumber = firstInput === '' ? null : Number(firstInput);
	return { ok: true, plan: { sizes, floors, firstNumber } };
}

/** The same fields for a request built in the browser (the map sidebar). */
export function appendPlan(form: FormData, plan: RoomPlan): FormData {
	form.append('sizes', formatSizes(plan.sizes));
	if (plan.floors) form.append('floors', 'on');
	if (plan.firstNumber !== null) form.append('first_number', String(plan.firstNumber));
	return form;
}
