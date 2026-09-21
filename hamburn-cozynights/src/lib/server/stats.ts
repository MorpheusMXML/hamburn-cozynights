/**
 * The live picture of the whole camp, for the control center's Intel panel.
 *
 * Both the control center's page load and `/admin/api/stats` build their
 * numbers here, so the first paint and every poll afterwards count spots the
 * same way. The snapshot is cached for a few seconds and shared by all admins:
 * ten open dashboards cost PocketBase the same as one.
 *
 * Two parts:
 *  - spots, per house, with the minute each booking and check-in happened
 *    (houses, rooms, beds: what moves while booking is live), and
 *  - camp-wide operations counts (tickets, guest messages, special-needs
 *    requests, the crew), which change slowly and are cached longer.
 * Only counts and stamps leave this module: no guest names, no addresses.
 */
import { createHash } from 'node:crypto';
import type {
	BedsResponse,
	HousesResponse,
	RoomsResponse,
	TypedPocketBase
} from '$lib/pocketbase-types';
import { APP_SETTINGS_ID } from '$lib/server/constants';
import { countSpots, houseState, type HouseState } from '$lib/occupancy';
import type { Count, HouseLiveStats, LiveStats, OpsStats } from '$lib/live-stats';

/** Only the bed fields the numbers need — everything else stays in the database. */
type StatsBed = Pick<BedsResponse, 'id' | 'room' | 'enabled' | 'occupied' | 'is_locked'> & {
	is_special?: boolean;
	order?: string;
	booked_at?: string;
	checked_in_at?: string;
};
type StatsRoom = Pick<RoomsResponse, 'id' | 'house'>;
type StatsHouse = Pick<HousesResponse, 'id' | 'name'>;

/** How long a computed snapshot is handed out again before PocketBase is asked. */
export const SNAPSHOT_TTL_MS = 3000;
/** Tickets, messages, requests and the crew move slowly: asked at most this often. */
export const OPS_TTL_MS = 10000;

/** A PocketBase date ("2026-09-21 09:00:00.000Z") as minutes since the epoch, or null. */
export function toMinute(stamp: string | undefined | null): number | null {
	if (!stamp) return null;
	const ms = Date.parse(String(stamp).replace(' ', 'T'));
	return Number.isNaN(ms) ? null : Math.floor(ms / 60000);
}

/** The newest of the given stamps, as stored, or null. Only spots with a ticket count. */
function newest(beds: StatsBed[], field: 'booked_at' | 'checked_in_at'): string | null {
	let latest: string | null = null;
	for (const bed of beds) {
		const stamp = bed[field];
		if (!bed.order || !stamp) continue;
		if (latest === null || stamp > latest) latest = stamp;
	}
	return latest;
}

/** The newest booking stamp, or null while nothing is booked. */
export function lastBooking(beds: StatsBed[]): string | null {
	return newest(beds, 'booked_at');
}

/** The newest check-in stamp, or null before the first arrival. */
export function lastCheckIn(beds: StatsBed[]): string | null {
	return newest(beds, 'checked_in_at');
}

/**
 * The minutes of every booking and check-in of these spots, oldest first.
 *
 * PocketBase stamps beds.booked_at whenever a spot gets a ticket
 * (pb_hooks/cozy_booked.pb.js), so a ticket import is not a booking wave. A
 * released spot drops out, a moved booking counts at the minute of the move.
 * Only active spots count, like everywhere else on the panel: the check-in
 * minutes add up to `checkedIn` exactly.
 */
export function spotActivity(beds: StatsBed[]) {
	const bookedAt: number[] = [];
	const checkedInAt: number[] = [];
	for (const bed of beds) {
		if (bed.enabled === false || !bed.order) continue;
		const booked = toMinute(bed.booked_at);
		if (booked !== null) bookedAt.push(booked);
		const checkedIn = toMinute(bed.checked_in_at);
		if (checkedIn !== null) checkedInAt.push(checkedIn);
	}
	const ascending = (a: number, b: number) => a - b;
	return { bookedAt: bookedAt.sort(ascending), checkedInAt: checkedInAt.sort(ascending) };
}

/** Per-house numbers, in the order the houses were handed in. */
export function houseStats(
	houses: StatsHouse[],
	rooms: StatsRoom[],
	beds: StatsBed[]
): HouseLiveStats[] {
	const houseOfRoom = new Map(rooms.map((room) => [room.id, room.house]));
	const bedsByHouse = new Map<string, StatsBed[]>(houses.map((house) => [house.id, []]));
	for (const bed of beds) {
		const house = houseOfRoom.get(bed.room);
		if (house) bedsByHouse.get(house)?.push(bed);
	}
	return houses.map((house) => {
		const houseBeds = bedsByHouse.get(house.id) ?? [];
		const spots = countSpots(houseBeds);
		return {
			id: house.id,
			name: house.name ?? '',
			...spots,
			state: houseState({
				totalBeds: spots.total,
				occupiedBeds: spots.occupied,
				freeBeds: spots.free
			}),
			...spotActivity(houseBeds)
		};
	});
}

/** The spot part of the snapshot, derived from records already read. No I/O. */
export function deriveLiveStats(
	houses: StatsHouse[],
	rooms: StatsRoom[],
	beds: StatsBed[]
): Omit<LiveStats, 'changedAt' | 'ops'> {
	const perHouse = houseStats(houses, rooms, beds);
	const states: Record<HouseState, number> = { unconfigured: 0, open: 0, filling: 0, full: 0 };
	for (const house of perHouse) states[house.state]++;
	return {
		spots: countSpots(beds),
		houseStates: states,
		houses: perHouse,
		ticketsWithSpot: new Set(beds.map((bed) => bed.order).filter(Boolean)).size,
		lastBookingAt: lastBooking(beds),
		lastCheckInAt: lastCheckIn(beds)
	};
}

