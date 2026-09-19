// tests/admin-imports.test.ts — the server side of the ticket page and of the
// template review: finding and changing tickets, importing the ticket list,
// applying chosen template changes, and who may do what. PocketBase is the
// in-memory stand-in of tests/memory-pb.ts; the real database, its hooks and the
// e-mails are covered by tests/integration/imports.test.ts.
import { describe, it, expect, beforeEach } from 'vitest';
import { memoryPb, type MemoryPb } from './memory-pb';
import { encrypt } from '../src/lib/server/crypto';
import {
	TicketError,
	changeTicket,
	importRoster,
	readRosterRows,
	searchTickets
} from '../src/lib/server/tickets';
import { TemplateImportError, applyTemplate } from '../src/lib/server/template';
import { defaultSelection, diffLayout } from '../src/lib/template-diff';
import { APP_SETTINGS_ID } from '../src/lib/server/constants';
import { actions as ticketActions } from '../src/routes/admin/tickets/+page.server';
import { actions as dashboardActions } from '../src/routes/admin/+page.server';
import type { LayoutTemplate } from '../src/lib/template';

const crew = {
	id: 'a1',
	email: 'crew@mauersegler.art',
	name: '',
	role: 'admin',
	isSuperuser: false
};
const boss = {
	...crew,
	id: 'a2',
	email: 'boss@mauersegler.art',
	role: 'superuser',
	isSuperuser: true
};

/** A small camp: one house, one room with two spots, one of them booked by HB-1001. */
function seed(): MemoryPb {
	return memoryPb({
		houses: [{ id: 'h1', name: 'Neon Cave', x: 100, y: 200 }],
		rooms: [{ id: 'r1', house: 'h1', name: 'Bunks', room_number: 1 }],
		beds: [
			{
				id: 'b1',
				room: 'r1',
				label: 'B1',
				enabled: true,
				is_locked: false,
				occupied: true,
				order: 'o1'
			},
			{
				id: 'b2',
				room: 'r1',
				label: 'B2',
				enabled: true,
				is_locked: false,
				occupied: false,
				order: ''
			}
		],
		orders: [
			{
				id: 'o1',
				order_number: 'HB-1001',
				order_hash: 'hash-1001',
				customer_name: 'Ada Lovelace',
				email: 'ada@example.org',
				pass_code: 'PASSCODE2345',
				burner_name: encrypt('Sparkle')
			},
			{
				id: 'o2',
				order_number: 'HB-1002',
				customer_name: 'Ticket HB-1002',
				email: 'ada@example.org'
			},
			{ id: 'o3', order_number: 'HB-1003', customer_name: 'Grace', email: '' }
		],
		guest_notify: [{ id: 'n1', order: 'o1', tg_chat: '4711', tg_spot: 'b1', tg_label: 'B1' }],
		admin_events: [],
		app_settings: [{ id: APP_SETTINGS_ID, is_booking_active: false, booking_unlock_at: '' }]
	});
}

let db: MemoryPb;
beforeEach(() => {
	db = seed();
});

const order = (id: string) => db.data.orders.find((o) => o.id === id)!;

