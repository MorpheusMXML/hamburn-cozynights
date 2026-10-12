// tests/login-steps.test.ts — the start page's sign-in with the steps against
// guessing (src/routes/+page.server.ts, $lib/server/login-guard): code plus
// e-mail address, unpaid tickets, and "send me my code".
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FakePb } from './fake-pb';
import { APP_SETTINGS_ID } from '../src/lib/server/constants';
import { createLookupHash } from '../src/lib/server/crypto';

vi.mock('$env/dynamic/private', () => ({
	env: {
		ENCRYPTION_KEY: '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff',
		PB_ADMIN_EMAIL: 'admin@test.com',
		PB_ADMIN_PASSWORD: 'password'
	}
}));

const requestCodeMail = vi.fn(async () => 'queued');
vi.mock('$lib/server/code-mail', () => ({ requestCodeMail }));
vi.mock('$lib/server/pocketbase', () => ({ getAdminPb: vi.fn(async () => new FakePb()) }));

type Actions = (typeof import('../src/routes/+page.server'))['actions'];
let actions: Actions;

beforeEach(async () => {
	// a fresh module: the steps are counted in it
	vi.resetModules();
	requestCodeMail.mockClear();
	actions = (await import('../src/routes/+page.server')).actions;
});

function camp() {
	const pb = new FakePb();
	pb.seed('app_settings', { id: APP_SETTINGS_ID, guest_round: 0 });
	pb.seed('orders', {
		order_number: 'PAID1',
		order_hash: createLookupHash('PAID1'),
		email: 'guest@example.org'
	});
	pb.seed('orders', {
		order_number: 'OPEN1',
		order_hash: createLookupHash('OPEN1'),
		email: 'late@example.org',
		unpaid: true
	});
	return pb;
}

function cookies() {
	return { set: vi.fn(), get: vi.fn(), delete: vi.fn() };
}

async function signIn(pb: FakePb, fields: Record<string, string>, ip = '203.0.113.7') {
	const form = new FormData();
	for (const [name, value] of Object.entries(fields)) form.set(name, value);
	try {
		return await actions.login({
			request: { formData: async () => form },
			cookies: cookies(),
			locals: { pb, adminPb: pb },
			getClientAddress: () => ip
		} as any);
	} catch (thrown: any) {
		return thrown; // the redirect after a sign-in
	}
}

async function askForCode(pb: FakePb, email: string, ip = '203.0.113.7') {
	const form = new FormData();
	form.set('email', email);
	return actions.sendCode({
		request: { formData: async () => form },
		locals: { pb, adminPb: pb },
		getClientAddress: () => ip
	} as any);
}

describe('signing in', () => {
	it('signs in with a paid code and counts nothing', async () => {
		const pb = camp();
		for (let i = 0; i < 6; i++) {
			const result = await signIn(pb, { bookingCode: 'PAID1' });
			expect(result.status).toBe(303);
		}
	});

	it('offers the e-mail after 3 wrong codes and needs it after 5', async () => {
		const pb = camp();
		const first = await signIn(pb, { bookingCode: 'WRONG1' });
		expect(first.status).toBe(404);
		expect(first.data.offerMail).toBe(false);
		await signIn(pb, { bookingCode: 'WRONG2' });
		const third = await signIn(pb, { bookingCode: 'WRONG3' });
		expect(third.data).toMatchObject({ offerMail: true, needEmail: false });
		await signIn(pb, { bookingCode: 'WRONG4' });
		const fifth = await signIn(pb, { bookingCode: 'WRONG5' });
		expect(fifth.data).toMatchObject({ offerMail: true, needEmail: true });

		// now the right code alone isn't enough, and asking for the address is no guess
		const codeOnly = await signIn(pb, { bookingCode: 'PAID1' });
		expect(codeOnly.status).toBe(400);
		expect(codeOnly.data.error).toMatch(/e-mail address of your ticket/);
		const wrongAddress = await signIn(pb, { bookingCode: 'PAID1', email: 'other@example.org' });
		expect(wrongAddress.status).toBe(404);
		expect(wrongAddress.data.error).toMatch(/don't belong to the same ticket/);
		const both = await signIn(pb, { bookingCode: 'PAID1', email: 'Guest@Example.org ' });
		expect(both.status).toBe(303);

		// another connection is not affected
		expect((await signIn(pb, { bookingCode: 'PAID1' }, '198.51.100.1')).status).toBe(303);
	});

	it('stops a connection after 10 wrong codes, also an IPv6 /64', async () => {
		const pb = camp();
		for (let i = 0; i < 10; i++) {
			const ip = `2a01:4f8:c0c:1234::${(i + 1).toString(16)}`;
			await signIn(pb, { bookingCode: `WRONG${i}`, email: 'guest@example.org' }, ip);
		}
		const stopped = await signIn(
			pb,
			{ bookingCode: 'PAID1', email: 'guest@example.org' },
			'2a01:4f8:c0c:1234:ffff::9'
		);
		expect(stopped.status).toBe(429);
		expect(stopped.data.error).toMatch(/try again in 15 minutes/);
	});

	it('tells an unpaid ticket to settle the invoice, without counting it as a guess', async () => {
		const pb = camp();
		for (let i = 0; i < 6; i++) {
			const unpaid = await signIn(pb, { bookingCode: 'OPEN1' });
			expect(unpaid.status).toBe(403);
			expect(unpaid.data.unpaid).toBe(true);
			expect(unpaid.data.error).toMatch(/still unpaid.*Membership Team.*due invoice/);
		}
	});
});

describe('send me my code', () => {
	it('answers the same for any address and asks in the background', async () => {
		const pb = camp();
		for (const email of ['guest@example.org', 'nobody@example.org']) {
			expect(await askForCode(pb, email)).toEqual({ mailSent: true });
		}
		expect(requestCodeMail).toHaveBeenCalledWith(pb, 'guest@example.org');
		expect(requestCodeMail).toHaveBeenCalledWith(pb, 'nobody@example.org');
	});

	it('wants an e-mail address', async () => {
		const result: any = await askForCode(camp(), 'not an address');
		expect(result.status).toBe(400);
		expect(requestCodeMail).not.toHaveBeenCalled();
	});

	it('asks at most 5 times an hour from one connection', async () => {
		const pb = camp();
		for (let i = 0; i < 5; i++) await askForCode(pb, `guest${i}@example.org`);
		const sixth: any = await askForCode(pb, 'guest6@example.org');
		expect(sixth.status).toBe(429);
		expect(requestCodeMail).toHaveBeenCalledTimes(5);
	});
});
