// tests/integration/special-needs.test.ts — special-needs requests against a
// real PocketBase (migration 1759200000, pb_hooks/cozy_notify.pb.js,
// pb_hooks/lib/notify.js): who may read them, one per ticket, the messages to
// the guest and the crew (never what the guest wrote), the requests switch
// and the cleanup after the event. The app side is used like the app does,
// through $lib/server/special-requests with the service account.
import { describe, it, expect, beforeAll } from 'vitest';
import crypto from 'crypto';
import type PocketBase from 'pocketbase';
import { APP_SETTINGS_ID } from '../../src/lib/server/constants';
import {
	assignSpot,
	decideRequest,
	saveRequest,
	withdrawRequest
} from '../../src/lib/server/special-requests';
import type { RequestInput } from '../../src/lib/special-needs';
import {
	anonymous,
	cozyAdmin,
	createAdmin,
	expectRefused,
	seedHouse,
	seedTicket,
	serviceAccount,
	uid
} from '../stack-helpers';

const MOCK_URL = process.env.MOCK_URL || '';
const MAILPIT_URL = process.env.MAILPIT_URL || '';
const CREW_CHAT = '-1001234567890'; // docker-compose.test.yml
const APP_URL = `http://127.0.0.1:${process.env.TEST_APP_PORT || '3290'}`;

const SECRET_TEXT = 'Wheelchair user, I need step-free access to the room.';
const INPUT: RequestInput = {
	needs: ['step_free'],
	text: SECRET_TEXT,
	burnerName: 'Rolling Thunder',
	consent: true
};
const ADMIN = {
	id: 'a1',
	email: 'crew-lead@mauersegler.art',
	name: 'Crew Lead',
	role: 'admin' as const,
	isSuperuser: false
};

let su: PocketBase;

beforeAll(async () => {
	if (!MOCK_URL || !MAILPIT_URL) {
		throw new Error('MOCK_URL / MAILPIT_URL are not set — run with `npm run test:integration`.');
	}
	su = await serviceAccount();
});

// --- helpers (like tests/integration/notifications.test.ts) -------------------------

async function flush() {
	return su.send('/api/cozy/notify/flush?force=1', { method: 'POST' });
}

async function mock(route: string, body?: unknown) {
	const res = await fetch(MOCK_URL + route, {
		method: body === undefined ? 'GET' : 'POST',
		headers: { 'content-type': 'application/json' },
		body: body === undefined ? undefined : JSON.stringify(body)
	});
	return res.json();
}

async function telegramTo(chat: string | number): Promise<{ text: string }[]> {
	const sent: { chat_id: string; text: string }[] = await mock('/_mock/telegram/sent');
	return sent.filter((m) => m.chat_id === String(chat));
}

