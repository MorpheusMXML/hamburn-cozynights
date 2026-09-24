// src/lib/template-diff.ts
/**
 * Comparing a layout template with the camp, and choosing which of the
 * differences to apply (docs/admin/templates.md). Pure code, shared by the
 * admin actions, the review in the Burn Template Manager and the unit tests.
 *
 * Houses are matched by name, rooms by their number within the house, spots by
 * their label within the room; upper/lower case doesn't matter. A renamed house
 * therefore shows up as one new and one missing house.
 *
 * Every difference is one selectable change with a key: a new, changed or
 * missing house, room or spot. Two rules tie them together: a new room or spot
 * needs its new house or room, and a house or room that is removed takes all
 * its rooms and spots with it (normalizeSelection).
 */
import { buildTemplate, compareNatural, type LayoutTemplate, type TemplateBed } from './template';
import {
	bedTypeLabel,
	featureLabel,
	houseKindEntry,
	roomKindEntry,
	type Feature
} from './accommodation';

/** How long a description may be in a "changed" line before it is cut off. */
const DESCRIPTION_PREVIEW = 60;

/** What happens to an item itself; null = nothing (its rooms or spots may still change). */
export type ChangeKind = 'new' | 'changed' | 'removed';

export type FieldValue = string | number | boolean | null;

/** What a record is written with; features are a list, everything else a plain value. */
export type WriteValue = FieldValue | string[];

export interface FieldChange {
	field: string;
	from: FieldValue;
	to: FieldValue;
}

interface DiffNode {
	key: string;
	own: ChangeKind | null;
	/** For `changed`: what differs (camp → file). */
	changes: FieldChange[];
	/** Taken spots in the camp (booked, or marked as taken by the crew). */
	booked: number;
	/** The camp's record; null for new items. */
	id: string | null;
}

export interface SpotDiff extends DiffNode {
	label: string;
	/** The spot in the camp and in the file. */
	before: TemplateBed | null;
	after: TemplateBed | null;
}

/** The details of a house or room as the file has them (as the camp has them when it is removed). */
export interface DetailFields {
	kind?: string;
	features?: Feature[];
	/** Rooms only: what the room does not take over from its house. A house has nothing above it. */
	features_off?: Feature[];
	description?: string;
}

export interface RoomDiff extends DiffNode, DetailFields {
	name: string;
	number: number;
	spots: SpotDiff[];
}

export interface HouseDiff extends DiffNode, DetailFields {
	name: string;
	/** Position in the file, or in the camp for a house that is not in the file. */
	x: number;
	y: number;
	rooms: RoomDiff[];
}

export interface KindCounts {
	new: number;
	changed: number;
	removed: number;
	unchanged: number;
}

export interface LayoutDiff {
	houses: HouseDiff[];
	counts: { houses: KindCounts; rooms: KindCounts; spots: KindCounts };
	/** About the camp, e.g. two houses with the same name. */
	warnings: string[];
}

/** The camp's records, as PocketBase returns them (`created` decides between duplicates). */
export interface CampRecords {
	houses: {
		id: string;
		created?: string;
		name: string;
		x?: number;
		y?: number;
		kind?: string;
		features?: string[];
		description?: string;
	}[];
	rooms: {
		id: string;
		created?: string;
		house: string;
		name: string;
		room_number?: number;
		kind?: string;
		features?: string[];
		features_off?: string[];
		description?: string;
	}[];
	beds: ({
		id: string;
		created?: string;
		room: string;
		label?: string;
		occupied?: boolean;
		order?: string;
	} & Record<string, unknown>)[];
}

const nameKey = (name: string) => encodeURIComponent(name.trim().toLowerCase());

/**
 * A camp bed as a template spot. The export (buildTemplate) owns the mapping of
 * the fields, so a new spot flag needs no change here. The other beds of the
 * room are needed for the bunk partner's label.
 */
function templateBed(
	bed: CampRecords['beds'][number],
	roomBeds: readonly CampRecords['beds'][number][] = [bed]
): TemplateBed {
	const records = {
		houses: [{ id: 'h', name: 'h' }],
		rooms: [{ id: 'r', house: 'h', name: 'r' }],
		beds: roomBeds.map((other) => ({ ...other, room: 'r' }))
	} as Parameters<typeof buildTemplate>[0];
	const spots = buildTemplate(records).houses[0].rooms[0].beds;
	const label = String(bed.label ?? '');
	return spots.find((spot) => spot.label === label) ?? spots[0];
}

