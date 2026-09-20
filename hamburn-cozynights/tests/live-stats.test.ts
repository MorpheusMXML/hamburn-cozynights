// tests/live-stats.test.ts — the numbers the control center shows live, the
// snapshot cache behind /admin/api/stats, and the rules the poller follows.
import { describe, it, expect, beforeEach } from 'vitest';
import {
	bookingTrend,
	deriveLiveStats,
	lastBooking,
	liveStatsSnapshot,
	resetStatsCache,
	SNAPSHOT_TTL_MS
} from '../src/lib/server/stats';
import { nextDelayMs, statusFor, POLL_INTERVAL_MS } from '../src/lib/live-stats';
import { GET as statsEndpoint } from '../src/routes/admin/api/stats/+server';
import { relativeTime } from '../src/lib/time';

const houses = [{ id: 'h1' }, { id: 'h2' }, { id: 'h3' }];
const rooms = [
	{ id: 'r1', house: 'h1' },
	{ id: 'r2', house: 'h2' }
];
/** h1: one taken, one free, one locked, one ♿, one switched off. h2: full. h3: no rooms. */
const beds = [
	{ id: 'b1', room: 'r1', enabled: true, occupied: true, is_locked: false, order: 'o1' },
	{ id: 'b2', room: 'r1', enabled: true, occupied: false, is_locked: false },
	{ id: 'b3', room: 'r1', enabled: true, occupied: false, is_locked: true },
	{ id: 'b4', room: 'r1', enabled: true, occupied: false, is_locked: false, is_special: true },
	{ id: 'b5', room: 'r1', enabled: false, occupied: false, is_locked: false },
	{ id: 'b6', room: 'r2', enabled: true, occupied: true, is_locked: false, order: 'o2' }
];

describe('deriveLiveStats', () => {
	it('counts every spot state and puts each house in one state', () => {
		const stats = deriveLiveStats(houses, rooms, beds);
		expect(stats.spots).toMatchObject({
			total: 5,
			occupied: 2,
			free: 1,
			locked: 1,
			special: 1,
			deactivated: 1
		});
		// The four slices of the ring add up to the active spots exactly.
		const { occupied, free, locked, special, total } = stats.spots;
		expect(occupied + free + locked + special).toBe(total);
		expect(stats.houseStates).toEqual({ unconfigured: 1, open: 0, filling: 1, full: 1 });
	});

	it('keeps the per-house numbers the cards show', () => {
		const stats = deriveLiveStats(houses, rooms, beds);
		expect(stats.houses).toEqual([
			{ id: 'h1', total: 4, occupied: 1, free: 1, checkedIn: 0, state: 'filling' },
			{ id: 'h2', total: 1, occupied: 1, free: 0, checkedIn: 0, state: 'full' },
			{ id: 'h3', total: 0, occupied: 0, free: 0, checkedIn: 0, state: 'unconfigured' }
		]);
	});

	it('ignores spots whose room belongs to no house', () => {
		const orphan = [...beds, { id: 'b9', room: 'gone', enabled: true, occupied: true, is_locked: false }];
		const stats = deriveLiveStats(houses, rooms, orphan);
		expect(stats.houses.reduce((sum, house) => sum + house.total, 0)).toBe(5);
		// The camp total still sees it: a spot in a lost room is a sanity warning,
		// not a reason for the ring to disagree with the database.
		expect(stats.spots.total).toBe(6);
	});
});

describe('bookingTrend', () => {
	const now = new Date('2026-09-21T10:00:00Z');
	const stamp = (iso: string) => ({
		id: iso,
		room: 'r1',
		enabled: true,
		occupied: true,
		is_locked: false,
		order: 'o',
		booked_at: iso
	});

	it('has one bucket per day, oldest first, today last', () => {
		const trend = bookingTrend([], now);
		expect(trend.values).toEqual([0, 0, 0, 0, 0, 0, 0]);
		expect(trend.labels).toHaveLength(7);
		expect(trend.labels[6]).toBe('Mon'); // 21 Sep 2026 is a Monday in Berlin
	});

	it('buckets by Berlin day, not by UTC day', () => {
		// 22:30 UTC on the 20th is 00:30 Berlin on the 21st: today, not yesterday.
		const trend = bookingTrend([stamp('2026-09-20T22:30:00Z')], now);
		expect(trend.values[6]).toBe(1);
		expect(trend.values[5]).toBe(0);
	});

	it('does not count a stamp without a ticket, or one older than a week', () => {
		const released = { ...stamp('2026-09-21T08:00:00Z'), order: '' };
		const ancient = stamp('2026-08-01T08:00:00Z');
		expect(bookingTrend([released, ancient], now).values).toEqual([0, 0, 0, 0, 0, 0, 0]);
	});
});

describe('lastBooking', () => {
	it('is the newest stamp that still carries a ticket', () => {
		expect(
			lastBooking([
				{
					id: 'a',
					room: 'r1',
					enabled: true,
					occupied: true,
					is_locked: false,
					order: 'o',
					booked_at: '2026-09-19 10:00:00.000Z'
				},
				{
					id: 'b',
					room: 'r1',
					enabled: true,
					occupied: true,
					is_locked: false,
					order: 'o',
					booked_at: '2026-09-21 09:00:00.000Z'
				},
				{
					id: 'c',
					room: 'r1',
					enabled: true,
					occupied: false,
					is_locked: false,
					order: '',
					booked_at: '2026-09-22 09:00:00.000Z'
				}
			])
		).toBe('2026-09-21 09:00:00.000Z');
	});

	it('is null while nothing is booked', () => {
		expect(lastBooking([])).toBeNull();
	});
});

describe('the shared snapshot', () => {
	function pb(counter: { reads: number }, extraBed = false) {
		return {
			collection: (name: string) => ({
				getFullList: async () => {
					if (name === 'beds') {
						counter.reads++;
						return extraBed
							? [
									...beds,
									{ id: 'b7', room: 'r2', enabled: true, occupied: false, is_locked: false }
								]
							: beds;
					}
					return name === 'houses' ? houses : rooms;
				}
			})
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
	const adminPb = {
		collection: (name: string) => ({
			getFullList: async () => (name === 'houses' ? houses : name === 'rooms' ? rooms : beds)
		})
	};
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

	it('answers an admin with the numbers and an ETag', async () => {
		const response = await call({ admin, adminPb });
		expect(response.status).toBe(200);
		const etag = response.headers.get('etag');
		expect(etag).toMatch(/^"[\w-]+"$/);
		await expect(response.json()).resolves.toMatchObject({ spots: { total: 5, occupied: 2 } });
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
				}
			})
		};
		await expect(call({ admin, adminPb: broken })).rejects.toMatchObject({ status: 503 });
	});
});
