// src/lib/server/template.ts
/**
 * Layout templates against PocketBase: the export, the comparison of a
 * template with the camp (the review in the Burn Template Manager), the
 * safety backup, and applying the changes the admin chose
 * (docs/admin/templates.md).
 */
import type { TypedPocketBase } from '$lib/pocketbase-types';
import { buildTemplate, type LayoutTemplate } from '$lib/template';
import {
	changeKeys,
	diffLayout,
	normalizeSelection,
	planChanges,
	planSize,
	type ApplyOutcome,
	type CampRecords,
	type LayoutDiff,
	type LayoutPlan
} from '$lib/template-diff';

export type { ApplyOutcome };

type LevelCounts = ApplyOutcome['created'];

const BACKUP_PREFIX = 'pre-import-';
/** Older pre-import backups are removed, so repeated imports can't fill the disk. */
const BACKUPS_KEPT = 10;

/** An import that did not happen. `message` is written for the admin. */
export class TemplateImportError extends Error {
	constructor(
		message: string,
		public status = 500,
		/** True when only the safety backup failed, so the admin may retry without one. */
		public backupFailed = false
	) {
		super(message);
		this.name = 'TemplateImportError';
	}
}

export async function exportTemplate(pb: TypedPocketBase): Promise<LayoutTemplate> {
	const [houses, rooms, beds] = await Promise.all([
		pb.collection('houses').getFullList({ fields: 'id,name,x,y,kind,features,description' }),
		pb.collection('rooms').getFullList({
			fields: 'id,house,name,room_number,kind,features,features_off,description'
		}),
		pb.collection('beds').getFullList({
			fields:
				'id,room,label,enabled,is_locked,is_special,bed_type,features,features_off,bunk_partner'
		})
	]);
	return buildTemplate({ houses, rooms, beds });
}

/**
 * The camp as the comparison needs it: record ids and bookings, and every field
 * of the spots, because buildTemplate decides which of them a template holds.
 */
export async function loadCamp(pb: TypedPocketBase): Promise<CampRecords> {
	// requestKey null: parallel requests of one client must not cancel each other.
	const [houses, rooms, beds] = await Promise.all([
		pb.collection('houses').getFullList({
			fields: 'id,created,name,x,y,kind,features,description',
			requestKey: null
		}),
		pb.collection('rooms').getFullList({
			fields: 'id,created,house,name,room_number,kind,features,features_off,description',
			requestKey: null
		}),
		pb.collection('beds').getFullList({ requestKey: null })
	]);
	return { houses, rooms, beds } as CampRecords;
}

/** What applying the template could change (the review). Changes nothing. */
export async function compareTemplate(
	pb: TypedPocketBase,
	template: LayoutTemplate
): Promise<LayoutDiff> {
	return diffLayout(await loadCamp(pb), template);
}

function describeError(err: unknown): string {
	const failure = err as {
		status?: number;
		message?: string;
		response?: { message?: string; data?: Record<string, { message?: string }> };
	};
	if (failure?.status === 0) return 'the database did not answer';
	const fields = Object.entries(failure?.response?.data ?? {}).map(
		([field, problem]) => `${field}: ${problem?.message ?? 'not accepted'}`
	);
	if (fields.length > 0) return fields.join('; ');
	return failure?.response?.message || failure?.message || 'unknown error';
}

const isNotFound = (err: unknown) => (err as { status?: number })?.status === 404;

async function createBackup(pb: TypedPocketBase): Promise<string> {
	// PocketBase accepts only [a-z0-9_-] in backup names.
	// Down to the millisecond: a name that exists already is refused.
	const stamp = new Date().toISOString().slice(0, 23).replace(/[-:]/g, '').replace(/[T.]/g, '-');
	const name = `${BACKUP_PREFIX}${stamp}.zip`;
	await pb.backups.create(name);

	try {
		const old = (await pb.backups.getFullList())
			.filter((backup) => backup.key.startsWith(BACKUP_PREFIX))
			.sort((a, b) => b.key.localeCompare(a.key))
			.slice(BACKUPS_KEPT);
		for (const backup of old) await pb.backups.delete(backup.key);
	} catch (err) {
		console.error('[Template import] Could not tidy up old pre-import backups:', err);
	}
	return name;
}

async function deleteAll(
	pb: TypedPocketBase,
	collection: 'houses' | 'rooms' | 'beds',
	ids: string[]
): Promise<number> {
	let failed = 0;
	for (const id of ids) {
		try {
			await pb.collection(collection).delete(id);
		} catch (err) {
			// Already gone, e.g. removed together with its house.
			if (isNotFound(err)) continue;
			failed++;
			console.error(`[Template import] Could not delete ${collection}/${id}:`, err);
		}
	}
	return failed;
}

/**
 * Creates the new houses, rooms and spots, top down. PocketBase has no
 * transaction over several requests: if one fails, what was created so far is
 * removed again and nothing else of the import happens.
 */
