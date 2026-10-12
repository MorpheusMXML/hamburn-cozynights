// tests/lost-updates.test.ts — PocketBase saves the whole record on every
// update, so two writes of one record at the same moment undo each other
// (reproduced against PocketBase: 130 of 200 concurrent pairs lost a field).
// Release v1.32.3, B2: every writer of a spot, a ticket and app_settings runs
// in that record's queue (withLock, src/lib/server/booking.ts) — the same
// queues guest bookings use: bed:<id>, order:<id>, and app_settings.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { withLock } from '../src/lib/server/booking';
import { APP_SETTINGS_ID, APP_SETTINGS_LOCK } from '../src/lib/server/constants';
import { setRequestsOpen } from '../src/lib/server/special-requests';
import { setSwapPause, setSwapsOff } from '../src/lib/server/swaps';
import { bumpGuestRound } from '../src/lib/server/guest-session';
import { changeTicket, importRoster } from '../src/lib/server/tickets';
import { actions as dashboardActions } from '../src/routes/admin/+page.server';
import { actions as roomActions } from '../src/routes/admin/room/[id]/+page.server';
import { FakePb } from './fake-pb';
import { memoryPb } from './memory-pb';

type Row = Record<string, any>;

/**
 * A PocketBase that saves like the real one: an update loads the record, the
 * hooks and the round trip take a moment, then all of it is written back.
 * Reads without a filter only; enough for the writers here.
 */
function wholeRecordPb(seed: Record<string, Row[]>) {
	const data: Record<string, Row[]> = structuredClone(seed);
	const table = (name: string) => (data[name] ??= []);
	const notFound = () => Object.assign(new Error('not found'), { status: 404 });
	const collection = (name: string) => ({
		async getOne(id: string) {
			const row = table(name).find((r) => r.id === id);
			if (!row) throw notFound();
			return { ...row };
		},
		async getFullList() {
			return [];
		},
		async create(row: Row) {
			table(name).push({ id: `${name}-${table(name).length + 1}`, ...row });
			return { ...row };
		},
		async update(id: string, patch: Row) {
			const loaded = table(name).find((r) => r.id === id);
			if (!loaded) throw notFound();
			const record = { ...loaded };
			await new Promise((resolve) => setTimeout(resolve, 2));
			Object.assign(record, patch);
			const rows = table(name);
			rows[rows.findIndex((r) => r.id === id)] = record;
			return { ...record };
		}
	});
	const pb = { collection, filter: (expr: string) => expr } as any;
	return { data, pb };
}

const crew = {
	id: 'a1',
	email: 'crew@mauersegler.art',
	name: '',
	role: 'admin' as const,
	isSuperuser: false
};

function post(fields: Record<string, string>) {
	return {
		formData: async () => {
			const data = new FormData();
			for (const [key, value] of Object.entries(fields)) data.append(key, value);
			return data;
		}
	};
}

