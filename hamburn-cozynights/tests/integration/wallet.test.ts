// tests/integration/wallet.test.ts — wallet passes against a real PocketBase:
// the two download routes, Apple's web service (register, what changed, the
// pass itself, unregister) and the sync that keeps passes up to date. Apple's
// push service and Google's Wallet API are stand-ins in this process; nothing
// here talks to Apple or Google.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type PocketBase from 'pocketbase';
import { env } from '../../src/env-mock/dynamic/private';
import { BookingService } from '../../src/lib/server/booking';
import { formatPassCode } from '../../src/lib/pass';
import { appleAuthToken } from '../../src/lib/server/wallet/apple';
import { resetWalletConfig, walletConfig } from '../../src/lib/server/wallet/config';
import { resetGoogleCaches } from '../../src/lib/server/wallet/google';
import { readZip } from '../../src/lib/server/wallet/zip';
import { syncWalletPasses } from '../../src/lib/server/wallet/sync';
import { applePushService, googleWalletApi, testWalletEnv } from '../wallet-fixtures';
import { cozyAdmin, seedHouse, seedTicket, serviceAccount, uid } from '../stack-helpers';

const PASS_TYPE = 'pass.test.cozynights';

let su: PocketBase;
let booking: BookingService;
let apple: Awaited<ReturnType<typeof applePushService>>;
let google: Awaited<ReturnType<typeof googleWalletApi>>;

/** The route modules read the configuration from the environment, like the app. */
function useWalletEnv(overrides: Record<string, string | undefined> = {}) {
	const values = testWalletEnv({
		WALLET_APPLE_APNS_URL: apple.url,
		...google.urls,
		...overrides
	});
	for (const [key, value] of Object.entries(values)) {
		if (value === undefined || value === '') delete (env as Record<string, unknown>)[key];
		else (env as Record<string, string>)[key] = value;
	}
	resetWalletConfig();
	resetGoogleCaches();
}

function walletEvent(code: string, path = '') {
	return {
		params: { code, passType: PASS_TYPE, serial: code.replace(/-/g, ''), device: 'device-1' },
		locals: { adminPb: su as any, pb: su as any, admin: null },
		url: new URL(`https://cozy.test/pass/${code}${path}`),
		getClientAddress: () => '203.0.113.9',
		request: new Request(`https://cozy.test/pass/${code}${path}`)
	} as any;
}

/** A ticket with a spot and its pass code. */
async function guestWithSpot() {
	const { beds } = await seedHouse(su, 2);
	const guest = await seedTicket(su);
	await booking.bookBed(guest.order as any, beds[0].id, `Sunny ${uid()}`);
	const order = await su.collection('orders').getOne(guest.order.id);
	return { order, beds, code: formatPassCode(order.pass_code), serial: order.pass_code };
}

/** The spot a seeded bed shows on a pass. */
const spotOf = (bed: Record<string, unknown>) => String(bed.label);

beforeAll(async () => {
	su = await serviceAccount();
	booking = new BookingService(su as any);
	apple = await applePushService((token) => (token.startsWith('dead') ? 410 : 200));
	google = await googleWalletApi();
});

afterAll(() => {
	apple.close();
	google.close();
	resetWalletConfig();
});

beforeEach(() => {
	apple.seen.length = 0;
	google.calls.length = 0;
	google.store.clear();
	google.fail(0);
	useWalletEnv();
});

