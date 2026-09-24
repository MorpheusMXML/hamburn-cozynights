// src/lib/accommodation.ts
/**
 * What a place to sleep is like: the kind of a house or room, the kind of bed
 * and the features around it. Pure code without server imports, shared by the
 * guest pages, the room editor, the ♿ picker, the layout templates and the
 * unit tests.
 *
 * ONE fixed catalogue for every venue. The words are generic on purpose
 * (a "hut group", not "Waldhütten"): anything that is true for one camp only
 * belongs in a house's or room's free-text description. Because the catalogue
 * is fixed, the app knows what each entry MEANS — that is what makes the
 * ♿ matching, the map filters and the roulette wishes possible.
 *
 * Nothing is ever guessed: a field nobody filled in stays empty and counts as
 * "not specified", never as "no".
 */
import { SPECIAL_NEEDS, cleanRequestText, needLabel, type SpecialNeed } from './special-needs';

export type HouseKind = 'house' | 'hut_group' | 'tent_area' | 'other';
export type RoomKind = 'room' | 'hut' | 'tent' | 'other';
export type BedType =
	'single' | 'bunk_lower' | 'bunk_upper' | 'double' | 'sofa' | 'mattress' | 'camp_bed';
export type Feature =
	| 'wheelchair'
	| 'ground_floor'
	| 'toilets_inside'
	| 'own_bathroom'
	| 'heated'
	| 'unheated'
	| 'quiet'
	| 'power';

/** Where a feature can be set. A spot has its own and inherits the others. */
export type FeatureLevel = 'house' | 'room' | 'spot';

export const DESCRIPTION_MAX = 500;

export interface KindEntry<V extends string> {
	value: V;
	label: string;
	icon: string;
	hint?: string;
}

/** Keep in sync with `houses.kind` in pb_migrations/1759900000_accommodation.js. */
export const HOUSE_KINDS: (KindEntry<HouseKind> & {
	room: RoomKind;
	word: string;
	plural: string;
})[] = [
	{ value: 'house', label: 'House', icon: '🏠', room: 'room', word: 'room', plural: 'rooms' },
	{
		value: 'hut_group',
		label: 'Hut group',
		icon: '🛖',
		hint: 'Several huts under one pin on the map; each hut is a room.',
		room: 'hut',
		word: 'hut',
		plural: 'huts'
	},
	{
		value: 'tent_area',
		label: 'Tent area',
		icon: '⛺',
		hint: 'Tents or yurts under one pin; each tent is a room.',
		room: 'tent',
		word: 'tent',
		plural: 'tents'
	},
	{ value: 'other', label: 'Other', icon: '📍', room: 'other', word: 'place', plural: 'places' }
];

/** Keep in sync with `rooms.kind` in pb_migrations/1759900000_accommodation.js. */
export const ROOM_KINDS: KindEntry<RoomKind>[] = [
	{ value: 'room', label: 'Room', icon: '🚪' },
	{ value: 'hut', label: 'Hut', icon: '🛖' },
	{ value: 'tent', label: 'Tent', icon: '⛺' },
	{ value: 'other', label: 'Other', icon: '📍' }
];

export interface BedTypeEntry extends KindEntry<BedType> {
	/** You need a ladder to get in: the one thing "a bed without a ladder" rules out. */
	ladder: boolean;
}

/** Keep in sync with `beds.bed_type` in pb_migrations/1759900000_accommodation.js. */
export const BED_TYPES: BedTypeEntry[] = [
	{ value: 'single', label: 'Single bed', icon: '🛏️', ladder: false },
	{ value: 'bunk_lower', label: 'Lower bunk', icon: '🛏️', ladder: false },
	{ value: 'bunk_upper', label: 'Upper bunk', icon: '🪜', ladder: true },
	{
		value: 'double',
		label: 'Double bed (shared)',
		icon: '🛏️',
		ladder: false,
		hint: 'One half of a double bed: two spots, two guests.'
	},
	{ value: 'sofa', label: 'Sofa', icon: '🛋️', ladder: false },
	{ value: 'mattress', label: 'Mattress', icon: '🛌', ladder: false },
	{ value: 'camp_bed', label: 'Camp bed', icon: '🛏️', ladder: false }
];

