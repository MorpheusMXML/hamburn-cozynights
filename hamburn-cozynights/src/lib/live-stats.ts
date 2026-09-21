/**
 * Shape of the live booking snapshot and the rules the poller follows.
 *
 * Shared by the server (`$lib/server/stats.ts` builds it) and the browser
 * (`LiveStatsPoll` fetches it), so both ends agree on the wire format.
 */
import type { HouseState, SpotCounts } from '$lib/occupancy';

/** One house, only the numbers the control center repaints live. */
export interface HouseLiveStats {
	id: string;
	total: number;
	occupied: number;
	free: number;
	checkedIn: number;
	state: HouseState;
}

export interface LiveStats {
	/** When these numbers last *changed*, not when they were last fetched. */
	changedAt: string;
	spots: SpotCounts;
	/** How many houses are in each state. */
	houseStates: Record<HouseState, number>;
	houses: HouseLiveStats[];
	/** Spots booked per Berlin day, oldest first — seven entries. */
	trend: { labels: string[]; values: number[] };
	/** The most recent booking, or null while nothing is booked. */
	lastBookingAt: string | null;
}

/** Where the numbers on screen come from right now. */
export type LiveStatus = 'idle' | 'live' | 'stale' | 'offline';

export interface LiveState {
	stats: LiveStats | null;
	status: LiveStatus;
	/** When the browser last got an answer (200 or 304), ms since the epoch. */
	checkedAt: number | null;
	/** Consecutive failed attempts; drives the backoff. */
	failures: number;
}

export const POLL_INTERVAL_MS = 5000;
/** After this long without a fresh answer the numbers are marked as stale. */
export const STALE_AFTER_MS = 20000;
const MAX_BACKOFF_MS = 60000;

/**
 * How long to wait before the next attempt. A reachable server is polled at a
 * steady interval; after an error the gap doubles (5s, 10s, 20s, 40s, 60s), so
 * an admin tab left open on a restarting server doesn't hammer it.
 */
export function nextDelayMs(failures: number, intervalMs = POLL_INTERVAL_MS): number {
	if (failures <= 0) return intervalMs;
	return Math.min(intervalMs * 2 ** failures, MAX_BACKOFF_MS);
}

/** Numbers older than STALE_AFTER_MS are shown as stale, not as current. */
export function statusFor(state: Pick<LiveState, 'checkedAt' | 'failures'>, now = Date.now()) {
	if (state.checkedAt === null) return state.failures > 0 ? 'offline' : 'idle';
	if (state.failures >= 3) return 'offline';
	return now - state.checkedAt > STALE_AFTER_MS ? 'stale' : 'live';
}
