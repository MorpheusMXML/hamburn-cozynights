// src/lib/template.ts
/**
 * Layout templates: the camp's structure (houses with map positions, rooms,
 * spots) as a JSON file. Pure code without server imports, shared by the
 * import actions, the export endpoint, the admin UI and the unit tests.
 */
import { MAP_WIDTH, MAP_HEIGHT, MAP_IMAGE, MIN_HOUSE_DISTANCE } from './map-geometry';

export const TEMPLATE_FORMAT = 'cozynights-layout';
export const TEMPLATE_VERSION = '2.0';

export const TEMPLATE_LIMITS = {
	fileBytes: 1024 * 1024,
	houses: 200,
	roomsPerHouse: 50,
	bedsPerRoom: 50,
	houseNameLength: 100,
	roomNameLength: 100,
	bedLabelLength: 50,
	roomNumber: 9999
} as const;

/** Long lists of problems are cut off here; nobody reads the 51st line. */
const MAX_REPORTED_PROBLEMS = 50;

export interface TemplateBed {
	label: string;
	enabled: boolean;
	is_locked: boolean;
}

export interface TemplateRoom {
	name: string;
	room_number: number;
	beds: TemplateBed[];
}

export interface TemplateHouse {
	name: string;
	x: number;
	y: number;
	rooms: TemplateRoom[];
}

export interface LayoutTemplate {
	format: typeof TEMPLATE_FORMAT;
	version: typeof TEMPLATE_VERSION;
	name: string;
	exported_at: string;
	map: { image: string; width: number; height: number };
	houses: TemplateHouse[];
}

export interface TemplateSummary {
	houses: number;
	rooms: number;
	beds: number;
	/** Bookable: active and not locked. */
	activeBeds: number;
	/** Active but reserved by the crew. */
	lockedBeds: number;
	deactivatedBeds: number;
}

export type TemplateParseResult =
	| { ok: true; template: LayoutTemplate; summary: TemplateSummary; warnings: string[] }
	| { ok: false; errors: string[] };

/** "B2" before "B10": compares digit runs as numbers. */
export function compareNatural(a: string, b: string): number {
	return a.localeCompare(b, 'en', { numeric: true });
}

export function summarizeTemplate(houses: TemplateHouse[]): TemplateSummary {
	const rooms = houses.flatMap((house) => house.rooms);
	const beds = rooms.flatMap((room) => room.beds);
	const deactivatedBeds = beds.filter((bed) => !bed.enabled).length;
	const lockedBeds = beds.filter((bed) => bed.enabled && bed.is_locked).length;
	return {
		houses: houses.length,
		rooms: rooms.length,
		beds: beds.length,
		activeBeds: beds.length - deactivatedBeds - lockedBeds,
		lockedBeds,
		deactivatedBeds
	};
}

/** The records an export is built from (what PocketBase returns, ids included). */
export interface LayoutRecords {
	houses: { id: string; name: string; x?: number; y?: number }[];
	rooms: { id: string; house: string; name: string; room_number?: number }[];
	beds: { room: string; label?: string; enabled?: boolean; is_locked?: boolean }[];
}

/** Builds a version 2.0 template from flat record lists, in a stable order. */
export function buildTemplate(records: LayoutRecords, exportedAt = new Date()): LayoutTemplate {
	const roomsByHouse = groupBy(records.rooms, (room) => room.house);
	const bedsByRoom = groupBy(records.beds, (bed) => bed.room);

	const houses = [...records.houses]
		.sort((a, b) => compareNatural(a.name, b.name))
		.map((house) => ({
			name: house.name,
			x: house.x ?? 0,
			y: house.y ?? 0,
			rooms: (roomsByHouse.get(house.id) ?? [])
				.sort(
					(a, b) => (a.room_number ?? 0) - (b.room_number ?? 0) || compareNatural(a.name, b.name)
				)
				.map((room) => ({
					name: room.name,
					room_number: room.room_number ?? 0,
					beds: (bedsByRoom.get(room.id) ?? [])
						.map((bed) => ({
							label: bed.label ?? '',
							enabled: bed.enabled !== false,
							is_locked: bed.is_locked === true
						}))
						.sort((a, b) => compareNatural(a.label, b.label))
				}))
		}));

	return {
		format: TEMPLATE_FORMAT,
		version: TEMPLATE_VERSION,
		name: 'CozyNights camp layout',
		exported_at: exportedAt.toISOString(),
		map: { image: MAP_IMAGE, width: MAP_WIDTH, height: MAP_HEIGHT },
		houses
	};
}