describe('adding a pass to a wallet', () => {
	it('hands out a signed Apple pass and remembers it', async () => {
		const { code, serial, order, beds } = await guestWithSpot();
		const { GET } = await import('../../src/routes/pass/[code]/wallet/apple/+server');
		const res = await GET(walletEvent(code, '/wallet/apple'));

		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toBe('application/vnd.apple.pkpass');
		expect(res.headers.get('content-disposition')).toContain(`cozynights-pass-${code}.pkpass`);
		const files = readZip(Buffer.from(await res.arrayBuffer()));
		const pass = JSON.parse(files.get('pass.json')!.toString('utf8'));
		expect(pass).toMatchObject({ serialNumber: serial, passTypeIdentifier: PASS_TYPE });
		expect(pass.eventTicket.headerFields[0].value).toBe(spotOf(beds[0]));
		expect(files.get('signature')!.length).toBeGreaterThan(500);

		const row = await su
			.collection('wallet_passes')
			.getFirstListItem(su.filter('platform = "apple" && serial = {:serial}', { serial }));
		expect(row).toMatchObject({ order: order.id, pushed_hash: row.hash });
		expect(row.hash).not.toBe('');
	});

	it('writes the Google object and sends the guest to the save link', async () => {
		const { code, serial, beds } = await guestWithSpot();
		const { GET } = await import('../../src/routes/pass/[code]/wallet/google/+server');
		const redirect = await Promise.resolve(GET(walletEvent(code, '/wallet/google'))).catch(
			(err: any) => err
		);

		expect(redirect.status).toBe(303);
		expect(redirect.location).toContain('https://pay.google.com/gp/v/save/');
		const object = google.store.get(
			`eventTicketObject/3388000000012345678.cozy-test-${serial}`
		) as any;
		expect(object.state).toBe('ACTIVE');
		expect(object.seatInfo.seat.defaultValue.value).toBe(spotOf(beds[0]));
		expect(google.store.has('eventTicketClass/3388000000012345678.cozynights-cozy-test')).toBe(
			true
		);
		expect(
			await su
				.collection('wallet_passes')
				.getFirstListItem(su.filter('platform = "google" && serial = {:serial}', { serial }))
		).toBeTruthy();
	});

	it('is not offered when the wallet is off, and never for an unknown code', async () => {
		const { code } = await guestWithSpot();
		useWalletEnv({
			WALLET_APPLE_CERT: '',
			WALLET_APPLE_PASS_TYPE_ID: '',
			WALLET_APPLE_TEAM_ID: ''
		});
		const { GET } = await import('../../src/routes/pass/[code]/wallet/apple/+server');
		await expect(GET(walletEvent(code, '/wallet/apple'))).rejects.toMatchObject({ status: 404 });

		useWalletEnv();
		await expect(GET(walletEvent('ZZZZ-YYYY-XXXX', '/wallet/apple'))).rejects.toMatchObject({
			status: 404
		});
	});
});

describe("Apple's web service", () => {
	async function register(serial: string, pushToken: string, token = appleAuthToken(serial)) {
		const { POST } =
			await import('../../src/routes/wallet/apple/v1/devices/[device]/registrations/[passType]/[serial]/+server');
		return POST({
			params: { device: 'device-1', passType: PASS_TYPE, serial },
			locals: { adminPb: su as any, pb: su as any },
			request: new Request('https://cozy.test/wallet/apple/v1/…', {
				method: 'POST',
				headers: { authorization: `ApplePass ${token}`, 'content-type': 'application/json' },
				body: JSON.stringify({ pushToken })
			})
		} as any);
	}

	it('registers a device, lists what changed, hands out the pass and unregisters again', async () => {
		const { code, serial, beds, order } = await guestWithSpot();
		const { GET: download } = await import('../../src/routes/pass/[code]/wallet/apple/+server');
		await download(walletEvent(code, '/wallet/apple'));

		expect((await register(serial, 'aaaa0000aaaa0000')).status).toBe(201);
		expect((await register(serial, 'aaaa0000aaaa0000')).status).toBe(200); // again: known
		await expect(register(serial, 'aaaa0000aaaa0000', 'wrong-token-0000')).rejects.toMatchObject({
			status: 401
		});

		// Nothing changed yet, so the device is up to date.
		const { GET: serials } =
			await import('../../src/routes/wallet/apple/v1/devices/[device]/registrations/[passType]/+server');
		const listEvent = (since: string) =>
			({
				params: { device: 'device-1', passType: PASS_TYPE },
				locals: { adminPb: su as any, pb: su as any },
				url: new URL(
					`https://cozy.test/wallet/apple/v1/devices/device-1/registrations/${PASS_TYPE}?passesUpdatedSince=${since}`
				)
			}) as any;
		const first = await serials(listEvent(String(Date.now())));
		expect(first.status).toBe(204);

		// The crew moves the guest: the sync notes the change and pushes.
		await booking.bookBed(order as any, beds[1].id, 'Sunny');
		const report = await syncWalletPasses(su as any, walletConfig());
		expect(report.pushed).toBeGreaterThan(0);
		expect(apple.seen.map((p) => p.token)).toContain('aaaa0000aaaa0000');

		const changed = await serials(listEvent('0'));
		expect(changed.status).toBe(200);
		const body = (await changed.json()) as { serialNumbers: string[]; lastUpdated: string };
		expect(body.serialNumbers).toContain(serial);

		// The device fetches the new pass, and gets 304 while it is unchanged.
		const { GET: latest } =
			await import('../../src/routes/wallet/apple/v1/passes/[passType]/[serial]/+server');
		const passEvent = (headers: Record<string, string>) =>
			({
				params: { passType: PASS_TYPE, serial },
				locals: { adminPb: su as any, pb: su as any },
				request: new Request('https://cozy.test/wallet/apple/v1/passes', {
					headers: { authorization: `ApplePass ${appleAuthToken(serial)}`, ...headers }
				})
			}) as any;
		const fresh = await latest(passEvent({}));
		expect(fresh.status).toBe(200);
		const modified = fresh.headers.get('last-modified')!;
		const again = await latest(passEvent({ 'if-modified-since': modified }));
		expect(again.status).toBe(304);
		const spot = JSON.parse(
			readZip(Buffer.from(await fresh.arrayBuffer()))
				.get('pass.json')!
				.toString('utf8')
		);
		expect(spot.eventTicket.headerFields[0].value).toBe(spotOf(beds[1]));

		const { DELETE } =
			await import('../../src/routes/wallet/apple/v1/devices/[device]/registrations/[passType]/[serial]/+server');
		const gone = await DELETE({
			params: { device: 'device-1', passType: PASS_TYPE, serial },
			locals: { adminPb: su as any, pb: su as any },
			request: new Request('https://cozy.test/wallet/apple/v1/…', {
				method: 'DELETE',
				headers: { authorization: `ApplePass ${appleAuthToken(serial)}` }
			})
		} as any);
		expect(gone.status).toBe(200);
		expect(
			await su.collection('wallet_devices').getFullList({ filter: 'device = "device-1"' })
		).toHaveLength(0);
	});

	it('takes the log of a device without telling it anything', async () => {
		const { POST } = await import('../../src/routes/wallet/apple/v1/log/+server');
		const res = await POST({
			request: new Request('https://cozy.test/wallet/apple/v1/log', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ logs: ['[cozy] could not verify the pass'] })
			})
		} as any);
		expect(res.status).toBe(200);
		expect(await res.text()).toBe('');
	});
});

