/**
 * The live booking picture of the whole camp.
 *
 * Both the control center's page load and `/admin/api/stats` build their
 * numbers here, so the first paint and every poll afterwards count spots the
 * same way. The snapshot is cached for a few seconds and shared by all admins:
 * ten open dashboards cost PocketBase the same as one.
 */
import { createHash } from 'node:crypto';
import type {
	BedsResponse,
	HousesResponse,
	RoomsResponse,
	TypedPocketBase
} from '$lib/pocketbase-types';
import { countSpots, houseState, type HouseState } from '$lib/occupancy';
import type { HouseLiveStats, LiveStats } from '$lib/live-stats';

/** Only the bed fields the numbers need — everything else stays in the database. */
type StatsBed = Pick<BedsResponse, 'id' | 'room' | 'enabled' | 'occupied' | 'is_locked'> & {
	is_special?: boolean;
	order?: string;
	booked_at?: string;
	checked_in_at?: string;
};
type StatsRoom = Pick<RoomsResponse, 'id' | 'house'>;
type StatsHouse = Pick<HousesResponse, 'id'>;

/** How long a computed snapshot is handed out again before PocketBase is asked. */
export const SNAPSHOT_TTL_MS = 3000;

const berlinDay = new Intl.DateTimeFormat('en-CA', {
	timeZone: 'Europe/Berlin',
	year: 'numeric',
	month: '2-digit',
	day: '2-digit'
});
const berlinWeekday = new Intl.DateTimeFormat('en-US', {
	timeZone: 'Europe/Berlin',
	weekday: 'short'
});

/**
 * Spots booked per day over the last seven days (including today).
 *
 * PocketBase stamps beds.booked_at whenever a spot gets a ticket
 * (pb_hooks/cozy_booked.pb.js), so a ticket import is not a booking wave. A
 * released spot drops out, a moved booking counts on the day of the move.
 * Bucketed by Berlin calendar day (the event's timezone), not UTC: a raw UTC
 * slice would misfile a booking made in the CET/CEST evening into "tomorrow".
 */
export function bookingTrend(beds: StatsBed[], now = new Date()) {
	const days: { key: string; label: string }[] = [];
	for (let i = 6; i >= 0; i--) {
		const day = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
		days.push({ key: berlinDay.format(day), label: berlinWeekday.format(day) });
	}
	const countsByDay = new Map(days.map((day) => [day.key, 0]));
	for (const bed of beds) {
		if (!bed.order || !bed.booked_at) continue;
		const key = berlinDay.format(new Date(bed.booked_at));
		const counted = countsByDay.get(key);
		if (counted !== undefined) countsByDay.set(key, counted + 1);
	}
	return {
		labels: days.map((day) => day.label),
		values: days.map((day) => countsByDay.get(day.key) ?? 0)
	};
}

/** The newest booking stamp, or null while nothing is booked. */
export function lastBooking(beds: StatsBed[]): string | null {
	let latest: string | null = null;
	for (const bed of beds) {
		if (!bed.order || !bed.booked_at) continue;
		if (latest === null || bed.booked_at > latest) latest = bed.booked_at;
	}
	return latest;
}

/** Per-house numbers, in the order the houses were handed in. */
export function houseStats(houses: StatsHouse[], rooms: StatsRoom[], beds: StatsBed[]) {
	const houseOfRoom = new Map(rooms.map((room) => [room.id, room.house]));
	const bedsByHouse = new Map<string, StatsBed[]>(houses.map((house) => [house.id, []]));
	for (const bed of beds) {
		const house = houseOfRoom.get(bed.room);
		if (house) bedsByHouse.get(house)?.push(bed);
	}
	return houses.map((house) => {
		const spots = countSpots(bedsByHouse.get(house.id) ?? []);
		const stats: HouseLiveStats = {
			id: house.id,
			total: spots.total,
			occupied: spots.occupied,
			free: spots.free,
			checkedIn: spots.checkedIn,
			state: houseState({
				totalBeds: spots.total,
				occupiedBeds: spots.occupied,
				freeBeds: spots.free
			})
		};
		return { ...stats, spots };
	});
}

/** The whole snapshot, derived from records already read. No I/O. */
export function deriveLiveStats(
	houses: StatsHouse[],
	rooms: StatsRoom[],
	beds: StatsBed[],
	now = new Date()
): Omit<LiveStats, 'changedAt'> {
	const perHouse = houseStats(houses, rooms, beds);
	const states: Record<HouseState, number> = { unconfigured: 0, open: 0, filling: 0, full: 0 };
	for (const house of perHouse) states[house.state]++;
	return {
		spots: countSpots(beds),
		houseStates: states,
		houses: perHouse.map(({ spots: _spots, ...house }) => house),
		trend: bookingTrend(beds, now),
		lastBookingAt: lastBooking(beds)
	};
}

/** Reads exactly the three collections the numbers are made of. */
export async function readStatsRecords(pb: TypedPocketBase) {
	const [houses, rooms, beds] = await Promise.all([
		pb.collection('houses').getFullList<StatsHouse>({ fields: 'id', requestKey: null }),
		pb.collection('rooms').getFullList<StatsRoom>({ fields: 'id,house', requestKey: null }),
		pb.collection('beds').getFullList<StatsBed>({
			fields: 'id,room,enabled,occupied,is_locked,is_special,order,booked_at,checked_in_at',
			requestKey: null
		})
	]);
	return { houses, rooms, beds };
}

export interface StatsSnapshot {
	stats: LiveStats;
	/** Content hash of everything but `changedAt`; the endpoint's ETag. */
	etag: string;
}

let cached: { at: number; snapshot: StatsSnapshot } | null = null;
let inFlight: Promise<StatsSnapshot> | null = null;

function hash(value: unknown): string {
	return createHash('sha1').update(JSON.stringify(value)).digest('base64url').slice(0, 22);
}

async function build(pb: TypedPocketBase, now: number): Promise<StatsSnapshot> {
	const { houses, rooms, beds } = await readStatsRecords(pb);
	const derived = deriveLiveStats(houses, rooms, beds, new Date(now));
	const etag = hash(derived);
	// Same numbers as before? Then nothing changed, and `changedAt` keeps
	// pointing at the moment they last moved — that is what the dashboard shows
	// as "last change", and it keeps the ETag stable so polls answer 304.
	const changedAt =
		cached?.snapshot.etag === etag ? cached.snapshot.stats.changedAt : new Date(now).toISOString();
	return { stats: { changedAt, ...derived }, etag };
}

/**
 * The current snapshot, at most SNAPSHOT_TTL_MS old. Concurrent callers share
 * one PocketBase round trip (single flight).
 */
export async function liveStatsSnapshot(
	pb: TypedPocketBase,
	now = Date.now()
): Promise<StatsSnapshot> {
	if (cached && now - cached.at < SNAPSHOT_TTL_MS) return cached.snapshot;
	if (inFlight) return inFlight;
	inFlight = build(pb, now)
		.then((snapshot) => {
			cached = { at: now, snapshot };
			return snapshot;
		})
		.finally(() => {
			inFlight = null;
		});
	return inFlight;
}

/** Test seam: forget the cached snapshot. */
export function resetStatsCache() {
	cached = null;
	inFlight = null;
}