export interface FeatureEntry extends KindEntry<Feature> {
	levels: FeatureLevel[];
	/** The feature that says the opposite of this one; the closer level wins. */
	opposite?: Feature;
}

/** Keep in sync with the `features` fields in pb_migrations/1759900000_accommodation.js. */
export const FEATURES: FeatureEntry[] = [
	{
		value: 'wheelchair',
		label: 'Wheelchair accessible',
		icon: '♿',
		levels: ['house', 'room'],
		hint: 'Step-free way in and an accessible bathroom.'
	},
	{
		value: 'ground_floor',
		label: 'Ground floor',
		icon: '⬇️',
		levels: ['house', 'room'],
		hint: 'No stairs on the way to the bed.'
	},
	{
		value: 'toilets_inside',
		label: 'Toilets + showers inside',
		icon: '🚻',
		levels: ['house'],
		hint: 'In the building itself, not in a wash house outside.'
	},
	{ value: 'own_bathroom', label: 'Own bathroom', icon: '🛁', levels: ['room'] },
	{ value: 'heated', label: 'Heated', icon: '🔥', levels: ['house', 'room'], opposite: 'unheated' },
	{
		value: 'unheated',
		label: 'No heating',
		icon: '❄️',
		levels: ['house', 'room'],
		opposite: 'heated'
	},
	{
		value: 'quiet',
		label: 'Quiet zone',
		icon: '🤫',
		levels: ['house', 'room'],
		hint: 'A calm corner of the camp, away from the sound systems.'
	},
	{
		value: 'power',
		label: 'Power socket',
		icon: '🔌',
		levels: ['room', 'spot'],
		hint: 'A socket at the bed or in the room.'
	}
];

const HOUSE_KIND_VALUES: readonly string[] = HOUSE_KINDS.map((kind) => kind.value);
const ROOM_KIND_VALUES: readonly string[] = ROOM_KINDS.map((kind) => kind.value);
const BED_TYPE_VALUES: readonly string[] = BED_TYPES.map((type) => type.value);

export function isHouseKind(value: unknown): value is HouseKind {
	return typeof value === 'string' && HOUSE_KIND_VALUES.includes(value);
}

export function isRoomKind(value: unknown): value is RoomKind {
	return typeof value === 'string' && ROOM_KIND_VALUES.includes(value);
}

export function isBedType(value: unknown): value is BedType {
	return typeof value === 'string' && BED_TYPE_VALUES.includes(value);
}

/** The features that may be set on this level. */
export function featuresFor(level: FeatureLevel): FeatureEntry[] {
	return FEATURES.filter((feature) => feature.levels.includes(level));
}

export function isFeature(value: unknown, level?: FeatureLevel): value is Feature {
	const entry = FEATURES.find((feature) => feature.value === value);
	return !!entry && (!level || entry.levels.includes(level));
}

export function houseKind(value: unknown): HouseKind | '' {
	return isHouseKind(value) ? value : '';
}

export function roomKind(value: unknown): RoomKind | '' {
	return isRoomKind(value) ? value : '';
}

export function bedType(value: unknown): BedType | '' {
	return isBedType(value) ? value : '';
}

export function houseKindEntry(value: unknown) {
	return HOUSE_KINDS.find((kind) => kind.value === value);
}

export function roomKindEntry(value: unknown) {
	return ROOM_KINDS.find((kind) => kind.value === value);
}

export function bedTypeEntry(value: unknown) {
	return BED_TYPES.find((type) => type.value === value);
}

export function featureEntry(value: unknown) {
	return FEATURES.find((feature) => feature.value === value);
}

export function bedTypeLabel(value: unknown): string {
	return bedTypeEntry(value)?.label ?? '';
}

export function featureLabel(value: unknown): string {
	return featureEntry(value)?.label ?? String(value ?? '');
}

/** What one room of such a house is called: "room", "hut", "tent", "place". */
export function roomWord(kind: unknown, plural = false): string {
	const entry = houseKindEntry(kind) ?? HOUSE_KINDS[0];
	return plural ? entry.plural : entry.word;
}

/** The room kind a new room of such a house gets by default. */
export function defaultRoomKind(kind: unknown): RoomKind {
	return (houseKindEntry(kind) ?? HOUSE_KINDS[0]).room;
}

/**
 * Cleans a list of features: only what this level allows, no duplicates, in
 * catalogue order, so two equal lists always look equal.
 */
