// tests/layout-safety.test.ts — misclicks and deletions (release v1.32.3, B3 +
// B4): a backup of the database before the guests' bookings are released, a
// booking phase that can't be read never unlocks anything destructive, and
// deleting a house, room or spot (or freeing a spot) ends guest bookings only
// for a superuser — a spot the crew booked for a special-needs request only
// when the confirmation says so. PocketBase is the in-memory stand-in of
// tests/memory-pb.ts; its own layout guard and cascades are covered by
// tests/integration.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { memoryPb, type MemoryPb } from './memory-pb';
import { APP_SETTINGS_ID } from '../src/lib/server/constants';
import { PHASE_UNREADABLE, readPhaseStrict } from '../src/lib/server/settings';
import { BACKUP_PREFIX, createSafetyBackup } from '../src/lib/server/template';
import { countHeld, releaseRefusal, RELEASE_CREW_SPOTS } from '../src/lib/server/held-spots';
import { actions as dashboardActions } from '../src/routes/admin/+page.server';
import { actions as houseActions } from '../src/routes/admin/house/[id]/+page.server';
import { actions as roomActions } from '../src/routes/admin/room/[id]/+page.server';

const crew = {
	id: 'a1',
	email: 'crew@mauersegler.art',
	name: '',
	role: 'admin' as const,
	isSuperuser: false
};
const boss = {
	...crew,
	id: 'a2',
	email: 'boss@mauersegler.art',
	role: 'superuser' as const,
	isSuperuser: true
};

const outage = () => Object.assign(new Error('fetch failed'), { status: 0 });

/**
 * One house with one room: B1 booked by a guest (o1), B2 booked by the crew
 * for o2's approved special-needs request, B3 🔄 TAKEN by the crew (no
 * ticket), B4 free. Staging Mode unless said otherwise.
 */
function seed(settings: Record<string, unknown> = {}): MemoryPb {
	const bed = (id: string, extra: Record<string, unknown>) => ({
		id,
		room: 'r1',
		label: id.toUpperCase(),
		enabled: true,
		occupied: false,
		order: '',
		...extra
	});
	return memoryPb({
		app_settings: [{ id: APP_SETTINGS_ID, is_booking_active: false, ...settings }],
		houses: [{ id: 'h1', name: 'Neon Cave' }],
		rooms: [{ id: 'r1', house: 'h1', name: 'Bunks', room_number: 1 }],
		beds: [
			bed('b1', { occupied: true, order: 'o1' }),
			bed('b2', { occupied: true, order: 'o2' }),
			bed('b3', { occupied: true }),
			bed('b4', {})
		],
		orders: [
			{ id: 'o1', order_number: 'HB-1', burner_name: 'x' },
			{ id: 'o2', order_number: 'HB-2', burner_name: 'y' }
		],
		special_requests: [{ id: 'sr2', order: 'o2', status: 'approved', bed: 'b2' }]
	});
}

/** The same database for the admin's own connection and the service account. */
const localsOf = (db: MemoryPb, admin: typeof crew | typeof boss | null) => ({
	pb: db.pb,
	adminPb: db.pb,
	admin
});

function form(fields: Record<string, string>): FormData {
	const data = new FormData();
	for (const [key, value] of Object.entries(fields)) data.append(key, value);
	return data;
}
const request = (fields: Record<string, string>) => ({ formData: async () => form(fields) });

/** A copy of `db.pb` whose app_settings can't be read (PocketBase not answering). */
function phaseDown(db: MemoryPb) {
	return {
		...db.pb,
		collection: (name: string) =>
			name === 'app_settings'
				? {
						getOne: async () => {
							throw outage();
						}
					}
				: db.pb.collection(name)
	};
}

const bedOf = (db: MemoryPb, id: string) => db.data.beds.find((bed) => bed.id === id);
const events = (db: MemoryPb) => db.data.admin_events ?? [];

beforeEach(() => {
	vi.spyOn(console, 'log').mockImplementation(() => {});
	vi.spyOn(console, 'warn').mockImplementation(() => {});
	vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
	vi.restoreAllMocks();
});

