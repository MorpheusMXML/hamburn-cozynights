// tests/intel.test.ts — what the Intel panel does with the live numbers in the
// browser: time buckets in Berlin time, one house or the whole camp, the house
// table, and the list of what needs the crew.
import { describe, it, expect } from 'vitest';
import {
	activityBuckets,
	attentionItems,
	berlinDayOf,
	countSince,
	formatCount,
	houseRows,
	loadOf,
	scopedSpots,
	searchable,
	ticketsWithoutSpot,
	waitingOf,
	MAX_DAILY_BARS
} from '../src/lib/intel';
import type { HouseLiveStats, LiveStats, OpsStats } from '../src/lib/live-stats';

const minute = (iso: string) => Math.floor(Date.parse(iso) / 60000);
const stamps = (bookedAt: string[], checkedInAt: string[] = []) => ({
	bookedAt: bookedAt.map(minute),
	checkedInAt: checkedInAt.map(minute)
});

describe('activityBuckets: the last 24 hours', () => {
	// 21 Sep 2026, 12:20 in Berlin (CEST, UTC+2).
	const now = Date.parse('2026-09-21T10:20:00Z');

	it('has one bar per hour, the current Berlin hour last', () => {
		const buckets = activityBuckets([], '24h', now);
		expect(buckets).toHaveLength(24);
		expect(buckets[23]).toMatchObject({ label: '12', current: true, unit: 'hour' });
		expect(buckets[23].detail).toBe('Mon 21 Sep, 12:00–13:00');
		expect(buckets[0]).toMatchObject({ label: '13', current: false });
		expect(buckets[0].detail).toBe('Sun 20 Sep, 13:00–14:00');
	});

	it('puts every stamp into its hour and leaves older ones out', () => {
		const buckets = activityBuckets(
			[
				stamps(
					['2026-09-21T10:05:00Z', '2026-09-21T09:59:00Z', '2026-09-20T11:00:00Z'],
					['2026-09-21T10:19:00Z']
				),
				// older than 24 hours: not in the chart
				stamps(['2026-09-20T10:59:00Z'])
			],
			'24h',
			now
		);
		expect(buckets[23]).toMatchObject({ booked: 1, checkedIn: 1 });
		expect(buckets[22]).toMatchObject({ booked: 1, checkedIn: 0 });
		expect(buckets[0]).toMatchObject({ booked: 1 });
		expect(buckets.reduce((sum, bucket) => sum + bucket.booked, 0)).toBe(3);
	});

	it('counts a stamp from a clock slightly ahead as now, not as never', () => {
		const buckets = activityBuckets([stamps(['2026-09-21T11:05:00Z'])], '24h', now);
		expect(buckets[23].booked).toBe(1);
		const farAhead = activityBuckets([stamps(['2026-09-22T11:05:00Z'])], '24h', now);
		expect(farAhead.every((bucket) => bucket.booked === 0)).toBe(true);
	});

	it('names the doubled hour when the clocks go back', () => {
		// 25 Oct 2026: 03:00 CEST becomes 02:00 CET, so 02:00 comes twice.
		const buckets = activityBuckets([], '24h', Date.parse('2026-10-25T12:00:00Z'));
		const labels = buckets.map((bucket) => bucket.label);
		expect(labels.filter((label) => label === '02')).toHaveLength(2);
		expect(labels.at(-1)).toBe('13');
	});
});

describe('activityBuckets: days', () => {
	const now = Date.parse('2026-09-21T10:00:00Z');

	it('has seven days, oldest first, today last', () => {
		const buckets = activityBuckets([], '7d', now);
		expect(buckets.map((bucket) => bucket.label)).toEqual([
			'Tue',
			'Wed',
			'Thu',
			'Fri',
			'Sat',
			'Sun',
			'Mon'
		]);
		expect(buckets[6]).toMatchObject({ detail: 'Mon 21 Sep', current: true, unit: 'day' });
	});

	it('buckets by Berlin day, not by UTC day', () => {
		// 22:30 UTC on the 20th is 00:30 Berlin on the 21st: today, not yesterday.
		const buckets = activityBuckets([stamps(['2026-09-20T22:30:00Z'])], '7d', now);
		expect(buckets[6].booked).toBe(1);
		expect(buckets[5].booked).toBe(0);
	});

	it('skips no day around a 23-hour day (clocks go forward)', () => {
		// 29 Mar 2027, 00:30 CEST: yesterday (the 28th) had only 23 hours.
		const buckets = activityBuckets([], '7d', Date.parse('2027-03-28T22:30:00Z'));
		expect(buckets.map((bucket) => bucket.detail)).toEqual([
			'Tue 23 Mar',
			'Wed 24 Mar',
			'Thu 25 Mar',
			'Fri 26 Mar',
			'Sat 27 Mar',
			'Sun 28 Mar',
			'Mon 29 Mar'
		]);
	});

	it('starts "All" at the first stamp, and at least a week back', () => {
		const quiet = activityBuckets([], 'all', now);
		expect(quiet).toHaveLength(7);
		const buckets = activityBuckets(
			[stamps(['2026-09-01T10:00:00Z', '2026-09-21T09:00:00Z'], ['2026-09-21T09:30:00Z'])],
			'all',
			now
		);
		expect(buckets).toHaveLength(21);
		expect(buckets[0]).toMatchObject({ label: '1 Sep', booked: 1 });
		expect(buckets[20]).toMatchObject({ label: '21 Sep', booked: 1, checkedIn: 1, current: true });
	});

	it('goes by week once "All" would be too many bars', () => {
		const first = '2026-05-01T10:00:00Z';
		const buckets = activityBuckets([stamps([first])], 'all', now);
		const days = berlinDayOf(now) - berlinDayOf(Date.parse(first)) + 1;
		expect(days).toBeGreaterThan(MAX_DAILY_BARS);
		expect(buckets).toHaveLength(Math.ceil(days / 7));
		expect(buckets[0]).toMatchObject({ unit: 'week', booked: 1, detail: '1 May – 7 May' });
		expect(buckets.at(-1)?.current).toBe(true);
	});

	it('counts the pace of the last hour', () => {
		const list = stamps(['2026-09-21T09:30:00Z', '2026-09-21T08:30:00Z']).bookedAt;
		expect(countSince(list, now, 60)).toBe(1);
		expect(countSince(list, now, 120)).toBe(2);
	});
});

