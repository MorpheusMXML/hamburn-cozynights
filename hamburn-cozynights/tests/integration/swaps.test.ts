// tests/integration/swaps.test.ts — swap requests against a real PocketBase
// (docs/admin/swaps.md): the migration's collection is closed to guests, the
// swap is one transaction behind POST /api/cozy/swap with its own last checks,
// the delivery run tells the other guest (Mailpit, the Telegram mock) without
// ever sending what the asker wrote, a "no" reaches the asker, a "yes" is
// "Swap done!" for both, and a hand-over or forget-contacts takes the requests
// along. Rules and words: tests/swaps.test.ts, tests/notify-swaps.test.ts.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'crypto';
import type PocketBase from 'pocketbase';
import { APP_SETTINGS_ID } from '../../src/lib/server/constants';
import { acceptSwap, askForSwap, declineSwap, guestSwaps } from '../../src/lib/server/swaps';
import { changeTicket } from '../../src/lib/server/tickets';
import {
	anonymous,
	cozyAdmin,
	expectRefused,
	seedHouse,
	seedTicket,
	serviceAccount,
	uid
} from '../stack-helpers';

const MOCK_URL = process.env.MOCK_URL || '';
const MAILPIT_URL = process.env.MAILPIT_URL || '';
const APP_URL = `http://127.0.0.1:${process.env.TEST_APP_PORT || '3290'}`;
const LIVE = { phase: 'live' as const, swapsOff: false };
const NOTE = 'SECRET-NOTE my knees prefer the lower bunk';
const PHASE_FIELDS = [
	'is_booking_active',
	'booking_closed',
	'booking_unlock_at',
	'booking_close_at',
	'booking_timer_paused',
	'swaps_off'
] as const;

let su: PocketBase;
let original: Record<string, unknown>;

beforeAll(async () => {
	if (!MOCK_URL || !MAILPIT_URL) {
		throw new Error('MOCK_URL / MAILPIT_URL are not set — run with `npm run test:integration`.');
	}
	su = await serviceAccount();
	const settings = await su.collection('app_settings').getOne(APP_SETTINGS_ID);
	original = Object.fromEntries(PHASE_FIELDS.map((f) => [f, settings[f] ?? '']));
	await su.collection('app_settings').update(APP_SETTINGS_ID, {
		is_booking_active: true,
		booking_closed: false,
		booking_unlock_at: '',
		booking_close_at: '',
		booking_timer_paused: false,
		swaps_off: false
	});
});

afterAll(async () => {
	await su?.collection('app_settings').update(APP_SETTINGS_ID, original);
});

// --- helpers ---------------------------------------------------------------------

const flush = () => su.send('/api/cozy/notify/flush?force=1', { method: 'POST' });

async function mock(route: string, body?: unknown) {
	const res = await fetch(MOCK_URL + route, {
		method: body === undefined ? 'GET' : 'POST',
		headers: { 'content-type': 'application/json' },
		body: body === undefined ? undefined : JSON.stringify(body)
	});
	return res.json();
}

type SentMessage = {
	chat_id: string;
	text: string;
	reply_markup?: { inline_keyboard: { text: string; url: string }[][] };
};
async function telegramTo(chat: number): Promise<SentMessage[]> {
	const sent: SentMessage[] = await mock('/_mock/telegram/sent');
	return sent.filter((m) => m.chat_id === String(chat));
}

