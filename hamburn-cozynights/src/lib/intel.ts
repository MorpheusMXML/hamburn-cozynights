/**
 * What the Intel panel does with the live numbers in the browser: narrow them
 * to one house, bucket bookings and check-ins by hour or day, sort and filter
 * the house table, and list what waits for the crew.
 *
 * Pure functions on the snapshot ($lib/live-stats), so a click on a filter
 * costs no request and the unit tests can pin every number. Event time is
 * Europe/Berlin, like every time in the app.
 */
import { EVENT_TIME_ZONE } from '$lib/time';
import type { BookingPhase } from '$lib/booking-phase';
import type { HouseState, SpotCounts } from '$lib/occupancy';
import type { Count, HouseLiveStats, LiveStats } from '$lib/live-stats';

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

// ─── Time buckets ────────────────────────────────────────────────────────────

export type IntelRange = '24h' | '7d' | 'all';

export const RANGES: { key: IntelRange; label: string; title: string }[] = [
	{ key: '24h', label: '24 h', title: 'The last 24 hours, by hour' },
	{ key: '7d', label: '7 days', title: 'The last 7 days, by day' },
	{ key: 'all', label: 'All', title: 'Everything since the first booking' }
];

/** "All" goes by day up to this many days, by week beyond. */
export const MAX_DAILY_BARS = 45;

export interface ActivityBucket {
	/** What one bar covers. */
	unit: 'hour' | 'day' | 'week';
	/** Short label under the bar ("14", "Mon", "21 Sep"). */
	label: string;
	/** Readable span for the readout and the table ("Mon 21 Sep, 14:00–15:00"). */
	detail: string;
	booked: number;
	checkedIn: number;
	/** The bucket that contains now. */
	current: boolean;
}

const berlinWallClock = new Intl.DateTimeFormat('en-US', {
	timeZone: EVENT_TIME_ZONE,
	hourCycle: 'h23',
	year: 'numeric',
	month: 'numeric',
	day: 'numeric',
	hour: 'numeric'
});

// Berlin is a whole number of hours off UTC, so every UTC hour lies within one
// Berlin day and one Berlin hour: the lookup is cached per hour, and a camp
// with a thousand stamps formats only the few dozen hours they fall into.
const hourCache = new Map<number, { day: number; hour: number }>();

/** Berlin calendar day (days since 1970-01-01 of that wall date) and hour of a UTC hour index. */
function berlinOfHour(utcHour: number): { day: number; hour: number } {
	let hit = hourCache.get(utcHour);
	if (!hit) {
		const parts: Record<string, number> = {};
		for (const part of berlinWallClock.formatToParts(new Date(utcHour * HOUR_MS))) {
			if (part.type !== 'literal') parts[part.type] = Number(part.value);
		}
		hit = { day: Date.UTC(parts.year, parts.month - 1, parts.day) / DAY_MS, hour: parts.hour };
		if (hourCache.size > 5000) hourCache.clear();
		hourCache.set(utcHour, hit);
	}
	return hit;
}

/** The Berlin calendar day of an instant (ms), as a day number. */
export function berlinDayOf(ms: number): number {
	return berlinOfHour(Math.floor(ms / HOUR_MS)).day;
}

// A day number is a wall date, so it is formatted in UTC: no DST can shift it.
const dayFormat = new Intl.DateTimeFormat('en-GB', {
	timeZone: 'UTC',
	weekday: 'short',
	day: 'numeric',
	month: 'short'
});
const weekdayFormat = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'short' });
const dateFormat = new Intl.DateTimeFormat('en-GB', {
	timeZone: 'UTC',
	day: 'numeric',
	month: 'short'
});
const noon = (day: number) => new Date(day * DAY_MS + 12 * HOUR_MS);
/** "Mon 21 Sep" (en-GB writes "Mon 21 Sept"; the app says "Sep" everywhere). */
const dayLabel = (day: number) =>
	dayFormat.format(noon(day)).replace(',', '').replace('Sept', 'Sep');
const dateLabel = (day: number) => dateFormat.format(noon(day)).replace('Sept', 'Sep');
const pad2 = (n: number) => String(n).padStart(2, '0');

