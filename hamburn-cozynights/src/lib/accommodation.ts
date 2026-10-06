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
	| 'quiet';

/**
 * Where a feature can be set: on a house or a room. A spot has none of its
 * own — it inherits its room's and its house's and may switch some of them
 * off (`features_off`, offAllowed). The only spot feature there was, the 🔌
 * power socket, went on 2026-09-28 (RETIRED_FEATURES).
 */
export type FeatureLevel = 'house' | 'room';

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

/**
 * Keep in sync with the `features` fields in pb_migrations/1759900000_accommodation.js
 * and pb_migrations/1760200000_no_power_socket.js.
 */
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
	}
];

/**
 * Values the catalogue once had and dropped. `power` (🔌 Power socket) went
 * on 2026-09-28: the crew doesn't know where the sockets are, so the app
 * neither offers nor shows it any more, and
 * pb_migrations/1760200000_no_power_socket.js removed what was stored. An
 * older layout file may still name it: the import leaves it out with a note
 * instead of refusing the file (src/lib/template.ts). The ♿ form no longer
 * offers a socket either (since v0.30.0); old requests show it as legacy
 * (RETIRED_NEEDS in src/lib/special-needs.ts), and the crew answers it by
 * hand (MATCHED_BY_HAND).
 */
export const RETIRED_FEATURES: readonly string[] = ['power'];

/**
 * What a bed with a ladder can never be, whatever its room and house say: an
 * upper bunk is never wheelchair accessible — whoever needs the ♿ can't get
 * up the ladder. The room stays accessible; the bed is not. Applied wherever
 * a spot's features are summed up (effectiveFeatures, factsOf), so the ♿
 * picker, the map filters, the guest pages and the messages all agree; the
 * admin spot editor shows the room's ♿ struck through there (bedRulesOut).
 * An upper bunk isn't step-free either (needFit, spotMatchesFilter), though
 * it keeps ⬇️ Ground floor: that is a fact about its room.
 */
export const NOT_UP_A_LADDER: readonly Feature[] = ['wheelchair'];

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

/** The levels a room or spot inherits from: everything above it. */
const LEVELS_ABOVE: Record<'room' | 'spot', FeatureLevel[]> = {
	room: ['house'],
	spot: ['house', 'room']
};

/**
 * What a room or spot may switch OFF for itself: any feature a level above
 * it can have (`features_off`). A room in a heated house that stays cold, a
 * bed by the door of a quiet room. Only superusers set it (the actions
 * check), and "reset" simply empties the list, so the place inherits again.
 */
export function offAllowed(level: 'room' | 'spot'): FeatureEntry[] {
	const above = LEVELS_ABOVE[level];
	return FEATURES.filter((feature) => feature.levels.some((l) => above.includes(l)));
}

/** Cleans a `features_off` list: only what this level may switch off, no duplicates, catalogue order. */
export function readFeaturesOff(raw: unknown, level: 'room' | 'spot'): Feature[] {
	const values = Array.isArray(raw) ? raw : typeof raw === 'string' && raw ? [raw] : [];
	const allowed = new Set(offAllowed(level).map((feature) => feature.value));
	const chosen = new Set(
		values.filter((value): value is Feature => isFeature(value) && allowed.has(value))
	);
	return FEATURES.filter((feature) => chosen.has(feature.value)).map((feature) => feature.value);
}

/**
 * Why a place can't both switch a feature off and claim it itself: '' when
 * the lists agree. The same rule runs in pb_hooks/lib/beds.js.
 */
