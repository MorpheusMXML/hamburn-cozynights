// tests/integration/guest-session.test.ts — the guest session against a real
// PocketBase: the migration's `guest_round` field, the round the sign-in
// carries, and the two things that end a session (the ticket is gone, a reset
// started a new round). The rules themselves: tests/guest-session.test.ts.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type PocketBase from 'pocketbase';
import type { TypedPocketBase } from '../../src/lib/pocketbase-types';
import { APP_SETTINGS_ID } from '../../src/lib/server/constants';
import {
	GUEST_COOKIE,
	ROUND_COOKIE,
	bumpGuestRound,
	readGuestRound,
	resolveGuestSession,
	setGuestSession
} from '../../src/lib/server/guest-session';
import { anonymous, seedTicket, serviceAccount } from '../stack-helpers';

let su: PocketBase;
let guestPb: PocketBase;
let originalRound: number;

/** Just enough of SvelteKit's `cookies` (see tests/guest-session.test.ts). */
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

const resolve = (cookies: ReturnType<typeof fakeCookies>) =>
	resolveGuestSession(cookies, guestPb as TypedPocketBase, su as TypedPocketBase);

beforeAll(async () => {
	su = await serviceAccount();
	// The guest's own connection is anonymous: app_settings is public read.
	guestPb = anonymous();
	originalRound = (await readGuestRound(su as TypedPocketBase)) ?? 0;
});

afterAll(async () => {
	await su.collection('app_settings').update(APP_SETTINGS_ID, { guest_round: originalRound });
});

describe('the round field', () => {
	it('is part of app_settings after the migration', async () => {
		const settings = await su.collection('app_settings').getOne(APP_SETTINGS_ID);
		expect(settings).toHaveProperty('guest_round');
		expect(Number(settings.guest_round) || 0).toBeGreaterThanOrEqual(0);
	});

	it('is readable without signing in, and written by the service account', async () => {
		const before = (await readGuestRound(guestPb as TypedPocketBase)) ?? 0;
		const next = await bumpGuestRound(su as TypedPocketBase);
		expect(next).toBe(before + 1);
		expect(await readGuestRound(guestPb as TypedPocketBase)).toBe(next);
	});
});

describe('a signed-in ticket', () => {
	it('stays signed in, and is signed out by a reset', async () => {
		const { code } = await seedTicket(su);
		const cookies = fakeCookies();
		setGuestSession(cookies, code, (await readGuestRound(guestPb as TypedPocketBase)) ?? 0);
		expect(cookies.jar[GUEST_COOKIE]).toBe(code);

		const signedIn = await resolve(cookies);
		expect(signedIn.code).toBe(code);
		expect(signedIn.order?.id).toBeTruthy();
		expect(signedIn.signedOut).toBeUndefined();

		// A reset between rounds ends it, and the cookies are gone.
		await bumpGuestRound(su as TypedPocketBase);
		const afterReset = await resolve(cookies);
		expect(afterReset.code).toBe(null);
		expect(afterReset.signedOut).toBe('round');
		expect(cookies.deleted).toEqual([GUEST_COOKIE, ROUND_COOKIE]);
	});

	it('is signed out when its code leaves the ticket list', async () => {
		const { code, order } = await seedTicket(su);
		const cookies = fakeCookies();
		setGuestSession(cookies, code, (await readGuestRound(guestPb as TypedPocketBase)) ?? 0);
		expect((await resolve(cookies)).code).toBe(code);

		await su.collection('orders').delete(order.id);
		const gone = await resolve(cookies);
		expect(gone.code).toBe(null);
		expect(gone.signedOut).toBe('expired');
		expect(cookies.deleted).toEqual([GUEST_COOKIE, ROUND_COOKIE]);
	});
});