interface Stamps {
	bookedAt: readonly number[];
	checkedInAt: readonly number[];
}

/**
 * Bookings and check-ins of the given houses, bucketed for the chart.
 *
 *  - `24h`: the current Berlin hour and the 23 before it,
 *  - `7d`: today and the six Berlin days before,
 *  - `all`: every day from the first stamp (at least the last seven days),
 *    or every week once that would be more than MAX_DAILY_BARS bars.
 *
 * A stamp up to an hour in the future (a server clock slightly ahead) counts
 * in the current bucket; anything older than the first bucket is left out.
 */
export function activityBuckets(
	houses: readonly Stamps[],
	range: IntelRange,
	now: number
): ActivityBucket[] {
	const nowMinute = Math.floor(now / 60000);
	const booked = houses.flatMap((house) => house.bookedAt);
	const checkedIn = houses.flatMap((house) => house.checkedInAt);

	let buckets: ActivityBucket[];
	let indexOf: (minute: number) => number;

	if (range === '24h') {
		const currentHour = Math.floor(nowMinute / 60);
		const firstHour = currentHour - 23;
		buckets = Array.from({ length: 24 }, (_, i) => {
			const { day, hour } = berlinOfHour(firstHour + i);
			const next = berlinOfHour(firstHour + i + 1).hour;
			return {
				unit: 'hour' as const,
				label: pad2(hour),
				detail: `${dayLabel(day)}, ${pad2(hour)}:00–${pad2(next)}:00`,
				booked: 0,
				checkedIn: 0,
				current: i === 23
			};
		});
		indexOf = (minute) => Math.floor(minute / 60) - firstHour;
	} else {
		const today = berlinDayOf(now);
		let firstDay = today - 6;
		if (range === 'all') {
			for (const minute of [...booked, ...checkedIn]) {
				firstDay = Math.min(firstDay, berlinDayOf(minute * 60000));
			}
		}
		const span = today - firstDay + 1;
		const width = range === 'all' && span > MAX_DAILY_BARS ? 7 : 1;
		const count = Math.ceil(span / width);
		buckets = Array.from({ length: count }, (_, i) => {
			const start = firstDay + i * width;
			const end = start + width - 1;
			return {
				unit: width === 1 ? ('day' as const) : ('week' as const),
				label: width === 1 && range === '7d' ? weekdayFormat.format(noon(start)) : dateLabel(start),
				detail: width === 1 ? dayLabel(start) : `${dateLabel(start)} – ${dateLabel(end)}`,
				booked: 0,
				checkedIn: 0,
				current: i === count - 1
			};
		});
		indexOf = (minute) => Math.floor((berlinDayOf(minute * 60000) - firstDay) / width);
	}

	const last = buckets.length - 1;
	const place = (minute: number, field: 'booked' | 'checkedIn') => {
		let index = indexOf(minute);
		if (index > last && minute - nowMinute <= 60) index = last;
		if (index >= 0 && index <= last) buckets[index][field]++;
	};
	for (const minute of booked) place(minute, 'booked');
	for (const minute of checkedIn) place(minute, 'checkedIn');
	return buckets;
}

/** Bookings or check-ins in the last `minutes` (the pace readout). */
export function countSince(stamps: readonly number[], now: number, minutes: number): number {
	const from = Math.floor(now / 60000) - minutes;
	let count = 0;
	for (const minute of stamps) if (minute > from) count++;
	return count;
}

// ─── Scope: the whole camp or one house ──────────────────────────────────────

const SPOT_FIELDS = [
	'total',
	'occupied',
	'free',
	'checkedIn',
	'booked',
	'locked',
	'special',
	'deactivated'
] as const satisfies readonly (keyof SpotCounts)[];

/** The spot numbers of the whole camp, or of one house. */
export function scopedSpots(stats: LiveStats, houseId: string | null): SpotCounts {
	if (!houseId) return stats.spots;
	const house = stats.houses.find((entry) => entry.id === houseId);
	const counts = {} as SpotCounts;
	for (const field of SPOT_FIELDS) counts[field] = house ? house[field] : 0;
	return counts;
}

