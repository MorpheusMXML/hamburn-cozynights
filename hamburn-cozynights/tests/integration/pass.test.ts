// tests/integration/pass.test.ts — booking passes in the real PocketBase:
// codes are created by pb_hooks/cozy_pass.pb.js when a ticket gets a spot,
// stay the same for that ticket, are unique, and reach the guest in the
// confirmation messages (pb_hooks/lib/notify.js).
import { describe, it, expect, beforeAll } from 'vitest';
import crypto from 'crypto';
import type PocketBase from 'pocketbase';
import { BookingService } from '../../src/lib/server/booking';
import { formatPassCode, isPassCode } from '../../src/lib/pass';
import { ensurePassCode, findPass } from '../../src/lib/server/pass';
import {
	anonymous,
	expectRefused,
	seedHouse,
	seedTicket,
	serviceAccount,
	uid
} from '../stack-helpers';

const MOCK_URL = process.env.MOCK_URL || '';
const MAILPIT_URL = process.env.MAILPIT_URL || '';

let su: PocketBase;
let booking: BookingService;

beforeAll(async () => {
	su = await serviceAccount();
	booking = new BookingService(su as any);
});

async function passCodeOf(orderId: string): Promise<string> {
	return (await su.collection('orders').getOne(orderId)).pass_code;
}

async function flush() {
	return su.send('/api/cozy/notify/flush?force=1', { method: 'POST' });
}

describe('booking passes', () => {
	it('are created when a ticket gets a spot, and stay the same for that ticket', async () => {
		const { beds } = await seedHouse(su, 2);
		const guest = await seedTicket(su);
		expect(await passCodeOf(guest.order.id)).toBe('');

		await booking.bookBed(guest.order as any, beds[0].id, 'Passer');
		const code = await passCodeOf(guest.order.id);
		expect(isPassCode(code)).toBe(true);

		await booking.bookBed(guest.order as any, beds[1].id, 'Passer'); // move
		expect(await passCodeOf(guest.order.id)).toBe(code);
		await booking.unbookOrder(guest.order.id); // release
		expect(await passCodeOf(guest.order.id)).toBe(code);

		const pass = await findPass(su as any, code);
		expect(pass?.order.id).toBe(guest.order.id);
		expect(pass?.spot).toBeNull(); // released
	});

	it('show the current spot, and nothing for unknown codes', async () => {
		const { house, room, beds } = await seedHouse(su, 1);
		const guest = await seedTicket(su);
		await booking.bookBed(guest.order as any, beds[0].id, 'Sleeper');

		const pass = await findPass(su as any, await passCodeOf(guest.order.id));
		expect(pass?.spot).toMatchObject({
			spot: beds[0].label,
			room: `${room.name} #1`,
			house: house.name
		});
		expect(await findPass(su as any, 'AAAABBBBCCCC')).toBeNull();
	});

	it('are unique', async () => {
		const { beds } = await seedHouse(su, 1);
		const first = await seedTicket(su);
		const second = await seedTicket(su);
		await booking.bookBed(first.order as any, beds[0].id, 'First');
		await expectRefused(
			su
				.collection('orders')
				.update(second.order.id, { pass_code: await passCodeOf(first.order.id) })
		);
	});

	it('can be requested by the app (service account) only', async () => {
		const guest = await seedTicket(su);
		const code = await ensurePassCode(su as any, { id: guest.order.id, pass_code: '' });
		expect(isPassCode(code)).toBe(true);
		expect(await ensurePassCode(su as any, { id: guest.order.id, pass_code: '' })).toBe(code);

		await expectRefused(anonymous().send(`/api/cozy/pass/${guest.order.id}`, { method: 'POST' }));
		await expectRefused(su.send(`/api/cozy/pass/doesnotexist123`, { method: 'POST' }));
	});

	it('reach the guest with the confirmation (e-mail and Telegram)', async () => {
		const { beds } = await seedHouse(su, 1);
		const guest = await seedTicket(su);
		const email = `pass-${uid()}@example.com`;
		await su.collection('orders').update(guest.order.id, { email });
		const chat = 900000 + Math.floor(Math.random() * 90000);
		const token = crypto.randomBytes(24).toString('base64url');
		// what "Get updates on Telegram" does; the address above already made the record
		const notify = await su
			.collection('guest_notify')
			.getFirstListItem(su.filter('order = {:order}', { order: guest.order.id }));
		await su.collection('guest_notify').update(notify.id, {
			tg_token_hash: crypto.createHash('sha256').update(token).digest('hex'),
			tg_token_exp: new Date(Date.now() + 30 * 60 * 1000).toISOString()
		});
		await fetch(`${MOCK_URL}/_mock/telegram/update`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ chat_id: chat, text: `/start ${token}` })
		});

		await booking.bookBed(guest.order as any, beds[0].id, 'Pass Holder');
		await flush();

		const shown = formatPassCode(await passCodeOf(guest.order.id));
		const search = await (
			await fetch(`${MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`)
		).json();
		const mail = await (
			await fetch(`${MAILPIT_URL}/api/v1/message/${search.messages[0].ID}`)
		).json();
		expect(mail.Text).toContain(`/pass/${shown}`);
		expect(mail.Text).toContain(`code ${shown}`);
		expect(mail.HTML).toContain(`/pass/${shown}"`);
		expect(mail.Text).not.toContain(guest.code);

		const sent: { chat_id: string; text: string }[] = await (
			await fetch(`${MOCK_URL}/_mock/telegram/sent`)
		).json();
		const toGuest = sent.filter((m) => m.chat_id === String(chat)).map((m) => m.text);
		expect(toGuest.some((t) => t.includes(`/pass/${shown}`))).toBe(true);
	});
});
