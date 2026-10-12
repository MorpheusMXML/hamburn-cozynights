// tests/ticket-spot.test.ts — moving and releasing a ticket's booking on the
// Tickets page (docs/admin/tickets.md): every admin, in every phase; ♿ spots
// only through an approved special-needs request, a locked 🔒 spot only when
// confirmed, never a booking that changed since the card was shown; the audit
// log names the masked code only. PocketBase is the in-memory stand-in of
// tests/fake-pb.ts (its booking route: tests/fake-book.ts); the hooks — the
// guest's message, a check-in dropped with the release, the crew chat line —
// are covered against a real PocketBase in tests/integration.
import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('$env/dynamic/private', () => ({
	env: {
		ENCRYPTION_KEY: '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff',
		PB_ADMIN_EMAIL: 'admin@test.com',
		PB_ADMIN_PASSWORD: 'password'
	}
}));

import { FakePb } from './fake-pb';
import { createLookupHash, decrypt, encrypt } from '../src/lib/server/crypto';
import { APP_SETTINGS_ID } from '../src/lib/server/constants';
import { isSpotFixed } from '../src/lib/server/special-requests';
import {
	TicketError,
	moveTicketSpot,
	releaseTicketSpot,
	ticketMoveSpots
} from '../src/lib/server/tickets';
import { actions as ticketActions } from '../src/routes/admin/tickets/+page.server';

function form(fields: Record<string, string | string[]>): FormData {
	const data = new FormData();
	for (const [key, value] of Object.entries(fields)) {
		for (const v of Array.isArray(value) ? value : [value]) data.append(key, v);
	}
	return data;
}

const admin = {
	id: 'a1',
	email: 'crew@mauersegler.art',
	name: 'Crew',
	role: 'admin' as const,
	isSuperuser: false
};

const CHECKED_IN = '2026-10-29 18:00:00.000Z';

/**
 * One house, one room, six spots. Ada (HB-1001) holds B1 and Bo B3; B2 is
 * free, B4 a free ♿ spot, B5 a free locked 🔒 one, B6 is switched off. Cy
 * holds no spot.
 */
function camp(settings: Record<string, unknown> = {}) {
	const pb = new FakePb();
	pb.seed('app_settings', { id: APP_SETTINGS_ID, is_booking_active: false, ...settings });
	const house = pb.seed('houses', { name: 'Villa' });
	const room = pb.seed('rooms', { name: 'Dorm', room_number: 2, house: house.id });
	// FakePb's rows are untyped; the service takes PocketBase records.
	const bed = (label: string, extra: Record<string, unknown> = {}): any =>
		pb.seed('beds', {
			label,
			room: room.id,
			enabled: true,
			occupied: false,
			is_locked: false,
			is_special: false,
			order: '',
			checked_in_at: '',
			checked_in_by: '',
			...extra
		});
	const ticket = (code: string, name: string): any =>
		pb.seed('orders', {
			order_number: code,
			order_hash: createLookupHash(code),
			customer_name: `${name} Lovelace`,
			email: `${name.toLowerCase()}@example.com`,
			burner_name: encrypt(`${name} Sparkle`)
		});
	const ada = ticket('HB-1001', 'Ada');
	const bo = ticket('HB-1002', 'Bo');
	const cy = ticket('HB-1003', 'Cy');
	const b1 = bed('B1', { occupied: true, order: ada.id });
	const b2 = bed('B2');
	const b3 = bed('B3', { occupied: true, order: bo.id });
	const b4 = bed('B4', { is_special: true });
	const b5 = bed('B5', { is_locked: true });
	const b6 = bed('B6', { enabled: false });
	const spot = (id: string) => pb.rows('beds').find((b) => b.id === id)!;
	const order = (id: string) => pb.rows('orders').find((o) => o.id === id)!;
	const request = () => pb.rows('special_requests')[0];
	/** Everything stored, to show that a refusal changed nothing. */
	const snapshot = () => structuredClone(pb.tables);
	return { pb, house, room, ada, bo, cy, b1, b2, b3, b4, b5, b6, spot, order, request, snapshot };
}
type Camp = ReturnType<typeof camp>;

