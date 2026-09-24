/**
 * Keeps a list of bookings (names, spots, check-ins) current without polling
 * the names themselves.
 *
 * The live numbers (/admin/api/stats, $lib/live-stats-poll.ts) already notice
 * every booking, move, release and check-in, and cost almost nothing while
 * nothing changes (304). A page hands each fresh snapshot to `follow`; only
 * when its `changedAt` moved does it ask /admin/api/bookings once for the
 * rows. So an open bookings page asks for guest names once per change, not
 * every five seconds.
 */
import { writable, type Readable } from 'svelte/store';
import type { BookingRow } from '$lib/bookings';
import type { LiveStats } from '$lib/live-stats';

export const BOOKINGS_URL = '/admin/api/bookings';

export interface BookingsFeedState {
	rows: BookingRow[];
	/** The last refetch failed; the rows shown are the ones before it. */
	failed: boolean;
}

export interface BookingsFeed extends Readable<BookingsFeedState> {
	/** Hand every snapshot of the live poll here. */
	follow(stats: Pick<LiveStats, 'changedAt'> | null): void;
	/** Rows and stamp from a page load (again after an action reloaded the page). */
	reset(rows: BookingRow[], changedAt: string | null): void;
	/** Ask for the rows now. */
	refresh(): Promise<void>;
}

interface Options {
	initial: BookingRow[];
	/** `changedAt` of the numbers the page load saw; null when unknown. */
	changedAt: string | null;
	/** Narrow to one house or room, like the page load did. */
	scope?: { house?: string; room?: string };
	fetcher?: typeof fetch;
}

export function createBookingsFeed(options: Options): BookingsFeed {
	const doFetch: typeof fetch = options.fetcher ?? ((...args) => fetch(...args));
	const query = new URLSearchParams();
	if (options.scope?.house) query.set('house', options.scope.house);
	if (options.scope?.room) query.set('room', options.scope.room);
	const url = query.size ? `${BOOKINGS_URL}?${query}` : BOOKINGS_URL;

	let seen = options.changedAt;
	let current: BookingsFeedState = { rows: options.initial, failed: false };
	const state = writable(current);
	let controller: AbortController | null = null;

	function set(patch: Partial<BookingsFeedState>) {
		current = { ...current, ...patch };
		state.set(current);
	}

	async function refresh() {
		controller?.abort();
		controller = new AbortController();
		try {
			const response = await doFetch(url, { signal: controller.signal });
			if (!response.ok) throw new Error(`bookings endpoint answered ${response.status}`);
			const body = (await response.json()) as { bookings: BookingRow[] };
			set({ rows: body.bookings, failed: false });
		} catch (err) {
			if ((err as Error)?.name === 'AbortError') return;
			set({ failed: true });
		}
	}

	return {
		subscribe: state.subscribe,
		follow(stats) {
			if (!stats?.changedAt) return;
			if (seen === null) {
				seen = stats.changedAt;
				return;
			}
			if (stats.changedAt === seen) return;
			seen = stats.changedAt;
			void refresh();
		},
		reset(rows, changedAt) {
			controller?.abort();
			seen = changedAt;
			set({ rows, failed: false });
		},
		refresh
	};
}
