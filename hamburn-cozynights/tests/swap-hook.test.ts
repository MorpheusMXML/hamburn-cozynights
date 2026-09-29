// tests/swap-hook.test.ts — the swap itself, PocketBase's side
// (pb_hooks/lib/swap.js, POST /api/cozy/swap): two spots change tickets in one
// transaction with the request's "accepted", every other open request about
// either spot or ticket ends, and every reason not to swap is caught. Against
// a real PocketBase: tests/integration/swaps.test.ts.
import { describe, expect, it } from 'vitest';
import { loadHookModule } from './hook-module';

type Row = Record<string, any>;

/** A record like the JSVM's: getters and set() over a plain row. */
function record(row: Row) {
	return {
		id: row.id,
		getString: (key: string) => String(row[key] ?? ''),
		getBool: (key: string) => !!row[key],
		getInt: (key: string) => Number(row[key] ?? 0),
		get: (key: string) => row[key],
		set: (key: string, value: unknown) => {
			row[key] = value;
		},
		row
	};
}

/** A fake app over a few collections, with the finders swap.js uses. */
function fakeApp(tables: Record<string, Row[]>) {
	const saved: string[] = [];
	const app: Record<string, any> = {
		findRecordById: (collection: string, id: string) => {
			const row = (tables[collection] ?? []).find((r) => r.id === id);
			if (!row) throw new Error(`${collection} ${id} not found`);
			return record(row);
		},
		findRecordsByFilter: (
			collection: string,
			_filter: string,
			_sort: string,
			_limit: number,
			_offset: number,
			p: Row
		) => {
			const rows = tables[collection] ?? [];
			if (collection === 'special_requests') {
				return rows
					.filter((r) => r.order === p.order && r.status === 'approved' && r.bed)
					.map(record);
			}
			if (collection === 'swap_requests') {
				const orders = [p.a, p.b];
				const beds = [p.x, p.y];
				return rows
					.filter(
						(r) =>
							r.status === 'pending' &&
							r.id !== p.id &&
							(orders.includes(r.from_order) ||
								orders.includes(r.to_order) ||
								beds.includes(r.from_bed) ||
								beds.includes(r.to_bed))
					)
					.map(record);
			}
			throw new Error(`unexpected query on ${collection}`);
		},
		save: (rec: { id: string }) => {
			saved.push(rec.id);
		},
		runInTransaction: (fn: (tx: unknown) => void) => fn(app)
	};
	return { app, saved };
}

const swap = loadHookModule('lib/swap.js');
const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();

/** Ada (B1) asked Bo (B2); Cy (B3) asked Ada; Bo asked Di (B4); Eve asked Cy — unrelated. */
function camp(settings: Row = {}) {
	const bed = (id: string, order: string, extra: Row = {}) => ({
		id,
		order,
		occupied: true,
		enabled: true,
		is_locked: false,
		is_special: false,
		checked_in_at: '',
		...extra
	});
	const request = (id: string, from: [string, string], to: [string, string], extra: Row = {}) => ({
		id,
		from_order: from[0],
		from_bed: from[1],
		to_order: to[0],
		to_bed: to[1],
		status: 'pending',
		quiet: false,
		expires_at: inDays(2),
		answered_at: '',
		ended: '',
		notify_due: '',
		...extra
	});
	const tables: Record<string, Row[]> = {
		app_settings: [
			{
				id: 'appsettings0123',
				is_booking_active: true,
				booking_closed: false,
				booking_unlock_at: '',
				booking_close_at: '',
				booking_timer_paused: false,
				swaps_off: false,
				...settings
			}
		],
		beds: [bed('b1', 'ada'), bed('b2', 'bo'), bed('b3', 'cy'), bed('b4', 'di'), bed('b5', 'eve')],
		special_requests: [],
		swap_requests: [
			request('ask', ['ada', 'b1'], ['bo', 'b2']),
			request('cyToAda', ['cy', 'b3'], ['ada', 'b1']),
			request('boToDi', ['bo', 'b2'], ['di', 'b4']),
			request('eveToCy', ['eve', 'b5'], ['cy', 'b3'])
		]
	};
	const bedOf = (id: string) => tables.beds.find((b) => b.id === id)!;
	const req = (id: string) => tables.swap_requests.find((r) => r.id === id)!;
	return { tables, bedOf, req, ...fakeApp(tables) };
}