describe('finding tickets', () => {
	it('finds a ticket by its code in any case, with spot, burner name and Telegram', async () => {
		const found = await searchTickets(db.pb, '  hb-1001 ');
		expect(found.by).toBe('code');
		expect(found.tickets).toHaveLength(1);
		expect(found.tickets[0]).toEqual({
			id: 'o1',
			code: 'HB-1001',
			codeMasked: false,
			name: 'Ada Lovelace',
			email: 'ada@example.org',
			signedIn: true,
			spot: { house: 'Neon Cave', room: 'Bunks #1', spot: 'B1', roomId: 'r1', checkIn: null },
			burnerName: 'Sparkle',
			telegram: true,
			pass: true
		});
	});

	it('finds every ticket of an address, with the codes hidden', async () => {
		const found = await searchTickets(db.pb, 'ADA@example.org');
		expect(found.by).toBe('email');
		expect(found.tickets.map((t) => [t.code, t.codeMasked])).toEqual([
			['H•••', true],
			['H•••', true]
		]);
		// the default label would give the code away
		expect(found.tickets[1].name).toBe('');
		expect(JSON.stringify(found)).not.toContain('HB-1002');
	});

	it('keeps codes and addresses out of database queries (they end up in logs)', async () => {
		await searchTickets(db.pb, 'HB-1001');
		await searchTickets(db.pb, 'ada@example.org');
		const queries = db.queries.join('\n');
		expect(queries).not.toContain('HB-1001');
		expect(queries.toLowerCase()).not.toContain('ada@');
	});

	it('explains what it can not search for', async () => {
		await expect(searchTickets(db.pb, '')).rejects.toBeInstanceOf(TicketError);
		await expect(searchTickets(db.pb, 'two words')).rejects.toThrow(/letters, digits/);
		await expect(searchTickets(db.pb, 'ada@')).rejects.toThrow(/not a complete e-mail/);
	});
});

describe('changing a ticket', () => {
	it('changes the address; a ticket with a spot gets a confirmation there', async () => {
		const outcome = await changeTicket(db.pb, 'o1', {
			email: ' New@Example.org ',
			name: 'Ada Lovelace',
			newHolder: false
		});
		expect(order('o1')).toMatchObject({ email: 'new@example.org', pass_code: 'PASSCODE2345' });
		expect(outcome).toMatchObject({
			emailBefore: 'ada@example.org',
			emailChanged: true,
			nameChanged: false,
			newHolder: false,
			confirmation: true,
			maskedCode: 'H•••'
		});
		// Telegram stays: same holder
		expect(db.data.guest_notify[0].tg_chat).toBe('4711');
	});

	it('hands a ticket over: Telegram first, then a new pass and no burner name', async () => {
		const outcome = await changeTicket(db.pb, 'o1', {
			email: 'bob@example.org',
			name: '',
			newHolder: true
		});
		expect(db.log).toEqual(['update guest_notify/n1', 'update orders/o1']);
		expect(db.data.guest_notify[0]).toMatchObject({ tg_chat: '', tg_spot: '', tg_label: '' });
		expect(order('o1')).toMatchObject({
			email: 'bob@example.org',
			customer_name: 'Ticket HB-1001', // an empty name is the default label
			pass_code: '',
			burner_name: ''
		});
		// the spot stays with the ticket
		expect(db.data.beds.find((b) => b.id === 'b1')?.order).toBe('o1');
		expect(outcome.ticket).toMatchObject({
			code: 'H•••', // never the full code in an answer
			codeMasked: true,
			name: '',
			burnerName: '',
			pass: false,
			telegram: false
		});
		expect(outcome.confirmation).toBe(true);
	});

	it("resets the old holder's check-in: the new holder checks in with the new pass", async () => {
		const bed = db.data.beds.find((b) => b.id === 'b1')!;
		Object.assign(bed, { checked_in_at: '2026-09-19 12:00:00.000Z', checked_in_by: crew.email });
		const outcome = await changeTicket(db.pb, 'o1', {
			email: 'bob@example.org',
			name: '',
			newHolder: true
		});
		expect(outcome.checkInReset).toBe(true);
		// before the ticket itself changes, like the Telegram link
		expect(db.log).toEqual(['update guest_notify/n1', 'update beds/b1', 'update orders/o1']);
		expect(bed).toMatchObject({
			order: 'o1',
			occupied: true,
			checked_in_at: '',
			checked_in_by: ''
		});
		expect(outcome.ticket.spot?.checkIn).toBeNull();

		// an address change alone keeps it
		Object.assign(bed, { checked_in_at: '2026-09-19 12:00:00.000Z', checked_in_by: crew.email });
		const same = await changeTicket(db.pb, 'o1', {
			email: 'b@example.org',
			name: '',
			newHolder: false
		});
		expect(same.checkInReset).toBe(false);
		expect(same.ticket.spot?.checkIn).toEqual({ at: '2026-09-19 12:00:00.000Z', by: crew.email });
	});

	it("deletes the old holder's special-needs request when a ticket is passed on", async () => {
		db.data.special_requests = [
			{ id: 'sr1', order: 'o1', status: 'approved', needs: 'x', reason: 'y', consent_at: '2026-09-01' },
			{ id: 'sr3', order: 'o3', status: 'pending', needs: 'x', reason: 'y', consent_at: '2026-09-01' }
		];
		const outcome = await changeTicket(db.pb, 'o1', {
			email: 'new@example.org',
			name: 'New Holder',
			newHolder: true
		});
		expect(outcome.requestRemoved).toBe(true);
		expect(db.data.special_requests.map((r) => r.id)).toEqual(['sr3']);
		expect(db.log).toContain('delete special_requests/sr1');
		// the spot stays with the ticket, as an ordinary booking
		expect(db.data.beds.find((b) => b.id === 'b1')).toMatchObject({ occupied: true, order: 'o1' });

		// an address change alone keeps the request
		const kept = await changeTicket(db.pb, 'o3', { email: 'g@example.org', name: '', newHolder: false });
		expect(kept.requestRemoved).toBe(false);
		expect(db.data.special_requests).toHaveLength(1);
	});

	it('removes an address, and changes nothing when nothing changed', async () => {
		await changeTicket(db.pb, 'o3', { email: '', name: 'Grace', newHolder: false });
		expect(db.log).toEqual([]);
		const removed = await changeTicket(db.pb, 'o2', { email: '', name: '', newHolder: false });
		expect(order('o2').email).toBe('');
		expect(removed.confirmation).toBe(false);
	});

	it('refuses bad addresses and names, and tickets that are gone', async () => {
		await expect(
			changeTicket(db.pb, 'o1', { email: 'not-an-address', name: '', newHolder: false })
		).rejects.toMatchObject({ status: 400 });
		await expect(
			changeTicket(db.pb, 'o1', { email: '', name: 'x'.repeat(101), newHolder: false })
		).rejects.toMatchObject({ status: 400 });
		await expect(
			changeTicket(db.pb, 'gone', { email: '', name: '', newHolder: false })
		).rejects.toMatchObject({ status: 404 });
		expect(db.log).toEqual([]);
	});
});

