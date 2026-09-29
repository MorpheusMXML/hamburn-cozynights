// tests/live-stats.test.ts — the numbers the control center shows live, the
// snapshot cache behind /admin/api/stats, and the rules the poller follows.
import { describe, it, expect, beforeEach } from 'vitest';
import {
	deriveLiveStats,
	failingAlertsFilter,
	lastBooking,
	lastCheckIn,
	liveStatsSnapshot,
	opsSnapshot,
	readOpsStats,
	resetStatsCache,
	spotActivity,
	toMinute,
	OPS_TTL_MS,
	SNAPSHOT_TTL_MS
} from '../src/lib/server/stats';
import { nextDelayMs, statusFor, POLL_INTERVAL_MS } from '../src/lib/live-stats';
import { GET as statsEndpoint } from '../src/routes/admin/api/stats/+server';
import { relativeTime } from '../src/lib/time';

const houses = [
	{ id: 'h1', name: 'Neon Cave' },
	{ id: 'h2', name: 'Disco Barn' },
	{ id: 'h3', name: 'Empty Dome' }
];
const rooms = [
	{ id: 'r1', house: 'h1' },
	{ id: 'r2', house: 'h2' }
];
/** h1: one booked, one free, one locked, one ♿, one switched off. h2: full. h3: no rooms. */
const beds = [
	{
		id: 'b1',
		room: 'r1',
		enabled: true,
		occupied: true,
		is_locked: false,
		order: 'o1',
		booked_at: '2026-09-21 08:00:30.000Z',
		checked_in_at: '2026-09-21 09:15:00.000Z'
	},
	{ id: 'b2', room: 'r1', enabled: true, occupied: false, is_locked: false },
	{ id: 'b3', room: 'r1', enabled: true, occupied: false, is_locked: true },
	{ id: 'b4', room: 'r1', enabled: true, occupied: false, is_locked: false, is_special: true },
	{ id: 'b5', room: 'r1', enabled: false, occupied: false, is_locked: false },
	{
		id: 'b6',
		room: 'r2',
		enabled: true,
		occupied: true,
		is_locked: false,
		order: 'o2',
		booked_at: '2026-09-20 18:00:00.000Z'
	}
];
const minute = (iso: string) => Math.floor(Date.parse(iso) / 60000);

describe('deriveLiveStats', () => {
	it('counts every spot state and puts each house in one state', () => {
		const stats = deriveLiveStats(houses, rooms, beds);
		expect(stats.spots).toMatchObject({
			total: 5,
			occupied: 2,
			free: 1,
			booked: 2,
			checkedIn: 1,
			locked: 1,
			special: 1,
			deactivated: 1
		});
		// The four slices of the ring add up to the active spots exactly.
		const { occupied, free, locked, special, total } = stats.spots;
		expect(occupied + free + locked + special).toBe(total);
		expect(stats.houseStates).toEqual({ unconfigured: 1, open: 0, filling: 1, full: 1 });
	});

	it('keeps the per-house numbers, names and stamps the panel filters by', () => {
		const stats = deriveLiveStats(houses, rooms, beds);
		expect(stats.houses).toEqual([
			{
				id: 'h1',
				name: 'Neon Cave',
				total: 4,
				occupied: 1,
				free: 1,
				checkedIn: 1,
				booked: 1,
				locked: 1,
				special: 1,
				deactivated: 1,
				state: 'filling',
				bookedAt: [minute('2026-09-21T08:00:30Z')],
				checkedInAt: [minute('2026-09-21T09:15:00Z')]
			},
			{
				id: 'h2',
				name: 'Disco Barn',
				total: 1,
				occupied: 1,
				free: 0,
				checkedIn: 0,
				booked: 1,
				locked: 0,
				special: 0,
				deactivated: 0,
				state: 'full',
				bookedAt: [minute('2026-09-20T18:00:00Z')],
				checkedInAt: []
			},
			{
				id: 'h3',
				name: 'Empty Dome',
				total: 0,
				occupied: 0,
				free: 0,
				checkedIn: 0,
				booked: 0,
				locked: 0,
				special: 0,
				deactivated: 0,
				state: 'unconfigured',
				bookedAt: [],
				checkedInAt: []
			}
		]);
	});

	it('counts each ticket with a spot once and knows the latest booking and check-in', () => {
		const stats = deriveLiveStats(houses, rooms, beds);
		expect(stats.ticketsWithSpot).toBe(2);
		expect(stats.lastBookingAt).toBe('2026-09-21 08:00:30.000Z');
		expect(stats.lastCheckInAt).toBe('2026-09-21 09:15:00.000Z');
	});

	it('ignores spots whose room belongs to no house', () => {
		const orphan = [
			...beds,
			{ id: 'b9', room: 'gone', enabled: true, occupied: true, is_locked: false }
		];
		const stats = deriveLiveStats(houses, rooms, orphan);
		expect(stats.houses.reduce((sum, house) => sum + house.total, 0)).toBe(5);
		// The camp total still sees it: a spot in a lost room is a sanity warning,
		// not a reason for the ring to disagree with the database.
		expect(stats.spots.total).toBe(6);
	});

	it('sends no guest data: names, tickets and addresses stay on the server', () => {
		const stats = deriveLiveStats(houses, rooms, beds);
		const wire = JSON.stringify(stats);
		expect(wire).not.toContain('o1');
		expect(wire).not.toContain('b1');
		expect(wire).not.toContain('@');
	});
});