/** The same for a camp house's and room's details, so junk in the camp is read like a file. */
function templateHouse(house: CampRecords['houses'][number]) {
	return buildTemplate({ houses: [house], rooms: [], beds: [] }).houses[0];
}

function templateRoom(room: CampRecords['rooms'][number]) {
	const records = {
		houses: [{ id: 'h', name: 'h' }],
		rooms: [{ ...room, house: 'h' }],
		beds: []
	} as Parameters<typeof buildTemplate>[0];
	return buildTemplate(records).houses[0].rooms[0];
}

const isBooked = (bed: { occupied?: boolean; order?: string }) => !!bed.occupied || !!bed.order;

/** "Heated · Quiet zone", or null when there is nothing to show. */
const featureList = (features: readonly Feature[] | undefined): FieldValue =>
	features && features.length > 0 ? features.map(featureLabel).join(' · ') : null;

const shorten = (text: string | undefined): FieldValue =>
	!text
		? null
		: text.length > DESCRIPTION_PREVIEW
			? `${text.slice(0, DESCRIPTION_PREVIEW - 1)}…`
			: text;

/**
 * A detail as the review shows it: the labels people read, not the stored
 * values, and one line per detail even for a list of features.
 */
function detailChanges(
	before: DetailFields,
	after: DetailFields,
	kindLabel: (value: unknown) => FieldValue
): FieldChange[] {
	const changes: FieldChange[] = [];
	if ((before.kind ?? '') !== (after.kind ?? '')) {
		changes.push({ field: 'kind', from: kindLabel(before.kind), to: kindLabel(after.kind) });
	}
	const fromFeatures = featureList(before.features);
	const toFeatures = featureList(after.features);
	if (fromFeatures !== toFeatures) {
		changes.push({ field: 'features', from: fromFeatures, to: toFeatures });
	}
	// Only rooms have it; for a house both sides are always empty.
	const fromOff = featureList(before.features_off);
	const toOff = featureList(after.features_off);
	if (fromOff !== toOff) {
		changes.push({ field: 'features_off', from: fromOff, to: toOff });
	}
	// The whole text would flood the review, so the line only says it changed.
	if ((before.description ?? '') !== (after.description ?? '')) {
		changes.push({
			field: 'description',
			from: shorten(before.description),
			to: shorten(after.description)
		});
	}
	return changes;
}

/** The details of a file (or camp) item, without the empty ones. */
const detailsOf = (item: DetailFields): DetailFields => ({
	...(item.kind ? { kind: item.kind } : {}),
	...(item.features && item.features.length > 0 ? { features: item.features } : {}),
	...(item.features_off && item.features_off.length > 0 ? { features_off: item.features_off } : {}),
	...(item.description ? { description: item.description } : {})
});

/**
 * The file decides: a detail it doesn't have is cleared in the camp. Only a
 * room gets `features_off` written (an empty list means "inherit everything");
 * the houses collection has no such field.
 */
const detailWrite = (item: DetailFields, level: 'house' | 'room'): DetailWrite => ({
	kind: item.kind ?? '',
	features: item.features ?? [],
	...(level === 'room' ? { features_off: item.features_off ?? [] } : {}),
	description: item.description ?? ''
});

/** Everything a spot of the file says, ready for the database. */
const spotWrite = (bed: TemplateBed): Record<string, WriteValue> => ({
	label: bed.label,
	enabled: bed.enabled,
	is_locked: bed.is_locked,
	is_special: bed.is_special === true,
	bed_type: bed.bed_type ?? '',
	features: bed.features ?? [],
	features_off: bed.features_off ?? []
});

const houseKindLabel = (value: unknown): FieldValue => houseKindEntry(value)?.label ?? null;
const roomKindLabel = (value: unknown): FieldValue => roomKindEntry(value)?.label ?? null;

