// tests/waiting.test.ts — what the wait veil ($lib/waiting, WaitVeil.svelte)
// says, and when it says nothing: only a form the guest sent or a page change
// between guest pages, never a filter in the address, the crew's pages or a
// full page load. A wait always ends: with its answer, or by itself.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import {
	MAX_WAIT_MS,
	WAIT_TEXTS,
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
