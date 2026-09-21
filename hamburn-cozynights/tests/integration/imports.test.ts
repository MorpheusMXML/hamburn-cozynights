// tests/integration/imports.test.ts — the ticket page and the template review
// against a real PocketBase with its hooks: a ticket handed over to a new
// holder (new pass, Telegram off, confirmation to the new address), the ticket
// list import, the search, and applying chosen template changes while the
// other bookings stay.
import { describe, it, expect, beforeAll } from 'vitest';
import type PocketBase from 'pocketbase';
import { BookingService } from '../../src/lib/server/booking';
import { changeTicket, importRoster, searchTickets } from '../../src/lib/server/tickets';
import { applyTemplate, compareTemplate } from '../../src/lib/server/template';
import { findPass } from '../../src/lib/server/pass';
import { defaultSelection } from '../../src/lib/template-diff';
import type { LayoutTemplate } from '../../src/lib/template';
import { seedHouse, seedTicket, serviceAccount, uid } from '../stack-helpers';

const MOCK_URL = process.env.MOCK_URL || '';
const MAILPIT_URL = process.env.MAILPIT_URL || '';

let su: PocketBase;
let booking: BookingService;

beforeAll(async () => {
	if (!MOCK_URL || !MAILPIT_URL) {
		throw new Error('MOCK_URL / MAILPIT_URL are not set — run with `npm run test:integration`.');
	}
	su = await serviceAccount();
	booking = new BookingService(su as any);
});

async function flush() {
	return su.send('/api/cozy/notify/flush?force=1', { method: 'POST' });
}