function spotChanges(before: TemplateBed, after: TemplateBed): FieldChange[] {
	const changes: FieldChange[] = [];
	if (before.label !== after.label) {
		changes.push({ field: 'label', from: before.label, to: after.label });
	}
	const flags = ['enabled', 'is_locked', 'is_special'] as const;
	for (const field of flags) {
		// A flag one side doesn't know counts as off.
		const from = before[field] ?? false;
		const to = after[field] ?? false;
		if (from !== to) changes.push({ field, from, to });
	}
	if ((before.bed_type ?? '') !== (after.bed_type ?? '')) {
		changes.push({
			field: 'bed_type',
			from: bedTypeLabel(before.bed_type) || null,
			to: bedTypeLabel(after.bed_type) || null
		});
	}
	const fromFeatures = featureList(before.features);
	const toFeatures = featureList(after.features);
	if (fromFeatures !== toFeatures) {
		changes.push({ field: 'features', from: fromFeatures, to: toFeatures });
	}
	const fromOff = featureList(before.features_off);
	const toOff = featureList(after.features_off);
	if (fromOff !== toOff) {
		changes.push({ field: 'features_off', from: fromOff, to: toOff });
	}
	// The partner is a label; the import resolves it to the spot after every
	// spot of the room exists (src/lib/server/template.ts, syncBunks).
	const fromPartner = before.bunk_partner ?? '';
	const toPartner = after.bunk_partner ?? '';
	if (fromPartner.toLowerCase() !== toPartner.toLowerCase()) {
		changes.push({ field: 'bunk_partner', from: fromPartner || null, to: toPartner || null });
	}
	return changes;
}

const byAge = (a: { id: string; created?: string }, b: { id: string; created?: string }) => {
	const ca = a.created ?? '';
	const cb = b.created ?? '';
	if (ca !== cb) return ca < cb ? -1 : 1;
	return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
};

/**
 * Records with their keys, oldest first: of two houses with the same name the
 * older one is compared with the file, a later copy gets "#<its id>". The
 * order is stable, so the same data always gives the same keys (the import
 * compares again and must find the same items).
 */
function keyed<T extends { id: string; created?: string }>(
	items: T[],
	baseOf: (item: T) => string
) {
	const seen = new Map<string, number>();
	return [...items].sort(byAge).map((item) => {
		const base = baseOf(item);
		const n = (seen.get(base) ?? 0) + 1;
		seen.set(base, n);
		// A copy is keyed by its record id: stable even if another copy is deleted
		// between review and import. "#" never occurs in a base (nameKey encodes it).
		return { item, base, key: n === 1 ? base : `${base}#${item.id}`, duplicate: n > 1 };
	});
}

const emptyCounts = (): KindCounts => ({ new: 0, changed: 0, removed: 0, unchanged: 0 });

type CampHouse = CampRecords['houses'][number];
type CampRoom = CampRecords['rooms'][number];
type CampBed = CampRecords['beds'][number];