beforeEach(() => {
	vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => {
	vi.restoreAllMocks();
});

describe('the stand-in', () => {
	it('loses a field when two writes of one record cross, like PocketBase', async () => {
		const { data, pb } = wholeRecordPb({ beds: [{ id: 'b1' }] });
		await Promise.all([
			pb.collection('beds').update('b1', { is_locked: true }),
			pb.collection('beds').update('b1', { is_special: true })
		]);
		expect(Object.keys(data.beds[0]).filter((key) => data.beds[0][key] === true)).toHaveLength(1);
	});
});

describe('spots: every admin write runs in the spot’s queue', () => {
	function camp() {
		return wholeRecordPb({
			app_settings: [{ id: APP_SETTINGS_ID }],
			beds: [
				{
					id: 'b1',
					room: 'r1',
					label: 'B1',
					enabled: true,
					is_locked: false,
					is_special: false
				}
			]
		});
	}

	it('three switches of one spot at once all stay', async () => {
		const { data, pb } = camp();
		const locals = { pb, adminPb: pb, admin: crew };
		const results = await Promise.all([
			roomActions.toggleLocked({ locals, request: post({ id: 'b1', is_locked: 'false' }) } as any),
			roomActions.toggleSpecial({
				locals,
				request: post({ id: 'b1', is_special: 'false' })
			} as any),
			roomActions.toggleEnabled({ locals, request: post({ id: 'b1', enabled: 'true' }) } as any)
		]);
		for (const result of results) expect(result).toEqual({ success: true });
		expect(data.beds[0]).toMatchObject({ is_locked: true, is_special: true, enabled: false });
	});

	it('waits while a booking holds the spot', async () => {
		const { data, pb } = camp();
		let release!: () => void;
		const booking = withLock('bed:b1', () => new Promise<void>((done) => (release = done)));

		const locked = roomActions.toggleLocked({
			locals: { pb, adminPb: pb, admin: crew },
			request: post({ id: 'b1', is_locked: 'false' })
		} as any);
		await new Promise((resolve) => setTimeout(resolve, 10));
		expect(data.beds[0].is_locked).toBe(false);

		release();
		await booking;
		expect(await locked).toEqual({ success: true });
		expect(data.beds[0].is_locked).toBe(true);
	});
});

describe('releasing every booking', () => {
	it('waits for a booking that holds one of the spots', async () => {
		const db = memoryPb({
			app_settings: [{ id: APP_SETTINGS_ID }],
			beds: [{ id: 'b1', room: 'r1', occupied: true, order: 'o1' }],
			orders: [{ id: 'o1', order_number: 'HB-1' }]
		});
		let release!: () => void;
		const booking = withLock('bed:b1', () => new Promise<void>((done) => (release = done)));

		const cleared = dashboardActions.clearAllBookings({
			locals: { pb: db.pb, adminPb: db.pb, admin: { ...crew, isSuperuser: true } }
		} as any);
		await new Promise((resolve) => setTimeout(resolve, 10));
		expect(db.data.beds[0]).toMatchObject({ occupied: true, order: 'o1' });

		release();
		await booking;
		expect(await cleared).toMatchObject({ success: true, released: 1 });
		expect(db.data.beds[0]).toMatchObject({ occupied: false, order: null });
	});
});

describe('a change of a whole room', () => {
	it('waits until no booking holds any of its spots, then writes them all', async () => {
		const pb = new FakePb();
		pb.seed('app_settings', { id: APP_SETTINGS_ID });
		const [b1, b2] = ['B1', 'B2'].map((label) => pb.seed('beds', { room: 'r1', label }));
		let release!: () => void;
		const booking = withLock(`bed:${b2.id}`, () => new Promise<void>((done) => (release = done)));

		const typed = roomActions.setBedTypes({
			locals: { pb, adminPb: pb, admin: crew },
			params: { id: 'r1' },
			request: post({ pattern: 'single' })
		} as any);
		await new Promise((resolve) => setTimeout(resolve, 10));
		expect([b1.bed_type, b2.bed_type]).toEqual([undefined, undefined]);

		release();
		await booking;
		expect(await typed).toEqual({ success: true });
		expect([b1.bed_type, b2.bed_type]).toEqual(['single', 'single']);
	});
});

describe('tickets: every app write runs in the ticket’s queue', () => {
	const ticket = {
		id: 'o1',
		order_number: 'HB-1',
		customer_name: 'Ada',
		email: 'ada@example.org',
		no_swap_requests: false
	};

	it('a guest pausing swaps and the crew changing the name at once: both stay', async () => {
		const { data, pb } = wholeRecordPb({ orders: [ticket] });
		await Promise.all([
			setSwapPause(pb, { id: 'o1' }, true),
			changeTicket(pb, 'o1', { email: 'ada@example.org', name: 'Ada Lovelace', newHolder: false })
		]);
		expect(data.orders[0]).toMatchObject({ no_swap_requests: true, customer_name: 'Ada Lovelace' });
	});

	it('the ticket list import writes a changed ticket in its queue too', async () => {
		const db = memoryPb({
			orders: [
				{ id: 'o1', order_number: 'HB-1001', customer_name: 'Ada', email: 'ada@example.org' }
			]
		});
		let release!: () => void;
		const booking = withLock('order:o1', () => new Promise<void>((done) => (release = done)));

		const imported = importRoster(
			db.pb,
			[{ line: 2, code: 'HB-1001', email: 'ada@example.org', name: 'Ada Lovelace' }],
			{ selected: ['hb-1001'], newHolders: [] }
		);
		await new Promise((resolve) => setTimeout(resolve, 10));
		expect(db.data.orders[0].customer_name).toBe('Ada');

		release();
		await booking;
		expect(await imported).toMatchObject({ updated: 1, failed: [] });
		expect(db.data.orders[0].customer_name).toBe('Ada Lovelace');
	});

	it('waits while a booking holds the ticket', async () => {
		const { data, pb } = wholeRecordPb({ orders: [ticket] });
		let release!: () => void;
		const booking = withLock('order:o1', () => new Promise<void>((done) => (release = done)));

		const paused = setSwapPause(pb, { id: 'o1' }, true);
		await new Promise((resolve) => setTimeout(resolve, 10));
		expect(data.orders[0].no_swap_requests).toBe(false);

		release();
		await booking;
		await paused;
		expect(data.orders[0].no_swap_requests).toBe(true);
	});
});

describe('app_settings: every app write runs in one queue', () => {
	it('switches, a new guest round and a window edit at the same moment all stay', async () => {
		const { data, pb } = wholeRecordPb({
			app_settings: [{ id: APP_SETTINGS_ID, guest_round: 3 }]
		});
		const results = await Promise.all([
			setSwapsOff(pb, true),
			setRequestsOpen(pb, true),
			bumpGuestRound(pb),
			bumpGuestRound(pb),
			dashboardActions.pauseTimer({ locals: { pb, adminPb: pb, admin: crew } } as any)
		]);
		expect(results[4]).toMatchObject({ success: true });
		expect(data.app_settings[0]).toMatchObject({
			swaps_off: true,
			special_requests_open: true,
			guest_round: 5,
			booking_timer_paused: true
		});
	});

	it('waits while another write holds the settings', async () => {
		const { data, pb } = wholeRecordPb({ app_settings: [{ id: APP_SETTINGS_ID }] });
		let release!: () => void;
		const other = withLock(APP_SETTINGS_LOCK, () => new Promise<void>((done) => (release = done)));

		const off = setSwapsOff(pb, true);
		await new Promise((resolve) => setTimeout(resolve, 10));
		expect(data.app_settings[0].swaps_off).toBeUndefined();

		release();
		await other;
		await off;
		expect(data.app_settings[0].swaps_off).toBe(true);
	});
});