describe('importing the ticket list', () => {
	const rows = [
		{ line: 2, code: 'HB-1001', email: 'bob@example.org', name: 'Bob' }, // handed over
		{ line: 3, code: 'HB-1003', email: 'grace@example.org', name: '' }, // first address
		{ line: 4, code: 'HB-2000', email: 'new@example.org', name: 'Newbie' }, // new
		{ line: 5, code: 'HB-2001', email: 'other@example.org', name: '' }, // new, not chosen
		{ line: 6, code: 'bad code', email: '', name: '' } // problem
	];

	it('imports only the chosen tickets, and hands over only where it applies', async () => {
		const bed = db.data.beds.find((b) => b.id === 'b1')!;
		Object.assign(bed, { checked_in_at: '2026-09-19 12:00:00.000Z', checked_in_by: crew.email });
		const outcome = await importRoster(db.pb, rows, {
			selected: ['hb-1001', 'hb-1003', 'hb-2000', 'hb-9999', 'bad code'],
			newHolders: ['hb-1001', 'hb-1003']
		});
		expect(outcome).toMatchObject({
			created: 1,
			updated: 2,
			newHolders: 1,
			confirmations: 1,
			skipped: 2,
			failed: []
		});
		expect(order('o1')).toMatchObject({
			email: 'bob@example.org',
			customer_name: 'Bob',
			pass_code: ''
		});
		expect(db.data.guest_notify[0].tg_chat).toBe('');
		// the new holder checks in with the new pass; the spot stays booked
		expect(bed).toMatchObject({ order: 'o1', checked_in_at: '', checked_in_by: '' });
		// HB-1003 had no address and no spot: nothing to hand over
		expect(order('o3')).toMatchObject({ email: 'grace@example.org', customer_name: 'Grace' });
		expect(db.data.orders.map((o) => o.order_number)).toEqual([
			'HB-1001',
			'HB-1002',
			'HB-1003',
			'HB-2000'
		]);
		expect(db.data.orders[3]).toMatchObject({ customer_name: 'Newbie', email: 'new@example.org' });
	});

	it('reports tickets the database refused and imports the others', async () => {
		db.failWhen = (collection, action, data) =>
			collection === 'orders' && action === 'create' && data.order_number === 'HB-2000';
		const outcome = await importRoster(db.pb, rows, {
			selected: ['hb-2000', 'hb-2001'],
			newHolders: []
		});
		expect(outcome.created).toBe(1);
		expect(outcome.failed).toEqual([{ code: 'HB-2000', error: 'name: refused by test' }]);
	});

	it('checks the shape of what the browser sent', () => {
		expect(() => readRosterRows('not json')).toThrow(TicketError);
		expect(() => readRosterRows('[]')).toThrow(/No tickets arrived/);
		expect(() => readRosterRows(JSON.stringify(Array(5001).fill({ code: 'A' })))).toThrow(/limit/);
		expect(
			readRosterRows(JSON.stringify([{ code: 'A', email: 5, name: 'x'.repeat(900) }]))
		).toEqual([{ line: 2, code: 'A', email: '', name: 'x'.repeat(400) }]);
	});
});