/** Compares the camp with a validated template. */
export function diffLayout(camp: CampRecords, template: LayoutTemplate): LayoutDiff {
	const warnings: string[] = [];
	const roomsOf = groupBy(camp.rooms, (room) => room.house);
	const bedsOf = groupBy(camp.beds, (bed) => bed.room);

	const houseBase = (name: string) => `h:${nameKey(name)}`;
	const roomBase = (houseKey: string, number: number | undefined) => `${houseKey}/r:${number ?? 0}`;
	const spotBase = (roomKey: string, label: string | undefined) =>
		`${roomKey}/s:${nameKey(String(label ?? ''))}`;

	const newSpot = (roomKey: string, bed: TemplateBed): SpotDiff => ({
		key: spotBase(roomKey, bed.label),
		own: 'new',
		changes: [],
		booked: 0,
		id: null,
		label: bed.label,
		before: null,
		after: bed
	});
	const newRoom = (houseKey: string, room: LayoutTemplate['houses'][number]['rooms'][number]) => {
		const key = roomBase(houseKey, room.room_number);
		const diff: RoomDiff = {
			key,
			own: 'new',
			changes: [],
			booked: 0,
			id: null,
			name: room.name,
			number: room.room_number,
			...detailsOf(room),
			spots: room.beds.map((bed) => newSpot(key, bed))
		};
		return diff;
	};
	const removedSpot = (key: string, bed: CampBed): SpotDiff => {
		const before = templateBed(bed, bedsOf.get(bed.room) ?? [bed]);
		return {
			key,
			own: 'removed',
			changes: [],
			booked: isBooked(bed) ? 1 : 0,
			id: bed.id,
			label: before.label,
			before,
			after: null
		};
	};
	const removedRoom = (key: string, room: CampRoom): RoomDiff => {
		const spots = keyed(bedsOf.get(room.id) ?? [], (bed) => spotBase(key, bed.label)).map(
			({ item, key: spotKey }) => removedSpot(spotKey, item)
		);
		return {
			key,
			own: 'removed',
			changes: [],
			booked: spots.reduce((sum, spot) => sum + spot.booked, 0),
			id: room.id,
			name: room.name,
			number: room.room_number ?? 0,
			...detailsOf(templateRoom(room)),
			spots: sortSpots(spots)
		};
	};
	const removedHouse = (key: string, house: CampHouse): HouseDiff => {
		const rooms = keyed(roomsOf.get(house.id) ?? [], (room) => roomBase(key, room.room_number)).map(
			({ item, key: roomKey }) => removedRoom(roomKey, item)
		);
		return {
			key,
			own: 'removed',
			changes: [],
			booked: rooms.reduce((sum, room) => sum + room.booked, 0),
			id: house.id,
			name: house.name,
			x: Math.round(house.x ?? 0),
			y: Math.round(house.y ?? 0),
			...detailsOf(templateHouse(house)),
			rooms: sortRooms(rooms)
		};
	};

	const houses: HouseDiff[] = [];
	const campHouses = new Map<string, CampHouse>();
	for (const { item, base, key, duplicate } of keyed(camp.houses, (h) => houseBase(h.name))) {
		if (!duplicate) {
			campHouses.set(base, item);
			continue;
		}
		warnings.push(
			`Your camp has more than one house called "${item.name}". Only one of them is compared with the file; the others are listed as not in the file.`
		);
		houses.push(removedHouse(key, item));
	}

	const matchedHouses = new Set<string>();
	for (const fileHouse of template.houses) {
		const key = houseBase(fileHouse.name);
		const campHouse = campHouses.get(key);
		if (!campHouse) {
			houses.push({
				key,
				own: 'new',
				changes: [],
				booked: 0,
				id: null,
				name: fileHouse.name,
				x: fileHouse.x,
				y: fileHouse.y,
				...detailsOf(fileHouse),
				rooms: fileHouse.rooms.map((room) => newRoom(key, room))
			});
			continue;
		}
		matchedHouses.add(campHouse.id);

		const changes: FieldChange[] = [];
		if (campHouse.name !== fileHouse.name) {
			changes.push({ field: 'name', from: campHouse.name, to: fileHouse.name });
		}
		const campX = Math.round(campHouse.x ?? 0);
		const campY = Math.round(campHouse.y ?? 0);
		if (campX !== fileHouse.x || campY !== fileHouse.y) {
			changes.push({
				field: 'position',
				from: `${campX} / ${campY}`,
				to: `${fileHouse.x} / ${fileHouse.y}`
			});
		}
		changes.push(...detailChanges(templateHouse(campHouse), fileHouse, houseKindLabel));

		const rooms: RoomDiff[] = [];
		const campRooms = new Map<string, CampRoom>();
		for (const entry of keyed(roomsOf.get(campHouse.id) ?? [], (room) =>
			roomBase(key, room.room_number)
		)) {
			if (!entry.duplicate) {
				campRooms.set(entry.base, entry.item);
				continue;
			}
			warnings.push(
				`"${campHouse.name}" has more than one room with number ${entry.item.room_number ?? 0}. Only one of them is compared with the file.`
			);
			rooms.push(removedRoom(entry.key, entry.item));
		}

		const matchedRooms = new Set<string>();
		for (const fileRoom of fileHouse.rooms) {
			const roomKey = roomBase(key, fileRoom.room_number);
			const campRoom = campRooms.get(roomKey);
			if (!campRoom) {
				rooms.push(newRoom(key, fileRoom));
				continue;
			}
			matchedRooms.add(campRoom.id);

			const spots: SpotDiff[] = [];
			const campBeds = new Map<string, CampBed>();
			for (const entry of keyed(bedsOf.get(campRoom.id) ?? [], (bed) =>
				spotBase(roomKey, bed.label)
			)) {
				if (!entry.duplicate) {
					campBeds.set(entry.base, entry.item);
					continue;
				}
				warnings.push(
					`Room "${campRoom.name}" of "${campHouse.name}" has more than one spot called "${entry.item.label}". Only one of them is compared with the file.`
				);
				spots.push(removedSpot(entry.key, entry.item));
			}

			const matchedBeds = new Set<string>();
			for (const fileBed of fileRoom.beds) {
				const spotKey = spotBase(roomKey, fileBed.label);
				const campBed = campBeds.get(spotKey);
				if (!campBed) {
					spots.push(newSpot(roomKey, fileBed));
					continue;
				}
				matchedBeds.add(campBed.id);
				const before = templateBed(campBed, bedsOf.get(campRoom.id) ?? [campBed]);
				const changes = spotChanges(before, fileBed);
				spots.push({
					key: spotKey,
					own: changes.length > 0 ? 'changed' : null,
					changes,
					booked: isBooked(campBed) ? 1 : 0,
					id: campBed.id,
					label: fileBed.label,
					before,
					after: fileBed
				});
			}
			for (const [spotKey, bed] of campBeds) {
				if (!matchedBeds.has(bed.id)) spots.push(removedSpot(spotKey, bed));
			}

			const roomChanges: FieldChange[] =
				campRoom.name !== fileRoom.name
					? [{ field: 'name', from: campRoom.name, to: fileRoom.name }]
					: [];
			roomChanges.push(...detailChanges(templateRoom(campRoom), fileRoom, roomKindLabel));
			rooms.push({
				key: roomKey,
				own: roomChanges.length > 0 ? 'changed' : null,
				changes: roomChanges,
				booked: spots.reduce((sum, spot) => sum + spot.booked, 0),
				id: campRoom.id,
				name: fileRoom.name,
				number: fileRoom.room_number,
				...detailsOf(fileRoom),
				spots: sortSpots(spots)
			});
		}
		for (const [roomKey, room] of campRooms) {
			if (!matchedRooms.has(room.id)) rooms.push(removedRoom(roomKey, room));
		}

		houses.push({
			key,
			own: changes.length > 0 ? 'changed' : null,
			changes,
			booked: rooms.reduce((sum, room) => sum + room.booked, 0),
			id: campHouse.id,
			name: fileHouse.name,
			x: fileHouse.x,
			y: fileHouse.y,
			...detailsOf(fileHouse),
			rooms: sortRooms(rooms)
		});
	}

	for (const [key, campHouse] of campHouses) {
		if (!matchedHouses.has(campHouse.id)) houses.push(removedHouse(key, campHouse));
	}

	houses.sort((a, b) => compareNatural(a.name, b.name) || compareNatural(a.key, b.key));
	return { houses, counts: countChanges(houses), warnings };
}