describe('the safety backup', () => {
	it('is named after what it comes before, and keeps the ten newest of each kind', async () => {
		const db = memoryPb();
		db.backups = [
			...Array.from({ length: 10 }, (_, i) => `pre-release-2026010${i}-000000-000.zip`),
			'pre-import-20260101-000000-000.zip'
		];
		const name = await createSafetyBackup(db.pb, BACKUP_PREFIX.release);
		expect(name).toMatch(/^pre-release-\d{8}-\d{6}-\d{3}\.zip$/);
		expect(db.backups).toContain(name);
		expect(db.backups.filter((key) => key.startsWith('pre-release-'))).toHaveLength(10);
		// the oldest release backup went, the import backup stays
		expect(db.backups).not.toContain('pre-release-20260100-000000-000.zip');
		expect(db.backups).toContain('pre-import-20260101-000000-000.zip');
	});
});

describe('Clear all bookings', () => {
	it('makes a backup first, then releases', async () => {
		const db = seed();
		const result: any = await dashboardActions.clearAllBookings({
			locals: localsOf(db, boss)
		} as any);

		expect(result).toMatchObject({ success: true, released: 2, kept: 1 });
		expect(result.backup).toMatch(/^pre-release-/);
		const firstRelease = db.log.findIndex((entry) => entry.startsWith('update beds/'));
		expect(db.log.indexOf(`backup ${result.backup}`)).toBeLessThan(firstRelease);
		expect(events(db)[0]).toMatchObject({
			action: 'bookings_cleared',
			details: expect.objectContaining({ backup: result.backup })
		});
	});

	it('releases nothing when the backup fails', async () => {
		const db = seed();
		db.pb.backups.create = async () => {
			throw Object.assign(new Error('disk full'), {
				status: 400,
				response: { message: 'disk full' }
			});
		};
		const result: any = await dashboardActions.clearAllBookings({
			locals: localsOf(db, boss)
		} as any);

		expect(result.status).toBe(503);
		expect(result.data.error).toBe(
			'The safety backup could not be created (disk full), so no booking was released. Try again in a minute.'
		);
		expect(db.log.filter((entry) => entry.startsWith('update'))).toEqual([]);
	});

	it('releases nothing when the booking phase cannot be read', async () => {
		const db = seed();
		const result: any = await dashboardActions.clearAllBookings({
			locals: { ...localsOf(db, boss), pb: phaseDown(db) }
		} as any);

		expect(result.status).toBe(503);
		expect(result.data.error).toBe(PHASE_UNREADABLE);
		expect(db.backups).toEqual([]);
		expect(db.log).toEqual([]);
	});
});

describe('the switch back to Staging with "release the bookings"', () => {
	const switchForm = () => request({ phase: 'staging', clearBookings: '1' });

	it('makes a backup before anything changes', async () => {
		const db = seed({ is_booking_active: true });
		const result: any = await dashboardActions.setPhase({
			locals: localsOf(db, boss),
			request: switchForm()
		} as any);

		expect(result).toMatchObject({ success: true, phase: 'staging', released: 2, kept: 1 });
		expect(db.log[0]).toBe(`backup ${result.backup}`);
		expect(db.log[1]).toBe(`update app_settings/${APP_SETTINGS_ID}`);
		// a new booking round started, after the phase was written
		expect(db.data.app_settings[0].guest_round).toBe(1);
	});

	it('changes nothing at all when the backup fails', async () => {
		const db = seed({ is_booking_active: true });
		db.pb.backups.create = async () => {
			throw outage();
		};
		const result: any = await dashboardActions.setPhase({
			locals: localsOf(db, boss),
			request: switchForm()
		} as any);

		expect(result.status).toBe(503);
		expect(result.data.error).toMatch(
			/^The safety backup could not be created \(the database did not answer\), so nothing was changed/
		);
		expect(db.log).toEqual([]);
		expect(db.data.app_settings[0].is_booking_active).toBe(true);
	});

	it('needs no backup when the bookings stay', async () => {
		const db = seed({ is_booking_active: true });
		const result: any = await dashboardActions.setPhase({
			locals: localsOf(db, boss),
			request: request({ phase: 'staging' })
		} as any);

		expect(result).toMatchObject({ success: true, phase: 'staging' });
		expect(result.backup).toBeUndefined();
		expect(db.backups).toEqual([]);
	});
});