export function readFeatures(raw: unknown, level: FeatureLevel): Feature[] {
	const values = Array.isArray(raw) ? raw : typeof raw === 'string' && raw ? [raw] : [];
	const chosen = new Set(values.filter((value): value is Feature => isFeature(value, level)));
	return FEATURES.filter((feature) => chosen.has(feature.value)).map((feature) => feature.value);
}

/**
 * A house's or room's description as it is stored: normal line breaks, no
 * control or invisible formatting characters, at most one empty line in a row
 * (the same cleaning a guest's own text gets). The length is checked where it
 * is read, so nothing is cut off silently.
 */
export function cleanDescription(raw: unknown): string {
	return cleanRequestText(raw);
}

export interface DetailsInput {
	kind: string;
	features: Feature[];
	description: string;
}

export type DetailsResult =
	{ ok: true; value: DetailsInput } | { ok: false; value: DetailsInput; error: string };

/**
 * Reads the details form of a house or room. Never throws; the messages are
 * written for the crew. The server checks the same rules the file import does.
 */
export function parseDetailsForm(form: FormData, level: 'house' | 'room'): DetailsResult {
	const raw = String(form.get('kind') ?? '').trim();
	const known = level === 'house' ? isHouseKind(raw) : isRoomKind(raw);
	const kind = known ? raw : '';
	const features = readFeatures(form.getAll('features'), level);
	const description = cleanDescription(form.get('description'));
	const value: DetailsInput = { kind, features, description };

	if (raw && !known) {
		return { ok: false, value, error: 'Pick a kind from the list, or leave it open.' };
	}
	const clash = FEATURES.find(
		(feature) =>
			feature.opposite && features.includes(feature.value) && features.includes(feature.opposite)
	);
	if (clash) {
		return {
			ok: false,
			value,
			error: `"${clash.label}" and "${featureLabel(clash.opposite)}" say the opposite of each other. Tick only one of them.`
		};
	}
	if (description.length > DESCRIPTION_MAX) {
		return {
			ok: false,
			value,
			error: `The description is too long: at most ${DESCRIPTION_MAX} characters (now ${description.length}).`
		};
	}
	return { ok: true, value };
}

/** The same for one spot: its bed type and the features of the spot itself. */
export function parseSpotForm(
	form: FormData
):
	| { ok: true; value: { bed_type: BedType | ''; features: Feature[] } }
	| { ok: false; error: string } {
	const raw = String(form.get('bed_type') ?? '').trim();
	if (raw && !isBedType(raw)) {
		return { ok: false, error: 'Pick a bed from the list, or leave it open.' };
	}
	return {
		ok: true,
		value: {
			bed_type: raw as BedType | '',
			features: readFeatures(form.getAll('features'), 'spot')
		}
	};
}

export interface SpotFacts {
	bedType: BedType | '';
	/** House, room and spot features together. */
	features: Feature[];
}

export interface FeatureSource {
	house?: readonly string[] | string | null;
	room?: readonly string[] | string | null;
	/** PocketBase returns a single value for a select that allows only one. */
	spot?: readonly string[] | string | null;
}

/**
 * What is true for one spot: its own features plus those of its room and
 * house. Where two levels say the opposite ("heated" in an "unheated" hut
 * group), the closer one wins.
 */
export function effectiveFeatures(source: FeatureSource): Feature[] {
	const byLevel: [FeatureLevel, Feature[]][] = [
		['house', readFeatures(source.house, 'house')],
		['room', readFeatures(source.room, 'room')],
		['spot', readFeatures(source.spot, 'spot')]
	];
	const chosen = new Set<Feature>();
	for (const [, features] of byLevel) {
		for (const feature of features) {
			const opposite = featureEntry(feature)?.opposite;
			if (opposite) chosen.delete(opposite);
			chosen.add(feature);
		}
	}
	return FEATURES.filter((feature) => chosen.has(feature.value)).map((feature) => feature.value);
}

export function spotFacts(source: FeatureSource & { bedType?: unknown }): SpotFacts {
	return { bedType: bedType(source.bedType), features: effectiveFeatures(source) };
}

/**
 * The same from a list that is already the sum of house, room and spot (what a
 * page or the ♿ picker was given), so no level filter narrows it again.
 */