/** The file's text: indented JSON with one line per spot, so it stays editable by hand. */
export function stringifyTemplate(template: LayoutTemplate): string {
	const mark = `@@spot-${Math.random().toString(36).slice(2)}-`;
	const spotLines: string[] = [];
	const text = JSON.stringify(
		template,
		(key, value) =>
			key === 'beds' && Array.isArray(value)
				? (value as TemplateBed[]).map((bed) => {
						spotLines.push(
							`{ "label": ${JSON.stringify(bed.label)}, "enabled": ${bed.enabled}, "is_locked": ${bed.is_locked} }`
						);
						return `${mark}${spotLines.length - 1}`;
					})
				: value,
		'\t'
	);
	return text.replace(new RegExp(`"${mark}(\\d+)"`, 'g'), (_, index) => spotLines[+index]);
}

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
	const groups = new Map<string, T[]>();
	for (const item of items) {
		const group = groups.get(key(item));
		if (group) group.push(item);
		else groups.set(key(item), [item]);
	}
	return groups;
}

/** Reads and validates the text of a template file. Never throws. */
export function parseTemplate(text: string): TemplateParseResult {
	// Windows editors like to put a byte order mark in front, which JSON.parse rejects.
	const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
	if (source.trim() === '') return { ok: false, errors: ['The file is empty.'] };

	let data: unknown;
	try {
		data = JSON.parse(source);
	} catch (err) {
		// The parser quotes the file, which may be binary: keep the detail short and printable.
		const detail = (err instanceof Error ? err.message : String(err))
			.replace(/[^\x20-\x7e]+/g, ' ')
			.slice(0, 120);
		return {
			ok: false,
			errors: [
				`The file is not valid JSON, so it can't be read (${detail}). Export a fresh template, or fix the file in an editor that checks JSON.`
			]
		};
	}
	return validateTemplate(data);
}

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

const isMissing = (value: unknown) => value === undefined || value === null;

function show(value: unknown): string {
	if (value === undefined) return 'nothing';
	const json = JSON.stringify(value) ?? String(value);
	return json.length > 40 ? `${json.slice(0, 37)}…` : json;
}

function kindOf(value: unknown): string {
	if (value === null) return 'null';
	if (Array.isArray(value)) return 'a list';
	if (typeof value === 'string') return 'a text';
	if (typeof value === 'object') return 'an object';
	return `a ${typeof value}`;
}

function titled(path: string, name: unknown): string {
	if (typeof name !== 'string' || name.trim() === '') return path;
	const clean = name.trim();
	return `${path} "${clean.length > 40 ? `${clean.slice(0, 37)}…` : clean}"`;
}

function capped(problems: string[]): string[] {
	if (problems.length <= MAX_REPORTED_PROBLEMS) return problems;
	const hidden = problems.length - MAX_REPORTED_PROBLEMS;
	return [...problems.slice(0, MAX_REPORTED_PROBLEMS), `… and ${hidden} more of the same kind.`];
}

