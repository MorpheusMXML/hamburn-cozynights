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
		expect(res.headers.get('location')).toBe('/?login=required');

		const request = await get('/special-needs');
		expect(request.status).toBe(303);
		expect(request.headers.get('location')).toBe('/?login=required');
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

		// special-needs requests: what guests wrote is for admins only
		const requests = await get('/admin/requests');
		expect(requests.status).toBe(303);
		expect(requests.headers.get('location')).toBe('/admin/login');
		expect((await post('/admin/requests?/approve', { id: 'doesnotexist000' })).status).toBe(403);

		// message texts: the editor and its preview are for admins only
		const messages = await get('/admin/messages');
		expect(messages.status).toBe(303);
		expect(messages.headers.get('location')).toBe('/admin/login');
		expect((await post('/admin/messages?/save', { key: 'mail.signature', text: 'x' })).status).toBe(
			403
		);
		expect((await post('/admin/messages/preview')).status).toBe(403);
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

	it('sends the security headers on every page', async () => {
		for (const path of ['/', '/legal-notice', '/admin/login']) {
			const res = await get(path);
			expect(res.headers.get('x-content-type-options'), path).toBe('nosniff');
			expect(res.headers.get('x-frame-options'), path).toBe('DENY');
			expect(res.headers.get('content-security-policy'), path).toContain("frame-ancestors 'none'");
			expect(res.headers.get('referrer-policy'), path).toBe('strict-origin-when-cross-origin');
		}
		// Only the TLS terminator sends HSTS, so it is checked on real sites only.
		if (BASE.startsWith('https://')) {
			const res = await get('/');
			expect(res.headers.get('strict-transport-security') || '').toContain('max-age=');
		}
	});

	it('reports readiness only with a working service account', async () => {
		const res = await get('/api/health');
		expect(res.status, 'app → PocketBase → service account').toBe(200);
		expect(await res.json()).toEqual({ status: 'ok' });
		expect(res.headers.get('cache-control')).toContain('no-store');
	});

	it('does not expose PocketBase on the public host', async () => {
		// The browser never talks to PocketBase; its API and dashboard must not
		// be reachable through the site (they would answer with JSON / the UI).
		for (const path of [
			'/_/',
			'/api/collections',
			'/api/collections/orders/records',
			'/pb/api/health'
		]) {
			const res = await get(path);
			expect(res.status, path).toBe(404);
			expect(res.headers.get('content-type') || '', path).not.toContain('application/json');
		}
	});

	it('answers unknown booking passes with 404 and keeps the check-in for admins', async () => {
		const unknown = await get('/pass/AAAA-BBBB-CCCC');
		expect(unknown.status).toBe(404);
		expect(unknown.headers.get('referrer-policy')).toBe('no-referrer');
		expect((await get('/pass/not-a-pass')).status).toBe(404);
		expect((await get('/admin/check')).status).toBe(303);
		// an unknown code: nothing would change even if the door were open
		expect((await post('/admin/check?/checkin', { code: 'AAAA-BBBB-CCCC' })).status).toBe(403);
		expect((await post('/admin/check?/undo', { code: 'AAAA-BBBB-CCCC' })).status).toBe(403);
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
		// 409 Conflict since the English-only guest messages (6520061)
		expect(stolen.status).toBe(409);
		expect((await su.collection('beds').getOne(beds[0].id)).order).toBe(first.order.id);

		expect((await post(`/room/${room.id}?/unbookBed`, {}, firstCookie)).status).toBe(200);
		bed = await su.collection('beds').getOne(beds[0].id);
		expect(bed.occupied).toBe(false);
	});

	it('shows the guest a booking pass that the crew can check', async () => {
		const { room, beds } = await seedHouse(su, 1);
		const ticket = await seedTicket(su);
		const cookie = await guestLogin(ticket.code);
		await setBookingOpen(true);
		await post(
			`/room/${room.id}?/bookBed`,
			{ bedId: beds[0].id, guestName: 'Pass Tester' },
			cookie
		);

		const code = (await su.collection('orders').getOne(ticket.order.id)).pass_code as string;
		const shown = code.replace(/(.{4})(?=.)/g, '$1-');
		expect(await (await get(`/room/${room.id}`, cookie)).text()).toContain(`/pass/${shown}`);

		// anyone with the link: spot and burner name, never whose ticket it is
		const guestView = await (await get(`/pass/${shown}`)).text();
		expect(guestView).toContain(beds[0].label);
		expect(guestView).toContain('Pass Tester');
		expect(guestView).not.toContain('Test Guest');
		expect(guestView).not.toContain(ticket.code);
		const gif = await get(`/pass/${shown}/qr.gif`);
		expect(gif.headers.get('content-type')).toBe('image/gif');

		// the crew: the same link shows the booking and a Check in button
		const admin = await createAdmin(su, 'admin');
		const crewView = await (await get(`/pass/${shown}`, adminCookie(admin.client))).text();
		expect(crewView).toContain('BOOKED');
		expect(crewView).toContain('Test Guest');
		expect(crewView).toContain('action="/admin/check?/checkin"');
		// opening the pass changes nothing
		expect((await su.collection('beds').getOne(beds[0].id)).checked_in_at).toBe('');
	});

	it('lets only admins and superusers check guests in, never a ticket code', async () => {
		const { room, beds } = await seedHouse(su, 1);
		const ticket = await seedTicket(su);
		const guest = await guestLogin(ticket.code);
		await setBookingOpen(true);
		await post(`/room/${room.id}?/bookBed`, { bedId: beds[0].id, guestName: 'Arriver' }, guest);
		const code = (await su.collection('orders').getOne(ticket.order.id)).pass_code as string;
		const shown = code.replace(/(.{4})(?=.)/g, '$1-');
		const checkedIn = async () => (await su.collection('beds').getOne(beds[0].id)).checked_in_at;

		// the ticket holder, a pending access request, nobody: refused before any action runs
		const pending = await createAdmin(su, 'pending');
		for (const cookie of [guest, adminCookie(pending.client), '']) {
			expect((await post('/admin/check?/checkin', { code: shown }, cookie)).status).toBe(403);
		}
		expect(await checkedIn()).toBe('');

		const admin = await createAdmin(su, 'admin');
		const checked = await post('/admin/check?/checkin', { code: shown }, adminCookie(admin.client));
		expect(checked.status).toBe(200);
		expect(await checked.text()).toContain('CHECKED IN');
		const stored = await su.collection('beds').getOne(beds[0].id);
		expect(stored.checked_in_by).toBe(admin.email);

		// the crew sees it, the guest's pass link doesn't
		const crewView = await (await get(`/pass/${shown}`, adminCookie(admin.client))).text();
		expect(crewView).toContain('CHECKED IN');
		const guestView = await (await get(`/pass/${shown}`)).text();
		expect(guestView).not.toContain('CHECKED IN');
		expect(guestView).not.toContain(admin.email);

		// the guest can't give the spot up anymore, and can't undo the check-in
		expect((await post(`/room/${room.id}?/unbookBed`, {}, guest)).status).toBe(409);
		expect((await post('/admin/check?/undo', { code: shown }, guest)).status).toBe(403);
		expect((await su.collection('beds').getOne(beds[0].id)).order).toBe(ticket.order.id);

		// a superuser can undo it; then the guest may release again
		const boss = await createAdmin(su, 'superuser');
		expect(
			(await post('/admin/check?/undo', { code: shown }, adminCookie(boss.client))).status
		).toBe(200);
		expect(await checkedIn()).toBe('');
		expect((await post(`/room/${room.id}?/unbookBed`, {}, guest)).status).toBe(200);
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
		expect((await post('/admin?/setPhase', {}, adminCookie(pending.client))).status).toBe(403);
	});

	it('drops an admin session as soon as the account is removed', async () => {
		const admin = await createAdmin(su, 'admin');
		const cookie = adminCookie(admin.client);
		expect((await get('/admin', cookie)).status).toBe(200);

		await su.collection('admins').delete(admin.id);
		expect((await get('/admin', cookie)).status).toBe(303);
	});

	it('takes a special-needs request while booking is closed, and lets an admin book the spot', async () => {
		await setBookingOpen(false);
		await su.collection('app_settings').update(APP_SETTINGS_ID, { special_requests_open: true });
		try {
			const { room, beds } = await seedHouse(su, 1);
			await su.collection('beds').update(beds[0].id, { is_special: true });
			const ticket = await seedTicket(su);
			const cookie = await guestLogin(ticket.code);

			const sent = await post(
				'/special-needs?/save',
				{ needs: 'step_free', text: 'Smoke: step-free access please.', consent: 'yes' },
				cookie
			);
			expect(sent.status).toBe(200);
			const request = await su
				.collection('special_requests')
				.getFirstListItem(su.filter('order = {:id}', { id: ticket.order.id }));
			expect(request.status).toBe('pending');
			expect(request.reason).not.toContain('Smoke');

			// the guest's own page shows it; other guests' pages never mark special spots
			expect(await (await get('/special-needs', cookie)).text()).toContain('Waiting for the crew');
			const otherGuest = await guestLogin((await seedTicket(su)).code);
			const roomHtml = await (await get(`/room/${room.id}`, otherGuest)).text();
			expect(roomHtml).toContain('Reserved by the crew');
			expect(roomHtml).not.toContain('is_special');

			const admin = await createAdmin(su, 'admin');
			const list = await (await get('/admin/requests', adminCookie(admin.client))).text();
			expect(list).toContain('Smoke: step-free access please.');
			const assigned = await post(
				'/admin/requests?/assign',
				{ id: request.id, bedId: beds[0].id },
				adminCookie(admin.client)
			);
			expect(assigned.status).toBe(200);
			expect((await su.collection('beds').getOne(beds[0].id)).order).toBe(ticket.order.id);
			expect((await su.collection('special_requests').getOne(request.id)).status).toBe('approved');

			// the crew picked it: once booking opens, the guest can't release it
			await setBookingOpen(true);
			expect((await post(`/room/${room.id}?/unbookBed`, {}, cookie)).status).toBe(409);
			expect((await su.collection('beds').getOne(beds[0].id)).order).toBe(ticket.order.id);
		} finally {
			await su.collection('app_settings').update(APP_SETTINGS_ID, { special_requests_open: false });
		}
	});

	it('lets admins find a ticket and change its address; the ticket list is for superusers', async () => {
		const ticket = await seedTicket(su);
		const admin = await createAdmin(su, 'admin');
		const cookie = adminCookie(admin.client);

		const page = await get('/admin/tickets', cookie);
		expect(page.status).toBe(200);
		expect(await page.text()).toContain('Find a ticket');

		// without JavaScript, the action answers with the page and the result
		const found = await post('/admin/tickets?/search', { q: ticket.code.toLowerCase() }, cookie);
		expect(found.status).toBe(200);
		expect(await found.text()).toContain(ticket.code);

		const email = `smoke-${Date.now()}@example.com`;
		const saved = await post(
			'/admin/tickets?/update',
			{ id: ticket.order.id, email, name: 'Smoke Holder' },
			cookie
		);
		expect(saved.status).toBe(200);
		expect(await su.collection('orders').getOne(ticket.order.id)).toMatchObject({
			email,
			customer_name: 'Smoke Holder'
		});

		const rows = JSON.stringify([{ line: 2, code: `SMOKE-${Date.now()}`, email: '', name: '' }]);
		expect((await post('/admin/tickets?/previewRoster', { rows }, cookie)).status).toBe(403);
		expect((await post('/admin/tickets?/importRoster', { rows }, cookie)).status).toBe(403);
		const boss = await createAdmin(su, 'superuser');
		const preview = await post('/admin/tickets?/previewRoster', { rows }, adminCookie(boss.client));
		expect(preview.status).toBe(200);
	});

	it('lets admins compare a layout file, and only superusers apply it in Staging Mode', async () => {
		const name = `Smoke Tent ${Date.now()}`;
		const layout = {
			format: 'cozynights-layout',
			version: '2.0',
			name: 'Smoke layout',
			houses: [
				{
					name,
					x: 900,
					y: 650,
					rooms: [{ name: 'Canvas', room_number: 1, beds: [{ label: 'T1' }] }]
				}
			]
		};
		const upload = (action: string, cookie: string, selection?: string[]) => {
			const form = new FormData();
			form.set(
				'template',
				new Blob([JSON.stringify(layout)], { type: 'application/json' }),
				'l.json'
			);
			if (selection) form.set('selection', JSON.stringify(selection));
			return fetch(`${BASE}/admin?/${action}`, {
				method: 'POST',
				redirect: 'manual',
				headers: { accept: 'text/html', origin: BASE, cookie },
				body: form
			});
		};
		const key = `h:${encodeURIComponent(name.toLowerCase())}`;
		const chosen = [key, `${key}/r:1`, `${key}/r:1/s:t1`];
		await setBookingOpen(false);

		const crew = adminCookie((await createAdmin(su, 'admin')).client);
		expect((await upload('previewTemplate', crew)).status).toBe(200);
		// Templates may be up to 1 MB: more than adapter-node's default body limit.
		const big = new FormData();
		const padded = { ...layout, name: 'x'.repeat(700 * 1024) };
		big.set('template', new Blob([JSON.stringify(padded)], { type: 'application/json' }), 'b.json');
		const bigPreview = await fetch(`${BASE}/admin?/previewTemplate`, {
			method: 'POST',
			redirect: 'manual',
			headers: { accept: 'text/html', origin: BASE, cookie: crew },
			body: big
		});
		expect(bigPreview.status).toBe(200);
		expect((await upload('importTemplate', crew, chosen)).status).toBe(403);

		const boss = adminCookie((await createAdmin(su, 'superuser')).client);
		expect((await upload('importTemplate', boss, chosen)).status).toBe(200);
		const house = await su
			.collection('houses')
			.getFirstListItem(su.filter('name = {:name}', { name }));
		expect(house).toMatchObject({ x: 900, y: 650 });
	});

	it('refuses a second spot for a ticket that already holds one (release first)', async () => {
		const { room, beds } = await seedHouse(su, 2);
		const ticket = await seedTicket(su);
		const cookie = await guestLogin(ticket.code);
		await setBookingOpen(true);

		expect((await post(`/room/${room.id}?/bookBed`, { bedId: beds[0].id }, cookie)).status).toBe(
			200
		);
		const second = await post(`/room/${room.id}?/bookBed`, { bedId: beds[1].id }, cookie);
		expect(second.status).toBe(409);
		expect((await su.collection('beds').getOne(beds[0].id)).order).toBe(ticket.order.id);
		expect((await su.collection('beds').getOne(beds[1].id)).order).toBe('');
		// renaming the spot it holds is fine
		const renamed = await post(
			`/room/${room.id}?/bookBed`,
			{ bedId: beds[0].id, guestName: 'Dusty' },
			cookie
		);
		expect(renamed.status).toBe(200);
	});

	it('sweeps a spot away for the roulette only as confirmed, then books a new random one', async () => {
		const { room, beds } = await seedHouse(su, 2);
		const ticket = await seedTicket(su);
		const cookie = await guestLogin(ticket.code);
		await setBookingOpen(true);
		expect((await post(`/room/${room.id}?/bookBed`, { bedId: beds[0].id }, cookie)).status).toBe(
			200
		);

		// a dialog that showed another spot (stale tab) deletes nothing
		const stale = await post('/random-bed?/releaseBed', { bedId: beds[1].id }, cookie);
		expect(stale.status).toBe(409);
		expect((await su.collection('beds').getOne(beds[0].id)).order).toBe(ticket.order.id);

		// the sweep deletes the booking right away …
		const swept = await post('/random-bed?/releaseBed', { bedId: beds[0].id }, cookie);
		expect(swept.status).toBe(200);
		expect((await su.collection('beds').getOne(beds[0].id)).occupied).toBe(false);

		// … and the roulette books the spot it spun
		const rolled = await post(
			'/random-bed?/bookRandom',
			{ bedId: beds[1].id, guestName: 'Plasma Puma #404' },
			cookie
		);
		expect(rolled.status).toBe(200);
		expect((await su.collection('beds').getOne(beds[1].id)).order).toBe(ticket.order.id);
	});

	it('lets a superuser keep or release the guest bookings when switching back to Staging', async () => {
		const { room, beds } = await seedHouse(su, 1);
		const ticket = await seedTicket(su);
		const cookie = await guestLogin(ticket.code);
		await setBookingOpen(true);
		expect((await post(`/room/${room.id}?/bookBed`, { bedId: beds[0].id }, cookie)).status).toBe(
			200
		);
		expect((await su.collection('beds').getOne(beds[0].id)).order).toBe(ticket.order.id);

		// admins can't switch right now (PocketBase refuses the phase change too)
		const admin = await createAdmin(su, 'admin');
		expect(
			(await post('/admin?/setPhase', { phase: 'staging' }, adminCookie(admin.client))).status
		).toBe(403);
		expect((await su.collection('beds').getOne(beds[0].id)).order).toBe(ticket.order.id);

		// without a word about the bookings they stay: the dialog asks, the server obeys
		const boss = await createAdmin(su, 'superuser');
		const kept = await post('/admin?/setPhase', { phase: 'staging' }, adminCookie(boss.client));
		expect(kept.status).toBe(200);
		expect((await su.collection('beds').getOne(beds[0].id)).order).toBe(ticket.order.id);

		// back to live, then switch again and release them this time
		await setBookingOpen(true);
		const switched = await post(
			'/admin?/setPhase',
			{ phase: 'staging', clearBookings: '1' },
			adminCookie(boss.client)
		);
		expect(switched.status).toBe(200);
		const bed = await su.collection('beds').getOne(beds[0].id);
		expect(bed.occupied).toBe(false);
		expect(bed.order).toBe('');
		expect(bed.booked_at).toBe('');
		expect((await su.collection('app_settings').getOne(APP_SETTINGS_ID)).is_booking_active).toBe(
			false
		);
		// the ticket roster survives
		await guestLogin(ticket.code);
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
		// only in Staging Mode: a stale tab must never clear a live camp
		const live = await post('/admin?/clearAllBookings', {}, adminCookie(boss.client));
		expect(live.status).toBe(403);
		expect((await su.collection('beds').getOne(beds[0].id)).occupied).toBe(true);

		await setBookingOpen(false);
		const cleared = await post('/admin?/clearAllBookings', {}, adminCookie(boss.client));
		expect(cleared.status).toBe(200);
		expect((await su.collection('beds').getOne(beds[0].id)).occupied).toBe(false);
		// the ticket roster survives: the guest's code still works
		expect((await su.collection('orders').getOne(ticket.order.id)).order_number).toBe(ticket.code);
		await guestLogin(ticket.code);
	});
});
