// src/lib/server/template.ts
/**
 * Layout templates against PocketBase: building the export, the numbers shown
 * in the import preview, the pre-import backup and the import itself.
 */
import type { TypedPocketBase } from '$lib/pocketbase-types';
import { buildTemplate, type LayoutTemplate } from '$lib/template';

const BACKUP_PREFIX = 'pre-import-';
/** Older pre-import backups are removed, so repeated imports can't fill the disk. */
const BACKUPS_KEPT = 10;

export interface CampCounts {
	houses: number;
	rooms: number;
	beds: number;
	/** Spots that are currently booked or marked as taken. */
	bookings: number;
}

export interface ImportOutcome {
	/** File name of the backup made before the import, null when it was skipped. */
	backup: string | null;
	releasedBookings: number;
	/** Old records that could not be deleted after the new layout was in place. */
	leftovers: number;
}

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
		pb.collection('houses').getFullList({ fields: 'id,name,x,y' }),
		pb.collection('rooms').getFullList({ fields: 'id,house,name,room_number' }),
		pb.collection('beds').getFullList({ fields: 'room,label,enabled,is_locked,is_special' })
	]);
	return buildTemplate({ houses, rooms, beds });
}

export async function getCampCounts(pb: TypedPocketBase): Promise<CampCounts> {
	// requestKey null: two of these hit the same endpoint, and a per-request
	// client would auto-cancel the first one.
	const count = (collection: 'houses' | 'rooms' | 'beds', filter = '') =>
		pb
			.collection(collection)
			.getList(1, 1, { filter, fields: 'id', requestKey: null })
			.then((page) => page.totalItems);

	const [houses, rooms, beds, bookings] = await Promise.all([
		count('houses'),
		count('rooms'),
		count('beds'),
		count('beds', 'occupied = true || order != ""')
	]);
	return { houses, rooms, beds, bookings };
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

let importRunning = false;

/**
 * Replaces the camp's structure with `template` (already validated).
 *
 * PocketBase has no transaction over several requests, so the order makes it
 * safe: the new layout is created completely while the old one still exists.
 * If anything fails, the records created so far are removed again and the old
 * camp is untouched. Only a complete new layout replaces the old records.
 *
 * @throws {TemplateImportError} when nothing was imported
 */
export async function importTemplate(
	pb: TypedPocketBase,
	template: LayoutTemplate,
	options: { skipBackup?: boolean } = {}
): Promise<ImportOutcome> {
	if (importRunning) {
		throw new TemplateImportError(
			'Another import is running right now. Wait until it has finished, then check the layout before you import again.',
			409
		);
	}
	importRunning = true;
	try {
		let backup: string | null = null;
		if (!options.skipBackup) {
			try {
				backup = await createBackup(pb);
			} catch (err) {
				console.error('[Template import] Backup failed:', err);
				throw new TemplateImportError(
					`The safety backup could not be created (${describeError(err)}), so nothing was imported and your layout is unchanged. Try again in a minute. If it keeps failing, you can import without a backup.`,
					500,
					true
				);
			}
		}
		return { backup, ...(await replaceLayout(pb, template)) };
	} finally {
		importRunning = false;
	}
}

async function replaceLayout(pb: TypedPocketBase, template: LayoutTemplate) {
	const [oldHouses, oldRooms, oldBeds] = await Promise.all([
		pb.collection('houses').getFullList({ fields: 'id' }),
		pb.collection('rooms').getFullList({ fields: 'id' }),
		pb.collection('beds').getFullList({ fields: 'id,occupied,order' })
	]).catch((err) => {
		console.error('[Template import] Could not read the current layout:', err);
		throw new TemplateImportError(
			`The current layout could not be read (${describeError(err)}). Nothing was changed. Try again.`
		);
	});

	const created = { houses: [] as string[], rooms: [] as string[], beds: [] as string[] };
	let where = '';
	try {
		for (const [houseIndex, house] of template.houses.entries()) {
			where = `houses[${houseIndex}] "${house.name}"`;
			const houseRecord = await pb
				.collection('houses')
				.create({ name: house.name, x: house.x, y: house.y });
			created.houses.push(houseRecord.id);

			for (const [roomIndex, room] of house.rooms.entries()) {
				const roomWhere = `houses[${houseIndex}] "${house.name}" > rooms[${roomIndex}] "${room.name}"`;
				where = roomWhere;
				const roomRecord = await pb.collection('rooms').create({
					name: room.name,
					room_number: room.room_number,
					amount_beds: room.beds.length,
					house: houseRecord.id
				});
				created.rooms.push(roomRecord.id);

				for (const [bedIndex, bed] of room.beds.entries()) {
					where = `${roomWhere} > beds[${bedIndex}] "${bed.label}"`;
					const bedRecord = await pb.collection('beds').create({
						label: bed.label,
						enabled: bed.enabled,
						is_locked: bed.is_locked,
						is_special: bed.is_special === true,
						occupied: false,
						room: roomRecord.id
					});
					created.beds.push(bedRecord.id);
				}
			}
		}
	} catch (err) {
		console.error(`[Template import] Creating ${where} failed, rolling back:`, err);
		const stuck =
			(await deleteAll(pb, 'beds', created.beds)) +
			(await deleteAll(pb, 'rooms', created.rooms)) +
			(await deleteAll(pb, 'houses', created.houses));
		const aftermath =
			stuck === 0
				? 'Everything created so far was removed again. Your previous layout and all bookings are unchanged.'
				: `Your previous layout and all bookings are unchanged, but ${stuck} half-imported records could not be removed. Delete them in the editor.`;
		throw new TemplateImportError(
			`The database refused ${where} (${describeError(err)}). ${aftermath}`
		);
	}

	// The new layout is complete. From here on nothing is rolled back.
	let leftovers = 0;
	let releasedBookings = 0;
	for (const bed of oldBeds.filter((bed) => bed.occupied || bed.order)) {
		try {
			await pb.collection('beds').update(bed.id, { occupied: false, order: null });
			releasedBookings++;
		} catch (err) {
			if (!isNotFound(err)) console.error(`[Template import] Could not release ${bed.id}:`, err);
		}
	}
	leftovers += await deleteAll(
		pb,
		'beds',
		oldBeds.map((bed) => bed.id)
	);
	leftovers += await deleteAll(
		pb,
		'rooms',
		oldRooms.map((room) => room.id)
	);
	leftovers += await deleteAll(
		pb,
		'houses',
		oldHouses.map((house) => house.id)
	);

	return { releasedBookings, leftovers };
}