// Subjects carry the stack's label in front ("[TEST] …", COZY_ENV_LABEL).
type Mail = { ID: string; Subject: string };
async function mailsTo(address: string): Promise<Mail[]> {
	const res = await fetch(
		`${MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:"${address}"`)}`
	);
	return [...((await res.json()).messages || [])].reverse();
}
async function mailText(id: string): Promise<string> {
	const body = await (await fetch(`${MAILPIT_URL}/api/v1/message/${id}`)).json();
	return `${body.Text}\n${body.HTML}`;
}

/** Links a Telegram chat to the ticket the way the bot does it (/start <token>). */
async function connectTelegram(orderId: string): Promise<number> {
	const token = crypto.randomBytes(24).toString('base64url');
	const data = {
		tg_token_hash: crypto.createHash('sha256').update(token).digest('hex'),
		tg_token_exp: new Date(Date.now() + 30 * 60 * 1000).toISOString()
	};
	// the booking made the ticket's record already (it has an address)
	const existing = await su
		.collection('guest_notify')
		.getFirstListItem(su.filter('order = {:orderId}', { orderId }))
		.catch(() => null);
	if (existing) await su.collection('guest_notify').update(existing.id, data);
	else await su.collection('guest_notify').create({ order: orderId, ...data });
	const chat = 800000 + Math.floor(Math.random() * 100000);
	await mock('/_mock/telegram/update', { chat_id: chat, text: `/start ${token}` });
	await flush();
	return chat;
}

/** A ticket with an address (example.com: the stack's Mailpit refuses .test). */
async function guest() {
	const ticket = await seedTicket(su);
	const email = `swap-${uid()}@example.com`;
	// a plain record: the service functions take the app's typed tickets
	const order: any = await su.collection('orders').update(ticket.order.id, { email });
	return { ...ticket, order, email };
}

/** Ada holds spot 1, Bo spot 2 of a fresh room; both were told about it already. */
async function twoGuests() {
	const { beds } = await seedHouse(su, 3);
	const ada = await guest();
	const bo = await guest();
	await su.collection('beds').update(beds[0].id, { order: ada.order.id, occupied: true });
	await su.collection('beds').update(beds[1].id, { order: bo.order.id, occupied: true });
	await flush(); // the "booked" messages: the channels know the spots now
	return { beds, ada, bo };
}

const bed = (id: string) => su.collection('beds').getOne(id);
const request = (id: string) => su.collection('swap_requests').getOne(id);

// --- the collection ---------------------------------------------------------------

describe('swap requests in PocketBase', () => {
	it('are closed to guests, and so is the swap itself', async () => {
		const { beds, ada, bo } = await twoGuests();
		const guestPb = anonymous();
		await expectRefused(guestPb.collection('swap_requests').getList(1, 1));
		await expectRefused(
			guestPb.collection('swap_requests').create({
				from_order: ada.order.id,
				from_bed: beds[0].id,
				to_order: bo.order.id,
				to_bed: beds[1].id,
				status: 'pending',
				expires_at: new Date(Date.now() + 3600_000).toISOString()
			})
		);
		await expectRefused(
			guestPb.send('/api/cozy/swap', { method: 'POST', body: { request: 'x', order: 'y' } })
		);
	});
});

// --- asking, answering ------------------------------------------------------------

describe('a swap request', () => {
	it('reaches the other guest by e-mail and on Telegram — without what the asker wrote', async () => {
		const { beds, ada, bo } = await twoGuests();
		const chat = await connectTelegram(bo.order.id);
		const before = (await telegramTo(chat)).length;

		const id = await askForSwap(su as any, LIVE, ada.order, beds[1].id, {
			vibe: 'crew',
			note: NOTE
		});
		await flush();

		const mails = (await mailsTo(bo.email)).filter((m) => m.Subject.includes('🔁 Swap request'));
		expect(mails).toHaveLength(1);
		const text = await mailText(mails[0].ID);
		expect(text).toContain(`${APP_URL}/swaps`);
		expect(text).not.toContain('SECRET-NOTE');

		const sent = (await telegramTo(chat)).slice(before);
		expect(sent).toHaveLength(1);
		expect(sent[0].text).toContain('🔁 Swap request!');
		expect(sent[0].text).not.toContain('SECRET-NOTE');
		expect(sent[0].reply_markup?.inline_keyboard[0][0]).toEqual({
			text: '🔁 Answer the swap request',
			url: `${APP_URL}/swaps`
		});

		const stored = await request(id);
		expect(stored.ask_mail).not.toBe('');
		expect(stored.ask_tg).not.toBe('');
		expect(stored.notify_due).toBe('');
		expect(stored.note).not.toContain('SECRET-NOTE'); // encrypted at rest

		// told once
		await flush();
		expect(
			(await mailsTo(bo.email)).filter((m) => m.Subject.includes('🔁 Swap request'))
		).toHaveLength(1);
		// and the note is there for Bo in the app
		expect((await guestSwaps(su as any, bo.order)).incoming[0].note).toBe(NOTE);
	});

	it('to a guest who paused requests is never sent', async () => {
		const { beds, ada, bo } = await twoGuests();
		await su.collection('orders').update(bo.order.id, { no_swap_requests: true });
		const id = await askForSwap(su as any, LIVE, ada.order, beds[1].id, { vibe: '', note: '' });
		await flush();
		expect((await request(id)).quiet).toBe(true);
		expect(
			(await mailsTo(bo.email)).filter((m) => m.Subject.includes('🔁 Swap request'))
		).toHaveLength(0);
	});

	it('answered with no tells the asker', async () => {
		const { beds, ada, bo } = await twoGuests();
		const id = await askForSwap(su as any, LIVE, ada.order, beds[1].id, { vibe: '', note: '' });
		await flush();
		await declineSwap(su as any, bo.order, id);
		await flush();
		const noes = (await mailsTo(ada.email)).filter((m) => m.Subject.includes('No swap this time'));
		expect(noes).toHaveLength(1);
		expect((await request(id)).status).toBe('declined');
		expect((await bed(beds[0].id)).order).toBe(ada.order.id);
	});

	it('answered with yes swaps both spots at once, and both hear "Swap done!"', async () => {
		const { beds, ada, bo } = await twoGuests();
		const cy = await guest();
		await su.collection('beds').update(beds[2].id, { order: cy.order.id, occupied: true });
		const id = await askForSwap(su as any, LIVE, ada.order, beds[1].id, { vibe: '', note: '' });
		// Cy wanted Ada's spot: that request ends with the swap
		const other = await askForSwap(su as any, LIVE, cy.order, beds[0].id, { vibe: '', note: '' });
		const bookedBefore = (await bed(beds[0].id)).booked_at;
		await new Promise((resolve) => setTimeout(resolve, 20));

		const { gained, gave } = await acceptSwap(su as any, LIVE, bo.order, id);
		expect(gained.bedId).toBe(beds[0].id);
		expect(gave.bedId).toBe(beds[1].id);
		const [first, second] = await Promise.all([bed(beds[0].id), bed(beds[1].id)]);
		expect(first).toMatchObject({ order: bo.order.id, occupied: true });
		expect(second).toMatchObject({ order: ada.order.id, occupied: true });
		expect(first.booked_at).not.toBe(bookedBefore); // stamped anew (pb_hooks/lib/booked.js)
		expect((await request(id)).status).toBe('accepted');
		expect(await request(other)).toMatchObject({ status: 'void', ended: 'swapped' });

		await flush();
		for (const g of [ada, bo]) {
			const done = (await mailsTo(g.email)).filter((m) => m.Subject.includes('🔁 Swap done!'));
			expect(done, g.email).toHaveLength(1);
			const text = await mailText(done[0].ID);
			expect(text).toContain('belongs to the other guest now');
			expect(text).not.toContain('the crew had to move you');
		}
	});
});

// --- PocketBase's last word --------------------------------------------------------

describe('POST /api/cozy/swap', () => {
	async function pending() {
		const { beds, ada, bo } = await twoGuests();
		const id = await askForSwap(su as any, LIVE, ada.order, beds[1].id, { vibe: '', note: '' });
		return { beds, ada, bo, id };
	}
	async function refusedWith(body: Record<string, string>) {
		const outcome = await su.send('/api/cozy/swap', { method: 'POST', body }).then(
			() => null,
			(err) => err
		);
		expect(outcome?.status).toBe(409);
		return outcome.response.reason as string;
	}

	it('refuses while the crew paused swaps', async () => {
		const { bo, id } = await pending();
		await su.collection('app_settings').update(APP_SETTINGS_ID, { swaps_off: true });
		try {
			expect(await refusedWith({ request: id, order: bo.order.id })).toBe('closed');
		} finally {
			await su.collection('app_settings').update(APP_SETTINGS_ID, { swaps_off: false });
		}
	});

	it('refuses a spot that can’t be swapped, and one that changed hands', async () => {
		const first = await pending();
		await su.collection('beds').update(first.beds[1].id, { is_locked: true });
		expect(await refusedWith({ request: first.id, order: first.bo.order.id })).toBe('fixed');
		expect((await request(first.id)).status).toBe('pending');

		const second = await pending();
		await su.collection('beds').update(second.beds[1].id, { order: null, occupied: false });
		expect(await refusedWith({ request: second.id, order: second.bo.order.id })).toBe('moved');
		expect(await request(second.id)).toMatchObject({ status: 'void', ended: 'moved' });
	});

	it('refuses a request that isn’t addressed to the ticket', async () => {
		const { ada, id } = await pending();
		expect(await refusedWith({ request: id, order: ada.order.id })).toBe('mismatch');
	});
});

// --- a new holder, and after the event ---------------------------------------------

describe('the requests of a ticket', () => {
	it('go with the holder when the ticket is handed over, and the pause too', async () => {
		const { beds, ada, bo } = await twoGuests();
		await askForSwap(su as any, LIVE, ada.order, beds[1].id, { vibe: '', note: '' });
		await su.collection('orders').update(bo.order.id, { no_swap_requests: true });
		await changeTicket(su as any, bo.order.id, {
			email: `new-${uid()}@example.com`,
			name: '',
			newHolder: true
		});
		const left = await su.collection('swap_requests').getFullList({
			filter: su.filter('to_order = {:o} || from_order = {:o}', { o: bo.order.id })
		});
		expect(left).toHaveLength(0);
		expect((await su.collection('orders').getOne(bo.order.id)).no_swap_requests).toBe(false);
	});

	it('are all deleted by forget-contacts after the event; bookings stay', async () => {
		const { beds, ada } = await twoGuests();
		await askForSwap(su as any, LIVE, ada.order, beds[1].id, { vibe: '', note: NOTE });
		const output = cozyAdmin(['tickets', 'forget-contacts', '--yes']);
		expect(output).toMatch(/swap request\(s\)/);
		expect(await su.collection('swap_requests').getFullList()).toHaveLength(0);
		expect((await bed(beds[0].id)).order).toBe(ada.order.id);
	});
});