function groupBy<T>(items: T[], keyOf: (item: T) => string): Map<string, T[]> {
	const groups = new Map<string, T[]>();
	for (const item of items) {
		const list = groups.get(keyOf(item));
		if (list) list.push(item);
		else groups.set(keyOf(item), [item]);
	}
	return groups;
}

function sortRooms(rooms: RoomDiff[]): RoomDiff[] {
	return rooms.sort(
		(a, b) => a.number - b.number || compareNatural(a.name, b.name) || compareNatural(a.key, b.key)
	);
}

function sortSpots(spots: SpotDiff[]): SpotDiff[] {
	return spots.sort((a, b) => compareNatural(a.label, b.label) || compareNatural(a.key, b.key));
}

function countChanges(houses: HouseDiff[]): LayoutDiff['counts'] {
	const counts = { houses: emptyCounts(), rooms: emptyCounts(), spots: emptyCounts() };
	const add = (target: KindCounts, own: ChangeKind | null) => {
		target[own ?? 'unchanged']++;
	};
	for (const house of houses) {
		add(counts.houses, house.own);
		for (const room of house.rooms) {
			add(counts.rooms, room.own);
			for (const spot of room.spots) add(counts.spots, spot.own);
		}
	}
	return counts;
}

// --- choosing what to apply ----------------------------------------------------

export type AnyNode = HouseDiff | RoomDiff | SpotDiff;

interface Located {
	node: AnyNode;
	level: 'house' | 'room' | 'spot';
	/** Keys of the house (and room) above, outermost first. */
	ancestors: AnyNode[];
}

function walk(diff: LayoutDiff): Located[] {
	const list: Located[] = [];
	for (const house of diff.houses) {
		list.push({ node: house, level: 'house', ancestors: [] });
		for (const room of house.rooms) {
			list.push({ node: room, level: 'room', ancestors: [house] });
			for (const spot of room.spots) {
				list.push({ node: spot, level: 'spot', ancestors: [house, room] });
			}
		}
	}
	return list;
}