async function createAll(pb: TypedPocketBase, plan: LayoutPlan): Promise<LevelCounts> {
	const houseIds = new Map<string, string>();
	const roomIds = new Map<string, string>();
	const created = { houses: [] as string[], rooms: [] as string[], beds: [] as string[] };
	let where = '';
	try {
		for (const house of plan.createHouses) {
			where = `house "${house.name}"`;
			const record = await pb
				.collection('houses')
				.create({ name: house.name, x: house.x, y: house.y, ...house.details });
			houseIds.set(house.key, record.id);
			created.houses.push(record.id);
		}
		for (const room of plan.createRooms) {
			where = `room "${room.name}" of "${room.houseName}"`;
			const house = room.houseId ?? houseIds.get(room.houseKey);
			if (!house) throw new Error('its house is missing');
			const record = await pb.collection('rooms').create({
				name: room.name,
				room_number: room.room_number,
				...room.details,
				amount_beds: room.spots,
				house
			});
			roomIds.set(room.key, record.id);
			created.rooms.push(record.id);
		}
		for (const spot of plan.createSpots) {
			where = `spot "${spot.bed.label}" in "${spot.roomName}" of "${spot.houseName}"`;
			const room = spot.roomId ?? roomIds.get(spot.roomKey);
			if (!room) throw new Error('its room is missing');
			// Every field the template knows about the spot, whatever they are —
			// except the bunk partner, a label that syncBunks turns into the
			// spot's id once every spot of the room exists. A list the file
			// leaves out (features, features_off) is not sent, so the new spot
			// starts empty there.
			const { bunk_partner: _partner, ...fields } = spot.bed;
			const record = await pb.collection('beds').create({ ...fields, occupied: false, room });
			created.beds.push(record.id);
		}
	} catch (err) {
		console.error(`[Template import] Creating ${where} failed, rolling back:`, err);
		const stuck =
			(await deleteAll(pb, 'beds', created.beds)) +
			(await deleteAll(pb, 'rooms', created.rooms)) +
			(await deleteAll(pb, 'houses', created.houses));
		const aftermath =
			stuck === 0
				? 'Everything created so far was removed again. Your layout and all bookings are unchanged.'
				: `Your layout and all bookings are unchanged, but ${stuck} half-imported records could not be removed. Delete them in the editor.`;
		throw new TemplateImportError(
			`The database refused ${where} (${describeError(err)}). ${aftermath}`
		);
	}
	return { houses: created.houses.length, rooms: created.rooms.length, spots: created.beds.length };
}

/**
 * Writes the bunk pairings of the file for the chosen spots: the camp is read
 * again, compared again, and every chosen spot whose partner differs gets
 * the id of the spot the file names (or none). Returns the number of writes.
 */
async function syncBunks(
	pb: TypedPocketBase,
	template: LayoutTemplate,
	chosen: Set<string>,
	report: (what: string, err: unknown) => void
): Promise<number> {
	const camp = await loadCamp(pb);
	const diff = diffLayout(camp, template);
	const bedsOfRoom = new Map<string, CampRecords['beds']>();
	for (const bed of camp.beds) {
		const list = bedsOfRoom.get(bed.room) ?? [];
		list.push(bed);
		bedsOfRoom.set(bed.room, list);
	}
	let writes = 0;
	for (const house of diff.houses) {
		for (const room of house.rooms) {
			if (!room.id) continue;
			const roomBeds = bedsOfRoom.get(room.id) ?? [];
			for (const spot of room.spots) {
				if (!spot.id || !spot.after || !chosen.has(spot.key)) continue;
				if (!spot.changes.some((change) => change.field === 'bunk_partner')) continue;
				const wanted = (spot.after.bunk_partner ?? '').toLowerCase();
				const partner = wanted
					? roomBeds.find((bed) => String(bed.label ?? '').toLowerCase() === wanted)
					: undefined;
				if (wanted && !partner) continue;
				const id = spot.id;
				try {
					await pb.collection('beds').update(id, { bunk_partner: partner?.id ?? '' });
					writes++;
				} catch (err) {
					if (isNotFound(err)) continue;
					console.error(`[Template import] Bunk partner of spot ${spot.label} failed:`, err);
					report(`Stacking spot ${spot.label}`, err);
				}
			}
		}
	}
	return writes;
}

let importRunning = false;

/**
 * Applies the chosen changes of `template` (already validated). The camp is
 * read and compared again here: the review in the browser is only a courtesy.
 * A change that is no longer needed is skipped.
 *
 * Order: backup, new records (all or nothing), then changes, then removals
 * (spots before rooms before houses). Changes and removals that fail are
 * reported; the rest stays applied.
 *
 * @throws {TemplateImportError} when nothing was changed
 */