/** Validates already parsed JSON and normalises it to a version 2.0 template. */
export function validateTemplate(data: unknown): TemplateParseResult {
	const errors: string[] = [];
	const warnings: string[] = [];

	if (!isObject(data)) {
		return {
			ok: false,
			errors: [
				`The file must contain one JSON object with a "houses" list, but it contains ${kindOf(data)}.`
			]
		};
	}

	if (!isMissing(data.format) && data.format !== TEMPLATE_FORMAT) {
		errors.push(
			`format: must be "${TEMPLATE_FORMAT}" (got ${show(data.format)}). This does not look like a CozyNights layout file.`
		);
	}

	const version = typeof data.version === 'number' ? data.version.toFixed(1) : data.version;
	if (isMissing(version)) {
		errors.push(`version: is missing. Add "version": "${TEMPLATE_VERSION}" to the file.`);
	} else if (version !== '1.0' && version !== TEMPLATE_VERSION) {
		errors.push(
			`version: must be "${TEMPLATE_VERSION}" (or "1.0" for older exports), got ${show(data.version)}. A file from a newer app version can't be imported here.`
		);
	} else if (version === TEMPLATE_VERSION && isMissing(data.format)) {
		errors.push(
			`format: is missing. A version ${TEMPLATE_VERSION} file needs "format": "${TEMPLATE_FORMAT}".`
		);
	}

	if (isObject(data.map)) {
		const { width, height, image } = data.map;
		const otherSize =
			(!isMissing(width) && width !== MAP_WIDTH) || (!isMissing(height) && height !== MAP_HEIGHT);
		if (otherSize) {
			warnings.push(
				`map: this layout was made for a ${show(width)} × ${show(height)} map, this camp's map is ${MAP_WIDTH} × ${MAP_HEIGHT}. House pins may end up in the wrong place.`
			);
		} else if (!isMissing(image) && image !== MAP_IMAGE) {
			warnings.push(
				`map: this layout was made for the map image ${show(image)}, this camp uses "${MAP_IMAGE}". Check the house pins after importing.`
			);
		}
	}

	const houses: TemplateHouse[] = [];
	if (!Array.isArray(data.houses)) {
		errors.push(
			isMissing(data.houses)
				? 'houses: is missing. A template needs a "houses" list with at least one house.'
				: `houses: must be a list of houses (got ${show(data.houses)}).`
		);
	} else if (data.houses.length === 0) {
		errors.push(
			'houses: the list is empty. A template needs at least one house. To remove houses from the camp, delete them in the editor.'
		);
	} else if (data.houses.length > TEMPLATE_LIMITS.houses) {
		errors.push(
			`houses: ${data.houses.length} houses are too many, the limit is ${TEMPLATE_LIMITS.houses}.`
		);
	} else {
		const firstUse = new Map<string, string>();
		data.houses.forEach((entry, index) => {
			const house = readHouse(entry, `houses[${index}]`, errors, warnings);
			if (!house) return;
			const key = house.name.toLowerCase();
			const where = titled(`houses[${index}]`, house.name);
			if (key && firstUse.has(key)) {
				errors.push(
					`${where}: the name is already used by ${firstUse.get(key)}. Every house needs its own name.`
				);
			} else if (key) {
				firstUse.set(key, where);
			}
			houses.push(house);
		});
		if (errors.length === 0) warnAboutCloseHouses(houses, warnings);
	}

	if (errors.length > 0) return { ok: false, errors: capped(errors) };

	const summary = summarizeTemplate(houses);
	if (summary.beds > 0 && summary.activeBeds === 0) {
		warnings.push(
			'No spot in this template is bookable: all of them are deactivated or locked. Guests will not be able to book until you activate spots in the editor.'
		);
	}

	const template: LayoutTemplate = {
		format: TEMPLATE_FORMAT,
		version: TEMPLATE_VERSION,
		name: typeof data.name === 'string' && data.name.trim() ? data.name.trim() : 'Unnamed layout',
		exported_at: typeof data.exported_at === 'string' ? data.exported_at : '',
		map: { image: MAP_IMAGE, width: MAP_WIDTH, height: MAP_HEIGHT },
		houses
	};
	return { ok: true, template, summary, warnings: capped(warnings) };
}