describe('spotActivity', () => {
	it('keeps the minute of every booking and check-in, oldest first', () => {
		const activity = spotActivity([
			{ ...beds[0], booked_at: '2026-09-21 10:00:00.000Z' },
			{ ...beds[5], booked_at: '2026-09-21 07:00:00.000Z' }
		]);
		expect(activity.bookedAt).toEqual([
			minute('2026-09-21T07:00:00Z'),
			minute('2026-09-21T10:00:00Z')
		]);
		expect(activity.checkedInAt).toEqual([minute('2026-09-21T09:15:00Z')]);
	});

	it('leaves out released spots, switched-off spots and broken stamps', () => {
		const activity = spotActivity([
			{ ...beds[0], order: '' },
			{ ...beds[0], enabled: false },
			{ ...beds[5], booked_at: 'not a date' }
		]);
		expect(activity).toEqual({ bookedAt: [], checkedInAt: [] });
	});

	it('reads PocketBase dates with a space and ISO dates alike', () => {
		expect(toMinute('2026-09-21 09:00:59.999Z')).toBe(minute('2026-09-21T09:00:00Z'));
		expect(toMinute('2026-09-21T09:00:00Z')).toBe(minute('2026-09-21T09:00:00Z'));
		expect(toMinute('')).toBeNull();
		expect(toMinute(undefined)).toBeNull();
	});
});

describe('lastBooking and lastCheckIn', () => {
	const spot = (id: string, order: string, booked_at: string, checked_in_at = '') => ({
		id,
		room: 'r1',
		enabled: true,
		occupied: !!order,
		is_locked: false,
		order,
		booked_at,
		checked_in_at
	});

	it('are the newest stamps that still carry a ticket', () => {
		const list = [
			spot('a', 'o', '2026-09-19 10:00:00.000Z', '2026-09-20 10:00:00.000Z'),
			spot('b', 'o', '2026-09-21 09:00:00.000Z'),
			spot('c', '', '2026-09-22 09:00:00.000Z', '2026-09-22 10:00:00.000Z')
		];
		expect(lastBooking(list)).toBe('2026-09-21 09:00:00.000Z');
		expect(lastCheckIn(list)).toBe('2026-09-20 10:00:00.000Z');
	});

	it('are null while nothing is booked or checked in', () => {
		expect(lastBooking([])).toBeNull();
		expect(lastCheckIn([spot('a', 'o', '2026-09-19 10:00:00.000Z')])).toBeNull();
	});
});

/**
 * PocketBase stand-in for the camp-wide counts: `getList` answers the number
 * of records the filter selects, from plain arrays.
 */