/** Share of the active spots that are taken, 0–100. */
export function loadOf(spots: Pick<SpotCounts, 'total' | 'occupied'>): number {
	return spots.total > 0 ? Math.round((spots.occupied / spots.total) * 100) : 0;
}

/** Booked guests the crew has not checked in yet. */
export function waitingOf(spots: Pick<SpotCounts, 'booked' | 'checkedIn'>): number {
	return Math.max(0, spots.booked - spots.checkedIn);
}

// ─── The house table ─────────────────────────────────────────────────────────

export type HouseSort = 'name' | 'load' | 'free' | 'waiting' | 'locked' | 'special';

export const HOUSE_SORTS: { key: HouseSort; label: string }[] = [
	{ key: 'name', label: 'Name' },
	{ key: 'load', label: 'Fullest first' },
	{ key: 'free', label: 'Most free spots' },
	{ key: 'waiting', label: 'Most still to check in' },
	{ key: 'locked', label: 'Most held back' },
	{ key: 'special', label: 'Most ♿ reserved' }
];

export type HouseStateFilter = HouseState | 'all';

export interface HouseRow {
	house: HouseLiveStats;
	load: number;
	waiting: number;
}

/** Case- and accent-blind text for the search ("hutte" finds "Hütte"). */
export function searchable(text: string): string {
	return text
		.normalize('NFD')
		.replace(/\p{Diacritic}/gu, '')
		.toLowerCase();
}

const byName = (a: HouseRow, b: HouseRow) =>
	a.house.name.localeCompare(b.house.name, 'en', { numeric: true });

const SORT_VALUE: Record<Exclude<HouseSort, 'name'>, (row: HouseRow) => number> = {
	load: (row) => row.load,
	free: (row) => row.house.free,
	waiting: (row) => row.waiting,
	locked: (row) => row.house.locked,
	special: (row) => row.house.special
};

/**
 * The rows of the house table: matching the search and the state chip, in the
 * chosen order. Ties (and "Name") go by name, numbers inside names in their
 * natural order ("House 2" before "House 10").
 */
export function houseRows(
	houses: readonly HouseLiveStats[],
	options: { search?: string; state?: HouseStateFilter; sort?: HouseSort } = {}
): HouseRow[] {
	const needle = searchable(options.search?.trim() ?? '');
	const state = options.state ?? 'all';
	const sort = options.sort ?? 'name';
	const rows = houses
		.filter((house) => state === 'all' || house.state === state)
		.filter((house) => !needle || searchable(house.name).includes(needle))
		.map((house) => ({ house, load: loadOf(house), waiting: waitingOf(house) }));
	if (sort === 'name') return rows.sort(byName);
	const value = SORT_VALUE[sort];
	// Fullest: equally full houses with more taken spots first.
	return rows.sort(
		(a, b) =>
			value(b) - value(a) ||
			(sort === 'load' ? b.house.occupied - a.house.occupied : 0) ||
			byName(a, b)
	);
}

// ─── What waits for the crew ─────────────────────────────────────────────────

export type AttentionTone = 'danger' | 'warning' | 'info';

