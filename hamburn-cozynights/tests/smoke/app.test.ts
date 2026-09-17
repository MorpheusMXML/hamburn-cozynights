// tests/smoke/app.test.ts — the running app over plain HTTP, no browser.
//
// Two parts:
//  1. "any deployment": read-only checks that are safe against staging or
//     production (SMOKE_BASE_URL=https://… npm run smoke:remote). They write
//     nothing and need no credentials.
//  2. "full flow": guest login, booking and admin sessions. Only on the
//     throwaway stack of scripts/test-stack.sh (SMOKE_FULL=1), where the tests
//     own the database.
import { describe, it, expect, beforeAll } from 'vitest';
import type PocketBase from 'pocketbase';
import { APP_SETTINGS_ID } from '../../src/lib/server/constants';
import { adminCookie, createAdmin, seedHouse, seedTicket, serviceAccount } from '../stack-helpers';

const BASE = (process.env.SMOKE_BASE_URL || '').replace(/\/$/, '');
const FULL = process.env.SMOKE_FULL === '1';

if (!BASE) {
	throw new Error(
		'SMOKE_BASE_URL is not set — use `npm run test:smoke` (local stack) or `SMOKE_BASE_URL=https://… npm run smoke:remote`.'
	);
}

function get(path: string, cookie = '') {
	return fetch(BASE + path, {
		redirect: 'manual',
		headers: { accept: 'text/html', ...(cookie ? { cookie } : {}) }
	});
}

/** A plain HTML form post, like a browser without JavaScript. */
function post(path: string, fields: Record<string, string> = {}, cookie = '') {
	return fetch(BASE + path, {
		method: 'POST',
		redirect: 'manual',
		headers: {
			// Without it SvelteKit answers form actions with JSON (always HTTP 200).
			accept: 'text/html',
			'content-type': 'application/x-www-form-urlencoded',
			origin: BASE, // SvelteKit's CSRF check compares this with ORIGIN
			...(cookie ? { cookie } : {})
		},
		body: new URLSearchParams(fields).toString()
	});
}