function opsPb(
	options: {
		broken?: string[];
		reads?: { ops: number };
		alerts?: Record<string, unknown>[];
	} = {}
) {
	const data: Record<string, Record<string, unknown>[]> = {
		orders: [
			{ id: 'o1', email: 'a@example.org' },
			{ id: 'o2', email: '' },
			{ id: 'o3', email: 'c@example.org' }
		],
		guest_notify: [
			{ id: 'n1', due: '', attempts: 0, tg_chat: '42', mail_sent: '2026-09-20 10:00:00.000Z' },
			{ id: 'n2', due: '2026-09-21 10:00:00.000Z', attempts: 0, tg_chat: '', mail_sent: '' },
			{ id: 'n3', due: '2026-09-21 10:05:00.000Z', attempts: 2, tg_chat: '', mail_sent: '' },
			{ id: 'n4', due: '', attempts: 8, tg_chat: '', mail_sent: '' }
		],
		special_requests: [
			{ id: 's1', status: 'pending' },
			{ id: 's2', status: 'pending' },
			{ id: 's3', status: 'approved' }
		],
		admins: [
			{ id: 'a1', role: 'superuser' },
			{ id: 'a2', role: 'admin' },
			{ id: 'a3', role: 'admin' },
			{ id: 'a4', role: 'pending' }
		],
		// e2 failed before the last alert got through (history), e4 after it.
		admin_events: options.alerts ?? [
			{ id: 'e1', alert_status: 'sent', updated: '2026-09-21 12:00:00.000Z' },
			{ id: 'e2', alert_status: 'failed', updated: '2026-09-21 10:00:00.000Z' },
			{ id: 'e3', alert_status: 'pending', updated: '2026-09-21 11:00:00.000Z' },
			{ id: 'e4', alert_status: 'failed', updated: '2026-09-21 13:00:00.000Z' }
		]
	};
	// The filters readOpsStats sends, and which records each one selects.
	const FILTERS: Record<string, (record: Record<string, unknown>) => boolean> = {
		"email != ''": (r) => r.email !== '',
		"tg_chat != ''": (r) => r.tg_chat !== '',
		"mail_sent != ''": (r) => r.mail_sent !== '',
		"due != ''": (r) => r.due !== '',
		"due != '' && attempts > 0": (r) => r.due !== '' && Number(r.attempts) > 0,
		"due = '' && attempts > 0": (r) => r.due === '' && Number(r.attempts) > 0,
		"alert_status = 'pending'": (r) => r.alert_status === 'pending',
		"alert_status = 'failed'": (r) => r.alert_status === 'failed',
		"alert_status = 'sent'": (r) => r.alert_status === 'sent'
	};
	/** `alert_status = 'failed' && updated > "<stamp>"`, as failingAlertsFilter builds it. */
	const matcher = (filter: string) => {
		const since = /^alert_status = 'failed' && updated > "(.+)"$/.exec(filter)?.[1];
		if (since)
			return (r: Record<string, unknown>) =>
				r.alert_status === 'failed' && String(r.updated) > since;
		return FILTERS[filter];
	};
	return {
		collection: (name: string) => {
			const fail = () => {
				throw Object.assign(new Error(`missing collection ${name}`), { status: 404 });
			};
			return {
				getList: async (
					_page: number,
					perPage: number,
					query: { filter?: string; sort?: string } = {}
				) => {
					if (options.broken?.includes(name)) fail();
					if (options.reads && name === 'orders' && !query.filter) options.reads.ops++;
					const match = query.filter ? matcher(query.filter) : () => true;
					if (!match) throw new Error(`unexpected filter ${query.filter}`);
					const records = (data[name] ?? []).filter(match);
					if (query.sort === '-updated') {
						records.sort((a, b) => String(b.updated).localeCompare(String(a.updated)));
					}
					return { totalItems: records.length, items: records.slice(0, perPage) };
				},
				getFullList: async () => {
					if (options.broken?.includes(name)) fail();
					if (name === 'houses') return houses;
					if (name === 'rooms') return rooms;
					if (name === 'beds') return beds;
					return data[name] ?? [];
				},
				getOne: async () => {
					if (options.broken?.includes(name)) fail();
					if (name !== 'app_settings') fail();
					return { notify_mail: true, telegram_bot: '' };
				}
			};
		}
	} as never;
}