type Mail = { ID: string; Subject: string };
async function mailsTo(address: string): Promise<Mail[]> {
	const res = await fetch(
		`${MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:"${address}"`)}`
	);
	return [...((await res.json()).messages || [])].reverse();
}

async function mailBody(id: string): Promise<{ Text: string; HTML: string }> {
	return (await fetch(`${MAILPIT_URL}/api/v1/message/${id}`)).json();
}

async function guestWithEmail() {
	const ticket = await seedTicket(su);
	const email = `special-${uid()}@example.com`;
	const name = `Guest ${uid()}`;
	await su.collection('orders').update(ticket.order.id, { email, customer_name: name });
	return { ...ticket, email, name };
}

async function notifyRecord(orderId: string) {
	return su
		.collection('guest_notify')
		.getFirstListItem(su.filter('order = {:orderId}', { orderId }))
		.catch(() => null);
}

async function requestOf(orderId: string) {
	return su
		.collection('special_requests')
		.getFirstListItem(su.filter('order = {:orderId}', { orderId }))
		.catch(() => null);
}

async function specialBed() {
	const { house, room, beds } = await seedHouse(su, 1);
	await su.collection('beds').update(beds[0].id, { is_special: true });
	return { house, room, bed: beds[0] };
}

async function crewTexts(): Promise<string> {
	return (await telegramTo(CREW_CHAT)).map((m) => m.text).join('\n---\n');
}

// --- storage -------------------------------------------------------------------------

describe('special-needs requests in the database', () => {
	it('are for the service account only: guests and admins get nothing through the API', async () => {
		const guest = await seedTicket(su);
		await saveRequest(su as any, guest.order as any, INPUT);
		const { client } = await createAdmin(su, 'admin');

		for (const pb of [anonymous(), client]) {
			await expectRefused(pb.collection('special_requests').getFullList());
			const listed = await pb
				.collection('special_requests')
				.getList(1, 50)
				.catch(() => ({ items: [] }));
			expect(listed.items).toHaveLength(0);
			await expectRefused(
				pb.collection('special_requests').create({
					order: guest.order.id,
					status: 'approved',
					consent_at: new Date().toISOString()
				})
			);
		}
	});

	it("hold the guest's words only encrypted", async () => {
		const guest = await seedTicket(su);
		await saveRequest(su as any, guest.order as any, INPUT);
		const stored = await requestOf(guest.order.id);
		expect(stored?.status).toBe('pending');
		expect(JSON.stringify(stored)).not.toContain('Wheelchair');
		expect(JSON.stringify(stored)).not.toContain('Rolling Thunder');
		expect(JSON.stringify(stored)).not.toContain('step_free');
		expect(stored?.consent_at).toBeTruthy();
	});

	it('allow one request per ticket and go with the ticket', async () => {
		const guest = await seedTicket(su);
		await saveRequest(su as any, guest.order as any, INPUT);
		await expectRefused(
			su.collection('special_requests').create({
				order: guest.order.id,
				status: 'pending',
				consent_at: new Date().toISOString()
			})
		);

		await su.collection('orders').delete(guest.order.id);
		expect(await requestOf(guest.order.id)).toBeNull();
	});

	it('let a booked bed be deleted (room removed, template import): the request forgets it', async () => {
		const guest = await seedTicket(su);
		const { room, bed } = await specialBed();
		await saveRequest(su as any, guest.order as any, INPUT);
		const request = await requestOf(guest.order.id);
		await assignSpot(su as any, ADMIN, request!.id, bed.id);
		expect((await requestOf(guest.order.id))?.bed).toBe(bed.id);

		await su.collection('rooms').delete(room.id); // its beds go with it
		const after = await requestOf(guest.order.id);
		expect(after?.status).toBe('approved');
		expect(after?.bed).toBe('');
	});

	it('mark beds as special-needs spots, normal by default', async () => {
		const { beds } = await seedHouse(su, 1);
		expect(beds[0].is_special).toBe(false);
		const settings = await su.collection('app_settings').getOne(APP_SETTINGS_ID);
		expect(typeof settings.special_requests_open).toBe('boolean');
	});
});

// --- messages -------------------------------------------------------------------------

describe('messages about a request', () => {
	it('confirm a new request to the guest and tell the crew, without names or what was written', async () => {
		const guest = await guestWithEmail();
		await saveRequest(su as any, guest.order as any, INPUT);
		await flush();

		const mails = await mailsTo(guest.email);
		expect(mails.map((m) => m.Subject)).toEqual(['[TEST] We got your special-needs request']);
		const body = await mailBody(mails[0].ID);
		expect(body.Text).toContain(`${APP_URL}/special-needs`);
		expect(body.Text).not.toContain('Wheelchair');
		expect(body.Text).not.toContain(guest.code);

		const crew = await crewTexts();
		expect(crew).toContain('🧡 New special-needs request');
		expect(crew).toContain(`${APP_URL}/admin/requests`);
		expect(crew).not.toContain('Wheelchair');
		expect(crew).not.toContain(guest.name);
		expect(crew).not.toContain('Rolling Thunder');
	});

	it('send one e-mail when the crew approves and books at once, with the pass, while booking is closed', async () => {
		await su.collection('app_settings').update(APP_SETTINGS_ID, { is_booking_active: false });
		const guest = await guestWithEmail();
		const { house, room, bed } = await specialBed();
		await saveRequest(su as any, guest.order as any, INPUT);
		await flush(); // "We got your request"

		const request = await requestOf(guest.order.id);
		await assignSpot(su as any, ADMIN, request!.id, bed.id);
		await flush();

		const booked = await su.collection('beds').getOne(bed.id);
		expect(booked.order).toBe(guest.order.id);
		const mails = await mailsTo(guest.email);
		expect(mails).toHaveLength(2);
		expect(mails[1].Subject).toBe(
			`[TEST] Your special-needs spot: ${bed.label} · ${room.name} #1 · ${house.name}`
		);
		const body = await mailBody(mails[1].ID);
		expect(body.Text).toContain('the crew approved your special-needs request');
		expect(body.Text).toContain('/pass/');
		expect(body.Text).toContain('please contact the crew to change it');
		expect(body.Text).not.toContain('To change or release it');

		const crew = await crewTexts();
		expect(crew).toContain(`✅ Special-needs request approved by ${ADMIN.email}`);
		expect(crew).toContain(`♿ Special-needs spot booked for a guest by ${ADMIN.email}`);
	});

	it('tell the guest about a decline in plain words', async () => {
		const guest = await guestWithEmail();
		await saveRequest(su as any, guest.order as any, INPUT);
		await flush();
		const request = await requestOf(guest.order.id);
		await decideRequest(su as any, ADMIN, request!.id, 'declined');
		await flush();

		const mails = await mailsTo(guest.email);
		expect(mails.map((m) => m.Subject)).toEqual([
			'[TEST] We got your special-needs request',
			'[TEST] About your special-needs request'
		]);
		expect((await mailBody(mails[1].ID)).Text).toContain(
			'the crew could not offer you a special-needs spot'
		);
		expect(await crewTexts()).toContain(`✋ Special-needs request declined by ${ADMIN.email}`);
	});

	it('stay quiet about a withdrawal, and treat a request sent afterwards as new', async () => {
		const guest = await guestWithEmail();
		await saveRequest(su as any, guest.order as any, INPUT);
		await flush();
		expect(await withdrawRequest(su as any, guest.order.id)).toBe(true);
		await flush();

		expect(await mailsTo(guest.email)).toHaveLength(1);
		expect((await notifyRecord(guest.order.id))?.mail_req).toBe('');
		expect(await crewTexts()).toContain('🧡 A guest withdrew their special-needs request');

		await saveRequest(su as any, guest.order as any, INPUT);
		await flush();
		const mails = await mailsTo(guest.email);
		expect(mails.map((m) => m.Subject)).toEqual([
			'[TEST] We got your special-needs request',
			'[TEST] We got your special-needs request'
		]);
	});

	it('show the request in the Telegram "connected" message and send the decision there', async () => {
		const guest = await seedTicket(su);
		await saveRequest(su as any, guest.order as any, INPUT);
		const chat = 800000 + Math.floor(Math.random() * 100000);
		const token = crypto.randomBytes(24).toString('base64url');
		const data = {
			tg_token_hash: crypto.createHash('sha256').update(token).digest('hex'),
			tg_token_exp: new Date(Date.now() + 30 * 60 * 1000).toISOString()
		};
		const existing = await notifyRecord(guest.order.id);
		if (existing) await su.collection('guest_notify').update(existing.id, data);
		else await su.collection('guest_notify').create({ order: guest.order.id, ...data });

		await mock('/_mock/telegram/update', { chat_id: chat, text: `/start ${token}` });
		await flush();
		let messages = await telegramTo(chat);
		expect(messages).toHaveLength(1);
		expect(messages[0].text).toContain('Your special-needs request: waiting for the crew');

		const request = await requestOf(guest.order.id);
		await decideRequest(su as any, ADMIN, request!.id, 'approved');
		await flush();
		messages = await telegramTo(chat);
		expect(messages).toHaveLength(2);
		expect(messages[1].text).toContain('Your special-needs request was approved');
		expect(messages.map((m) => m.text).join()).not.toContain('Wheelchair');
	});
});