describe('a booking phase that cannot be read unlocks nothing', () => {
	it('readPhaseStrict throws, and a missing record is Staging', async () => {
		const db = seed({ is_booking_active: true });
		await expect(readPhaseStrict(phaseDown(db) as any)).rejects.toThrow('fetch failed');
		expect(await readPhaseStrict(db.pb)).toBe('live');
		expect(await readPhaseStrict(memoryPb().pb)).toBe('staging');
	});

	it('refuses the template import, deleting a house and freeing a spot', async () => {
		const db = seed();
		const locals = { ...localsOf(db, boss), pb: phaseDown(db) };
		const imported: any = await dashboardActions.importTemplate({
			locals,
			request: { formData: async () => new FormData() }
		} as any);
		const house: any = await dashboardActions.deleteHouse({
			locals,
			request: request({ id: 'h1' })
		} as any);
		const freed: any = await roomActions.toggleOccupied({
			locals,
			request: request({ id: 'b3', occupied: 'true' })
		} as any);

		expect(imported).toMatchObject({ status: 503, data: { error: PHASE_UNREADABLE } });
		expect(house).toMatchObject({ status: 503, data: { error: PHASE_UNREADABLE } });
		expect(freed).toMatchObject({ status: 503, data: { message: PHASE_UNREADABLE } });
		expect(db.log).toEqual([]);
	});
});

