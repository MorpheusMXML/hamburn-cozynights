// tests/guest-session.test.ts — the guest session: a ticket code in a cookie,
// the booking round it was signed in for, and the two things that end it (the
// code is gone, a reset started a new round). Against real PocketBase:
// tests/integration/booking.test.ts.
import { describe, it, expect, vi } from 'vitest';

vi.mock('$env/dynamic/private', () => ({
	env: {
		ENCRYPTION_KEY: '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff',
		PB_ADMIN_EMAIL: 'admin@test.com',
		PB_ADMIN_PASSWORD: 'password'
	}
}));

import { FakePb } from './fake-pb';
import { createLookupHash } from '../src/lib/server/crypto';
import { APP_SETTINGS_ID } from '../src/lib/server/constants';
import {
	GUEST_COOKIE,
	ROUND_COOKIE,
	bumpGuestRound,
	clearGuestSession,
	readGuestRound,
	resolveGuestSession,
	setGuestSession,
	signInUrl
} from '../src/lib/server/guest-session';
import type { TypedPocketBase } from '../src/lib/pocketbase-types';

const CODE = 'UT-7F3K9Q';

/** Just enough of SvelteKit's `cookies`: what the browser sent, and what the answer sets. */
function fakeCookies(sent: Record<string, string> = {}) {
	const jar = { ...sent };
	const deleted: string[] = [];
	return {
		deleted,
		jar,
		get: (name: string) => jar[name],
		set: (name: string, value: string) => {
			jar[name] = value;
		},
		delete: (name: string) => {
			delete jar[name];
			deleted.push(name);
		}
	} as unknown as import('@sveltejs/kit').Cookies & {
		deleted: string[];
		jar: Record<string, string>;
	};
}

/** A database with one ticket and the settings record. */
function camp(settings: Record<string, unknown> = {}) {
	const pb = new FakePb();
	pb.seed('app_settings', { id: APP_SETTINGS_ID, ...settings });
	pb.seed('orders', { order_number: '', order_hash: createLookupHash(CODE), burner_name: '' });
	return pb as unknown as TypedPocketBase;
}

describe('the round stamp', () => {
	it('is 0 until a reset, and counts up with every reset', async () => {
		const pb = camp();
		expect(await readGuestRound(pb)).toBe(0);
		expect(await bumpGuestRound(pb)).toBe(1);
		expect(await readGuestRound(pb)).toBe(1);
		expect(await bumpGuestRound(pb)).toBe(2);
	});

	it('starts the settings record when the camp has none yet', async () => {
		const pb = new FakePb() as unknown as TypedPocketBase;
		expect(await readGuestRound(pb)).toBe(0);
		expect(await bumpGuestRound(pb)).toBe(1);
		expect(await readGuestRound(pb)).toBe(1);
	});

	it('is not read as a round when PocketBase is unreachable', async () => {
		const pb = {
			collection: () => ({ getOne: () => Promise.reject(new Error('connection refused')) })
		} as unknown as TypedPocketBase;
		expect(await readGuestRound(pb)).toBe(null);
	});
});

describe('signing in and out', () => {
	it('stores the code and the round it was signed in for', () => {
		const cookies = fakeCookies();
		setGuestSession(cookies, CODE, 3);
		expect(cookies.jar[GUEST_COOKIE]).toBe(CODE);
		expect(cookies.jar[ROUND_COOKIE]).toBe('3');

		clearGuestSession(cookies);
		expect(cookies.deleted).toEqual([GUEST_COOKIE, ROUND_COOKIE]);
	});

	it('names the reason the start page asks for the code again', () => {
		expect(signInUrl({ guestSignOut: 'round' } as App.Locals)).toBe('/?login=round');
		expect(signInUrl({ guestSignOut: 'expired' } as App.Locals)).toBe('/?login=expired');
		expect(signInUrl({} as App.Locals)).toBe('/?login=required');
	});
});

describe('resolveGuestSession', () => {
	it('keeps a session whose code is in the ticket list', async () => {
		const pb = camp();
		const cookies = fakeCookies({ [GUEST_COOKIE]: CODE, [ROUND_COOKIE]: '0' });

		const session = await resolveGuestSession(cookies, pb, pb);
		expect(session.code).toBe(CODE);
		expect(session.order?.order_hash).toBe(createLookupHash(CODE));
		expect(session.signedOut).toBeUndefined();
		expect(cookies.deleted).toEqual([]);
	});

	it('ends a session whose code was removed from the ticket list', async () => {
		const pb = camp();
		const cookies = fakeCookies({ [GUEST_COOKIE]: 'TEST-GONE', [ROUND_COOKIE]: '0' });

		const session = await resolveGuestSession(cookies, pb, pb);
		expect(session.code).toBe(null);
		expect(session.signedOut).toBe('expired');
		expect(cookies.deleted).toEqual([GUEST_COOKIE, ROUND_COOKIE]);
	});

	it('ends every session of an earlier booking round', async () => {
		const pb = camp();
		const cookies = fakeCookies({ [GUEST_COOKIE]: CODE, [ROUND_COOKIE]: '0' });
		await bumpGuestRound(pb);

		const session = await resolveGuestSession(cookies, pb, pb);
		expect(session.code).toBe(null);
		expect(session.signedOut).toBe('round');
		expect(cookies.deleted).toEqual([GUEST_COOKIE, ROUND_COOKIE]);

		// Signing in again lands in the new round and stays.
		const fresh = fakeCookies();
		setGuestSession(fresh, CODE, (await readGuestRound(pb)) ?? 0);
		expect((await resolveGuestSession(fresh, pb, pb)).code).toBe(CODE);
	});

	it('leaves a cookie from before the round stamp alone until the first reset', async () => {
		const pb = camp();
		const cookies = fakeCookies({ [GUEST_COOKIE]: CODE });

		expect((await resolveGuestSession(cookies, pb, pb)).code).toBe(CODE);

		await bumpGuestRound(pb);
		expect((await resolveGuestSession(cookies, pb, pb)).signedOut).toBe('round');
	});

	it('signs nobody out while PocketBase cannot answer', async () => {
		const down = {
			collection: () => ({
				getOne: () => Promise.reject(new Error('connection refused')),
				getFirstListItem: () => Promise.reject(new Error('connection refused'))
			}),
			filter: (expr: string) => expr
		} as unknown as TypedPocketBase;
		const cookies = fakeCookies({ [GUEST_COOKIE]: CODE, [ROUND_COOKIE]: '0' });

		const session = await resolveGuestSession(cookies, down, down);
		expect(session.code).toBe(CODE);
		expect(session.order).toBeUndefined();
		expect(session.signedOut).toBeUndefined();
		expect(cookies.deleted).toEqual([]);
	});

	it('is no session at all without a cookie', async () => {
		const pb = camp();
		const session = await resolveGuestSession(fakeCookies(), pb, pb);
		expect(session).toEqual({ code: null });
	});
});