// --- the switch and the cleanup ---------------------------------------------------------

describe('requests switch and cleanup', () => {
	it('tell the crew who opened or closed requests', async () => {
		const { client, email } = await createAdmin(su, 'admin');
		await client
			.collection('app_settings')
			.update(APP_SETTINGS_ID, { special_requests_open: true });
		await client
			.collection('app_settings')
			.update(APP_SETTINGS_ID, { special_requests_open: false });
		await flush();

		const events = await su.collection('admin_events').getFullList({
			filter: su.filter("actor = {:email} && action ~ 'requests_'", { email }),
			sort: 'created'
		});
		expect(events.map((e) => e.action)).toEqual(['requests_opened', 'requests_closed']);
		const crew = await crewTexts();
		expect(crew).toContain(`🧡 Special-needs requests OPENED by ${email}`);
		expect(crew).toContain(`🧡 Special-needs requests closed by ${email}`);
	});

	it('forget-contacts deletes every request after the event, bookings stay', async () => {
		const guest = await guestWithEmail();
		const { bed } = await specialBed();
		await saveRequest(su as any, guest.order as any, INPUT);
		const request = await requestOf(guest.order.id);
		await assignSpot(su as any, ADMIN, request!.id, bed.id);

		const output = cozyAdmin(['tickets', 'forget-contacts', '--yes']);
		expect(output).toMatch(/special-needs request\(s\)/);
		expect(await su.collection('special_requests').getFullList()).toHaveLength(0);
		expect((await su.collection('beds').getOne(bed.id)).order).toBe(guest.order.id);
	});
});
