// tests/integration/notifications.test.ts — booking confirmations and crew
// alerts (pb_hooks/cozy_notify.pb.js, pb_hooks/lib/notify.js) against a real
// PocketBase, with Mailpit catching the e-mail and tests/fixtures/
// mock-services.mjs playing the Telegram Bot API and Google's OAuth2.
//
// Delivery normally runs from a cron job; the tests trigger one run with
// POST /api/cozy/notify/flush?force=1 (skips the settle time, the per-ticket
// cooldown and the retry waits) and then look at what arrived.
import { describe, it, expect, beforeAll } from 'vitest';
import { spawnSync } from 'child_process';
import crypto from 'crypto';
import path from 'path';
import type PocketBase from 'pocketbase';
import { BookingService } from '../../src/lib/server/booking';
import { APP_SETTINGS_ID } from '../../src/lib/server/constants';
import {
	anonymous,
	createAdmin,
	seedHouse,
	seedTicket,
	serviceAccount,
	uid
} from '../stack-helpers';

const MOCK_URL = process.env.MOCK_URL || '';
const MAILPIT_URL = process.env.MAILPIT_URL || '';
const CREW_CHAT = '-1001234567890'; // docker-compose.test.yml
// COZY_APP_URL in docker-compose.test.yml; scripts/test-stack.sh exports the port
const APP_URL = `http://127.0.0.1:${process.env.TEST_APP_PORT || '3290'}`;
const COMPOSE_FILE = path.resolve(__dirname, '../../docker-compose.test.yml');

let su: PocketBase;
let booking: BookingService;

beforeAll(async () => {
	if (!MOCK_URL || !MAILPIT_URL) {
		throw new Error('MOCK_URL / MAILPIT_URL are not set — run with `npm run test:integration`.');
	}
	su = await serviceAccount();
	booking = new BookingService(su as any);
});

// --- helpers ---------------------------------------------------------------------

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

type SentMessage = { chat_id: string; text: string };
async function telegramTo(chat: string | number): Promise<SentMessage[]> {
	const sent: SentMessage[] = await mock('/_mock/telegram/sent');
	return sent.filter((m) => m.chat_id === String(chat));
}