describe('who may end guest bookings by deleting or freeing', () => {
	it('counts guest bookings and the crew-booked ones among them', async () => {
		const db = seed();
		expect(await countHeld(db.pb, db.data.beds as any)).toEqual({
			guest: 2,
			crew: 1,
			crewBedIds: ['b2']
		});
		// 🔄 TAKEN without a ticket is no booking
		expect(await countHeld(db.pb, [{ id: 'b3', order: '' }])).toEqual({
			guest: 0,
			crew: 0,
			crewBedIds: []
		});
		const one = { guest: 1, crew: 0, crewBedIds: [] };
		expect(releaseRefusal(crew, one, null, 'This spot')).toEqual({
			status: 403,
			message: 'This spot holds 1 guest booking — only a superuser can release it.'
		});
		expect(releaseRefusal(boss, one, null, 'This spot')).toBeNull();
	});

	it('house: a regular admin is told how many, and nothing is deleted', async () => {
		const db = seed();
		const result: any = await dashboardActions.deleteHouse({
			locals: localsOf(db, crew),
			request: request({ id: 'h1' })
		} as any);

		expect(result.status).toBe(403);
		expect(result.data.error).toBe(
			'This house holds 2 guest bookings — only a superuser can release them.'
		);
		expect(db.log).toEqual([]);
	});

	it('house: a superuser is stopped by a crew-booked spot until the confirmation says so', async () => {
		const db = seed();
		const refused: any = await dashboardActions.deleteHouse({
			locals: localsOf(db, boss),
			request: request({ id: 'h1' })
		} as any);
		expect(refused.status).toBe(409);
		expect(refused.data).toMatchObject({
			error:
				'This house holds 1 spot the crew booked for special-needs requests, so nothing was changed. Release it on the Special needs page first, or confirm releasing it too.',
			crewBooked: 1
		});
		expect(db.log).toEqual([]);

		const result: any = await dashboardActions.deleteHouse({
			locals: localsOf(db, boss),
			request: request({ id: 'h1', [RELEASE_CREW_SPOTS]: '1' })
		} as any);
		expect(result).toEqual({ success: true });
		expect(db.data.houses).toEqual([]);
		// the request stays approved, without its spot
		expect(db.data.special_requests[0]).toMatchObject({ status: 'approved', bed: '' });
		expect(events(db)).toEqual([
			expect.objectContaining({
				action: 'house_deleted',
				subject: 'Neon Cave',
				details: { released: 2, crewReleased: 1, rooms: 1 }
			})
		]);
	});

	it('house: a regular admin deletes one whose spots hold no guest booking', async () => {
		const db = seed();
		for (const id of ['b1', 'b2']) Object.assign(bedOf(db, id)!, { occupied: false, order: '' });
		const result: any = await dashboardActions.deleteHouse({
			locals: localsOf(db, crew),
			request: request({ id: 'h1' })
		} as any);
		expect(result).toEqual({ success: true });
		expect(db.data.houses).toEqual([]);
	});

	it('room: the same rules, and the crew chat hears the counts', async () => {
		const db = seed();
		const regular: any = await houseActions.deleteRoom({
			locals: localsOf(db, crew),
			request: request({ id: 'r1' })
		} as any);
		expect(regular).toMatchObject({
			status: 403,
			data: { message: 'This room holds 2 guest bookings — only a superuser can release them.' }
		});
		const unconfirmed: any = await houseActions.deleteRoom({
			locals: localsOf(db, boss),
			request: request({ id: 'r1' })
		} as any);
		expect(unconfirmed).toMatchObject({ status: 409, data: { crewBooked: 1 } });
		expect(db.data.rooms).toHaveLength(1);

		const result: any = await houseActions.deleteRoom({
			locals: localsOf(db, boss),
			request: request({ id: 'r1', [RELEASE_CREW_SPOTS]: '1' })
		} as any);
		expect(result).toEqual({ success: true });
		expect(db.data.rooms).toEqual([]);
		expect(events(db)).toEqual([
			expect.objectContaining({
				action: 'room_deleted',
				subject: 'r1',
				details: { released: 2, crewReleased: 1 }
			})
		]);
	});

	it('spot: deleting a guest booking is for superusers, a free spot for everybody', async () => {
		const db = seed();
		const del = (admin: typeof crew | typeof boss, id: string) =>
			roomActions.deleteBed({
				locals: localsOf(db, admin),
				request: request({ id })
			} as any) as any;

		expect(await del(crew, 'b1')).toMatchObject({
			status: 403,
			data: { message: 'This spot holds 1 guest booking — only a superuser can release it.' }
		});
		expect(await del(crew, 'b4')).toEqual({ success: true });
		expect(await del(crew, 'b3')).toEqual({ success: true });
		expect(await del(boss, 'b2')).toMatchObject({ status: 409, data: { crewBooked: 1 } });
		expect(await del(boss, 'b1')).toEqual({ success: true });
		expect(db.data.beds.map((bed) => bed.id)).toEqual(['b2']);
		// only the deletion that ended a booking is news for the crew chat
		expect(events(db)).toEqual([
			expect.objectContaining({
				action: 'spot_deleted',
				subject: 'b1',
				details: { released: 1, crewReleased: 0 }
			})
		]);
	});

	it('spot: freeing a guest booking is for superusers, freeing 🔄 TAKEN for everybody', async () => {
		const db = seed();
		const free = (admin: typeof crew | typeof boss, id: string, extra = {}) =>
			roomActions.toggleOccupied({
				locals: localsOf(db, admin),
				request: request({ id, occupied: 'true', ...extra })
			} as any) as any;

		expect(await free(crew, 'b1')).toMatchObject({
			status: 403,
			data: { message: 'This spot holds 1 guest booking — only a superuser can release it.' }
		});
		expect(bedOf(db, 'b1')).toMatchObject({ occupied: true, order: 'o1' });
		expect(await free(crew, 'b3')).toEqual({ success: true });
		expect(bedOf(db, 'b3')).toMatchObject({ occupied: false });

		expect(await free(boss, 'b2')).toMatchObject({ status: 409, data: { crewBooked: 1 } });
		expect(bedOf(db, 'b2')).toMatchObject({ occupied: true, order: 'o2' });
		expect(await free(boss, 'b2', { [RELEASE_CREW_SPOTS]: '1' })).toEqual({ success: true });
		expect(bedOf(db, 'b2')).toMatchObject({ occupied: false, order: null });
		// like Release spot: the request stays approved and has no spot any more
		expect(db.data.special_requests[0]).toMatchObject({ status: 'approved', bed: '' });

		expect(await free(boss, 'b1')).toEqual({ success: true });
		expect(events(db).map((event) => [event.action, event.subject, event.details])).toEqual([
			['spot_freed', 'b2', { released: 1, crewReleased: 1 }],
			['spot_freed', 'b1', { released: 1, crewReleased: 0 }]
		]);
	});

	it('spot: marking a free spot taken stays possible for every admin', async () => {
		const db = seed();
		const result: any = await roomActions.toggleOccupied({
			locals: localsOf(db, crew),
			request: request({ id: 'b4', occupied: 'false' })
		} as any);
		expect(result).toEqual({ success: true });
		expect(bedOf(db, 'b4')).toMatchObject({ occupied: true, order: '' });
	});

	it('spot: freeing is refused outside Staging Mode, like before', async () => {
		const db = seed({ is_booking_active: true });
		const result: any = await roomActions.toggleOccupied({
			locals: localsOf(db, boss),
			request: request({ id: 'b1', occupied: 'true' })
		} as any);
		expect(result.status).toBe(403);
		expect(bedOf(db, 'b1')).toMatchObject({ occupied: true, order: 'o1' });
	});
});