function house(overrides: Partial<HouseLiveStats> & { id: string; name: string }): HouseLiveStats {
	return {
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
		checkedInAt: [],
		...overrides
	};
}

const HOUSES = [
	house({
		id: 'h10',
		name: 'House 10',
		total: 4,
		occupied: 4,
		booked: 4,
		checkedIn: 1,
		state: 'full'
	}),
	house({ id: 'h2', name: 'House 2', total: 4, occupied: 2, free: 2, booked: 2, state: 'filling' }),
	house({
		id: 'hw',
		name: 'Waldhütte',
		total: 8,
		occupied: 4,
		free: 3,
		booked: 3,
		locked: 1,
		state: 'filling'
	}),
	house({ id: 'he', name: 'Empty Dome', total: 2, free: 1, special: 1, state: 'open' }),
	house({ id: 'hn', name: 'Not Ready' })
];

describe('the house table', () => {
	it('sorts by name with numbers in their natural order', () => {
		expect(houseRows(HOUSES).map((row) => row.house.name)).toEqual([
			'Empty Dome',
			'House 2',
			'House 10',
			'Not Ready',
			'Waldhütte'
		]);
	});

	it('finds a house without its accents', () => {
		expect(houseRows(HOUSES, { search: 'hutte' }).map((row) => row.house.id)).toEqual(['hw']);
		expect(houseRows(HOUSES, { search: 'HOUSE' })).toHaveLength(2);
		expect(searchable('Kuschelzeltplatzverwaltungsgebäude')).toContain('gebaude');
	});

	it('shows only the houses in the chosen state', () => {
		expect(houseRows(HOUSES, { state: 'filling' }).map((row) => row.house.id)).toEqual([
			'h2',
			'hw'
		]);
	});

	it('puts the fullest first, equally full ones with more taken spots before', () => {
		// House 2 and Waldhütte are both half full; Waldhütte has more guests.
		expect(houseRows(HOUSES, { sort: 'load' }).map((row) => row.house.id)).toEqual([
			'h10',
			'hw',
			'h2',
			'he',
			'hn'
		]);
	});

	it('sorts by free spots and by guests still to check in', () => {
		expect(houseRows(HOUSES, { sort: 'free' })[0].house.id).toBe('hw');
		const waiting = houseRows(HOUSES, { sort: 'waiting' });
		expect(waiting.map((row) => [row.house.id, row.waiting]).slice(0, 3)).toEqual([
			['h10', 3],
			['hw', 3],
			['h2', 2]
		]);
	});
});

const ops = (
	overrides: Partial<{ [K in keyof OpsStats]: Partial<OpsStats[K]> }> = {}
): OpsStats => ({
	tickets: { total: 10, withEmail: 10, telegram: 0, mailed: 0, ...overrides.tickets },
	requests: { pending: 0, approved: 0, declined: 0, ...overrides.requests },
	messages: {
		mailOn: true,
		telegramOn: false,
		queued: 0,
		retrying: 0,
		failed: 0,
		...overrides.messages
	},
	crew: {
		admins: 2,
		accessRequests: 0,
		alertsQueued: 0,
		alertsFailed: 0,
		alertsFailing: 0,
		...overrides.crew
	}
});

function camp(overrides: Partial<LiveStats> = {}): LiveStats {
	return {
		changedAt: '2026-09-21T10:00:00.000Z',
		spots: {
			total: 10,
			occupied: 10,
			free: 0,
			checkedIn: 0,
			booked: 10,
			locked: 0,
			special: 0,
			deactivated: 0
		},
		houseStates: { unconfigured: 0, open: 0, filling: 0, full: 1 },
		houses: [],
		ticketsWithSpot: 10,
		lastBookingAt: null,
		lastCheckInAt: null,
		ops: ops(),
		...overrides
	};
}