type Mail = { ID: string; Subject: string; To: { Address: string }[] };
async function mailsTo(address: string): Promise<Mail[]> {
	const res = await fetch(
		`${MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:"${address}"`)}`
	);
	const json = await res.json();
	// newest first → oldest first
	return [...(json.messages || [])].reverse();
}

async function mailBody(id: string): Promise<{ Text: string; HTML: string }> {
	return (await fetch(`${MAILPIT_URL}/api/v1/message/${id}`)).json();
}

async function ticketWithEmail(email = `guest-${uid()}@example.com`) {
	const ticket = await seedTicket(su);
	await su.collection('orders').update(ticket.order.id, { email });
	return { ...ticket, email };
}

async function notifyRecord(orderId: string) {
	return su
		.collection('guest_notify')
		.getFirstListItem(su.filter('order = {:orderId}', { orderId }))
		.catch(() => null);
}

/** What the "Get updates on Telegram" button does (src/lib/server/notifications.ts). */
async function telegramLink(orderId: string) {
	const token = crypto.randomBytes(24).toString('base64url');
	const data = {
		tg_token_hash: crypto.createHash('sha256').update(token).digest('hex'),
		tg_token_exp: new Date(Date.now() + 30 * 60 * 1000).toISOString()
	};
	const existing = await notifyRecord(orderId);
	if (existing) await su.collection('guest_notify').update(existing.id, data);
	else await su.collection('guest_notify').create({ order: orderId, ...data });
	return token;
}

function chatId() {
	return 700000 + Math.floor(Math.random() * 100000);
}

async function adminEvents(action: string, subject: string) {
	return su.collection('admin_events').getFullList({
		filter: su.filter('action = {:action} && subject = {:subject}', { action, subject })
	});
}

/**
 * Runs the cozy-admin CLI inside the test stack's PocketBase container, like
 * scripts/cozy-admin.sh does. Its messages go to stderr, so both are returned.
 */
function cozyAdmin(args: string[], input = ''): string {
	const run = spawnSync(
		'docker',
		[
			'compose',
			'-f',
			COMPOSE_FILE,
			'exec',
			'-T',
			'pocketbase',
			'/usr/local/bin/pocketbase',
			'cozy-admin',
			...args,
			'--dir=/pb_data',
			'--hooksDir=/pb_hooks',
			'--migrationsDir=/pb_migrations'
		],
		{ input, encoding: 'utf8' }
	);
	const output = `${run.stdout}${run.stderr}`;
	if (run.status !== 0) throw new Error(`cozy-admin ${args.join(' ')} failed:\n${output}`);
	return output;
}

// --- guests: e-mail ------------------------------------------------------------------

describe('booking confirmations by e-mail', () => {
	it('go to the address of the ticket, with house, room and spot — never the ticket code', async () => {
		const { house, room, beds } = await seedHouse(su, 1);
		const guest = await ticketWithEmail();

		await booking.bookBed(guest.order as any, beds[0].id, 'Mail Tester');
		await flush();

		const mails = await mailsTo(guest.email);
		expect(mails).toHaveLength(1);
		expect(mails[0].Subject).toBe(
			`[TEST] Your CozyNights spot: ${beds[0].label} · ${room.name} #1 · ${house.name}`
		);
		const body = await mailBody(mails[0].ID);
		expect(body.Text).toContain(house.name);
		expect(body.Text).toContain(beds[0].label);
		expect(body.Text).toContain(`/room/${room.id}`);
		expect(body.Text).not.toContain(guest.code);
		expect(body.HTML).not.toContain(guest.code);
	});

	it('send one "changed" e-mail for a move, not "released" + "booked"', async () => {
		const { beds } = await seedHouse(su, 2);
		const guest = await ticketWithEmail();

		await booking.bookBed(guest.order as any, beds[0].id, 'Mover');
		await flush();
		await booking.bookBed(guest.order as any, beds[1].id, 'Mover');
		await flush();

		const mails = await mailsTo(guest.email);
		expect(mails.map((m) => m.Subject.split(':')[0])).toEqual([
			'[TEST] Your CozyNights spot',
			'[TEST] Your CozyNights spot changed'
		]);
		expect((await mailBody(mails[1].ID)).Text).toContain(`Before: ${beds[0].label}`);
	});

	it('tell the guest when the spot is gone — released by them or deleted by the crew', async () => {
		const first = await seedHouse(su, 1);
		const second = await seedHouse(su, 1);
		const leaver = await ticketWithEmail();
		const evicted = await ticketWithEmail();

		await booking.bookBed(leaver.order as any, first.beds[0].id, 'Leaver');
		await booking.bookBed(evicted.order as any, second.beds[0].id, 'Evicted');
		await flush();

		await booking.unbookOrder(leaver.order.id);
		await su.collection('rooms').delete(second.room.id); // beds go with it (cascade)
		await flush();

		for (const guest of [leaver, evicted]) {
			const mails = await mailsTo(guest.email);
			expect(mails).toHaveLength(2);
			expect(mails[1].Subject).toBe('[TEST] Your CozyNights spot was released');
		}
		const released = await mailBody((await mailsTo(evicted.email))[1].ID);
		expect(released.Text).toContain('the crew had to change the camp layout');
		// one clean link to the map (room and map link are the same URL here)
		expect(released.HTML.match(/<a href=/g)).toHaveLength(1);
		expect(released.HTML).toContain(`<a href="${APP_URL}/map"`);
		expect(released.HTML).not.toContain('&lt;a');
	});

	it('are not sent twice, and not at all for tickets without an address', async () => {
		const { beds } = await seedHouse(su, 2);
		const withMail = await ticketWithEmail();
		const withoutMail = await seedTicket(su);

		await booking.bookBed(withMail.order as any, beds[0].id, 'Once');
		await booking.bookBed(withoutMail.order as any, beds[1].id, 'Never');
		await flush();
		await flush();

		expect(await mailsTo(withMail.email)).toHaveLength(1);
		expect(await notifyRecord(withoutMail.order.id)).toBeNull();
	});

	it('reach a newly imported address with the current spot', async () => {
		const { beds } = await seedHouse(su, 1);
		const guest = await seedTicket(su);
		await booking.bookBed(guest.order as any, beds[0].id, 'Late Import');
		await flush();

		const email = `late-${uid()}@example.com`;
		await su.collection('orders').update(guest.order.id, { email });
		await flush();

		const mails = await mailsTo(email);
		expect(mails).toHaveLength(1);
		expect(mails[0].Subject).toContain(beds[0].label);
	});

	it('are retried, and the crew hears about the last failed attempt', async () => {
		const { beds } = await seedHouse(su, 1);
		// Mailpit refuses this domain (docker-compose.test.yml)
		const guest = await ticketWithEmail(`bounce-${uid()}@refused.test`);

		await booking.bookBed(guest.order as any, beds[0].id, 'Unlucky');
		await flush();

		let rec = await notifyRecord(guest.order.id);
		expect(rec?.attempts).toBe(1);
		expect(rec?.due).not.toBe('');
		expect(rec?.last_error).toMatch(/^mail: /);

		// the last retry (see RETRY_MINUTES in pb_hooks/lib/notify.js)
		await su.collection('guest_notify').update(rec!.id, { attempts: 7 });
		await flush();

		rec = await notifyRecord(guest.order.id);
		expect(rec?.attempts).toBe(8);
		expect(rec?.due).toBe(''); // given up
		const alerts = await telegramTo(CREW_CHAT);
		expect(
			alerts.some((m) =>
				m.text.includes('Could not notify ticket "Test Guest" (e-mail b•••@refused.test)')
			)
		).toBe(true);
	});
});