describe('any deployment (read-only)', () => {
	it('serves the guest login page', async () => {
		const res = await get('/');
		expect(res.status).toBe(200);
		expect(await res.text()).toContain('name="bookingCode"');
	});

	it('reaches the database through the service account', async () => {
		// An unknown ticket code is only answered with 404 if the app could ask
		// PocketBase with a working service account. 503 = that chain is broken.
		const res = await post('/?/login', { bookingCode: 'smoke-check-not-a-ticket' });
		expect(res.status, 'app → PocketBase → service account').toBe(404);
		expect(res.headers.get('set-cookie') || '').not.toContain('bookingCode=');
	});

	it('sends guest pages without a ticket back to the login', async () => {
		const res = await get('/room/doesnotexist000');
		expect(res.status).toBe(303);
		expect(res.headers.get('location')).toBe('/');
	});

	it('shows the admin login page, with the backend reachable', async () => {
		const res = await get('/admin/login');
		const html = await res.text();
		expect(res.status).toBe(200);
		expect(html).toContain('ADMIN PORTAL');
		expect(html).not.toContain('BACKEND UNREACHABLE');
		if (process.env.SMOKE_EXPECT_GOOGLE === '1') expect(html).toContain('SIGN IN WITH GOOGLE');
	});

	it('keeps the admin area closed without a session', async () => {
		const page = await get('/admin');
		expect(page.status).toBe(303);
		expect(page.headers.get('location')).toBe('/admin/login');

		// Probe with an action that would do nothing even if the door were open
		// (renameHouse without a name) — this part also runs against real data.
		expect((await post('/admin?/renameHouse')).status).toBe(403);
		expect((await get('/admin/api/export-template')).status).toBe(403);
	});

	it('ignores a forged admin cookie', async () => {
		const b64 = (v: object) => Buffer.from(JSON.stringify(v)).toString('base64url');
		const token = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({
			id: 'forged',
			type: 'auth',
			collectionId: 'x',
			exp: Math.floor(Date.now() / 1000) + 3600
		})}.forged`;
		const record = {
			id: 'forged',
			collectionName: 'admins',
			email: 'boss@mauersegler.art',
			role: 'superuser'
		};
		const cookie = 'pb_auth=' + encodeURIComponent(JSON.stringify({ token, record }));

		expect((await get('/admin', cookie)).status).toBe(303);
		expect((await post('/admin?/renameHouse', {}, cookie)).status).toBe(403);
	});
});

// Skipped against a real site on purpose: these tests write data (tickets,
// houses, admin accounts, bookings) and need superuser access to the database.
describe.runIf(FULL)('full flow — writes data, test stack only (skipped on real sites)', () => {
	let su: PocketBase;

	async function setBookingOpen(open: boolean) {
		await su.collection('app_settings').update(APP_SETTINGS_ID, {
			is_booking_active: open,
			booking_unlock_at: ''
		});
	}

	async function guestLogin(code: string): Promise<string> {
		const res = await post('/?/login', { bookingCode: code });
		expect(res.status).toBe(303);
		expect(res.headers.get('location')).toBe('/map');
		const setCookie = res.headers.get('set-cookie') || '';
		expect(setCookie).toContain('bookingCode=');
		expect(setCookie).toContain('HttpOnly');
		return setCookie.split(';')[0];
	}

	beforeAll(async () => {
		su = await serviceAccount();
	});

	it('lets a guest sign in with a ticket code and see map and room', async () => {
		const { room, beds } = await seedHouse(su, 1);
		const { code } = await seedTicket(su);
		const cookie = await guestLogin(code);

		expect((await get('/map', cookie)).status).toBe(200);
		const roomPage = await get(`/room/${room.id}`, cookie);
		expect(roomPage.status).toBe(200);
		expect(await roomPage.text()).toContain(beds[0].label);
	});

	it('refuses bookings while booking is closed', async () => {
		const { room, beds } = await seedHouse(su, 1);
		const cookie = await guestLogin((await seedTicket(su)).code);
		await setBookingOpen(false);

		const res = await post(`/room/${room.id}?/bookBed`, { bedId: beds[0].id }, cookie);
		expect(res.status).toBe(403);
		expect((await su.collection('beds').getOne(beds[0].id)).occupied).toBe(false);
	});

	it('books a bed, protects it from the next guest, and releases it', async () => {
		const { room, beds } = await seedHouse(su, 1);
		const first = await seedTicket(su);
		const firstCookie = await guestLogin(first.code);
		const secondCookie = await guestLogin((await seedTicket(su)).code);
		await setBookingOpen(true);

		const booked = await post(
			`/room/${room.id}?/bookBed`,
			{ bedId: beds[0].id, guestName: 'Smoke Tester' },
			firstCookie
		);
		expect(booked.status).toBe(200);
		let bed = await su.collection('beds').getOne(beds[0].id);
		expect(bed.occupied).toBe(true);
		expect(bed.order).toBe(first.order.id);

		// other guests see the burner name, never the ticket code or customer name
		const asSecond = await (await get(`/room/${room.id}`, secondCookie)).text();
		expect(asSecond).toContain('Smoke Tester');
		expect(asSecond).not.toContain(first.code);
		expect(asSecond).not.toContain('Test Guest');

		const stolen = await post(`/room/${room.id}?/bookBed`, { bedId: beds[0].id }, secondCookie);
		expect(stolen.status).toBe(400);
		expect((await su.collection('beds').getOne(beds[0].id)).order).toBe(first.order.id);

		expect((await post(`/room/${room.id}?/unbookBed`, {}, firstCookie)).status).toBe(200);
		bed = await su.collection('beds').getOne(beds[0].id);
		expect(bed.occupied).toBe(false);
	});

	it('opens the admin area for approved admins only', async () => {
		const admin = await createAdmin(su, 'admin');
		const pending = await createAdmin(su, 'pending');

		const dashboard = await get('/admin', adminCookie(admin.client));
		expect(dashboard.status).toBe(200);
		expect(dashboard.headers.get('set-cookie') || '').toContain('HttpOnly');

		const waiting = await get('/admin', adminCookie(pending.client));
		expect(waiting.status).toBe(303);
		expect(waiting.headers.get('location')).toBe('/admin/login');
		expect(await (await get('/admin/login', adminCookie(pending.client))).text()).toContain(
			'ACCESS REQUESTED'
		);
		expect((await post('/admin?/togglePhase', {}, adminCookie(pending.client))).status).toBe(403);
	});

	it('drops an admin session as soon as the account is removed', async () => {
		const admin = await createAdmin(su, 'admin');
		const cookie = adminCookie(admin.client);
		expect((await get('/admin', cookie)).status).toBe(200);

		await su.collection('admins').delete(admin.id);
		expect((await get('/admin', cookie)).status).toBe(303);
	});

	it('reserves "clear all bookings" for superusers and keeps the tickets', async () => {
		const { room, beds } = await seedHouse(su, 1);
		const ticket = await seedTicket(su);
		const guestCookie = await guestLogin(ticket.code);
		await setBookingOpen(true);
		await post(`/room/${room.id}?/bookBed`, { bedId: beds[0].id }, guestCookie);
		expect((await su.collection('beds').getOne(beds[0].id)).occupied).toBe(true);

		const admin = await createAdmin(su, 'admin');
		const denied = await post('/admin?/clearAllBookings', {}, adminCookie(admin.client));
		expect(denied.status).toBe(403);
		expect((await su.collection('beds').getOne(beds[0].id)).occupied).toBe(true);

		const boss = await createAdmin(su, 'superuser');
		const cleared = await post('/admin?/clearAllBookings', {}, adminCookie(boss.client));
		expect(cleared.status).toBe(200);
		expect((await su.collection('beds').getOne(beds[0].id)).occupied).toBe(false);
		// the ticket roster survives: the guest's code still works
		expect((await su.collection('orders').getOne(ticket.order.id)).order_number).toBe(ticket.code);
		await guestLogin(ticket.code);
	});
});