/** Every way the room's spots are named, none of which may reach the audit log. */
const SPOT_WORDS = ['B1', 'B2', 'B3', 'B4', 'B5', 'Dorm', 'Villa'];

async function refusal(promise: Promise<unknown>): Promise<TicketError> {
	const outcome = await promise.then(
		() => null,
		(err) => err
	);
	expect(outcome).toBeInstanceOf(TicketError);
	return outcome as TicketError;
}

/** Calls one of the page's actions as SvelteKit would. */
function act(
	c: Camp,
	name: 'spots' | 'move' | 'release',
	fields: Record<string, string | string[]>,
	who: typeof admin | null = admin
): Promise<any> {
	return ticketActions[name]({
		request: { formData: async () => form(fields) },
		locals: { pb: c.pb, adminPb: c.pb, admin: who }
	} as any) as Promise<any>;
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe('moving a booking (moveTicketSpot)', () => {
	it.each([
		['Staging', {}],
		['Live', { is_booking_active: true }],
		['Closed', { booking_closed: true }]
	])(
		'moves it in one go in %s: the old spot is free, the new one holds the ticket, the burner name stays',
		async (_phase, settings) => {
			const c = camp(settings);
			const outcome = await moveTicketSpot(c.pb as any, admin, c.ada.id, c.b1.id, c.b2.id);

			expect(c.spot(c.b1.id)).toMatchObject({ order: '', occupied: false });
			expect(c.spot(c.b2.id)).toMatchObject({ order: c.ada.id, occupied: true });
			expect(decrypt(c.order(c.ada.id).burner_name)).toBe('Ada Sparkle');
			// Bo's booking is no business of the move
			expect(c.spot(c.b3.id)).toMatchObject({ order: c.bo.id, occupied: true });
			expect(outcome).toMatchObject({
				maskedCode: 'H•••',
				from: 'B1 · Dorm #2 · Villa',
				to: 'B2 · Dorm #2 · Villa',
				checkedIn: false,
				viaRequest: false
			});
			// the ticket afterwards, with its code masked like after any change
			expect(outcome.ticket).toMatchObject({
				id: c.ada.id,
				code: 'H•••',
				codeMasked: true,
				burnerName: 'Ada Sparkle',
				spot: { spot: 'B2', bedId: c.b2.id, roomId: c.room.id, viaRequest: false, checkIn: null }
			});
			// the action logs it, not the move itself
			expect(c.pb.rows('admin_events')).toHaveLength(0);
		}
	);

	it('takes the check-in along to the new spot', async () => {
		const c = camp();
		Object.assign(c.spot(c.b1.id), {
			checked_in_at: CHECKED_IN,
			checked_in_by: 'door@mauersegler.art'
		});
		const outcome = await moveTicketSpot(c.pb as any, admin, c.ada.id, c.b1.id, c.b2.id);

		expect(c.spot(c.b2.id)).toMatchObject({
			order: c.ada.id,
			checked_in_at: CHECKED_IN,
			checked_in_by: 'door@mauersegler.art'
		});
		expect(c.spot(c.b1.id)).toMatchObject({ order: '', checked_in_at: '' });
		expect(outcome.checkedIn).toBe(true);
		expect(outcome.ticket.spot?.checkIn).toEqual({
			at: CHECKED_IN,
			by: 'door@mauersegler.art'
		});
	});

	it('gives a ticket without a burner name a random one, never an empty one', async () => {
		const c = camp();
		c.order(c.ada.id).burner_name = '';
		await moveTicketSpot(c.pb as any, admin, c.ada.id, c.b1.id, c.b2.id);
		expect(decrypt(c.order(c.ada.id).burner_name)).toMatch(/ #\d{3}$/);
	});

	it('refuses the spot the ticket holds already', async () => {
		const c = camp();
		const before = c.snapshot();
		const err = await refusal(moveTicketSpot(c.pb as any, admin, c.ada.id, c.b1.id, c.b1.id));
		expect(err.status).toBe(400);
		expect(err.message).toMatch(/is the spot the ticket holds already/);
		expect(c.pb.tables).toEqual(before);
	});

	it('never moves a booking that changed since the card was shown', async () => {
		const c = camp();
		// moved to B2 meanwhile (another admin, or the guest); the card still shows B1
		Object.assign(c.spot(c.b1.id), { order: '', occupied: false });
		Object.assign(c.spot(c.b2.id), { order: c.ada.id, occupied: true });
		const before = c.snapshot();

		// the only reason: B5 is confirmed
		const err = await refusal(
			moveTicketSpot(c.pb as any, admin, c.ada.id, c.b1.id, c.b5.id, { blockedOk: true })
		);
		expect(err.status).toBe(409);
		expect(err.message).toMatch(/The booking changed meanwhile: the ticket holds B2 · Dorm #2/);
		expect(c.pb.tables).toEqual(before);
	});

	it('refuses a ♿ spot for a ticket without an approved request', async () => {
		for (const status of [null, 'pending', 'declined']) {
			const c = camp();
			if (status) c.pb.seed('special_requests', { order: c.ada.id, status, bed: '' });
			const before = c.snapshot();
			const err = await refusal(moveTicketSpot(c.pb as any, admin, c.ada.id, c.b1.id, c.b4.id));
			expect(err.status).toBe(409);
			expect(err.message).toMatch(/♿ B4 · Dorm #2 · Villa is a special-needs spot/);
			expect(c.pb.tables).toEqual(before);
		}
	});

	it('moves a ticket with an approved request through the request: the new spot is the crew’s spot for it', async () => {
		const c = camp();
		c.pb.seed('special_requests', {
			order: c.ada.id,
			status: 'approved',
			bed: c.b1.id,
			burner_name: encrypt('Old Wish')
		});
		const outcome = await moveTicketSpot(c.pb as any, admin, c.ada.id, c.b1.id, c.b4.id);

		expect(c.spot(c.b1.id)).toMatchObject({ order: '', occupied: false });
		expect(c.spot(c.b4.id)).toMatchObject({ order: c.ada.id, occupied: true });
		expect(c.request()).toMatchObject({ status: 'approved', bed: c.b4.id });
		expect(await isSpotFixed(c.pb as any, c.ada.id)).toBe(true);
		// the name the guest uses now wins over the one from the request
		expect(decrypt(c.order(c.ada.id).burner_name)).toBe('Ada Sparkle');
		expect(outcome).toMatchObject({ viaRequest: true, to: 'B4 · Dorm #2 · Villa' });
		expect(outcome.ticket.spot).toMatchObject({ bedId: c.b4.id, viaRequest: true });
		// no request events: the action logs the move once
		expect(c.pb.rows('admin_events')).toHaveLength(0);
	});

	it('moves a request ticket the guest booked themselves onto the crew’s spot, too', async () => {
		const c = camp();
		c.pb.seed('special_requests', { order: c.ada.id, status: 'approved', bed: '' });
		const outcome = await moveTicketSpot(c.pb as any, admin, c.ada.id, c.b1.id, c.b2.id);
		expect(c.spot(c.b2.id).order).toBe(c.ada.id);
		expect(c.request()).toMatchObject({ status: 'approved', bed: c.b2.id });
		expect(outcome.viaRequest).toBe(true);
	});

	it('books a locked 🔒 spot only when the admin confirmed it', async () => {
		const c = camp();
		const before = c.snapshot();
		const err = await refusal(moveTicketSpot(c.pb as any, admin, c.ada.id, c.b1.id, c.b5.id));
		expect(err.status).toBe(409);
		expect(err.message).toMatch(/🔒 B5 · Dorm #2 · Villa is blocked \(out of service\) now/);
		expect(c.pb.tables).toEqual(before);

		await moveTicketSpot(c.pb as any, admin, c.ada.id, c.b1.id, c.b5.id, { blockedOk: true });
		// moved on purpose; the lock stays for when the booking goes
		expect(c.spot(c.b5.id)).toMatchObject({ order: c.ada.id, is_locked: true });
		expect(c.spot(c.b1.id).order).toBe('');
	});

	it('books a locked 🔒 spot for a request ticket only when confirmed, too', async () => {
		const c = camp();
		c.pb.seed('special_requests', { order: c.ada.id, status: 'approved', bed: c.b1.id });
		const before = c.snapshot();
		const err = await refusal(moveTicketSpot(c.pb as any, admin, c.ada.id, c.b1.id, c.b5.id));
		expect(err.status).toBe(409);
		expect(c.pb.tables).toEqual(before);

		await moveTicketSpot(c.pb as any, admin, c.ada.id, c.b1.id, c.b5.id, { blockedOk: true });
		expect(c.spot(c.b5.id).order).toBe(c.ada.id);
		expect(c.request().bed).toBe(c.b5.id);
	});

	it('explains a taken, switched-off or deleted spot, and a spot id that is none', async () => {
		const c = camp();
		const before = c.snapshot();
		const cases: [string, number, RegExp][] = [
			[c.b3.id, 409, /already claimed\. Pick another spot\./],
			[c.b6.id, 409, /not available\. Pick another spot\./],
			['abcdefghijklmno', 409, /doesn't exist any more/],
			['', 400, /Pick a spot first/],
			['B2', 400, /Pick a spot first/]
		];
		for (const [bedId, status, message] of cases) {
			const err = await refusal(moveTicketSpot(c.pb as any, admin, c.ada.id, c.b1.id, bedId));
			expect(err.status).toBe(status);
			expect(err.message).toMatch(message);
		}
		expect(c.pb.tables).toEqual(before);
	});

	it('refuses a ticket that holds no spot, or no ticket at all', async () => {
		const c = camp();
		const before = c.snapshot();
		const none = await refusal(moveTicketSpot(c.pb as any, admin, c.cy.id, '', c.b2.id));
		expect(none.status).toBe(409);
		expect(none.message).toMatch(/holds no spot any more: nothing to move/);

		const gone = await refusal(moveTicketSpot(c.pb as any, admin, 'abcdefghijklmno', '', c.b2.id));
		expect(gone.status).toBe(404);
		const nonsense = await refusal(moveTicketSpot(c.pb as any, admin, 'not an id!', '', c.b2.id));
		expect(nonsense.status).toBe(400);
		expect(c.pb.tables).toEqual(before);
	});
});

describe('a booking that changes while the move is on its way', () => {
	it('is checked again in the ticket’s queue: a guest who released meanwhile is not booked anew', async () => {
		const c = camp();
		// The card showed B1. Right after that check, before the booking runs,
		// Ada releases B1 herself (another tab).
		const collection = c.pb.collection.bind(c.pb);
		vi.spyOn(c.pb, 'collection').mockImplementation(((name: string) => {
			const col = collection(name);
			if (name !== 'special_requests') return col;
			return {
				...col,
				async getFirstListItem(filter: string, options?: Record<string, unknown>) {
					Object.assign(c.spot(c.b1.id), { order: '', occupied: false });
					return col.getFirstListItem(filter, options);
				}
			};
		}) as any);
		const refused = await refusal(moveTicketSpot(c.pb as any, admin, c.ada.id, c.b1.id, c.b2.id));
		expect(refused.status).toBe(409);
		expect(refused.message).toMatch(/changed meanwhile/);
		// B2 stays free: the ticket is not booked onto it behind the guest's back
		expect(c.spot(c.b2.id)).toMatchObject({ order: '', occupied: false });
	});
});

describe('the spots a booking can move to (ticketMoveSpots)', () => {
	it('offers the free spots, ♿ ones only for a ticket with an approved request', async () => {
		for (const status of [null, 'pending', 'declined']) {
			const c = camp();
			if (status) c.pb.seed('special_requests', { order: c.ada.id, status, bed: '' });
			const offered = await ticketMoveSpots(c.pb as any, c.ada.id);
			expect(offered.special).toBe(false);
			// taken and switched-off spots never, a locked 🔒 one with its mark
			expect(offered.spots.map((s) => s.bedId)).toEqual([c.b2.id, c.b5.id]);
			expect(offered.spots.find((s) => s.bedId === c.b5.id)).toMatchObject({ locked: true });
			expect(offered.spots.some((s) => s.special)).toBe(false);
			// five active spots, the switched-off one not counted
			expect(offered.sizes).toEqual({ [c.room.id]: 5 });
		}

		const c = camp();
		c.pb.seed('special_requests', { order: c.ada.id, status: 'approved', bed: '' });
		const offered = await ticketMoveSpots(c.pb as any, c.ada.id);
		expect(offered.special).toBe(true);
		// ♿ first, as on /admin/requests
		expect(offered.spots.map((s) => s.bedId)).toEqual([c.b4.id, c.b2.id, c.b5.id]);
		expect(offered.spots[0]).toMatchObject({ special: true, label: 'B4 · Dorm #2 · Villa' });
	});

	it('refuses a ticket that is gone', async () => {
		const c = camp();
		expect((await refusal(ticketMoveSpots(c.pb as any, 'abcdefghijklmno'))).status).toBe(404);
		expect((await refusal(ticketMoveSpots(c.pb as any, ''))).status).toBe(400);
	});
});

describe('releasing a booking (releaseTicketSpot)', () => {
	it('frees the spot; the burner name stays', async () => {
		const c = camp({ is_booking_active: true });
		const outcome = await releaseTicketSpot(c.pb as any, c.ada.id, c.b1.id);

		expect(c.spot(c.b1.id)).toMatchObject({ order: null, occupied: false });
		expect(decrypt(c.order(c.ada.id).burner_name)).toBe('Ada Sparkle');
		expect(c.spot(c.b3.id)).toMatchObject({ order: c.bo.id, occupied: true });
		expect(outcome).toMatchObject({
			maskedCode: 'H•••',
			from: 'B1 · Dorm #2 · Villa',
			to: '',
			checkedIn: false,
			viaRequest: false
		});
		expect(outcome.ticket).toMatchObject({ id: c.ada.id, code: 'H•••', spot: null });
		expect(c.pb.rows('admin_events')).toHaveLength(0);
	});

	it('releases a guest who has arrived (PocketBase drops the check-in with it)', async () => {
		const c = camp({ booking_closed: true });
		Object.assign(c.spot(c.b1.id), { checked_in_at: CHECKED_IN, checked_in_by: 'door@x.org' });
		const outcome = await releaseTicketSpot(c.pb as any, c.ada.id, c.b1.id);
		expect(c.spot(c.b1.id)).toMatchObject({ order: null, occupied: false });
		expect(outcome.checkedIn).toBe(true);
	});

	it('never releases a booking that changed since the card was shown', async () => {
		const c = camp();
		Object.assign(c.spot(c.b1.id), { order: '', occupied: false });
		Object.assign(c.spot(c.b2.id), { order: c.ada.id, occupied: true });
		const before = c.snapshot();

		const err = await refusal(releaseTicketSpot(c.pb as any, c.ada.id, c.b1.id));
		expect(err.status).toBe(409);
		expect(err.message).toMatch(/The booking changed meanwhile/);
		expect(c.pb.tables).toEqual(before);
	});

	it('forgets the crew’s spot on the request, which stays approved', async () => {
		const c = camp();
		Object.assign(c.spot(c.b1.id), { order: '', occupied: false });
		Object.assign(c.spot(c.b4.id), { order: c.ada.id, occupied: true });
		c.pb.seed('special_requests', { order: c.ada.id, status: 'approved', bed: c.b4.id });

		const outcome = await releaseTicketSpot(c.pb as any, c.ada.id, c.b4.id);
		expect(c.spot(c.b4.id)).toMatchObject({ order: null, occupied: false });
		expect(c.request()).toMatchObject({ status: 'approved', bed: '' });
		expect(outcome.viaRequest).toBe(true);
		expect(await isSpotFixed(c.pb as any, c.ada.id)).toBe(false);
	});

	it('leaves a request alone whose spot the guest booked themselves', async () => {
		const c = camp();
		c.pb.seed('special_requests', { order: c.ada.id, status: 'approved', bed: '' });
		const outcome = await releaseTicketSpot(c.pb as any, c.ada.id, c.b1.id);
		expect(outcome.viaRequest).toBe(false);
		expect(c.request()).toMatchObject({ status: 'approved', bed: '' });
	});

	it('refuses a ticket that holds no spot', async () => {
		const c = camp();
		const before = c.snapshot();
		const err = await refusal(releaseTicketSpot(c.pb as any, c.cy.id, ''));
		expect(err.status).toBe(409);
		expect(err.message).toMatch(/holds no spot any more: nothing to release/);
		expect(c.pb.tables).toEqual(before);
	});
});

describe('the Move and Release actions on /admin/tickets', () => {
	it('are for admins only', async () => {
		const c = camp();
		const before = c.snapshot();
		for (const name of ['spots', 'move', 'release'] as const) {
			const result = await act(c, name, { id: c.ada.id, from: c.b1.id, bedId: c.b2.id }, null);
			expect(result.status).toBe(403);
		}
		expect(c.pb.tables).toEqual(before);
	});

	it('hand the picker the spots for the ticket', async () => {
		const c = camp();
		const result = await act(c, 'spots', { id: c.ada.id });
		expect(result.moveSpots.special).toBe(false);
		expect(result.moveSpots.spots.map((s: any) => s.bedId)).toEqual([c.b2.id, c.b5.id]);
		expect((await act(c, 'spots', { id: 'abcdefghijklmno' })).status).toBe(404);
	});

	it('move it and log the masked code only, never the spots', async () => {
		const c = camp();
		Object.assign(c.spot(c.b1.id), { checked_in_at: CHECKED_IN, checked_in_by: 'door@x.org' });
		const log = vi.spyOn(console, 'log').mockImplementation(() => {});

		const result = await act(c, 'move', { id: c.ada.id, from: c.b1.id, bedId: c.b2.id });
		expect(result.spotChanged).toMatchObject({ to: 'B2 · Dorm #2 · Villa', checkedIn: true });
		expect(c.spot(c.b2.id)).toMatchObject({ order: c.ada.id, checked_in_at: CHECKED_IN });

		const events = c.pb.rows('admin_events');
		expect(events).toHaveLength(1);
		expect(events[0]).toMatchObject({
			action: 'ticket_spot_moved',
			actor: 'crew@mauersegler.art',
			subject: c.ada.id
		});
		expect(events[0].details).toEqual({ ticket: 'H•••', checkedIn: true, viaRequest: false });
		const row = JSON.stringify(events[0]);
		expect(row).not.toContain('HB-1001');
		for (const word of SPOT_WORDS) expect(row).not.toContain(word);
		// the server log too
		const lines = log.mock.calls.map((call) => call.join(' ')).join('\n');
		expect(lines).toContain('H•••');
		expect(lines).not.toContain('HB-1001');
		for (const word of SPOT_WORDS) expect(lines).not.toContain(word);
	});

	it('move through an approved request and say so in the log', async () => {
		const c = camp();
		vi.spyOn(console, 'log').mockImplementation(() => {});
		c.pb.seed('special_requests', { order: c.ada.id, status: 'approved', bed: c.b1.id });
		const result = await act(c, 'move', { id: c.ada.id, from: c.b1.id, bedId: c.b4.id });
		expect(result.spotChanged.viaRequest).toBe(true);
		expect(c.request()).toMatchObject({ status: 'approved', bed: c.b4.id });
		expect(c.pb.rows('admin_events').map((e) => [e.action, e.details])).toEqual([
			['ticket_spot_moved', { ticket: 'H•••', checkedIn: false, viaRequest: true }]
		]);
	});

	it('move to a ♿ spot is refused without an approved request', async () => {
		const c = camp();
		const before = c.snapshot();
		const result = await act(c, 'move', { id: c.ada.id, from: c.b1.id, bedId: c.b4.id });
		expect(result.status).toBe(409);
		expect(result.data.error).toMatch(/special-needs spot/);
		expect(c.pb.tables).toEqual(before);
	});

	it('move to a locked 🔒 spot only with the confirmation for that very spot', async () => {
		vi.spyOn(console, 'log').mockImplementation(() => {});
		// nothing confirmed, a confirmation for another spot, forged values
		const refused: ((c: Camp) => string[])[] = [
			() => [],
			(c) => [c.b2.id],
			() => ['yes'],
			() => ['all'],
			(c) => [`${c.b5.id}x`],
			(c) => [`${c.b2.id},${c.b5.id}`]
		];
		for (const blockedOk of refused) {
			const c = camp();
			const before = c.snapshot();
			const result = await act(c, 'move', {
				id: c.ada.id,
				from: c.b1.id,
				bedId: c.b5.id,
				blockedOk: blockedOk(c)
			});
			expect(result.status).toBe(409);
			expect(result.data.error).toMatch(/is blocked \(out of service\) now/);
			expect(c.pb.tables).toEqual(before);
		}

		const c = camp();
		const result = await act(c, 'move', {
			id: c.ada.id,
			from: c.b1.id,
			bedId: c.b5.id,
			blockedOk: c.b5.id
		});
		expect(result.spotChanged.to).toBe('B5 · Dorm #2 · Villa');
		expect(c.spot(c.b5.id).order).toBe(c.ada.id);
	});

	it('move or release from a stale card answer 409 and change nothing', async () => {
		const c = camp();
		Object.assign(c.spot(c.b1.id), { order: '', occupied: false });
		Object.assign(c.spot(c.b2.id), { order: c.ada.id, occupied: true });
		const before = c.snapshot();

		const moved = await act(c, 'move', {
			id: c.ada.id,
			from: c.b1.id,
			bedId: c.b5.id,
			blockedOk: c.b5.id
		});
		expect(moved.status).toBe(409);
		expect(moved.data.error).toMatch(/The booking changed meanwhile/);
		const released = await act(c, 'release', { id: c.ada.id, from: c.b1.id });
		expect(released.status).toBe(409);
		expect(released.data.error).toMatch(/The booking changed meanwhile/);
		expect(c.pb.tables).toEqual(before);
	});

	it('move or release a ticket without a spot answer 409', async () => {
		const c = camp();
		const before = c.snapshot();
		expect((await act(c, 'move', { id: c.cy.id, from: '', bedId: c.b2.id })).status).toBe(409);
		expect((await act(c, 'release', { id: c.cy.id, from: '' })).status).toBe(409);
		expect(c.pb.tables).toEqual(before);
	});

	it('release it and log the masked code only, never the spot', async () => {
		const c = camp();
		const log = vi.spyOn(console, 'log').mockImplementation(() => {});
		Object.assign(c.spot(c.b1.id), { order: '', occupied: false });
		Object.assign(c.spot(c.b4.id), { order: c.ada.id, occupied: true });
		c.pb.seed('special_requests', { order: c.ada.id, status: 'approved', bed: c.b4.id });

		const result = await act(c, 'release', { id: c.ada.id, from: c.b4.id });
		expect(result.spotChanged).toMatchObject({ to: '', viaRequest: true });
		expect(c.spot(c.b4.id)).toMatchObject({ order: null, occupied: false });
		expect(c.request()).toMatchObject({ status: 'approved', bed: '' });

		const events = c.pb.rows('admin_events');
		expect(events).toHaveLength(1);
		expect(events[0]).toMatchObject({
			action: 'ticket_spot_released',
			actor: 'crew@mauersegler.art',
			subject: c.ada.id
		});
		expect(events[0].details).toEqual({ ticket: 'H•••', checkedIn: false, viaRequest: true });
		const row = JSON.stringify(events[0]);
		expect(row).not.toContain('HB-1001');
		for (const word of SPOT_WORDS) expect(row).not.toContain(word);
		const lines = log.mock.calls.map((call) => call.join(' ')).join('\n');
		expect(lines).toContain('H•••');
		for (const word of SPOT_WORDS) expect(lines).not.toContain(word);
	});
});