// --- guests: Telegram ---------------------------------------------------------------

describe('booking updates on Telegram', () => {
	it('link a chat with the one-time link and confirm the current spot', async () => {
		const { beds } = await seedHouse(su, 2);
		const guest = await seedTicket(su);
		await booking.bookBed(guest.order as any, beds[0].id, 'Telegrammer');
		const chat = chatId();

		const token = await telegramLink(guest.order.id);
		await mock('/_mock/telegram/update', { chat_id: chat, text: `/start ${token}` });
		await flush();

		const rec = await notifyRecord(guest.order.id);
		expect(rec?.tg_chat).toBe(String(chat));
		expect(rec?.tg_token_hash).toBe(''); // used up
		let messages = await telegramTo(chat);
		expect(messages).toHaveLength(1);
		expect(messages[0].text).toContain('Connected!');
		expect(messages[0].text).toContain(beds[0].label);

		await booking.bookBed(guest.order as any, beds[1].id, 'Telegrammer');
		await flush();
		messages = await telegramTo(chat);
		expect(messages).toHaveLength(2);
		expect(messages[1].text).toContain('spot changed');
		expect(messages[1].text).toContain(`Before: ${beds[0].label}`);

		// the same link does not work twice
		await mock('/_mock/telegram/update', { chat_id: chatId(), text: `/start ${token}` });
		await flush();
		expect((await notifyRecord(guest.order.id))?.tg_chat).toBe(String(chat));
	});

	it('keep what happens while a message is on its way (a move, a new link)', async () => {
		const { beds } = await seedHouse(su, 2);
		const guest = await seedTicket(su);
		const chat = chatId();
		const token = await telegramLink(guest.order.id);
		await mock('/_mock/telegram/update', { chat_id: chat, text: `/start ${token}` });
		await flush(); // "Connected!"
		await booking.bookBed(guest.order as any, beds[0].id, 'Racer');

		await mock('/_mock/telegram/slow', { ms: 2500 });
		let running: Promise<unknown>;
		let newToken: string;
		try {
			running = flush(); // sends "booked" — slowly
			await new Promise((r) => setTimeout(r, 1000));
			await booking.bookBed(guest.order as any, beds[1].id, 'Racer'); // the guest moves
			newToken = await telegramLink(guest.order.id); // and asks for a new link
			await running;
		} finally {
			await mock('/_mock/telegram/slow', { ms: 0 });
		}

		const rec = await notifyRecord(guest.order.id);
		expect(rec?.tg_token_hash).toBe(crypto.createHash('sha256').update(newToken!).digest('hex'));
		expect(rec?.due).not.toBe(''); // the move is still due
		await flush();
		const messages = await telegramTo(chat);
		expect(messages.at(-1)?.text).toContain('spot changed');
		expect(messages.at(-1)?.text).toContain(beds[1].label);
	});

	it('stop on /stop, and when the guest blocks the bot', async () => {
		const { beds } = await seedHouse(su, 2);
		const stopper = await seedTicket(su);
		const blocker = await seedTicket(su);
		const [stopChat, blockChat] = [chatId(), chatId()];

		for (const [guest, chat] of [
			[stopper, stopChat],
			[blocker, blockChat]
		] as const) {
			const token = await telegramLink(guest.order.id);
			await mock('/_mock/telegram/update', { chat_id: chat, text: `/start ${token}` });
		}
		await flush();

		await mock('/_mock/telegram/update', { chat_id: stopChat, text: '/stop' });
		await mock('/_mock/telegram/block', { chat_id: blockChat });
		await booking.bookBed(stopper.order as any, beds[0].id, 'Stopper');
		await booking.bookBed(blocker.order as any, beds[1].id, 'Blocker');
		await flush();

		expect((await notifyRecord(stopper.order.id))?.tg_chat).toBe('');
		expect((await notifyRecord(blocker.order.id))?.tg_chat).toBe('');
		const toStopper = await telegramTo(stopChat);
		expect(toStopper.at(-1)?.text).toContain('Disconnected');
		expect(toStopper.some((m) => m.text.includes('is booked'))).toBe(false);
	});

	it('answer unknown links and other messages with how to connect', async () => {
		const chat = chatId();
		await mock('/_mock/telegram/update', { chat_id: chat, text: '/start not-a-real-token' });
		await mock('/_mock/telegram/update', { chat_id: chat, text: 'hello?' });
		await mock('/_mock/telegram/update', { chat_id: chat, chat_type: 'group', text: '/start x' });
		await flush();

		const messages = await telegramTo(chat);
		expect(messages).toHaveLength(2); // nothing for the group message
		expect(messages[0].text).toContain('expired or was already used');
		expect(messages[1].text).toContain('sign in with your ticket code');
	});
});