describe('applying template changes', () => {
	const file = (): LayoutTemplate => ({
		format: 'cozynights-layout',
		version: '2.0',
		name: 'Next year',
		exported_at: '',
		map: { image: '/map.png', width: 1000, height: 700 },
		houses: [
			{
				name: 'Neon Cave',
				x: 150, // moved
				y: 200,
				rooms: [
					// B1 (booked) unchanged, B2 missing, B3 new
					{
						name: 'Bunks',
						room_number: 1,
						beds: [
							{ label: 'B1', enabled: true, is_locked: false },
							{ label: 'B3', enabled: true, is_locked: true }
						]
					},
					{
						name: 'Attic',
						room_number: 2,
						beds: [{ label: 'A1', enabled: true, is_locked: false }]
					}
				]
			}
		]
	});

	const everything = async (template: LayoutTemplate) => {
		const { loadCamp } = await import('../src/lib/server/template');
		const diff = diffLayout(await loadCamp(db.pb), template);
		return [...defaultSelection(diff), 'h:neon%20cave/r:1/s:b2'];
	};

	it('backs up, creates, changes and removes — and keeps the unchanged booking', async () => {
		const template = file();
		const outcome = await applyTemplate(db.pb, template, await everything(template));

		expect(db.log[0]).toMatch(/^backup pre-import-/);
		expect(outcome).toMatchObject({
			created: { houses: 0, rooms: 1, spots: 2 },
			updated: { houses: 1, rooms: 0, spots: 0 },
			removed: { houses: 0, rooms: 0, spots: 1 },
			releasedBookings: 0,
			skipped: 0,
			problems: [],
			namesCleared: true
		});
		expect(db.data.houses[0]).toMatchObject({ x: 150, y: 200 });
		expect(db.data.beds.find((b) => b.id === 'b1')).toMatchObject({ occupied: true, order: 'o1' });
		expect(db.data.beds.find((b) => b.id === 'b2')).toBeUndefined();
		const b3 = db.data.beds.find((b) => b.label === 'B3');
		expect(b3).toMatchObject({ room: 'r1', is_locked: true, enabled: true, occupied: false });
		const attic = db.data.rooms.find((r) => r.name === 'Attic');
		expect(attic).toMatchObject({ house: 'h1', room_number: 2, amount_beds: 1 });
		expect(db.data.beds.find((b) => b.label === 'A1')?.room).toBe(attic?.id);
	});

	it('releases a removed booking and forgets its burner name', async () => {
		const template = file();
		template.houses[0].rooms[0].beds = [{ label: 'B2', enabled: true, is_locked: false }];
		const outcome = await applyTemplate(db.pb, template, ['h:neon%20cave/r:1/s:b1'], {
			skipBackup: true
		});
		expect(outcome.backup).toBeNull();
		expect(outcome.releasedBookings).toBe(1);
		expect(db.data.beds.find((b) => b.id === 'b1')).toBeUndefined();
		expect(order('o1').burner_name).toBe('');
		// the ticket itself stays
		expect(order('o1').order_number).toBe('HB-1001');
	});

	it('removes what it created when the database refuses a new spot, and changes nothing else', async () => {
		db.failWhen = (collection, action, data) =>
			collection === 'beds' && action === 'create' && data.label === 'A1';
		const template = file();
		await expect(applyTemplate(db.pb, template, await everything(template))).rejects.toThrow(
			TemplateImportError
		);
		expect(db.data.rooms.map((r) => r.id)).toEqual(['r1']);
		expect(db.data.beds.map((b) => b.id)).toEqual(['b1', 'b2']);
		expect(db.data.houses[0]).toMatchObject({ x: 100 });
	});

	it('makes no backup when there is nothing to do, and counts what is no longer needed', async () => {
		const outcome = await applyTemplate(db.pb, file(), ['h:unknown', 'h:neon%20cave/r:1/s:b1']);
		expect(outcome.backup).toBeNull();
		expect(outcome.skipped).toBe(2);
		expect(db.log).toEqual([]);
	});
});