export function overrideProblem(own: readonly Feature[], off: readonly Feature[]): string {
	const clash = off.find((feature) => own.includes(feature));
	return clash
		? `"${featureLabel(clash)}" is switched off here and ticked here at the same time. Do one or the other.`
		: '';
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

/**
 * One line for a folded details panel (admin house and room pages): the kind,
 * the icons of the features, and whether a description is written, e.g.
 * "🛖 Hut group · ♿ 🔥 · description". Empty when nothing is set.
 */
export function detailsSummary(
	level: 'house' | 'room',
	kind: unknown,
	features: unknown,
	description: unknown
): string {
	const entry = level === 'house' ? houseKindEntry(kind) : roomKindEntry(kind);
	const icons = readFeatures(features, level).map((value) => featureEntry(value)?.icon ?? '');
	const parts = [
		entry ? `${entry.icon} ${entry.label}` : '',
		icons.join(' '),
		typeof description === 'string' && description.trim() ? 'description' : ''
	];
	return parts.filter(Boolean).join(' · ');
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
	/** Only when the caller may override (a superuser on a room): what the room switches off. */
	features_off?: Feature[];
}

/** Who may set what: `canOverride` lets the form carry `features_off`. */
export interface ParseOptions {
	canOverride?: boolean;
}

export type DetailsResult =
	{ ok: true; value: DetailsInput } | { ok: false; value: DetailsInput; error: string };

/**
 * Reads the details form of a house or room. Never throws; the messages are
 * written for the crew. The server checks the same rules the file import does.
 */
export function parseDetailsForm(
	form: FormData,
	level: 'house' | 'room',
	options: ParseOptions = {}
): DetailsResult {
	const raw = String(form.get('kind') ?? '').trim();
	const known = level === 'house' ? isHouseKind(raw) : isRoomKind(raw);
	const kind = known ? raw : '';
	const features = readFeatures(form.getAll('features'), level);
	const description = cleanDescription(form.get('description'));
	const value: DetailsInput = { kind, features, description };
	// A house has nothing above it to switch off; a room's overrides are a
	// superuser's call, so an admin's form never touches what is stored.
	if (level === 'room' && options.canOverride) {
		value.features_off = readFeaturesOff(form.getAll('features_off'), 'room');
		const problem = overrideProblem(features, value.features_off);
		if (problem) return { ok: false, value, error: problem };
	}

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

export interface SpotInput {
	bed_type: BedType | '';
	/** Only when the caller may override (a superuser): what the spot switches off. */
	features_off?: Feature[];
}

/**
 * The same for one spot: its bed type and, for a superuser, what it switches
 * off. A spot has no features of its own, so nothing can clash with that list.
 */
export function parseSpotForm(
	form: FormData,
	options: ParseOptions = {}
): { ok: true; value: SpotInput } | { ok: false; error: string } {
	const raw = String(form.get('bed_type') ?? '').trim();
	if (raw && !isBedType(raw)) {
		return { ok: false, error: 'Pick a bed from the list, or leave it open.' };
	}
	const value: SpotInput = { bed_type: raw as BedType | '' };
	if (options.canOverride) {
		value.features_off = readFeaturesOff(form.getAll('features_off'), 'spot');
	}
	return { ok: true, value };
}

export interface SpotFacts {
	bedType: BedType | '';
	/** House and room features together, minus what the spot switched off or its bed rules out. */
	features: Feature[];
}

export interface FeatureSource {
	house?: readonly string[] | string | null;
	room?: readonly string[] | string | null;
	/** What the room switched off of the house's features (`rooms.features_off`). */
	roomOff?: readonly string[] | string | null;
	/** What the spot switched off of what it would inherit (`beds.features_off`). */
	spotOff?: readonly string[] | string | null;
	/**
	 * The spot's bed type, when the sum is for one spot: a bed with a ladder
	 * loses what NOT_UP_A_LADDER lists. Leave it out for a room or a house.
	 */
	bedType?: unknown;
}

/**
 * The features a bed of this type can't have, whatever is around it: ♿ for
 * an upper bunk (NOT_UP_A_LADDER), nothing for any other bed. The admin spot
 * editor strikes these through among the inherited chips.
 */
export function bedRulesOut(type: unknown): readonly Feature[] {
	return bedTypeEntry(type)?.ladder ? NOT_UP_A_LADDER : [];
}

/** Adds one level's own features to the sum; a feature's opposite leaves. */
function addOwn(chosen: Set<Feature>, features: readonly Feature[]): void {
	for (const feature of features) {
		const opposite = featureEntry(feature)?.opposite;
		if (opposite) chosen.delete(opposite);
		chosen.add(feature);
	}
}

/**
 * What is true for one spot: the features of its room and house. Where the
 * two say the opposite ("heated" in an "unheated" hut group), the room wins;
 * what the room or the spot switched off for itself (`features_off`, a
 * superuser's call) is gone. An upper bunk is never wheelchair accessible,
 * however accessible its room is (NOT_UP_A_LADDER).
 */
export function effectiveFeatures(source: FeatureSource): Feature[] {
	const chosen = new Set<Feature>();
	addOwn(chosen, readFeatures(source.house, 'house'));
	for (const feature of readFeaturesOff(source.roomOff, 'room')) chosen.delete(feature);
	addOwn(chosen, readFeatures(source.room, 'room'));
	for (const feature of readFeaturesOff(source.spotOff, 'spot')) chosen.delete(feature);
	for (const feature of bedRulesOut(source.bedType)) chosen.delete(feature);
	return FEATURES.filter((feature) => chosen.has(feature.value)).map((feature) => feature.value);
}

/**
 * What a room or spot inherits from the levels above it, before its own
 * overrides (and, for a room, its own features): what the admin forms show
 * greyed out as "from the house" / "from the room and house", what a
 * superuser may switch off there, and what the guest room page shows as the
 * room's chips. The bed's rule (an upper bunk is never ♿) is not applied
 * here; bedRulesOut and missingAtSpot say what it takes away.
 */
export function inheritedFeatures(
	level: 'room' | 'spot',
	source: Pick<FeatureSource, 'house' | 'room' | 'roomOff'>
): Feature[] {
	return level === 'room'
		? effectiveFeatures({ house: source.house })
		: effectiveFeatures({ house: source.house, room: source.room, roomOff: source.roomOff });
}

/**
 * What the room's chips promise but this spot doesn't have: what the spot
 * switched off (`features_off`, a superuser's call) and what its bed rules
 * out (an upper bunk is never ♿). The guest room page writes these under the
 * spot as "no ♿ Wheelchair accessible", so the chips above don't promise
 * them for this bed.
 */
export function missingAtSpot(source: FeatureSource): Feature[] {
	const spot = effectiveFeatures(source);
	return inheritedFeatures('spot', source).filter((feature) => !spot.includes(feature));
}

export function spotFacts(source: FeatureSource): SpotFacts {
	return { bedType: bedType(source.bedType), features: effectiveFeatures(source) };
}

/**
 * The same from a list that is already the sum of house and room (what a page
 * or the ♿ picker was given), so no level filter narrows it again — only the
 * bed's own rule still applies (an upper bunk is never ♿).
 */
export function factsOf(type: unknown, features: readonly string[] | undefined): SpotFacts {
	const chosen = new Set((features ?? []).filter((value): value is Feature => isFeature(value)));
	for (const feature of bedRulesOut(type)) chosen.delete(feature);
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

/**
 * Needs the layout can't answer, so only the crew can match them: a power
 * socket (the app doesn't know where the sockets are, RETIRED_FEATURES; only
 * old requests still have it), "Something else", which is what the guest
 * wrote, and what a project or crew asks for (a room of their own, spots
 * close together: a question of who else sleeps where). The ♿ picker shows
 * no ✓ or ✗ for them, and the capacity line on the requests page leaves them
 * out, so project requests never count against the ♿ spots.
 */
export const MATCHED_BY_HAND: readonly SpecialNeed[] = [
	'power',
	'other',
	'own_room',
	'close_together'
];

export function needFit(need: SpecialNeed, facts: SpotFacts): NeedFit {
	switch (need) {
		case 'lower_bunk': {
			const entry = bedTypeEntry(facts.bedType);
			if (!entry) return 'unknown';
			return entry.ladder ? 'conflict' : 'fits';
		}
		case 'step_free':
			// The ladder is a step: an upper bunk is never step-free, not even
			// on the ground floor of a wheelchair-accessible house.
			if (bedTypeEntry(facts.bedType)?.ladder) return 'conflict';
			return hasFeature(facts, 'wheelchair') || hasFeature(facts, 'ground_floor')
				? 'fits'
				: 'unknown';
		case 'near_toilet':
			return hasFeature(facts, 'toilets_inside') || hasFeature(facts, 'own_bathroom')
				? 'fits'
				: 'unknown';
		case 'quiet':
			return hasFeature(facts, 'quiet') ? 'fits' : 'unknown';
		// MATCHED_BY_HAND: nothing in the layout answers these.
		case 'power':
		case 'other':
		case 'own_room':
		case 'close_together':
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
 * The needs only a human can answer (MATCHED_BY_HAND) are left out: no spot
 * could ever count as fitting them.
 */
export function needCapacity(
	open: readonly { needs: readonly SpecialNeed[] }[],
	spots: readonly { bedType: string; features: readonly string[] }[]
): NeedCapacity[] {
	const facts = spots.map((spot) => factsOf(spot.bedType, spot.features));
	return SPECIAL_NEEDS.filter((need) => !MATCHED_BY_HAND.includes(need.value))
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
export type SpotFilter = 'no_ladder' | 'step_free' | 'toilets' | 'heated' | 'quiet';

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
		hint: 'Ground floor or wheelchair accessible, and no ladder to climb.',
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
			// Never an upper bunk: the ladder is a step (needFit says the same).
			return (
				!bedTypeEntry(facts.bedType)?.ladder &&
				(hasFeature(facts, 'wheelchair') || hasFeature(facts, 'ground_floor'))
			);
		case 'toilets':
			return hasFeature(facts, 'toilets_inside') || hasFeature(facts, 'own_bathroom');
		case 'heated':
			return hasFeature(facts, 'heated');
		case 'quiet':
			return hasFeature(facts, 'quiet');
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

/**
 * "🔥 Heated · 🤫 Quiet zone": a list of features as words with their icons,
 * for the booking pass and the messages. Empty when the list is.
 */
export function featureText(features: readonly string[] | undefined): string {
	return (features ?? [])
		.map((value) => featureEntry(value))
		.filter((entry): entry is FeatureEntry => !!entry)
		.map((entry) => `${entry.icon} ${entry.label}`)
		.join(' · ');
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