export function factsOf(type: unknown, features: readonly string[] | undefined): SpotFacts {
	const chosen = new Set((features ?? []).filter((value): value is Feature => isFeature(value)));
	return {
		bedType: bedType(type),
		features: FEATURES.filter((feature) => chosen.has(feature.value)).map(
			(feature) => feature.value
		)
	};
}

export function hasFeature(facts: SpotFacts, feature: Feature): boolean {
	return facts.features.includes(feature);
}

/**
 * How a spot answers one need: it clearly fits, it clearly doesn't (only an
 * upper bunk can say that), or nobody wrote the detail down.
 */
export type NeedFit = 'fits' | 'conflict' | 'unknown';

export function needFit(need: SpecialNeed, facts: SpotFacts): NeedFit {
	switch (need) {
		case 'lower_bunk': {
			const entry = bedTypeEntry(facts.bedType);
			if (!entry) return 'unknown';
			return entry.ladder ? 'conflict' : 'fits';
		}
		case 'step_free':
			return hasFeature(facts, 'wheelchair') || hasFeature(facts, 'ground_floor')
				? 'fits'
				: 'unknown';
		case 'near_toilet':
			return hasFeature(facts, 'toilets_inside') || hasFeature(facts, 'own_bathroom')
				? 'fits'
				: 'unknown';
		case 'quiet':
			return hasFeature(facts, 'quiet') ? 'fits' : 'unknown';
		case 'power':
			return hasFeature(facts, 'power') ? 'fits' : 'unknown';
		// "Something else" is what the guest wrote: only a human can match that.
		case 'other':
			return 'unknown';
	}
}

export interface NeedMatch {
	fits: SpecialNeed[];
	conflicts: SpecialNeed[];
	/** Needs the layout says nothing about. */
	unknown: SpecialNeed[];
	/** How well the spot fits: more is better, a conflict costs a point. */
	score: number;
}

export function matchNeeds(needs: readonly SpecialNeed[], facts: SpotFacts): NeedMatch {
	const match: NeedMatch = { fits: [], conflicts: [], unknown: [], score: 0 };
	for (const need of needs) {
		const fit = needFit(need, facts);
		if (fit === 'fits') {
			match.fits.push(need);
			match.score += 1;
		} else if (fit === 'conflict') {
			match.conflicts.push(need);
			match.score -= 1;
		} else {
			match.unknown.push(need);
		}
	}
	return match;
}

/** One need of the open ♿ requests against the free spots that answer it. */
export interface NeedCapacity {
	need: SpecialNeed;
	label: string;
	/** Open requests that ticked this need. */
	asked: number;
	/** Free spots that fit it. */
	fitting: number;
	/** Fewer fitting spots than requests: the crew has to free or mark more. */
	short: boolean;
}

/**
 * What the open requests need and what the camp still has free for them.
 * "Something else" is left out: only a human can answer it.
 */
export function needCapacity(
	open: readonly { needs: readonly SpecialNeed[] }[],
	spots: readonly { bedType: string; features: readonly string[] }[]
): NeedCapacity[] {
	const facts = spots.map((spot) => factsOf(spot.bedType, spot.features));
	return SPECIAL_NEEDS.filter((need) => need.value !== 'other')
		.map(({ value }) => {
			const asked = open.filter((request) => request.needs.includes(value)).length;
			const fitting = facts.filter((spot) => needFit(value, spot) === 'fits').length;
			return { need: value, label: needLabel(value), asked, fitting, short: fitting < asked };
		})
		.filter((entry) => entry.asked > 0);
}

/**
 * The wishes guests can filter the map with and send the roulette off with.
 * Strict on purpose: a spot whose detail nobody filled in does not match, so
 * a filter never promises something the crew never wrote down.
 */
export type SpotFilter = 'no_ladder' | 'step_free' | 'toilets' | 'heated' | 'quiet' | 'power';

export interface SpotFilterEntry extends KindEntry<SpotFilter> {
	/** The need this filter answers, if it answers one. */
	need?: SpecialNeed;
}