/** Reads exactly the three collections the spot numbers are made of. */
export async function readStatsRecords(pb: TypedPocketBase) {
	const [houses, rooms, beds] = await Promise.all([
		pb
			.collection('houses')
			.getFullList<StatsHouse>({ fields: 'id,name', sort: 'name', requestKey: null }),
		pb.collection('rooms').getFullList<StatsRoom>({ fields: 'id,house', requestKey: null }),
		pb.collection('beds').getFullList<StatsBed>({
			fields: 'id,room,enabled,occupied,is_locked,is_special,order,booked_at,checked_in_at',
			requestKey: null
		})
	]);
	return { houses, rooms, beds };
}

/**
 * The filters behind the camp-wide counts. The message states mirror
 * pb_hooks/lib/notify.js: `due` is set while a message waits, `attempts`
 * counts failed tries since the last success, and after the last retry `due`
 * is cleared with `attempts` left standing (a success or a silent accept puts
 * `attempts` back to 0).
 */
export const OPS_FILTERS = {
	ticketsWithEmail: "email != ''",
	telegram: "tg_chat != ''",
	mailed: "mail_sent != ''",
	queued: "due != ''",
	retrying: "due != '' && attempts > 0",
	failed: "due = '' && attempts > 0",
	alertsQueued: "alert_status = 'pending'",
	alertsFailed: "alert_status = 'failed'"
} as const;

/**
 * The camp-wide counts. Each one is its own small query, and each one may
 * fail on its own (a collection missing on a database from before its
 * migration): that number reads as null, the rest still shows. Never throws.
 */
export async function readOpsStats(pb: TypedPocketBase): Promise<OpsStats> {
	const count = async (collection: string, filter = ''): Promise<Count> => {
		try {
			const page = await pb
				.collection(collection)
				.getList(1, 1, { filter: filter || undefined, fields: 'id', requestKey: null });
			return page.totalItems;
		} catch {
			return null;
		}
	};
	// Few records each: one list read instead of three counts.
	const tally = async <T extends string>(
		collection: string,
		field: string,
		values: readonly T[]
	): Promise<Record<T, Count>> => {
		const counts = Object.fromEntries(values.map((value) => [value, 0])) as Record<T, Count>;
		try {
			const records = await pb
				.collection(collection)
				.getFullList<Record<string, string>>({ fields: field, requestKey: null });
			for (const record of records) {
				const value = record[field] as T;
				if (Object.hasOwn(counts, value)) counts[value] = (counts[value] ?? 0) + 1;
			}
			return counts;
		} catch {
			return Object.fromEntries(values.map((value) => [value, null])) as Record<T, Count>;
		}
	};
	const readSettings = async () => {
		try {
			return await pb
				.collection('app_settings')
				.getOne(APP_SETTINGS_ID, { fields: 'notify_mail,telegram_bot', requestKey: null });
		} catch {
			return null;
		}
	};

	const [
		settings,
		total,
		withEmail,
		telegram,
		mailed,
		queued,
		retrying,
		failed,
		requests,
		roles,
		alertsQueued,
		alertsFailed
	] = await Promise.all([
		readSettings(),
		count('orders'),
		count('orders', OPS_FILTERS.ticketsWithEmail),
		count('guest_notify', OPS_FILTERS.telegram),
		count('guest_notify', OPS_FILTERS.mailed),
		count('guest_notify', OPS_FILTERS.queued),
		count('guest_notify', OPS_FILTERS.retrying),
		count('guest_notify', OPS_FILTERS.failed),
		tally('special_requests', 'status', ['pending', 'approved', 'declined'] as const),
		tally('admins', 'role', ['superuser', 'admin', 'pending'] as const),
		count('admin_events', OPS_FILTERS.alertsQueued),
		count('admin_events', OPS_FILTERS.alertsFailed)
	]);

	const approved =
		roles.superuser === null || roles.admin === null ? null : roles.superuser + roles.admin;
	return {
		tickets: { total, withEmail, telegram, mailed },
		requests,
		messages: {
			mailOn: !!settings?.notify_mail,
			telegramOn: !!settings?.telegram_bot,
			queued,
			retrying,
			failed
		},
		crew: { admins: approved, accessRequests: roles.pending, alertsQueued, alertsFailed }
	};
}

let opsCached: { at: number; ops: OpsStats } | null = null;
let opsInFlight: Promise<OpsStats> | null = null;

/** The camp-wide counts, at most OPS_TTL_MS old, one PocketBase round for all callers. */
export async function opsSnapshot(pb: TypedPocketBase, now = Date.now()): Promise<OpsStats> {
	if (opsCached && now - opsCached.at < OPS_TTL_MS) return opsCached.ops;
	if (opsInFlight) return opsInFlight;
	opsInFlight = readOpsStats(pb)
		.then((ops) => {
			opsCached = { at: now, ops };
			return ops;
		})
		.finally(() => {
			opsInFlight = null;
		});
	return opsInFlight;
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
	const [{ houses, rooms, beds }, ops] = await Promise.all([
		readStatsRecords(pb),
		opsSnapshot(pb, now)
	]);
	const derived = { ...deriveLiveStats(houses, rooms, beds), ops };
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

/** Test seam: forget the cached snapshots. */
export function resetStatsCache() {
	cached = null;
	inFlight = null;
	opsCached = null;
	opsInFlight = null;
}
