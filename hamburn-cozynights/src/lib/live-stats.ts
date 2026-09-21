/**
 * Shape of the live booking snapshot and the rules the poller follows.
 *
 * Shared by the server (`$lib/server/stats.ts` builds it) and the browser
 * (`LiveStatsPoll` fetches it), so both ends agree on the wire format.
 */
import type { HouseState, SpotCounts } from '$lib/occupancy';

/**
 * One house: its spot numbers, and when its spots were booked and checked in.
 * The Intel panel filters and buckets these in the browser, so switching a
 * house or a time range costs no request.
 */
export interface HouseLiveStats extends SpotCounts {
	id: string;
	name: string;
	state: HouseState;
	/** When each current booking landed, in minutes since the epoch (UTC), oldest first. */
	bookedAt: number[];
	/** When each checked-in guest was checked in, minutes since the epoch (UTC), oldest first. */
	checkedInAt: number[];
}

/** A count PocketBase could not answer (a collection missing on an old database) is null. */
export type Count = number | null;

/**
 * Camp-wide operations numbers that belong to no house: the ticket roster,
 * guest messages, special-needs requests, the crew. Counts only — no names, no
 * addresses, no request texts ever leave the server for this panel.
 */
export interface OpsStats {
	tickets: {
		total: Count;
		/** Tickets with an e-mail address (booking e-mails can reach them). */
		withEmail: Count;
		/** Tickets whose guest linked a Telegram chat for updates. */
		telegram: Count;
		/** Tickets that got at least one e-mail about their spot. */
		mailed: Count;
	};
	requests: { pending: Count; approved: Count; declined: Count };
	messages: {
		/** PocketBase has a mail server (app_settings.notify_mail). */
		mailOn: boolean;
		/** A Telegram bot is set up for guests (app_settings.telegram_bot). */
		telegramOn: boolean;
		/** Guest messages waiting to go out (pb_hooks/lib/notify.js, guest_notify.due). */
		queued: Count;
		/** Of those, messages that failed at least once and wait for their next try. */
		retrying: Count;
		/** Messages given up after the last retry (about two days); the crew got an alert. */
		failed: Count;
	};
	crew: {
		/** Approved admin accounts (admins and superusers). */
		admins: Count;
		/** Sign-ins waiting for a superuser's approval (role `pending`). */
		accessRequests: Count;
		alertsQueued: Count;
		/** Crew-chat alerts given up after their last retry. */
		alertsFailed: Count;
	};
}

export interface LiveStats {
	/** When these numbers last *changed*, not when they were last fetched. */
	changedAt: string;
	spots: SpotCounts;
	/** How many houses are in each state. */
	houseStates: Record<HouseState, number>;
	houses: HouseLiveStats[];
	/** Different tickets that have a spot right now (one ticket, one spot). */
	ticketsWithSpot: number;
	/** The most recent booking, or null while nothing is booked. */
	lastBookingAt: string | null;
	/** The most recent check-in, or null before the first arrival. */
	lastCheckInAt: string | null;
	/** Null when none of it could be read (the spot numbers still show). */
	ops: OpsStats | null;
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