function readText(
	value: unknown,
	where: string,
	field: string,
	maxLength: number,
	errors: string[]
): string {
	if (isMissing(value)) {
		errors.push(`${where}: ${field} is missing.`);
		return '';
	}
	if (typeof value !== 'string') {
		errors.push(`${where}: ${field} must be text in quotes (got ${show(value)}).`);
		return '';
	}
	const text = value.trim();
	if (text === '') errors.push(`${where}: ${field} must not be empty.`);
	if (text.length > maxLength) {
		errors.push(
			`${where}: ${field} is too long (${text.length} characters, the limit is ${maxLength}).`
		);
	}
	return text;
}

function readCoordinate(
	value: unknown,
	where: string,
	field: 'x' | 'y',
	max: number,
	errors: string[]
): number {
	if (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= max) {
		// Whole map units, like positions saved by dragging a pin.
		return Math.round(value);
	}
	const hint =
		typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))
			? ' Write the number without quotes.'
			: '';
	errors.push(
		`${where}: ${field} must be a number between 0 and ${max} (got ${show(value)}).${hint}`
	);
	return 0;
}

function readFlag(
	value: unknown,
	where: string,
	field: string,
	fallback: boolean,
	errors: string[]
): boolean {
	if (isMissing(value)) return fallback;
	if (typeof value === 'boolean') return value;
	errors.push(`${where}: ${field} must be true or false, without quotes (got ${show(value)}).`);
	return fallback;
}

function readHouse(
	entry: unknown,
	path: string,
	errors: string[],
	warnings: string[]
): TemplateHouse | null {
	if (!isObject(entry)) {
		errors.push(
			`${path}: must be an object with "name", "x", "y" and "rooms" (got ${show(entry)}).`
		);
		return null;
	}
	const where = titled(path, entry.name);
	const house: TemplateHouse = {
		name: readText(entry.name, where, 'name', TEMPLATE_LIMITS.houseNameLength, errors),
		x: readCoordinate(entry.x, where, 'x', MAP_WIDTH, errors),
		y: readCoordinate(entry.y, where, 'y', MAP_HEIGHT, errors),
		rooms: []
	};

	if (isMissing(entry.rooms) || (Array.isArray(entry.rooms) && entry.rooms.length === 0)) {
		warnings.push(`${where}: has no rooms, so there is nothing to book in this house.`);
		return house;
	}
	if (!Array.isArray(entry.rooms)) {
		errors.push(`${where}: rooms must be a list (got ${show(entry.rooms)}).`);
		return house;
	}
	if (entry.rooms.length > TEMPLATE_LIMITS.roomsPerHouse) {
		errors.push(
			`${where}: ${entry.rooms.length} rooms are too many, the limit is ${TEMPLATE_LIMITS.roomsPerHouse} per house.`
		);
		return house;
	}

	const numberUsedBy = new Map<number, string>();
	const unnumbered: TemplateRoom[] = [];
	entry.rooms.forEach((roomEntry, index) => {
		const roomPath = `${where} > rooms[${index}]`;
		if (!isObject(roomEntry)) {
			errors.push(
				`${roomPath}: must be an object with "name", "room_number" and "beds" (got ${show(roomEntry)}).`
			);
			return;
		}
		const roomWhere = titled(roomPath, roomEntry.name);
		const room: TemplateRoom = {
			name: readText(roomEntry.name, roomWhere, 'name', TEMPLATE_LIMITS.roomNameLength, errors),
			room_number: 0,
			beds: []
		};

		const number = roomEntry.room_number;
		if (isMissing(number)) {
			unnumbered.push(room);
		} else if (
			typeof number !== 'number' ||
			!Number.isInteger(number) ||
			number < 1 ||
			number > TEMPLATE_LIMITS.roomNumber
		) {
			errors.push(
				`${roomWhere}: room_number must be a whole number from 1 to ${TEMPLATE_LIMITS.roomNumber}, without quotes (got ${show(number)}).`
			);
		} else if (numberUsedBy.has(number)) {
			errors.push(
				`${roomWhere}: room_number ${number} is already used by ${numberUsedBy.get(number)}. Every room of a house needs its own number.`
			);
		} else {
			numberUsedBy.set(number, titled(`rooms[${index}]`, roomEntry.name));
			room.room_number = number;
		}
		room.beds = readBeds(roomEntry, roomWhere, errors, warnings);
		house.rooms.push(room);
	});

	if (unnumbered.length > 0) {
		let next = 1;
		for (const room of unnumbered) {
			while (numberUsedBy.has(next)) next++;
			numberUsedBy.set(next, room.name);
			room.room_number = next;
		}
		warnings.push(
			`${where}: ${unnumbered.length} of ${house.rooms.length} rooms have no room_number. They get the next free numbers in file order.`
		);
	}
	return house;
}