function children(node: AnyNode): AnyNode[] {
	if ('rooms' in node) return node.rooms.flatMap((room) => [room, ...room.spots]);
	if ('spots' in node) return node.spots;
	return [];
}

/** Keys of everything that can be applied. */
export function changeKeys(diff: LayoutDiff): string[] {
	return walk(diff)
		.filter(({ node }) => node.own !== null)
		.map(({ node }) => node.key);
}

/** What the review starts with: everything new and changed; nothing is removed unasked. */
export function defaultSelection(diff: LayoutDiff): Set<string> {
	return new Set(
		walk(diff)
			.filter(({ node }) => node.own === 'new' || node.own === 'changed')
			.map(({ node }) => node.key)
	);
}

/**
 * Makes a selection consistent: a chosen new room or spot brings its new house
 * or room along, a removed house or room takes everything inside with it, and
 * unknown keys are dropped.
 */
export function normalizeSelection(diff: LayoutDiff, keys: Iterable<string>): Set<string> {
	const wanted = new Set(keys);
	const result = new Set<string>();
	for (const { node, ancestors } of walk(diff)) {
		if (node.own === null || !wanted.has(node.key)) continue;
		result.add(node.key);
		for (const ancestor of ancestors) if (ancestor.own === 'new') result.add(ancestor.key);
		if (node.own === 'removed') {
			for (const child of children(node)) if (child.own) result.add(child.key);
		}
	}
	return result;
}

/** How much of an item (itself and everything inside) is selected. */
export function selectionState(
	node: AnyNode,
	selection: Set<string>
): 'all' | 'some' | 'none' | 'nothing' {
	const keys = [node, ...children(node)].filter((n) => n.own !== null).map((n) => n.key);
	if (keys.length === 0) return 'nothing';
	const chosen = keys.filter((key) => selection.has(key)).length;
	if (chosen === 0) return 'none';
	return chosen === keys.length ? 'all' : 'some';
}

/** The checkbox of an item: all of it on, or all of it off. */
export function toggleSelection(
	diff: LayoutDiff,
	selection: Set<string>,
	key: string
): Set<string> {
	const located = walk(diff).find(({ node }) => node.key === key);
	if (!located) return selection;
	const { node, ancestors } = located;
	const keys = [node, ...children(node)].filter((n) => n.own !== null).map((n) => n.key);
	const next = new Set(selection);
	if (selectionState(node, selection) === 'all') {
		for (const k of keys) next.delete(k);
		// Keeping a room means its house can't go either.
		for (const ancestor of ancestors) if (ancestor.own === 'removed') next.delete(ancestor.key);
		return next;
	}
	for (const k of keys) next.add(k);
	return normalizeSelection(diff, next);
}

// --- what the database has to do -----------------------------------------------

/** What the import writes for a house or room besides its name and place. */
export interface DetailWrite {
	kind: string;
	features: string[];
	/** Rooms only: what the room switches off, [] when the file says nothing. */
	features_off?: string[];
	description: string;
}

export interface LayoutPlan {
	createHouses: { key: string; name: string; x: number; y: number; details: DetailWrite }[];
	createRooms: {
		key: string;
		houseKey: string;
		/** The camp's house; null when it is created in the same import. */
		houseId: string | null;
		houseName: string;
		name: string;
		room_number: number;
		details: DetailWrite;
		/** Spots that are created with it (rooms.amount_beds). */
		spots: number;
	}[];
	createSpots: {
		key: string;
		roomKey: string;
		/** The camp's room; null when it is created in the same import. */
		roomId: string | null;
		roomName: string;
		houseName: string;
		bed: TemplateBed;
	}[];
	updateHouses: {
		key: string;
		id: string;
		name: string;
		x: number;
		y: number;
		details: DetailWrite;
	}[];
	updateRooms: { key: string; id: string; name: string; details: DetailWrite }[];
	updateSpots: { key: string; id: string; label: string; fields: Record<string, WriteValue> }[];
	/** Innermost first when applied: spots, then rooms, then houses. */
	removeSpots: { key: string; id: string; label: string; booked: boolean }[];
	removeRooms: { key: string; id: string; name: string }[];
	removeHouses: { key: string; id: string; name: string }[];
}

