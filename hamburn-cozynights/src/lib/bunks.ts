// src/lib/bunks.ts
/**
 * Bunk beds: two spots of a room stacked into one bed, a lower and an upper.
 *
 * The pairing is stored on both spots — `beds.bunk_partner` points at the
 * other spot — and their bed types say which is which: `bunk_lower` and
 * `bunk_upper` from the catalogue in ./accommodation. That is what the
 * ♿ matching ("a bed without a ladder"), the roulette wishes and the
 * booking pass already read, so a stacked pair fits every one of them
 * without a new rule. Pure code, shared by the room pages, the layout
 * templates and the tests; the server keeps the two sides in step
 * (src/routes/admin/room/[id]/+page.server.ts, pb_hooks/cozy_bunks.pb.js).
 */

export interface BunkSpot {
	id: string;
	label?: string;
	bed_type?: string;
	/** The other spot of the bunk bed; empty for a spot that stands alone. */
	bunk_partner?: string;
}

export type BunkLevel = 'lower' | 'upper';

/** The bed type each level of a bunk bed carries. */
export const BUNK_LEVEL_TYPE: Record<BunkLevel, 'bunk_lower' | 'bunk_upper'> = {
	lower: 'bunk_lower',
	upper: 'bunk_upper'
};

/** One card on a room page: a spot on its own, or a bunk bed of two. */
export type SpotUnit<T extends BunkSpot> =
	{ kind: 'single'; spot: T } | { kind: 'bunk'; lower: T; upper: T };

/** The level a spot's bed type says, or null for anything that is not a bunk. */
export function levelOf(spot: Pick<BunkSpot, 'bed_type'>): BunkLevel | null {
	if (spot.bed_type === 'bunk_lower') return 'lower';
	if (spot.bed_type === 'bunk_upper') return 'upper';
	return null;
}

/**
 * True when two spots are each other's bunk partner. Only a pairing written
 * on both sides counts: a half-written one (the other spot gone, or pointing
 * elsewhere) shows as two single spots until the server heals it.
 */
export function arePaired(a: BunkSpot, b: BunkSpot): boolean {
	return a.id !== b.id && a.bunk_partner === b.id && b.bunk_partner === a.id;
}

/**
 * The spots of a room as cards, in the order given: every bunk bed appears
 * once, where its first spot was, with its lower and upper level sorted out.
 * When neither or both spots say which level they are, the first one in the
 * list is the lower bunk — the same order the crew sees.
 */
export function groupBunks<T extends BunkSpot>(spots: readonly T[]): SpotUnit<T>[] {
	const byId = new Map(spots.map((spot) => [spot.id, spot]));
	const placed = new Set<string>();
	const units: SpotUnit<T>[] = [];
	for (const spot of spots) {
		if (placed.has(spot.id)) continue;
		const partner = spot.bunk_partner ? byId.get(spot.bunk_partner) : undefined;
		if (partner && !placed.has(partner.id) && arePaired(spot, partner)) {
			placed.add(spot.id);
			placed.add(partner.id);
			const [lower, upper] = orderLevels(spot, partner);
			units.push({ kind: 'bunk', lower, upper });
		} else {
			placed.add(spot.id);
			units.push({ kind: 'single', spot });
		}
	}
	return units;
}

/** [lower, upper] of two paired spots, by their bed types, else by their order. */
export function orderLevels<T extends BunkSpot>(first: T, second: T): [T, T] {
	const a = levelOf(first);
	const b = levelOf(second);
	if (a === 'upper' && b !== 'upper') return [second, first];
	if (b === 'lower' && a !== 'lower') return [second, first];
	return [first, second];
}

/** The bunk bed a spot belongs to, or null when it stands alone. */
export function bunkOf<T extends BunkSpot>(
	spots: readonly T[],
	id: string
): { lower: T; upper: T } | null {
	for (const unit of groupBunks(spots)) {
		if (unit.kind === 'bunk' && (unit.lower.id === id || unit.upper.id === id)) {
			return { lower: unit.lower, upper: unit.upper };
		}
	}
	return null;
}

/** The other spot of a bunk bed, or null. */
export function partnerOf<T extends BunkSpot>(spots: readonly T[], id: string): T | null {
	const bunk = bunkOf(spots, id);
	if (!bunk) return null;
	return bunk.lower.id === id ? bunk.upper : bunk.lower;
}

/**
 * Why two spots cannot be stacked, or '' when they can: they must be two
 * different spots of the same list, and neither may be part of a bunk bed
 * already. (A booked spot can be stacked: the guest keeps the spot, it just
 * gets a level.)
 */
export function stackProblem(spots: readonly BunkSpot[], lowerId: string, upperId: string): string {
	if (lowerId === upperId) return 'A spot cannot be stacked on itself.';
	const lower = spots.find((spot) => spot.id === lowerId);
	const upper = spots.find((spot) => spot.id === upperId);
	if (!lower || !upper) return 'One of the two spots is not in this room. Reload the page.';
	const name = (spot: BunkSpot) => (spot.label ? `"${spot.label}"` : 'the unnamed spot');
	if (bunkOf(spots, lowerId))
		return `${name(lower)} is part of a bunk bed already. Unstack it first.`;
	if (bunkOf(spots, upperId))
		return `${name(upper)} is part of a bunk bed already. Unstack it first.`;
	return '';
}

/** The spots that could go on top of `lowerId`: everything unpaired but itself. */
export function stackCandidates<T extends BunkSpot>(spots: readonly T[], lowerId: string): T[] {
	return spots.filter(
		(spot) => spot.id !== lowerId && stackProblem(spots, lowerId, spot.id) === ''
	);
}

/** What the two spots of a bunk bed are written with when stacked. */
export function stackWrites(lowerId: string, upperId: string) {
	return {
		lower: { id: lowerId, bunk_partner: upperId, bed_type: BUNK_LEVEL_TYPE.lower },
		upper: { id: upperId, bunk_partner: lowerId, bed_type: BUNK_LEVEL_TYPE.upper }
	};
}

/**
 * What a spot is written with when its bunk bed is taken apart: the pairing
 * goes; a bed type that said "lower" or "upper" bunk goes too, because a
 * bunk without a partner tells the ♿ matching the wrong thing. Any other bed
 * type stays.
 */
export function unstackWrite(spot: BunkSpot) {
	return {
		id: spot.id,
		bunk_partner: '',
		...(levelOf(spot) ? { bed_type: '' } : {})
	};
}

/** "above B1" / "below B2": where the other level is, for a spot's card. */
export function bunkNote<T extends BunkSpot>(spots: readonly T[], id: string): string {
	const bunk = bunkOf(spots, id);
	if (!bunk) return '';
	const other = bunk.lower.id === id ? bunk.upper : bunk.lower;
	const where = bunk.lower.id === id ? 'below' : 'above';
	return other.label ? `${where} ${other.label}` : `${where} the unnamed spot`;
}