function readBeds(room: Json, where: string, errors: string[], warnings: string[]): TemplateBed[] {
	const max = TEMPLATE_LIMITS.bedsPerRoom;

	if (isMissing(room.beds)) {
		// Version 1.0 rooms could carry only a count. Later files list their spots.
		const amount = room.amount_beds;
		if (isMissing(amount) || amount === 0) {
			warnings.push(`${where}: has no spots.`);
			return [];
		}
		if (typeof amount !== 'number' || !Number.isInteger(amount) || amount < 0 || amount > max) {
			errors.push(
				`${where}: amount_beds must be a whole number from 0 to ${max} (got ${show(amount)}). Better: list the spots under "beds".`
			);
			return [];
		}
		warnings.push(
			`${where}: has no "beds" list. ${amount} active spots labelled B1 to B${amount} are created from amount_beds.`
		);
		return Array.from({ length: amount }, (_, i) => ({
			label: `B${i + 1}`,
			enabled: true,
			is_locked: false
		}));
	}

	if (!Array.isArray(room.beds)) {
		errors.push(`${where}: beds must be a list (got ${show(room.beds)}).`);
		return [];
	}
	if (room.beds.length === 0) {
		warnings.push(`${where}: has no spots.`);
		return [];
	}
	if (room.beds.length > max) {
		errors.push(`${where}: ${room.beds.length} spots are too many, the limit is ${max} per room.`);
		return [];
	}

	const beds: TemplateBed[] = [];
	const firstUse = new Map<string, string>();
	room.beds.forEach((entry, index) => {
		const path = `${where} > beds[${index}]`;
		if (!isObject(entry)) {
			errors.push(
				`${path}: must be an object like { "label": "B1", "enabled": true, "is_locked": false } (got ${show(entry)}).`
			);
			return;
		}
		const bedWhere = titled(path, entry.label);
		const bed: TemplateBed = {
			label: readText(entry.label, bedWhere, 'label', TEMPLATE_LIMITS.bedLabelLength, errors),
			enabled: readFlag(entry.enabled, bedWhere, 'enabled', true, errors),
			is_locked: readFlag(entry.is_locked, bedWhere, 'is_locked', false, errors)
		};
		const key = bed.label.toLowerCase();
		if (key && firstUse.has(key)) {
			errors.push(
				`${bedWhere}: the label is already used by ${firstUse.get(key)} in the same room. Every spot of a room needs its own label.`
			);
		} else if (key) {
			firstUse.set(key, titled(`beds[${index}]`, entry.label));
		}
		beds.push(bed);
	});
	return beds;
}

function warnAboutCloseHouses(houses: TemplateHouse[], warnings: string[]) {
	for (let later = 1; later < houses.length; later++) {
		for (let earlier = 0; earlier < later; earlier++) {
			const a = houses[earlier];
			const b = houses[later];
			const distance = Math.hypot(a.x - b.x, a.y - b.y);
			if (distance < MIN_HOUSE_DISTANCE) {
				warnings.push(
					`${titled(`houses[${later}]`, b.name)}: is only ${Math.round(distance)} map units away from ${titled(`houses[${earlier}]`, a.name)}. Their pins will overlap; keep at least ${MIN_HOUSE_DISTANCE} units between houses.`
				);
			}
		}
	}
}