export async function applyTemplate(
	pb: TypedPocketBase,
	template: LayoutTemplate,
	selected: string[],
	options: { skipBackup?: boolean } = {}
): Promise<ApplyOutcome> {
	if (importRunning) {
		throw new TemplateImportError(
			'Another import is running right now. Wait until it has finished, then check the layout before you import again.',
			409
		);
	}
	importRunning = true;
	try {
		let camp: CampRecords;
		try {
			camp = await loadCamp(pb);
		} catch (err) {
			console.error('[Template import] Could not read the current layout:', err);
			throw new TemplateImportError(
				`The current layout could not be read (${describeError(err)}). Nothing was changed. Try again.`
			);
		}

		const diff = diffLayout(camp, template);
		const known = new Set(changeKeys(diff));
		const wanted = [...new Set(selected)];
		const plan = planChanges(diff, normalizeSelection(diff, wanted));
		const outcome: ApplyOutcome = {
			backup: null,
			created: { houses: 0, rooms: 0, spots: 0 },
			updated: { houses: 0, rooms: 0, spots: 0 },
			removed: { houses: 0, rooms: 0, spots: 0 },
			releasedBookings: 0,
			skipped: wanted.filter((key) => !known.has(key)).length,
			problems: [],
			namesCleared: true
		};
		if (planSize(plan) === 0) return outcome;

		if (!options.skipBackup) {
			try {
				outcome.backup = await createBackup(pb);
			} catch (err) {
				console.error('[Template import] Backup failed:', err);
				throw new TemplateImportError(
					`The safety backup could not be created (${describeError(err)}), so nothing was imported and your layout is unchanged. Try again in a minute. If it keeps failing, you can import without a backup.`,
					500,
					true
				);
			}
		}

		outcome.created = await createAll(pb, plan);

		// From here on nothing is rolled back: each step stands on its own.
		const attempt = async (what: string, step: () => Promise<unknown>) => {
			try {
				await step();
				return true;
			} catch (err) {
				if (isNotFound(err)) return false;
				console.error(`[Template import] ${what} failed:`, err);
				outcome.problems.push(`${what}: ${describeError(err)}`);
				return false;
			}
		};

		for (const house of plan.updateHouses) {
			const done = await attempt(`Updating house "${house.name}"`, () =>
				pb.collection('houses').update(house.id, {
					name: house.name,
					x: house.x,
					y: house.y,
					...house.details
				})
			);
			if (done) outcome.updated.houses++;
		}
		for (const room of plan.updateRooms) {
			const done = await attempt(`Renaming room "${room.name}"`, () =>
				pb.collection('rooms').update(room.id, { name: room.name, ...room.details })
			);
			if (done) outcome.updated.rooms++;
		}
		for (const spot of plan.updateSpots) {
			const done = await attempt(`Changing spot ${spot.label}`, () =>
				pb.collection('beds').update(spot.id, spot.fields)
			);
			if (done) outcome.updated.spots++;
		}

		const bookedBy = new Map(camp.beds.map((bed) => [bed.id, bed.order ?? '']));
		const released = new Set<string>();
		for (const spot of plan.removeSpots) {
			const done = await attempt(`Removing spot ${spot.label}`, () =>
				pb.collection('beds').delete(spot.id)
			);
			if (!done) continue;
			outcome.removed.spots++;
			if (spot.booked) outcome.releasedBookings++;
			const order = bookedBy.get(spot.id);
			if (order) released.add(order);
		}
		for (const room of plan.removeRooms) {
			const done = await attempt(`Removing room "${room.name}"`, () =>
				pb.collection('rooms').delete(room.id)
			);
			if (done) outcome.removed.rooms++;
		}
		for (const house of plan.removeHouses) {
			const done = await attempt(`Removing house "${house.name}"`, () =>
				pb.collection('houses').delete(house.id)
			);
			if (done) outcome.removed.houses++;
		}

		// Bunk beds last: a partner is named by label and both spots of a pair
		// must exist first. Only spots the admin chose are paired; PocketBase
		// completes the other side of each pair (pb_hooks/cozy_bunks.pb.js).
		const chosen = normalizeSelection(diff, wanted);
		try {
			outcome.updated.spots += await syncBunks(pb, template, chosen, (what, err) =>
				outcome.problems.push(`${what}: ${describeError(err)}`)
			);
		} catch (err) {
			console.error('[Template import] Bunk beds could not be read back:', err);
			outcome.problems.push(
				`Bunk beds: the layout could not be read back (${describeError(err)}), so the pairings of the file were not applied. Import the file again.`
			);
		}

		// The names chosen for released bookings go with them; the tickets stay.
		for (const order of released) {
			try {
				await pb.collection('orders').update(order, { burner_name: '' });
			} catch (err) {
				if (isNotFound(err)) continue;
				outcome.namesCleared = false;
				console.error(`[Template import] Could not clear the burner name of ${order}:`, err);
			}
		}
		return outcome;
	} finally {
		importRunning = false;
	}
}