// --- crew alerts ---------------------------------------------------------------------

describe('crew alerts', () => {
	it('report access requests, approvals and removals', async () => {
		const pending = await createAdmin(su, 'pending');
		await su.collection('admins').update(pending.id, { role: 'superuser' });
		await su.collection('admins').delete(pending.id);
		await flush();

		const texts = (await telegramTo(CREW_CHAT)).map((m) => m.text);
		expect(texts).toContain(
			`[TEST] 🛎️ Admin access request: <${pending.email}>\nApprove on the server: cozy-admin.sh approve ${pending.email}\n(or PocketBase dashboard → admins → role)`
		);
		expect(texts).toContain(`[TEST] ✅ Admin access approved: ${pending.email} (role superuser)`);
		expect(texts).toContain(`[TEST] 🚫 Admin access removed: ${pending.email} (was superuser)`);
	});

	it('report booking phase changes with the name of the admin', async () => {
		const admin = await createAdmin(su, 'admin');
		const settings = admin.client.collection('app_settings');
		const original = await su.collection('app_settings').getOne(APP_SETTINGS_ID);
		const opensAt = new Date(Date.now() + 3 * 24 * 3600 * 1000).toISOString();

		try {
			await settings.update(APP_SETTINGS_ID, { is_booking_active: false, booking_unlock_at: '' });
			await settings.update(APP_SETTINGS_ID, { is_booking_active: true });
			await settings.update(APP_SETTINGS_ID, {
				is_booking_active: false,
				booking_unlock_at: opensAt
			});
			await settings.update(APP_SETTINGS_ID, { booking_unlock_at: '' });
		} finally {
			await su.collection('app_settings').update(APP_SETTINGS_ID, {
				is_booking_active: original.is_booking_active,
				booking_unlock_at: original.booking_unlock_at
			});
		}
		await flush();

		const texts = (await telegramTo(CREW_CHAT)).map((m) => m.text);
		expect(texts).toContain(
			`[TEST] 🎪 LIVE BOOKING switched ON by ${admin.email} — guests can book now`
		);
		expect(texts).toContain(`[TEST] 🛠 Booking closed (STAGING MODE) by ${admin.email}`);
		expect(
			texts.some((t) =>
				t.startsWith(`[TEST] ⏰ Go-live timer set by ${admin.email}: booking opens `)
			)
		).toBe(true);
		expect(
			texts.some((t) => t.startsWith(`[TEST] ⏰ Go-live timer removed by ${admin.email}`))
		).toBe(true);
	});

	it('are kept and sent later when Telegram is down', async () => {
		await mock('/_mock/telegram/down', { down: true });
		let pending;
		try {
			pending = await createAdmin(su, 'pending');
			await flush();
			const [event] = await adminEvents('access_request', pending.email);
			expect(event.alert_status).toBe('pending');
			expect(event.alert_attempts).toBe(1);
		} finally {
			await mock('/_mock/telegram/down', { down: false });
		}
		await flush();

		const [event] = await adminEvents('access_request', pending.email);
		expect(event.alert_status).toBe('sent');
		expect((await telegramTo(CREW_CHAT)).some((m) => m.text.includes(pending.email))).toBe(true);
	});

	it('record every Google sign-in of an admin (and when it happened)', async () => {
		// Point the admins' Google provider at the stand-in (the PocketBase
		// container reaches it as http://mocks:8081).
		await su.collections.update('admins', {
			oauth2: {
				enabled: true,
				providers: [
					{
						name: 'google',
						clientId: 'test-client',
						clientSecret: 'test-secret',
						authURL: 'http://mocks:8081/oauth/auth',
						tokenURL: 'http://mocks:8081/oauth/token',
						userInfoURL: 'http://mocks:8081/oauth/userinfo'
					}
				]
			}
		});
		const email = `signin-${uid()}@mauersegler.art`;
		const signIn = async () => {
			const code = `code-${uid()}`;
			await mock('/_mock/oauth/user', {
				code,
				sub: `google-${email}`,
				email,
				name: 'Sign In Tester',
				hd: 'mauersegler.art'
			});
			return anonymous()
				.collection('admins')
				.authWithOAuth2Code(
					'google',
					code,
					`verifier-${uid()}${uid()}${uid()}`,
					'http://127.0.0.1/cb'
				);
		};

		const first = await signIn(); // creates the access request
		expect(first.record.role).toBe('pending');
		await su.collection('admins').update(first.record.id, { role: 'admin' });

		const before = Date.now();
		await signIn();
		const record = await su.collection('admins').getOne(first.record.id);
		expect(new Date(record.last_sign_in).getTime()).toBeGreaterThanOrEqual(before - 1000);

		await flush();
		const texts = (await telegramTo(CREW_CHAT)).map((m) => m.text);
		expect(texts).toContain(`[TEST] 🔐 Admin sign-in: Sign In Tester <${email}> (admin)`);
		expect(
			texts.filter((t) => t.includes(`Admin access request: Sign In Tester <${email}>`))
		).toHaveLength(1);
	});
});