describe('who may do what', () => {
	const post = (fields: Record<string, string>) => {
		const form = new FormData();
		for (const [key, value] of Object.entries(fields)) form.set(key, value);
		return { formData: async () => form } as unknown as Request;
	};
	const locals = (admin: typeof crew | null) => ({ admin, pb: db.pb, adminPb: db.pb }) as any;

	it('lets every admin find and change tickets, and logs changes without full codes or addresses', async () => {
		const found: any = await ticketActions.search({
			locals: locals(crew),
			request: post({ q: 'HB-1001' })
		} as any);
		expect(found.search.tickets).toHaveLength(1);

		const changed: any = await ticketActions.update({
			locals: locals(crew),
			request: post({ id: 'o1', email: 'bob@example.org', name: 'Bob', newHolder: '1' })
		} as any);
		expect(changed.updated.changed).toBe(true);
		const event = db.data.admin_events[0];
		expect(event).toMatchObject({
			action: 'ticket_updated',
			actor: 'crew@mauersegler.art',
			subject: 'o1',
			details: {
				ticket: 'H•••',
				emailChanged: true,
				emailFrom: 'a•••@example.org',
				emailTo: 'b•••@example.org',
				nameChanged: true,
				newHolder: true,
				hasSpot: true
			}
		});
		expect(JSON.stringify(event)).not.toContain('HB-1001');
		expect(JSON.stringify(event)).not.toContain('bob@example.org');
	});

	it('keeps the ticket list import for superusers', async () => {
		const rows = JSON.stringify([{ line: 2, code: 'HB-3000', email: 'x@example.org', name: '' }]);
		for (const action of ['previewRoster', 'importRoster'] as const) {
			const refused: any = await ticketActions[action]({
				locals: locals(crew),
				request: post({ rows, selected: '["hb-3000"]', newHolders: '[]' })
			} as any);
			expect(refused.status).toBe(403);
		}
		expect(db.data.orders).toHaveLength(3);

		const preview: any = await ticketActions.previewRoster({
			locals: locals(boss),
			request: post({ rows })
		} as any);
		expect(preview.roster.diff.changes.map((c: any) => c.code)).toEqual(['HB-3000']);
		// the stored tickets that are not in the file: shortened codes only
		expect(preview.roster.diff.notInFile.map((t: any) => t.code)).toEqual(['H•••', 'H•••', 'H•••']);
		expect(JSON.stringify(preview)).not.toContain('HB-1001');
		const done: any = await ticketActions.importRoster({
			locals: locals(boss),
			request: post({ rows, selected: '["hb-3000"]', newHolders: '[]' })
		} as any);
		expect(done.imported.created).toBe(1);
		expect(db.data.admin_events.at(-1)).toMatchObject({
			action: 'tickets_imported',
			details: { created: 1, updated: 0 }
		});
	});

	it('refuses the ticket actions without an admin session', async () => {
		for (const action of ['search', 'update', 'previewRoster', 'importRoster'] as const) {
			const refused: any = await ticketActions[action]({
				locals: locals(null),
				request: post({ q: 'HB-1001', id: 'o1' })
			} as any);
			expect(refused.status).toBe(403);
		}
	});

	const templateUpload = (template: LayoutTemplate, extra: Record<string, string> = {}) => {
		const form = new FormData();
		form.set(
			'template',
			new Blob([JSON.stringify(template)], { type: 'application/json' }),
			't.json'
		);
		for (const [key, value] of Object.entries(extra)) form.set(key, value);
		return { formData: async () => form } as unknown as Request;
	};
	const layout = (): LayoutTemplate => ({
		format: 'cozynights-layout',
		version: '2.0',
		name: 'Tent only',
		exported_at: '',
		map: { image: '/map.png', width: 1000, height: 700 },
		houses: [{ name: 'Tent', x: 800, y: 600, rooms: [] }]
	});

	it('lets every admin compare a template, but only superusers apply it in Staging Mode', async () => {
		const review: any = await dashboardActions.previewTemplate({
			locals: locals(crew),
			request: templateUpload(layout())
		} as any);
		expect(review.review.lockedReason).toMatch(/Only superusers/);
		expect(review.review.selection).toEqual(['h:tent']);

		const refused: any = await dashboardActions.importTemplate({
			locals: locals(crew),
			request: templateUpload(layout(), { selection: '["h:tent"]' })
		} as any);
		expect(refused.status).toBe(403);

		db.data.app_settings[0].is_booking_active = true;
		const live: any = await dashboardActions.importTemplate({
			locals: locals(boss),
			request: templateUpload(layout(), { selection: '["h:tent"]' })
		} as any);
		expect(live.status).toBe(403);
		const liveReview: any = await dashboardActions.previewTemplate({
			locals: locals(boss),
			request: templateUpload(layout())
		} as any);
		expect(liveReview.review.lockedReason).toMatch(/Live Booking/);
		expect(db.data.houses).toHaveLength(1);

		db.data.app_settings[0].is_booking_active = false;
		const applied: any = await dashboardActions.importTemplate({
			locals: locals(boss),
			request: templateUpload(layout(), { selection: '["h:tent"]', skipBackup: '1' })
		} as any);
		expect(applied.applied.created.houses).toBe(1);
		expect(db.data.houses.map((h) => h.name)).toEqual(['Neon Cave', 'Tent']);
		expect(db.data.admin_events.at(-1)).toMatchObject({
			action: 'template_imported',
			subject: 'Tent only'
		});
	});

	it('keeps the audit entry of a template with a very long name', async () => {
		const long = { ...layout(), name: 'L'.repeat(400) };
		const applied: any = await dashboardActions.importTemplate({
			locals: locals(boss),
			request: templateUpload(long, { selection: '["h:tent"]', skipBackup: '1' })
		} as any);
		expect(applied.applied.created.houses).toBe(1);
		expect(db.data.admin_events.at(-1)?.subject).toHaveLength(320);
	});

	it('refuses an import without the list of chosen changes', async () => {
		const refused: any = await dashboardActions.importTemplate({
			locals: locals(boss),
			request: templateUpload(layout(), { selection: 'nonsense' })
		} as any);
		expect(refused.status).toBe(400);
		expect(db.data.houses).toHaveLength(1);
	});
});