type Mail = { ID: string; Subject: string };
async function mailsTo(address: string): Promise<Mail[]> {
	const res = await fetch(
		`${MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:"${address}"`)}`
	);
	return [...((await res.json()).messages || [])].reverse();
}

async function mailText(id: string): Promise<string> {
	return (await (await fetch(`${MAILPIT_URL}/api/v1/message/${id}`)).json()).Text;
}

async function telegramTo(chat: string): Promise<{ text: string }[]> {
	const sent = await (await fetch(`${MOCK_URL}/_mock/telegram/sent`)).json();
	return sent.filter((m: { chat_id: string }) => m.chat_id === chat);
}

const format = (code: string) => code.replace(/(.{4})(?=.)/g, '$1-');

describe('a ticket passed on to someone else', () => {
	it('gets a new pass, loses the old holder’s Telegram and burner name, and keeps its spot', async () => {
		const { beds } = await seedHouse(su, 1);
		const ticket = await seedTicket(su);
		const oldEmail = `old-${uid()}@example.com`;
		await su.collection('orders').update(ticket.order.id, { email: oldEmail });
		await booking.bookBed(ticket.order as any, beds[0].id, 'Old Holder');
		const chat = String(800000 + Math.floor(Math.random() * 99999));
		await su
			.collection('guest_notify')
			.update(
				(
					await su
						.collection('guest_notify')
						.getFirstListItem(su.filter('order = {:o}', { o: ticket.order.id }))
				).id,
				{ tg_chat: chat, tg_spot: beds[0].id, tg_label: beds[0].label }
			);
		await flush();
		const oldPass = (await su.collection('orders').getOne(ticket.order.id)).pass_code as string;
		expect(oldPass).toMatch(/^[A-Z2-9]{12}$/);
		const telegramBefore = (await telegramTo(chat)).length;

		const newEmail = `new-${uid()}@example.com`;
		const outcome = await changeTicket(su as any, ticket.order.id, {
			email: newEmail,
			name: 'New Holder',
			newHolder: true
		});
		expect(outcome.confirmation).toBe(true);
		await flush();

		const stored = await su.collection('orders').getOne(ticket.order.id);
		expect(stored).toMatchObject({ email: newEmail, customer_name: 'New Holder', burner_name: '' });
		// PocketBase made a new pass for the confirmation; the old link is dead
		expect(stored.pass_code).toMatch(/^[A-Z2-9]{12}$/);
		expect(stored.pass_code).not.toBe(oldPass);
		expect(await findPass(su as any, oldPass)).toBeNull();

		const mails = await mailsTo(newEmail);
		expect(mails).toHaveLength(1);
		expect(mails[0].Subject).toContain(beds[0].label);
		const text = await mailText(mails[0].ID);
		expect(text).toContain('Hi New Holder,');
		expect(text).toContain(format(stored.pass_code));
		expect(text).not.toContain(format(oldPass));
		expect(text).not.toContain(ticket.code);

		// nothing more for the old holder
		expect(await telegramTo(chat)).toHaveLength(telegramBefore);
		const notify = await su
			.collection('guest_notify')
			.getFirstListItem(su.filter('order = {:o}', { o: ticket.order.id }));
		expect(notify.tg_chat).toBe('');
		expect((await su.collection('beds').getOne(beds[0].id)).order).toBe(ticket.order.id);
	});

	it('can just get a corrected address, without touching pass or Telegram', async () => {
		const { beds } = await seedHouse(su, 1);
		const ticket = await seedTicket(su);
		await booking.bookBed(ticket.order as any, beds[0].id, 'Typo Fixer');
		await flush();
		const pass = (await su.collection('orders').getOne(ticket.order.id)).pass_code;

		const email = `fixed-${uid()}@example.com`;
		await changeTicket(su as any, ticket.order.id, { email, name: '', newHolder: false });
		await flush();

		const stored = await su.collection('orders').getOne(ticket.order.id);
		expect(stored.pass_code).toBe(pass);
		expect(stored.burner_name).not.toBe('');
		expect(await mailsTo(email)).toHaveLength(1);
	});
});

describe('finding tickets in the real database', () => {
	it('finds a code in any case, also after the first sign-in stored its hash', async () => {
		const ticket = await seedTicket(su); // TEST-<hex>: mixed case
		await booking.getOrderByNumber(ticket.code); // first sign-in: hash stored
		for (const typed of [ticket.code.toLowerCase(), ticket.code.toUpperCase(), ticket.code]) {
			const found = await searchTickets(su as any, typed);
			expect(found.tickets.map((t) => t.id)).toEqual([ticket.order.id]);
			expect(found.tickets[0].signedIn).toBe(true);
		}
		// a ticket known only by its hash (the code itself not stored readably)
		const hashOnly = await seedTicket(su);
		await booking.getOrderByNumber(hashOnly.code);
		await su.collection('orders').update(hashOnly.order.id, { order_number: `renamed-${uid()}` });
		const byHash = await searchTickets(su as any, hashOnly.code);
		expect(byHash.tickets.map((t) => t.id)).toEqual([hashOnly.order.id]);
	});

	it('finds addresses with + and _ exactly, ignoring case', async () => {
		const tag = uid();
		const a = await seedTicket(su);
		const b = await seedTicket(su);
		await su.collection('orders').update(a.order.id, { email: `ada+cozy_${tag}@example.com` });
		// "_" is a wildcard for the database's LIKE: this one must not match
		await su.collection('orders').update(b.order.id, { email: `ada+cozyX${tag}@example.com` });
		const found = await searchTickets(su as any, `ADA+Cozy_${tag}@Example.com`);
		expect(found.tickets.map((t) => t.id)).toEqual([a.order.id]);
		expect(found.tickets[0].codeMasked).toBe(true);
	});
});

describe('importing the ticket list', () => {
	it('creates and updates the chosen tickets; new codes work for signing in', async () => {
		const tag = uid().toUpperCase();
		const existing = await seedTicket(su);
		const rows = [
			// addresses are stored in lower case
			{ line: 2, code: existing.code, email: `UPD-${tag}@Example.com`, name: 'Updated' },
			{ line: 3, code: `NEW-${tag}`, email: `new-${tag}@example.com`, name: '' },
			{ line: 4, code: `SKIP-${tag}`, email: '', name: '' }
		];
		const outcome = await importRoster(su as any, rows, {
			selected: [existing.code.toLowerCase(), `new-${tag}`.toLowerCase()],
			newHolders: []
		});
		expect(outcome).toMatchObject({ created: 1, updated: 1, failed: [] });

		expect(await su.collection('orders').getOne(existing.order.id)).toMatchObject({
			email: `upd-${tag.toLowerCase()}@example.com`,
			customer_name: 'Updated'
		});
		const created = await booking.getOrderByNumber(`NEW-${tag}`);
		expect(created).toMatchObject({
			customer_name: `Ticket NEW-${tag}`,
			email: `new-${tag.toLowerCase()}@example.com`
		});
		expect(await booking.getOrderByNumber(`SKIP-${tag}`)).toBeNull();
	});
});

describe('applying chosen template changes', () => {
	it('moves, renames, adds and removes only what was chosen; other bookings stay', async () => {
		const { house, room, beds } = await seedHouse(su, 2);
		const guest = await seedTicket(su);
		const leaving = await seedTicket(su);
		const email = `released-${uid()}@example.com`;
		await su.collection('orders').update(leaving.order.id, { email });
		await booking.bookBed(guest.order as any, beds[0].id, 'Stays');
		await booking.bookBed(leaving.order as any, beds[1].id, 'Goes');
		await flush();

		const template: LayoutTemplate = {
			format: 'cozynights-layout',
			version: '2.1',
			name: `Review ${uid()}`,
			exported_at: '',
			map: { image: '/map.png', width: 1000, height: 700 },
			houses: [
				{
					name: house.name,
					x: 42,
					y: 43,
					rooms: [
						{
							name: `${room.name} (renamed)`,
							room_number: 1,
							beds: [
								{ label: beds[0].label, enabled: true, is_locked: false },
								{ label: 'Extra', enabled: true, is_locked: true }
							]
						}
					]
				}
			]
		};
		const diff = await compareTemplate(su as any, template);
		const mine = (key: string) =>
			key.startsWith(`h:${encodeURIComponent(house.name.toLowerCase())}`);
		const chosen = [...defaultSelection(diff)].filter(mine);
		// the missing spot (booked by "Goes") is chosen by hand
		const goes = diff.houses
			.flatMap((h) => h.rooms)
			.flatMap((r) => r.spots)
			.find((s) => s.id === beds[1].id);
		expect(goes).toMatchObject({ own: 'removed', booked: 1 });
		chosen.push(goes!.key);

		const outcome = await applyTemplate(su as any, template, chosen);
		expect(outcome.backup).toMatch(/^pre-import-.*\.zip$/);
		expect(outcome).toMatchObject({
			created: { houses: 0, rooms: 0, spots: 1 },
			updated: { houses: 1, rooms: 1, spots: 0 },
			removed: { houses: 0, rooms: 0, spots: 1 },
			releasedBookings: 1,
			problems: []
		});

		expect(await su.collection('houses').getOne(house.id)).toMatchObject({ x: 42, y: 43 });
		expect((await su.collection('rooms').getOne(room.id)).name).toBe(`${room.name} (renamed)`);
		expect(await su.collection('beds').getOne(beds[0].id)).toMatchObject({
			occupied: true,
			order: guest.order.id
		});
		await expect(su.collection('beds').getOne(beds[1].id)).rejects.toMatchObject({ status: 404 });
		const extra = await su
			.collection('beds')
			.getFirstListItem(su.filter('room = {:room} && label = "Extra"', { room: room.id }));
		expect(extra).toMatchObject({ is_locked: true, enabled: true, occupied: false });
		expect((await su.collection('orders').getOne(leaving.order.id)).burner_name).toBe('');

		// the guest whose spot went is told
		await flush();
		const mails = await mailsTo(email);
		expect(mails.at(-1)?.Subject).toContain('was released');

		// what was not chosen elsewhere in the shared test database is untouched
		const again = await compareTemplate(su as any, template);
		expect([...defaultSelection(again)].filter(mine)).toEqual([]);
		expect((await su.backups.getFullList()).some((b) => b.key === outcome.backup)).toBe(true);
	});
});