describe('the camp-wide counts', () => {
	beforeEach(() => resetStatsCache());

	it('counts tickets, messages, requests and the crew', async () => {
		const ops = await readOpsStats(opsPb());
		expect(ops).toEqual({
			tickets: { total: 3, withEmail: 2, telegram: 1, mailed: 1 },
			requests: { pending: 2, approved: 1, declined: 0 },
			messages: { mailOn: true, telegramOn: false, queued: 2, retrying: 1, failed: 1 },
			crew: { admins: 3, accessRequests: 1, alertsQueued: 1, alertsFailed: 2, alertsFailing: 1 }
		});
	});

	it('shows what it could read when one collection is missing', async () => {
		const ops = await readOpsStats(opsPb({ broken: ['guest_notify', 'admins'] }));
		expect(ops.tickets.total).toBe(3);
		expect(ops.tickets.telegram).toBeNull();
		expect(ops.messages).toMatchObject({ queued: null, retrying: null, failed: null });
		expect(ops.crew).toMatchObject({ admins: null, accessRequests: null, alertsFailed: 2 });
	});

	it('stops calling crew alerts failing once one got through after them', async () => {
		const back = await readOpsStats(
			opsPb({
				alerts: [
					{ id: 'f1', alert_status: 'failed', updated: '2026-09-21 16:00:00.000Z' },
					{ id: 'f2', alert_status: 'failed', updated: '2026-09-21 17:00:00.000Z' },
					{ id: 's1', alert_status: 'sent', updated: '2026-09-21 20:40:00.000Z' }
				]
			})
		);
		expect(back.crew).toMatchObject({ alertsFailed: 2, alertsFailing: 0 });
		const never = await readOpsStats(
			opsPb({ alerts: [{ id: 'f1', alert_status: 'failed', updated: '2026-09-21 16:00:00.000Z' }] })
		);
		// No alert ever reached the chat: every failure still counts.
		expect(never.crew).toMatchObject({ alertsFailed: 1, alertsFailing: 1 });
	});

	it('builds the failing-alerts filter from a PocketBase date only', () => {
		expect(failingAlertsFilter(null)).toBe("alert_status = 'failed'");
		expect(failingAlertsFilter('2026-09-21 20:40:00.123Z')).toBe(
			'alert_status = \'failed\' && updated > "2026-09-21 20:40:00.123Z"'
		);
		expect(() => failingAlertsFilter('" || id != "')).toThrow();
	});

	it('never throws, even when nothing can be read', async () => {
		const broken = ['orders', 'guest_notify', 'special_requests', 'admins', 'admin_events'];
		const ops = await readOpsStats(opsPb({ broken: [...broken, 'app_settings'] }));
		expect(ops.tickets.total).toBeNull();
		expect(ops.messages.mailOn).toBe(false);
	});

	it('asks PocketBase at most once per OPS_TTL_MS', async () => {
		const reads = { ops: 0 };
		const pb = opsPb({ reads });
		await Promise.all([opsSnapshot(pb, 1000), opsSnapshot(pb, 1000)]);
		await opsSnapshot(pb, 1000 + OPS_TTL_MS - 1);
		expect(reads.ops).toBe(1);
		await opsSnapshot(pb, 1000 + OPS_TTL_MS);
		expect(reads.ops).toBe(2);
	});
});

describe('the shared snapshot', () => {
	function pb(counter: { reads: number }, extraBed = false) {
		const ops = opsPb() as unknown as { collection: (name: string) => object };
		return {
			collection: (name: string) => {
				const base = ops.collection(name);
				if (name !== 'beds') return base;
				return {
					...base,
					getFullList: async () => {
						counter.reads++;
						return extraBed
							? [
									...beds,
									{ id: 'b7', room: 'r2', enabled: true, occupied: false, is_locked: false }
								]
							: beds;
					}
				};
			}
		} as never;
	}

	beforeEach(() => resetStatsCache());

	it('reads PocketBase once for ten admins polling at the same time', async () => {
		const counter = { reads: 0 };
		const answers = await Promise.all(
			Array.from({ length: 10 }, () => liveStatsSnapshot(pb(counter), 1000))
		);
		expect(counter.reads).toBe(1);
		expect(new Set(answers.map((answer) => answer.etag)).size).toBe(1);
	});

	it('serves the cached snapshot until the TTL is over', async () => {
		const counter = { reads: 0 };
		await liveStatsSnapshot(pb(counter), 1000);
		await liveStatsSnapshot(pb(counter), 1000 + SNAPSHOT_TTL_MS - 1);
		expect(counter.reads).toBe(1);
		await liveStatsSnapshot(pb(counter), 1000 + SNAPSHOT_TTL_MS);
		expect(counter.reads).toBe(2);
	});

	it('keeps the ETag and the change time while the numbers stand still', async () => {
		const counter = { reads: 0 };
		const first = await liveStatsSnapshot(pb(counter), 1000);
		const second = await liveStatsSnapshot(pb(counter), 1000 + SNAPSHOT_TTL_MS);
		expect(second.etag).toBe(first.etag);
		expect(second.stats.changedAt).toBe(first.stats.changedAt);
	});

	it('moves the ETag and the change time as soon as a spot changes', async () => {
		const counter = { reads: 0 };
		const before = await liveStatsSnapshot(pb(counter), 1000);
		const after = await liveStatsSnapshot(pb(counter, true), 1000 + SNAPSHOT_TTL_MS);
		expect(after.etag).not.toBe(before.etag);
		expect(after.stats.changedAt).not.toBe(before.stats.changedAt);
		expect(after.stats.spots.free).toBe(before.stats.spots.free + 1);
	});

	it('carries the camp-wide counts next to the spots', async () => {
		const { stats } = await liveStatsSnapshot(pb({ reads: 0 }), 1000);
		expect(stats.ops?.tickets.total).toBe(3);
		expect(stats.ops?.requests.pending).toBe(2);
	});
});