describe('a yes', () => {
	it('swaps both spots, accepts the request and ends every other one about them', () => {
		const c = camp();
		expect(swap.acceptSwap(c.app, 'ask', 'bo')).toEqual({ ok: true, voided: 2 });
		expect(c.bedOf('b1')).toMatchObject({ order: 'bo', occupied: true });
		expect(c.bedOf('b2')).toMatchObject({ order: 'ada', occupied: true });
		expect(c.req('ask').status).toBe('accepted');
		expect(c.req('ask').answered_at).not.toBe('');
		// Cy wanted Ada's old spot; Bo offered his old one to Di: both over
		for (const id of ['cyToAda', 'boToDi']) {
			expect(c.req(id)).toMatchObject({ status: 'void', ended: 'swapped' });
		}
		expect(c.req('eveToCy').status).toBe('pending');
	});
});

describe('no swap, and why', () => {
	it('only for the guest the request is addressed to, never for a quiet one', () => {
		const c = camp();
		expect(swap.acceptSwap(c.app, 'ask', 'ada')).toEqual({ ok: false, reason: 'mismatch' });
		c.req('ask').quiet = true;
		expect(swap.acceptSwap(c.app, 'ask', 'bo')).toEqual({ ok: false, reason: 'mismatch' });
		expect(c.bedOf('b1').order).toBe('ada');
	});

	it('once only, and not after it ran out (which closes it)', () => {
		const c = camp();
		c.req('ask').status = 'declined';
		expect(swap.acceptSwap(c.app, 'ask', 'bo').reason).toBe('answered');
		const d = camp();
		d.req('ask').expires_at = inDays(-0.01);
		expect(swap.acceptSwap(d.app, 'ask', 'bo').reason).toBe('expired');
		expect(d.req('ask').status).toBe('expired');
		expect(swap.acceptSwap(d.app, 'nope', 'bo').reason).toBe('answered');
	});

	it('only while booking is live and the crew hasn’t paused swaps', () => {
		expect(swap.acceptSwap(camp({ is_booking_active: false }).app, 'ask', 'bo').reason).toBe(
			'closed'
		);
		expect(swap.acceptSwap(camp({ swaps_off: true }).app, 'ask', 'bo').reason).toBe('closed');
		// an armed closing time that has passed counts like Closed (lib/phase.js)
		expect(swap.acceptSwap(camp({ booking_close_at: inDays(-1) }).app, 'ask', 'bo').reason).toBe(
			'closed'
		);
	});

	it('not when a spot changed hands meanwhile (which ends the request)', () => {
		const c = camp();
		c.bedOf('b2').order = 'someone';
		expect(swap.acceptSwap(c.app, 'ask', 'bo').reason).toBe('moved');
		expect(c.req('ask')).toMatchObject({ status: 'void', ended: 'moved' });
		expect(c.bedOf('b1').order).toBe('ada');
	});

	it('not for a spot that can’t be swapped — and the request stays as it is', () => {
		const cases: [string, (c: ReturnType<typeof camp>) => void][] = [
			['locked', (c) => (c.bedOf('b2').is_locked = true)],
			['special', (c) => (c.bedOf('b1').is_special = true)],
			['deactivated', (c) => (c.bedOf('b2').enabled = false)],
			['checked in', (c) => (c.bedOf('b1').checked_in_at = '2026-10-29 18:00:00.000Z')],
			[
				'crew-picked',
				(c) =>
					c.tables.special_requests.push({ id: 'sr', order: 'bo', status: 'approved', bed: 'b2' })
			]
		];
		for (const [name, setUp] of cases) {
			const c = camp();
			setUp(c);
			expect(swap.acceptSwap(c.app, 'ask', 'bo'), name).toEqual({ ok: false, reason: 'fixed' });
			expect(c.req('ask').status, name).toBe('pending');
			expect(c.bedOf('b1').order, name).toBe('ada');
		}
	});
});