describe('the sync in the real database', () => {
	it('voids the pass of a ticket that changed hands, and forgets the devices afterwards', async () => {
		const { code, serial, order } = await guestWithSpot();
		const { GET: appleDownload } =
			await import('../../src/routes/pass/[code]/wallet/apple/+server');
		const { GET: googleSave } = await import('../../src/routes/pass/[code]/wallet/google/+server');
		await appleDownload(walletEvent(code, '/wallet/apple'));
		await Promise.resolve(googleSave(walletEvent(code, '/wallet/google'))).catch(() => null); // redirect
		const pass = await su
			.collection('wallet_passes')
			.getFirstListItem(su.filter('platform = "apple" && serial = {:serial}', { serial }));
		await su
			.collection('wallet_devices')
			.create({ pass: pass.id, device: `device-${uid()}`, push_token: 'aaaa0000aaaa0000' });

		// The ticket is handed over: it gets a new pass code, so the old wallet
		// passes belong to nobody.
		await su.collection('orders').update(order.id, { pass_code: '' });
		await su.send(`/api/cozy/pass/${order.id}`, { method: 'POST' });
		const report = await syncWalletPasses(su as any, walletConfig());
		expect(report.changed).toBeGreaterThan(0);

		const object = google.store.get(
			`eventTicketObject/3388000000012345678.cozy-test-${serial}`
		) as any;
		expect(object.state).toBe('INACTIVE');
		const applePass = JSON.parse(
			readZip(
				Buffer.from(
					await (
						await (
							await import('../../src/routes/wallet/apple/v1/passes/[passType]/[serial]/+server')
						).GET({
							params: { passType: PASS_TYPE, serial },
							locals: { adminPb: su as any, pb: su as any },
							request: new Request('https://cozy.test/wallet/apple/v1/passes', {
								headers: { authorization: `ApplePass ${appleAuthToken(serial)}` }
							})
						} as any)
					).arrayBuffer()
				)
			)
				.get('pass.json')!
				.toString('utf8')
		);
		expect(applePass.voided).toBe(true);

		// After the event the device registrations go with the contacts.
		const output = cozyAdmin(['tickets', 'forget-contacts', '--yes']);
		expect(output).toMatch(/wallet device registration\(s\)/);
		expect(await su.collection('wallet_devices').getFullList()).toHaveLength(0);
		expect(await su.collection('wallet_passes').getFullList()).not.toHaveLength(0);
	});

	it('publishes which wallets exist, for the messages PocketBase sends', async () => {
		await syncWalletPasses(su as any, walletConfig());
		const settings = await su.collection('app_settings').getOne('appsettings0123');
		expect(settings.wallet_platforms).toBe('apple,google');
	});
});
