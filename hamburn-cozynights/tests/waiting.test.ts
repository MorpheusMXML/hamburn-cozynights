// tests/waiting.test.ts — what the wait veil ($lib/waiting, WaitVeil.svelte)
// says, and when it says nothing: only a form the guest sent or a page change
// between guest pages, never a filter in the address, the crew's pages or a
// full page load. A wait always ends: with its answer, or by itself — also a
// page change that an invalidateAll() aborted (SvelteKit leaves `navigating`
// on it). And the refresh after a countdown runs one at a time.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import {
	MAX_PAGE_WAIT_MS,
	MAX_WAIT_MS,
	WAIT_TEXTS,
	followPageChange,
	resyncOnce,
	startWait,
	waitKind,
	waitWhile,
	waits,
	type PageChange
} from '../src/lib/waiting';

const at = (path: string) => new URL(path, 'https://cozy.example.org');
const change = (from: string | null, to: string, willUnload = false): PageChange => ({
	from: from ? at(from) : null,
	to: at(to),
	willUnload
});

afterEach(() => {
	vi.useRealTimers();
	waits.set([]);
});

describe('what the veil says', () => {
	it('says nothing when nothing is on its way', () => {
		expect(waitKind([], null)).toBeNull();
	});

	it('names the newest form that was sent', () => {
		const end = startWait('sign-in');
		startWait('booking');
		expect(waitKind(get(waits), null)).toBe('booking');
		end();
		expect(waitKind(get(waits), null)).toBe('booking');
	});

	it('prefers a sent form over the page change it causes', () => {
		startWait('sign-in');
		expect(waitKind(get(waits), change('/', '/map'))).toBe('sign-in');
	});

	it('covers a page change between guest pages', () => {
		expect(waitKind([], change('/map', '/house/abc'))).toBe('loading');
		expect(waitKind([], change('/house/abc', '/room/def'))).toBe('loading');
		expect(waitKind([], change(null, '/map'))).toBe('loading');
	});

	it('leaves a filter in the address, the crew pages and full page loads alone', () => {
		expect(waitKind([], change('/map', '/map?f=quiet'))).toBeNull();
		expect(waitKind([], change('/admin', '/admin/bookings'))).toBeNull();
		expect(waitKind([], change('/map', '/admin'))).toBeNull();
		expect(waitKind([], change('/map', '/docs/guide', true))).toBeNull();
		expect(waitKind([], change('/', '/auth/google'))).toBeNull();
	});

	it('asks to stay only when something was sent', () => {
		for (const kind of ['sign-in', 'booking', 'releasing'] as const) {
			expect(WAIT_TEXTS[kind].stay).toBe(true);
			expect(WAIT_TEXTS[kind].note).toMatch(/don’t reload/);
		}
		for (const kind of ['opening', 'loading'] as const) {
			expect(WAIT_TEXTS[kind].stay).toBe(false);
			expect(WAIT_TEXTS[kind].note).toMatch(/No need to reload/);
		}
	});
});

describe('a wait always ends', () => {
	it('ends once, however often its answer comes', () => {
		const end = startWait('releasing');
		const other = startWait('booking');
		end();
		end();
		expect(get(waits).map((w) => w.kind)).toEqual(['booking']);
		other();
		expect(get(waits)).toEqual([]);
	});

	it('ends by itself when no answer ever comes', () => {
		vi.useFakeTimers();
		startWait('booking');
		vi.advanceTimersByTime(MAX_WAIT_MS - 1);
		expect(get(waits)).toHaveLength(1);
		vi.advanceTimersByTime(1);
		expect(get(waits)).toEqual([]);
	});

	it('ends with the refresh, also when the refresh fails', async () => {
		const ok = waitWhile('opening', Promise.resolve('fresh'));
		expect(get(waits).map((w) => w.kind)).toEqual(['opening']);
		await expect(ok).resolves.toBe('fresh');
		expect(get(waits)).toEqual([]);

		const failed = waitWhile('opening', Promise.reject(new Error('offline')));
		await expect(failed).rejects.toThrow('offline');
		expect(get(waits)).toEqual([]);
	});
});