/** The steps for a selection (normalized first). */
export function planChanges(diff: LayoutDiff, selection: Set<string>): LayoutPlan {
	const plan: LayoutPlan = {
		createHouses: [],
		createRooms: [],
		createSpots: [],
		updateHouses: [],
		updateRooms: [],
		updateSpots: [],
		removeSpots: [],
		removeRooms: [],
		removeHouses: []
	};
	const chosen = normalizeSelection(diff, selection);
	for (const house of diff.houses) {
		if (chosen.has(house.key)) {
			if (house.own === 'new') {
				plan.createHouses.push({
					key: house.key,
					name: house.name,
					x: house.x,
					y: house.y,
					details: detailWrite(house, 'house')
				});
			} else if (house.own === 'changed' && house.id) {
				plan.updateHouses.push({
					key: house.key,
					id: house.id,
					name: house.name,
					x: house.x,
					y: house.y,
					details: detailWrite(house, 'house')
				});
			} else if (house.own === 'removed' && house.id) {
				plan.removeHouses.push({ key: house.key, id: house.id, name: house.name });
			}
		}
		for (const room of house.rooms) {
			if (chosen.has(room.key)) {
				if (room.own === 'new') {
					plan.createRooms.push({
						key: room.key,
						houseKey: house.key,
						houseId: house.id,
						houseName: house.name,
						name: room.name,
						room_number: room.number,
						details: detailWrite(room, 'room'),
						spots: room.spots.filter((spot) => chosen.has(spot.key)).length
					});
				} else if (room.own === 'changed' && room.id) {
					plan.updateRooms.push({
						key: room.key,
						id: room.id,
						name: room.name,
						details: detailWrite(room, 'room')
					});
				} else if (room.own === 'removed' && room.id) {
					plan.removeRooms.push({ key: room.key, id: room.id, name: room.name });
				}
			}
			for (const spot of room.spots) {
				if (!chosen.has(spot.key)) continue;
				if (spot.own === 'new' && spot.after) {
					plan.createSpots.push({
						key: spot.key,
						roomKey: room.key,
						roomId: room.id,
						roomName: room.name,
						houseName: house.name,
						bed: spot.after
					});
				} else if (spot.own === 'changed' && spot.id && spot.after) {
					// The file decides, so everything it says is written: the change lines
					// carry the labels people read, not the values the database wants.
					plan.updateSpots.push({
						key: spot.key,
						id: spot.id,
						label: spot.label,
						fields: spotWrite(spot.after)
					});
				} else if (spot.own === 'removed' && spot.id) {
					plan.removeSpots.push({
						key: spot.key,
						id: spot.id,
						label: spot.label,
						booked: spot.booked > 0
					});
				}
			}
		}
	}
	return plan;
}

export function planSize(plan: LayoutPlan): number {
	return Object.values(plan).reduce((sum, steps) => sum + steps.length, 0);
}

/** One line per level for the review and the confirmation, e.g. "+2 houses · 1 moved". */
export function describePlan(plan: LayoutPlan): string[] {
	const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;
	const lines: string[] = [];
	const part = (label: string, create: number, update: number, remove: number, verb: string) => {
		const bits = [
			create ? `${create} new` : '',
			update ? `${update} ${verb}` : '',
			remove ? `${remove} removed` : ''
		].filter(Boolean);
		if (bits.length) lines.push(`${plural(create + update + remove, label)}: ${bits.join(', ')}`);
	};
	part(
		'house',
		plan.createHouses.length,
		plan.updateHouses.length,
		plan.removeHouses.length,
		'moved or renamed'
	);
	part(
		'room',
		plan.createRooms.length,
		plan.updateRooms.length,
		plan.removeRooms.length,
		'renamed'
	);
	part(
		'spot',
		plan.createSpots.length,
		plan.updateSpots.length,
		plan.removeSpots.length,
		'changed'
	);
	return lines;
}

interface LevelCounts {
	houses: number;
	rooms: number;
	spots: number;
}

/** What applying a template did (src/lib/server/template.ts). */
export interface ApplyOutcome {
	/** File name of the backup made first; null when it was skipped or nothing had to change. */
	backup: string | null;
	created: LevelCounts;
	updated: LevelCounts;
	removed: LevelCounts;
	/** Bookings that went with removed spots. */
	releasedBookings: number;
	/** Chosen changes that were no longer needed (the camp changed meanwhile). */
	skipped: number;
	/** Changes and removals the database refused. Everything else was applied. */
	problems: string[];
	/** The burner names of released bookings were forgotten. */
	namesCleared: boolean;
}