// --- the cozy-admin CLI ----------------------------------------------------------------

describe('cozy-admin tickets import and notify', () => {
	it('imports a roster with e-mail addresses (and checks it first)', async () => {
		const tag = uid().toUpperCase();
		const existing = await seedTicket(su);
		const { beds } = await seedHouse(su, 1);
		await booking.bookBed(existing.order as any, beds[0].id, 'Imported Later');
		const csv = [
			'Order code;Attendee name;E-Mail',
			`IMP-${tag}-1;Ada Lovelace;ada-${tag}@example.com`,
			`"IMP-${tag}-2";"Grace ""Amazing"" Hopper";GRACE-${tag}@Example.com`,
			`${existing.code};;existing-${tag}@example.com`
		].join('\n');

		const dry = cozyAdmin(['tickets', 'import', '-', '--dry-run'], csv);
		expect(dry).toContain(
			'DRY RUN, nothing changed — would have created 2, updated 1, unchanged 0'
		);
		await expect(
			su
				.collection('orders')
				.getFirstListItem(su.filter('order_number = {:c}', { c: `IMP-${tag}-1` }))
		).rejects.toThrow();

		const out = cozyAdmin(['tickets', 'import', '-'], csv);
		expect(out).toContain('created 2, updated 1, unchanged 0 ticket(s)');
		expect(out).toContain('1 of the updated tickets hold a spot');
		const grace = await su
			.collection('orders')
			.getFirstListItem(su.filter('order_number = {:c}', { c: `IMP-${tag}-2` }));
		expect(grace.email).toBe(`grace-${tag.toLowerCase()}@example.com`);
		expect(grace.customer_name).toBe('Grace "Amazing" Hopper');

		// the ticket that already holds a spot: its new address gets a confirmation
		await flush();
		expect(await mailsTo(`existing-${tag.toLowerCase()}@example.com`)).toHaveLength(1);

		const again = cozyAdmin(['tickets', 'import', '-'], csv);
		expect(again).toContain('created 0, updated 0, unchanged 3 ticket(s)');
	});

	it('imports nothing from a file with a broken line', () => {
		const tag = uid().toUpperCase();
		const csv = [
			'code,email',
			`OK-${tag},ok-${tag}@example.com`,
			`BAD ${tag},bad@example.com`
		].join('\n');
		expect(() => cozyAdmin(['tickets', 'import', '-'], csv)).toThrow(/invalid ticket code/);
		expect(cozyAdmin(['tickets', 'list'])).not.toContain(`OK-${tag}`);
	});

	it('reports an invite from the server as an invite, not as an access request', async () => {
		const email = `invited-${uid()}@mauersegler.art`;
		expect(cozyAdmin(['add', email])).toContain(`invited: ${email} (role admin)`);
		expect(cozyAdmin(['remove', email])).toContain(`removed app admin access: ${email}`);
		await flush();

		const texts = (await telegramTo(CREW_CHAT)).map((m) => m.text);
		expect(texts).toContain(
			`[TEST] ✉️ Admin invited: ${email} (role admin) — can sign in with Google now`
		);
		expect(texts).toContain(`[TEST] 🚫 Admin access removed: ${email} (was admin)`);
		expect(texts.some((t) => t.includes(`access request: <${email}>`))).toBe(false);
		const [removed] = await adminEvents('access_removed', email);
		expect(removed.actor).toBe('cozy-admin');
	});

	it('creates a single ticket with an address, and reports the notification setup', async () => {
		const code = `ONE-${uid().toUpperCase()}`;
		expect(cozyAdmin(['tickets', 'add', code, '--email', `one-${uid()}@example.com`])).toContain(
			`created: ${code} (e-mail one-`
		);

		const status = cozyAdmin(['notify', 'status']);
		expect(status).toContain('E-MAIL TO GUESTS   on: mailpit:1025');
		expect(status).toContain('CREW CHAT          Telegram chat ' + CREW_CHAT);
		expect(status).toContain('TELEGRAM BOT       @cozy_test_bot, guest updates on');

		const to = `crew-${uid()}@example.com`;
		expect(cozyAdmin(['notify', 'test', '--email', to])).toContain(`e-mail: sent to ${to}`);
		expect((await mailsTo(to))[0].Subject).toBe('[TEST] CozyNights test e-mail');
	});
});