export const SPOT_FILTERS: SpotFilterEntry[] = [
	{
		value: 'no_ladder',
		label: 'No ladder',
		icon: '🛏️',
		hint: 'A lower bunk, a single bed, a sofa or a mattress.',
		need: 'lower_bunk'
	},
	{
		value: 'step_free',
		label: 'Step-free',
		icon: '⬇️',
		hint: 'Ground floor or wheelchair accessible.',
		need: 'step_free'
	},
	{
		value: 'toilets',
		label: 'Toilets inside',
		icon: '🚻',
		hint: 'Toilets and showers in the building, or an own bathroom.',
		need: 'near_toilet'
	},
	{ value: 'heated', label: 'Heated', icon: '🔥', hint: 'The room is heated.' },
	{
		value: 'quiet',
		label: 'Quiet',
		icon: '🤫',
		hint: 'In a quiet corner of the camp.',
		need: 'quiet'
	},
	{
		value: 'power',
		label: 'Power socket',
		icon: '🔌',
		hint: 'A socket at the bed or in the room.',
		need: 'power'
	}
];

const FILTER_VALUES: readonly string[] = SPOT_FILTERS.map((filter) => filter.value);

export function isSpotFilter(value: unknown): value is SpotFilter {
	return typeof value === 'string' && FILTER_VALUES.includes(value);
}

/** Cleans a list of wishes from a URL or a form: known ones, no duplicates, in order. */
export function readFilters(raw: unknown): SpotFilter[] {
	const values = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(',') : [];
	const chosen = new Set(values.map((value) => String(value).trim()).filter(isSpotFilter));
	return SPOT_FILTERS.filter((filter) => chosen.has(filter.value)).map((filter) => filter.value);
}

export function spotMatchesFilter(filter: SpotFilter, facts: SpotFacts): boolean {
	switch (filter) {
		case 'no_ladder': {
			const entry = bedTypeEntry(facts.bedType);
			return !!entry && !entry.ladder;
		}
		case 'step_free':
			return hasFeature(facts, 'wheelchair') || hasFeature(facts, 'ground_floor');
		case 'toilets':
			return hasFeature(facts, 'toilets_inside') || hasFeature(facts, 'own_bathroom');
		case 'heated':
			return hasFeature(facts, 'heated');
		case 'quiet':
			return hasFeature(facts, 'quiet');
		case 'power':
			return hasFeature(facts, 'power');
	}
}

export function spotMatchesFilters(filters: readonly SpotFilter[], facts: SpotFacts): boolean {
	return filters.every((filter) => spotMatchesFilter(filter, facts));
}

/**
 * The wishes worth offering: the filters at least one of these spots answers,
 * in the catalogue's order. A camp without a heated room offers no "Heated"
 * chip, and a camp nobody described offers none at all.
 */
export function availableFilters(spots: readonly SpotFacts[]): SpotFilter[] {
	return SPOT_FILTERS.filter((filter) =>
		spots.some((spot) => spotMatchesFilter(filter.value, spot))
	).map((filter) => filter.value);
}

/**
 * A need in a few words ("No ladder"), for lists where the whole sentence of
 * the guest form would not fit. Falls back to the sentence itself.
 */
export function needShort(need: SpecialNeed): string {
	return SPOT_FILTERS.find((filter) => filter.need === need)?.label ?? needLabel(need);
}

export function filterLabel(value: unknown): string {
	return SPOT_FILTERS.find((filter) => filter.value === value)?.label ?? String(value ?? '');
}

/** "Lower bunk · 🔌 Power socket" for a spot card, empty when nothing is known. */
export function spotSummary(facts: SpotFacts, own: readonly Feature[] = []): string {
	const parts: string[] = [];
	const type = bedTypeEntry(facts.bedType);
	if (type) parts.push(type.label);
	for (const feature of readFeatures(own, 'spot')) parts.push(featureLabel(feature));
	return parts.join(' · ');
}

/** How many spots of each bed type: "4 lower bunks · 4 upper bunks". */
export function bedTypeMix(types: readonly (string | undefined)[]): string {
	const counts = new Map<BedType, number>();
	let unknown = 0;
	for (const value of types) {
		const type = bedType(value);
		if (!type) unknown += 1;
		else counts.set(type, (counts.get(type) ?? 0) + 1);
	}
	const parts = BED_TYPES.filter((type) => counts.has(type.value)).map((type) => {
		const count = counts.get(type.value) ?? 0;
		return `${count} × ${type.label.toLowerCase()}`;
	});
	if (unknown > 0 && parts.length > 0) parts.push(`${unknown} not specified`);
	return parts.join(' · ');
}
