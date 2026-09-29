/**
 * Keeps the control center's numbers current without a page reload.
 *
 * A plain poll, on purpose: the browser never talks to PocketBase (see
 * $lib/server/pocketbase.ts), so a push channel would mean a new route through
 * nginx. Instead the dashboard asks a small admin endpoint, and only while
 * somebody is actually looking:
 *  - the panel starts and stops the poll when it opens and closes,
 *  - a hidden tab is skipped entirely and catches up the moment it is shown,
 *  - unchanged numbers come back as 304 (no body, no re-render),
 *  - after an error the gap doubles up to a minute,
 *  - a session that ran out (403) stops the poll instead of hammering.
 */
import { writable, type Readable } from 'svelte/store';
import {
	nextDelayMs,
	statusFor,
	POLL_INTERVAL_MS,
	type LiveState,
	type LiveStats
} from '$lib/live-stats';

export const STATS_URL = '/admin/api/stats';

/** What the panel reads: the numbers plus how trustworthy they are. */
export type LivePollState = LiveState & { signedOut: boolean };

export interface LivePoll extends Readable<LivePollState> {
	/** Begins polling and returns the matching stop function. */
	start(): () => void;
	/** Fetches once, right now (the panel's refresh button). */
	refresh(): Promise<void>;
}

interface Options {
	url?: string;
	intervalMs?: number;
	/** Numbers from the page load, shown until the first answer arrives. */
	initial?: LiveStats | null;
	fetcher?: typeof fetch;
}

export function createLivePoll(options: Options = {}): LivePoll {
	const url = options.url ?? STATS_URL;
	const intervalMs = options.intervalMs ?? POLL_INTERVAL_MS;
	const doFetch: typeof fetch = options.fetcher ?? ((...args) => fetch(...args));

	let current: LivePollState = {
		stats: options.initial ?? null,
		status: 'idle',
		checkedAt: null,
		failures: 0,
		signedOut: false
	};
	const state = writable(current);

	let etag: string | null = null;
	let timer: ReturnType<typeof setTimeout> | null = null;
	let controller: AbortController | null = null;
	let running = false;

	function set(patch: Partial<LivePollState>, status?: LivePollState['status']) {
		current = { ...current, ...patch };
		current.status = status ?? statusFor(current);
		state.set(current);
	}

	async function fetchOnce(): Promise<void> {
		controller?.abort();
		controller = new AbortController();
		try {
			const response = await doFetch(url, {
				headers: etag ? { 'if-none-match': etag } : undefined,
				signal: controller.signal
			});
			if (response.status === 403) {
				// The weekly re-sign-in, or the account was withdrawn. Nothing to
				// retry: the panel tells the admin to sign in again.
				stop();
				set({ failures: 0, signedOut: true, checkedAt: Date.now() }, 'offline');
				return;
			}
			if (response.status === 304) {
				set({ checkedAt: Date.now(), failures: 0 });
				return;
			}
			if (!response.ok) throw new Error(`stats endpoint answered ${response.status}`);
			const stats = (await response.json()) as LiveStats;
			etag = response.headers.get('etag');
			set({ stats, checkedAt: Date.now(), failures: 0 });
		} catch (err) {
			if ((err as Error)?.name === 'AbortError') return;
			set({ failures: current.failures + 1 });
		}
	}

	function schedule(delayMs: number) {
		if (!running) return;
		if (timer) clearTimeout(timer);
		timer = setTimeout(tick, delayMs);
	}

	async function tick() {
		if (!running) return;
		// A hidden tab keeps its timer but spends nothing: no request, no paint.
		if (typeof document !== 'undefined' && document.hidden) {
			schedule(intervalMs);
			return;
		}
		await fetchOnce();
		schedule(nextDelayMs(current.failures, intervalMs));
	}

	function onVisible() {
		if (running && !document.hidden) void tick();
	}

	function stop() {
		running = false;
		if (timer) clearTimeout(timer);
		timer = null;
		controller?.abort();
		controller = null;
		if (typeof document !== 'undefined') {
			document.removeEventListener('visibilitychange', onVisible);
		}
	}

	function start() {
		if (running) return stop;
		running = true;
		if (typeof document !== 'undefined') {
			document.addEventListener('visibilitychange', onVisible);
		}
		void tick();
		return stop;
	}

	return { subscribe: state.subscribe, start, refresh: fetchOnce };
}