export interface AttentionItem {
	key: string;
	tone: AttentionTone;
	icon: string;
	text: string;
	href?: string;
	linkLabel?: string;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const positive = (value: Count | undefined): value is number =>
	typeof value === 'number' && value > 0;

/**
 * Everything on the camp that a crew member should do something about, most
 * urgent first. Only what is actually the case: an empty list means all clear.
 * What matters depends on the phase: a ticket without a spot is normal while
 * booking is live, and a question once booking has closed.
 */
export function attentionItems(stats: LiveStats, phase: BookingPhase): AttentionItem[] {
	const items: AttentionItem[] = [];
	const ops = stats.ops;
	const docs = '/admin/docs/admin/';

	if (positive(ops?.messages.failed)) {
		items.push({
			key: 'messages-failed',
			tone: 'danger',
			icon: '✉️',
			text: `${plural(ops.messages.failed, 'guest message', 'guest messages')} could not be delivered, even after two days of retries.`,
			href: `${docs}notifications`,
			linkLabel: 'What to do'
		});
	}
	// Only while the chat still refuses them: once an alert gets through again,
	// the failures are history and stay counted in the Crew card.
	if (positive(ops?.crew.alertsFailing)) {
		items.push({
			key: 'alerts-failed',
			tone: 'danger',
			icon: '📣',
			text: `${plural(ops.crew.alertsFailing, 'crew alert', 'crew alerts')} never reached the crew chat, and none got through since.`,
			href: `${docs}notifications`,
			linkLabel: 'Check the setup'
		});
	}
	if (positive(ops?.requests.pending)) {
		items.push({
			key: 'requests-pending',
			tone: 'warning',
			icon: '♿',
			text: `${plural(ops.requests.pending, 'special-needs request waits', 'special-needs requests wait')} for a decision.`,
			href: '/admin/requests',
			linkLabel: 'Review'
		});
	}
	if (positive(ops?.crew.accessRequests)) {
		items.push({
			key: 'access-requests',
			tone: 'warning',
			icon: '🔑',
			text: `${plural(ops.crew.accessRequests, 'admin sign-in waits', 'admin sign-ins wait')} for a superuser's approval on the server.`,
			href: `${docs}access`,
			linkLabel: 'How'
		});
	}
	const withoutSpot = ticketsWithoutSpot(stats);
	if (phase === 'closed' && withoutSpot > 0) {
		items.push({
			key: 'tickets-without-spot',
			tone: 'warning',
			icon: '🎟',
			text: `${plural(withoutSpot, 'ticket has', 'tickets have')} no spot, and booking is closed.`,
			href: '/admin/tickets',
			linkLabel: 'Tickets'
		});
	}
	if (positive(ops?.messages.retrying)) {
		items.push({
			key: 'messages-retrying',
			tone: 'warning',
			icon: '⏳',
			text: `${plural(ops.messages.retrying, 'guest message is', 'guest messages are')} being retried.`,
			href: `${docs}notifications`,
			linkLabel: 'Why'
		});
	}
	if (stats.houseStates.unconfigured > 0) {
		items.push({
			key: 'houses-unconfigured',
			tone: phase === 'staging' ? 'warning' : 'info',
			icon: '🛖',
			text: `${plural(stats.houseStates.unconfigured, 'house has', 'houses have')} no active spots.`
		});
	}
	if (phase === 'live' && withoutSpot > 0) {
		items.push({
			key: 'tickets-to-book',
			tone: 'info',
			icon: '🎟',
			text: `${plural(withoutSpot, 'ticket has', 'tickets have')} no spot yet.`,
			href: '/admin/tickets',
			linkLabel: 'Tickets'
		});
	}
	const noEmail =
		typeof ops?.tickets.total === 'number' && typeof ops.tickets.withEmail === 'number'
			? ops.tickets.total - ops.tickets.withEmail
			: 0;
	if (ops?.messages.mailOn && phase !== 'closed' && noEmail > 0) {
		items.push({
			key: 'tickets-no-email',
			tone: 'info',
			icon: '📭',
			text: `${plural(noEmail, 'ticket has', 'tickets have')} no e-mail address, so no booking e-mails.`,
			href: '/admin/tickets',
			linkLabel: 'Tickets'
		});
	}
	const waiting = waitingOf(stats.spots);
	if (phase === 'closed' && stats.spots.checkedIn > 0 && waiting > 0) {
		items.push({
			key: 'arrivals-waiting',
			tone: 'info',
			icon: '🚪',
			text: `${plural(waiting, 'booked guest is', 'booked guests are')} not checked in yet.`,
			href: '/admin/bookings?show=arriving',
			linkLabel: 'Who'
		});
	}
	return items;
}

/** Tickets without a spot: the roster minus the tickets that have one. 0 when unknown. */
export function ticketsWithoutSpot(stats: Pick<LiveStats, 'ops' | 'ticketsWithSpot'>): number {
	const total = stats.ops?.tickets.total;
	return typeof total === 'number' ? Math.max(0, total - stats.ticketsWithSpot) : 0;
}

/** A count for the page: "—" when PocketBase could not answer it. */
export function formatCount(value: Count | undefined): string {
	return typeof value === 'number' ? value.toLocaleString('en-US') : '—';
}