describe('what needs attention', () => {
	it('is empty when all is well', () => {
		expect(attentionItems(camp(), 'live')).toEqual([]);
	});

	it('names failures first, then what waits, then what is worth knowing', () => {
		const items = attentionItems(
			camp({
				ticketsWithSpot: 7,
				houseStates: { unconfigured: 1, open: 0, filling: 0, full: 1 },
				ops: ops({
					messages: { failed: 2, retrying: 1 },
					requests: { pending: 3 },
					crew: { alertsFailed: 1, alertsFailing: 1, accessRequests: 1 }
				})
			}),
			'live'
		);
		expect(items.map((item) => [item.key, item.tone])).toEqual([
			['messages-failed', 'danger'],
			['alerts-failed', 'danger'],
			['requests-pending', 'warning'],
			['access-requests', 'warning'],
			['messages-retrying', 'warning'],
			['houses-unconfigured', 'info'],
			['tickets-to-book', 'info']
		]);
		expect(items[2].text).toBe('3 special-needs requests wait for a decision.');
		expect(items[6].text).toBe('3 tickets have no spot yet.');
	});

	it('warns about crew alerts only while none got through since', () => {
		const history = camp({ ops: ops({ crew: { alertsFailed: 10, alertsFailing: 0 } }) });
		expect(attentionItems(history, 'live')).toEqual([]);
		const stuck = camp({ ops: ops({ crew: { alertsFailed: 10, alertsFailing: 2 } }) });
		expect(attentionItems(stuck, 'live')).toEqual([
			expect.objectContaining({
				key: 'alerts-failed',
				tone: 'danger',
				text: '2 crew alerts never reached the crew chat, and none got through since.'
			})
		]);
	});

	it('treats a ticket without a spot as normal while booking is live, not once it closed', () => {
		const stats = camp({ ticketsWithSpot: 9 });
		expect(attentionItems(stats, 'live')[0]).toMatchObject({
			key: 'tickets-to-book',
			tone: 'info'
		});
		expect(attentionItems(stats, 'closed')[0]).toMatchObject({
			key: 'tickets-without-spot',
			tone: 'warning',
			text: '1 ticket has no spot, and booking is closed.'
		});
		expect(attentionItems(stats, 'staging')).toEqual([]);
	});

	it('counts guests still to arrive only once check-in has started', () => {
		const booked = camp().spots;
		expect(attentionItems(camp(), 'closed')).toEqual([]);
		const items = attentionItems(camp({ spots: { ...booked, checkedIn: 4 } }), 'closed');
		expect(items).toEqual([
			expect.objectContaining({
				key: 'arrivals-waiting',
				text: '6 booked guests are not checked in yet.'
			})
		]);
	});

	it('warns about houses without spots in Staging, where they can still be fixed', () => {
		const stats = camp({ houseStates: { unconfigured: 2, open: 0, filling: 0, full: 1 } });
		expect(attentionItems(stats, 'staging')[0]).toMatchObject({ tone: 'warning' });
		expect(attentionItems(stats, 'closed')[0]).toMatchObject({ tone: 'info' });
	});

	it('mentions tickets without an address only when e-mail is on', () => {
		const stats = camp({ ops: ops({ tickets: { withEmail: 8 } }) });
		expect(attentionItems(stats, 'staging')[0]).toMatchObject({ key: 'tickets-no-email' });
		const mailOff = camp({ ops: ops({ tickets: { withEmail: 8 }, messages: { mailOn: false } }) });
		expect(attentionItems(mailOff, 'staging')).toEqual([]);
	});

	it('stays quiet about numbers it could not read', () => {
		const unknown = camp({
			ops: ops({ messages: { failed: null, retrying: null }, tickets: { total: null } })
		});
		expect(attentionItems(unknown, 'closed')).toEqual([]);
		expect(attentionItems(camp({ ops: null }), 'closed')).toEqual([]);
	});
});

describe('the small numbers', () => {
	it('scopes to one house, or to nothing for a house that is gone', () => {
		const stats = camp({ houses: HOUSES });
		expect(scopedSpots(stats, null)).toBe(stats.spots);
		expect(scopedSpots(stats, 'hw')).toMatchObject({ total: 8, occupied: 4, locked: 1 });
		expect(scopedSpots(stats, 'gone')).toMatchObject({ total: 0, occupied: 0 });
	});

	it('rounds the load and never counts a negative', () => {
		expect(loadOf({ total: 3, occupied: 1 })).toBe(33);
		expect(loadOf({ total: 0, occupied: 0 })).toBe(0);
		expect(waitingOf({ booked: 2, checkedIn: 3 })).toBe(0);
		expect(ticketsWithoutSpot({ ticketsWithSpot: 12, ops: ops() })).toBe(0);
		expect(ticketsWithoutSpot({ ticketsWithSpot: 1, ops: null })).toBe(0);
	});

	it('prints a dash for a number it does not know', () => {
		expect(formatCount(1234)).toBe('1,234');
		expect(formatCount(0)).toBe('0');
		expect(formatCount(null)).toBe('—');
	});
});