/** A promise settled from outside, like SvelteKit's `navigating.complete`. */
function deferred() {
	let fulfil!: () => void;
	let reject!: (err: Error) => void;
	const promise = new Promise<void>((f, r) => {
		fulfil = f;
		reject = r;
	});
	promise.catch(() => undefined);
	return { promise, fulfil, reject };
}

const settle = () => new Promise((done) => setTimeout(done, 0));

describe('a page change on its way', () => {
	it('ends when the navigation is complete', async () => {
		const nav = deferred();
		const ended = vi.fn();
		followPageChange(nav.promise, ended);
		await settle();
		expect(ended).not.toHaveBeenCalled();
		nav.fulfil();
		await settle();
		expect(ended).toHaveBeenCalledTimes(1);
	});

	it('ends when an invalidateAll() aborted it, though `navigating` still points there', async () => {
		// SvelteKit 2.70: navigate() rejects `complete` with "navigation aborted"
		// and leaves navigating.to as it was; only the promise says it's over.
		const nav = deferred();
		const ended = vi.fn();
		followPageChange(nav.promise, ended);
		nav.reject(new Error('navigation aborted'));
		await settle();
		expect(ended).toHaveBeenCalledTimes(1);
	});

	it('ends by itself when the navigation never settles', () => {
		vi.useFakeTimers();
		const ended = vi.fn();
		followPageChange(new Promise(() => {}), ended);
		vi.advanceTimersByTime(MAX_PAGE_WAIT_MS - 1);
		expect(ended).not.toHaveBeenCalled();
		vi.advanceTimersByTime(1);
		expect(ended).toHaveBeenCalledTimes(1);
	});

	it('leaves a newer page change alone once it was taken over', async () => {
		const old = deferred();
		const ended = vi.fn();
		const stop = followPageChange(old.promise, ended);
		stop(); // a newer navigation replaced it
		old.reject(new Error('navigation aborted'));
		await settle();
		expect(ended).not.toHaveBeenCalled();
	});
});

describe('the refresh after a countdown', () => {
	// resyncOnce keeps its state for the whole module: every test runs an hour
	// further on, long after the previous one's last answer.
	let hours = 0;
	beforeEach(() => {
		const realNow = Date.now();
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(realNow + ++hours * 3_600_000);
	});
	const later = (ms: number) => vi.setSystemTime(Date.now() + ms);

	it('runs one at a time: a slow answer is not overtaken', async () => {
		const first = deferred();
		const refresh = vi.fn(() => first.promise);
		expect(resyncOnce(refresh, { gapMs: 0 })).toBe(true);
		// the countdown asks again 5 s later: the first answer is still out
		later(5_000);
		expect(resyncOnce(refresh, { gapMs: 0 })).toBe(false);
		expect(refresh).toHaveBeenCalledTimes(1);
		first.fulfil();
		await settle();
		expect(resyncOnce(() => Promise.resolve(), { gapMs: 0 })).toBe(true);
		await settle();
	});

	it('waits the gap after the last answer, also after a failed one', async () => {
		const failing = vi.fn(() => Promise.reject(new Error('offline')));
		expect(resyncOnce(failing, { gapMs: 0 })).toBe(true);
		await settle();
		later(4_999);
		expect(resyncOnce(failing, { gapMs: 5_000 })).toBe(false);
		later(1);
		expect(resyncOnce(failing, { gapMs: 5_000 })).toBe(true);
		expect(failing).toHaveBeenCalledTimes(2);
		await settle();
	});

	it('covers the page with "Booking is opening" only when asked to', async () => {
		const run = deferred();
		expect(resyncOnce(() => run.promise, { gapMs: 0, kind: 'opening' })).toBe(true);
		expect(get(waits).map((w) => w.kind)).toEqual(['opening']);
		run.fulfil();
		await settle();
		expect(get(waits)).toEqual([]);

		const quiet = deferred();
		expect(resyncOnce(() => quiet.promise, { gapMs: 0 })).toBe(true);
		expect(get(waits)).toEqual([]);
		quiet.fulfil();
		await settle();
	});
});