describe('the poller rules', () => {
	it('keeps a steady interval while the server answers', () => {
		expect(nextDelayMs(0)).toBe(POLL_INTERVAL_MS);
	});

	it('backs off after errors and stops at a minute', () => {
		expect(nextDelayMs(1)).toBe(10000);
		expect(nextDelayMs(2)).toBe(20000);
		expect(nextDelayMs(3)).toBe(40000);
		expect(nextDelayMs(4)).toBe(60000);
		expect(nextDelayMs(99)).toBe(60000);
	});

	it('calls the numbers stale before it calls them offline', () => {
		const now = 100_000;
		expect(statusFor({ checkedAt: null, failures: 0 }, now)).toBe('idle');
		expect(statusFor({ checkedAt: now - 1000, failures: 0 }, now)).toBe('live');
		expect(statusFor({ checkedAt: now - 30_000, failures: 1 }, now)).toBe('stale');
		expect(statusFor({ checkedAt: now - 30_000, failures: 3 }, now)).toBe('offline');
	});
});

describe('relativeTime', () => {
	const now = Date.parse('2026-09-21T12:00:00Z');
	const ago = (ms: number) => new Date(now - ms).toISOString();

	it('reads like a chip, not like a timestamp', () => {
		expect(relativeTime(ago(2000), now)).toBe('just now');
		expect(relativeTime(ago(12_000), now)).toBe('12 s ago');
		expect(relativeTime(ago(4 * 60_000), now)).toBe('4 min ago');
		expect(relativeTime(ago(2 * 3600_000), now)).toBe('2 h ago');
		expect(relativeTime(ago(26 * 3600_000), now)).toBe('yesterday');
		expect(relativeTime(ago(3 * 24 * 3600_000), now)).toBe('3 days ago');
	});

	it('survives a missing or broken stamp', () => {
		expect(relativeTime(null, now)).toBe('never');
		expect(relativeTime('not a date', now)).toBe('unknown');
		// A server clock a second ahead must not print "-1 s ago".
		expect(relativeTime(new Date(now + 1000).toISOString(), now)).toBe('just now');
	});
});

describe('GET /admin/api/stats', () => {
	const admin = {
		id: 'a1',
		email: 'crew@mauersegler.art',
		name: '',
		role: 'admin',
		isSuperuser: false
	};
	const adminPb = opsPb();
	const call = (locals: Record<string, unknown>, headers: Record<string, string> = {}) =>
		statsEndpoint({
			locals,
			request: new Request('http://localhost/admin/api/stats', { headers }),
			setHeaders: () => {}
		} as never);

	beforeEach(() => resetStatsCache());

	it('refuses a request without an admin session', async () => {
		await expect(call({ adminPb })).rejects.toMatchObject({ status: 403 });
	});

	it('refuses a signed-in account that is still waiting for approval', async () => {
		// hooks.server.ts sets only pendingAdmin for such an account, never admin.
		const pendingAdmin = { email: 'new@mauersegler.art', name: '' };
		await expect(call({ adminPb, admin: null, pendingAdmin })).rejects.toMatchObject({
			status: 403
		});
	});

	it('answers an admin with the numbers and an ETag', async () => {
		const response = await call({ admin, adminPb });
		expect(response.status).toBe(200);
		const etag = response.headers.get('etag');
		expect(etag).toMatch(/^"[\w-]+"$/);
		await expect(response.json()).resolves.toMatchObject({
			spots: { total: 5, occupied: 2 },
			ops: { tickets: { total: 3 } }
		});
	});

	it('answers 304 without a body while nothing changed', async () => {
		const first = await call({ admin, adminPb });
		const etag = first.headers.get('etag') as string;
		const second = await call({ admin, adminPb }, { 'if-none-match': etag });
		expect(second.status).toBe(304);
		expect(await second.text()).toBe('');
	});

	it('says 503 instead of crashing when the database is unreachable', async () => {
		const broken = {
			collection: () => ({
				getFullList: async () => {
					throw new Error('connection refused');
				},
				getList: async () => {
					throw new Error('connection refused');
				},
				getOne: async () => {
					throw new Error('connection refused');
				}
			})
		};
		await expect(call({ admin, adminPb: broken })).rejects.toMatchObject({ status: 503 });
	});
});
