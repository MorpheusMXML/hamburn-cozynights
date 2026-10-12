// tests/spot-holds.test.ts — a free spot a guest started booking is theirs for
// ten minutes ($lib/server/spot-holds, Max 12 Oct 2026): the booking window on
// the room page and the roulette's landing hold it, nobody else can book it
// meanwhile, the room page shows it as "Bed being made", and then it is free
// again. The crew books past a hold. What the pages say: $lib/spot-hold.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('$env/dynamic/private', () => ({
	env: {
		ENCRYPTION_KEY: '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff',
		PB_ADMIN_EMAIL: 'admin@test.com',
		PB_ADMIN_PASSWORD: 'password'
	}
}));

import { FakePb } from './fake-pb';
import { createLookupHash } from '../src/lib/server/crypto';
import { APP_SETTINGS_ID } from '../src/lib/server/constants';
import { BookingService } from '../src/lib/server/booking';
import {
	HOLD_MS,
	clearHolds,
	endHold,
	holdOf,
	holdOn,
	placeHold,
	roomHolds,
	settleHolds,
	unheld
} from '../src/lib/server/spot-holds';
import { actions as roomActions, load as roomLoad } from '../src/routes/room/[id]/+page.server';
import { GET as roomHoldsGet } from '../src/routes/room/[id]/holds/+server';
import {
	actions as rouletteActions,
	load as rouletteLoad
} from '../src/routes/random-bed/+page.server';
import { CONFIRMED_FIELDS } from '../src/lib/booking-check';
import {
	clock,
	endedEarly,
	freeAgainText,
	heldLine,
	HELD_LINES,
	untilFrom
} from '../src/lib/spot-hold';

const T0 = Date.parse('2026-10-17T18:00:00Z');
const MINUTE = 60_000;

function form(fields: Record<string, string>): FormData {
	const data = new FormData();
	for (const [key, value] of Object.entries(fields)) data.append(key, value);
	return data;
}

/** A room with B1–B3 and a locked L1, two guests without a spot: Ada and Bob. */
function camp(settings: Record<string, unknown> = {}) {
	const pb = new FakePb();
	pb.seed('app_settings', { id: APP_SETTINGS_ID, is_booking_active: true, ...settings });
	const house = pb.seed('houses', { name: 'Firework Villa' });
	const room = pb.seed('rooms', { name: 'Dorm', room_number: 4, house: house.id });
	const other = pb.seed('rooms', { name: 'Attic', room_number: 5, house: house.id });
	const spot = (label: string, roomId = room.id, extra: Record<string, unknown> = {}) =>
		pb.seed('beds', {
			label,
			room: roomId,
			enabled: true,
			occupied: false,
			is_locked: false,
			is_special: false,
			order: '',
			...extra
		});
	const [b1, b2, b3] = ['B1', 'B2', 'B3'].map((label) => spot(label));
	const l1 = spot('L1', room.id, { is_locked: true });
	const a1 = spot('A1', other.id);
	const guest = (code: string, name: string) => {
		const order = pb.seed('orders', {
			order_number: code,
			order_hash: createLookupHash(code),
			customer_name: name,
			email: `${name.toLowerCase()}@example.com`,
			burner_name: ''
		});
		const locals = { pb, adminPb: pb, orderNumber: code, order, admin: null };
		return { order, locals };
	};
	const ada = guest('HB-3001', 'Ada');
	const bob = guest('HB-3002', 'Bob');
	const bed = (id: string) => pb.rows('beds').find((row) => row.id === id)!;
	return { pb, room, other, b1, b2, b3, l1, a1, ada, bob, bed };
}

type Guest = ReturnType<typeof camp>['ada'];

const holdSpot = (g: Guest, bedId: string) =>
	roomActions.holdSpot({
		request: { formData: async () => form({ bedId }) },
		locals: g.locals
	} as any) as Promise<any>;

const dropHold = (g: Guest, bedId: string) =>
	roomActions.dropHold({
		request: { formData: async () => form({ bedId }) },
		locals: g.locals
	} as any) as Promise<any>;

const book = (g: Guest, bedId: string) =>
	roomActions.bookBed({
		request: {
			formData: async () => form({ bedId, guestName: 'Pillow Fighter', ...CONFIRMED_FIELDS })
		},
		locals: g.locals
	} as any) as Promise<any>;

const loadRoom = (c: ReturnType<typeof camp>, g: Guest) =>
	roomLoad({
		url: new URL('http://test.local/'),
		params: { id: c.room.id },
		locals: g.locals,
		cookies: { delete: () => {} }
	} as any) as Promise<any>;

beforeEach(() => {
	clearHolds();
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(T0);
});

afterEach(() => {
	vi.useRealTimers();
});

describe('the hold rules', () => {
	it('one spot per ticket, one ticket per spot', () => {
		expect(placeHold('ada', 'b1', 'room')).toMatchObject({ status: 'held' });
		expect(placeHold('bob', 'b1', 'room')).toMatchObject({
			status: 'taken',
			hold: { orderId: 'ada', until: T0 + HOLD_MS }
		});
		// Ada moves on to B2: B1 is free again, for Bob too
		expect(placeHold('ada', 'b2', 'room')).toMatchObject({ status: 'held' });
		expect(holdOn('b1')).toBeNull();
		expect(holdOf('ada')).toMatchObject({ bedId: 'b2' });
		expect(placeHold('bob', 'b1', 'room')).toMatchObject({ status: 'held' });
	});

	it('runs ten minutes from the first tap, and a closed window picks the same clock up', () => {
		placeHold('ada', 'b1', 'room');
		vi.setSystemTime(T0 + 3 * MINUTE);
		expect(endHold('ada')).toBe(true);
		expect(holdOn('b1')).toBeNull();
		// opened again: the same ten minutes, not ten new ones
		vi.setSystemTime(T0 + 4 * MINUTE);
		expect(placeHold('ada', 'b1', 'room')).toMatchObject({
			status: 'held',
			hold: { until: T0 + HOLD_MS }
		});
		vi.setSystemTime(T0 + HOLD_MS);
		expect(holdOn('b1')).toBeNull();
		expect(holdOf('ada')).toBeNull();
	});

	it('gives a ticket no second hold on the same spot until another ten minutes passed', () => {
		placeHold('ada', 'b1', 'room');
		vi.setSystemTime(T0 + 11 * MINUTE);
		expect(placeHold('ada', 'b1', 'room')).toEqual({ status: 'spent', again: T0 + 2 * HOLD_MS });
		// hopping to another spot and back doesn't reset the clock either
		expect(placeHold('ada', 'b2', 'room')).toMatchObject({ status: 'held' });
		expect(placeHold('ada', 'b1', 'room')).toMatchObject({ status: 'spent' });
		// everybody else can hold it right away
		expect(placeHold('bob', 'b1', 'room')).toMatchObject({ status: 'held' });
		vi.setSystemTime(T0 + 2 * HOLD_MS + 2 * MINUTE);
		expect(placeHold('ada', 'b1', 'room')).toMatchObject({ status: 'held' });
	});

	it('a booking ends the booking ticket hold and every hold on the booked spot', () => {
		placeHold('ada', 'b1', 'room');
		placeHold('bob', 'b2', 'room');
		settleHolds('bob', 'b1');
		expect(holdOf('ada')).toBeNull();
		expect(holdOf('bob')).toBeNull();
	});

	it('lists a room for everyone but the holder, and keeps held spots out of a drum', () => {
		placeHold('ada', 'b1', 'room');
		placeHold('bob', 'x1', 'elsewhere');
		expect(roomHolds('room', 'bob')).toEqual({ b1: HOLD_MS });
		expect(roomHolds('room', 'ada')).toEqual({});
		const drum = [{ id: 'b1' }, { id: 'b2' }, { id: 'x1' }];
		expect(unheld(drum, 'carl').map((s) => s.id)).toEqual(['b2']);
		expect(unheld(drum, 'ada').map((s) => s.id)).toEqual(['b1', 'b2']);
	});
});

describe('the room page', () => {
	it('holds the spot of the booking window, and nobody else can hold or book it', async () => {
		const c = camp();
		expect(await holdSpot(c.ada, c.b1.id)).toEqual({ hold: { bedId: c.b1.id, left: HOLD_MS } });

		const held = await holdSpot(c.bob, c.b1.id);
		expect(held.status).toBe(409);
		expect(held.data).toMatchObject({ held: true, left: HOLD_MS });
		expect(held.data.error).toMatch(/Someone else is making this bed/);

		const refused = await book(c.bob, c.b1.id);
		expect(refused.status).toBe(409);
		expect(refused.data).toMatchObject({ bedTaken: true });
		expect(refused.data.error).toMatch(/Someone else is making this bed right now/);
		expect(c.bed(c.b1.id)).toMatchObject({ occupied: false });

		// Ada books it, and her hold is done
		expect(await book(c.ada, c.b1.id)).toEqual({ success: true });
		expect(c.bed(c.b1.id)).toMatchObject({ occupied: true, order: c.ada.order.id });
		expect(holdOf(c.ada.order.id)).toBeNull();
	});

	it('frees the spot for everyone after ten minutes', async () => {
		const c = camp();
		await holdSpot(c.ada, c.b2.id);
		vi.setSystemTime(T0 + HOLD_MS - 1000);
		expect((await book(c.bob, c.b2.id)).status).toBe(409);
		vi.setSystemTime(T0 + HOLD_MS);
		expect(await book(c.bob, c.b2.id)).toEqual({ success: true });
		expect(c.bed(c.b2.id)).toMatchObject({ occupied: true, order: c.bob.order.id });
	});

	it('lets go when the window closes', async () => {
		const c = camp();
		await holdSpot(c.ada, c.b3.id);
		expect(await dropHold(c.ada, c.b3.id)).toEqual({ dropped: true });
		expect(await holdSpot(c.bob, c.b3.id)).toMatchObject({ hold: { bedId: c.b3.id } });
		// a drop for a spot the ticket doesn't hold changes nothing
		expect(await dropHold(c.ada, c.b3.id)).toEqual({ dropped: false });
		expect(holdOf(c.bob.order.id)).toMatchObject({ bedId: c.b3.id });
	});

	it('holds nothing for a ticket with a spot, a taken or locked spot, or outside Live Booking', async () => {
		const c = camp();
		await book(c.ada, c.b1.id);

		const own = await holdSpot(c.ada, c.b2.id);
		expect(own.status).toBe(409);
		expect(own.data.error).toMatch(/already holds spot B1/);

		const taken = await holdSpot(c.bob, c.b1.id);
		expect(taken.data).toMatchObject({ bedTaken: true });
		expect(taken.data.error).toMatch(/already claimed/);

		expect((await holdSpot(c.bob, c.l1.id)).data).toMatchObject({ bedTaken: true });
		expect(holdOf(c.bob.order.id)).toBeNull();

		const staging = camp({ is_booking_active: false });
		expect((await holdSpot(staging.bob, staging.b2.id)).status).toBe(403);
		expect(holdOf(staging.bob.order.id)).toBeNull();
	});

	it('shows other guests holds as "being made", never the guest own one', async () => {
		const c = camp();
		await holdSpot(c.ada, c.b2.id);
		vi.setSystemTime(T0 + 4 * MINUTE);
		expect((await loadRoom(c, c.bob)).heldSpots).toEqual({ [c.b2.id]: 6 * MINUTE });
		expect((await loadRoom(c, c.ada)).heldSpots).toEqual({});

		const answer = await roomHoldsGet({ params: { id: c.room.id }, locals: c.bob.locals } as any);
		expect(await answer.json()).toEqual({ held: { [c.b2.id]: 6 * MINUTE } });
		const anonymous = await roomHoldsGet({
			params: { id: c.room.id },
			locals: { orderNumber: null }
		} as any);
		expect(anonymous.status).toBe(401);
	});

	it('the crew books past a hold, and the hold ends with it', async () => {
		const c = camp();
		await holdSpot(c.ada, c.b1.id);
		// the crew's request flow: no requireLivePhase
		await new BookingService(c.pb as any).bookBed(c.bob.order as any, c.b1.id, 'Crew Pick');
		expect(c.bed(c.b1.id)).toMatchObject({ occupied: true, order: c.bob.order.id });
		expect(holdOn(c.b1.id)).toBeNull();
	});

	it('renaming the own spot never waits for a hold', async () => {
		const c = camp();
		await book(c.ada, c.b1.id);
		// a stray hold on Ada's spot (it can't happen through the pages)
		placeHold(c.bob.order.id, c.b1.id, c.room.id);
		const renamed = await roomActions.bookBed({
			request: { formData: async () => form({ bedId: c.b1.id, guestName: 'New Name' }) },
			locals: c.ada.locals
		} as any);
		expect(renamed).toEqual({ success: true });
	});
});

describe('the roulette', () => {
	it('keeps spots others are booking out of the drum, and refuses to book them', async () => {
		const c = camp();
		await holdSpot(c.ada, c.b1.id);
		const page: any = await rouletteLoad({
			url: new URL('http://test.local/random-bed'),
			locals: c.bob.locals,
			cookies: { delete: vi.fn() }
		} as any);
		const drum = page.freeBeds.map((spot: { label: string }) => spot.label);
		expect(drum).not.toContain('B1');
		expect(drum).toEqual(expect.arrayContaining(['B2', 'B3', 'A1']));

		const refused: any = await rouletteActions.bookRandom({
			request: {
				formData: async () =>
					form({ bedId: c.b1.id, guestName: 'Lucky Loser', ...CONFIRMED_FIELDS })
			},
			locals: c.bob.locals
		} as any);
		expect(refused.status).toBe(409);
		expect(c.bed(c.b1.id)).toMatchObject({ occupied: false });
	});

	it('a new spin holds the new spot and lets go of the old one', async () => {
		const c = camp();
		const spin = (bedId: string) =>
			rouletteActions.holdSpot({
				request: { formData: async () => form({ bedId }) },
				locals: c.ada.locals
			} as any) as Promise<any>;
		expect(await spin(c.b2.id)).toMatchObject({ hold: { bedId: c.b2.id } });
		expect(await spin(c.a1.id)).toMatchObject({ hold: { bedId: c.a1.id } });
		expect(holdOn(c.b2.id)).toBeNull();
		expect(holdOf(c.ada.order.id)).toMatchObject({ bedId: c.a1.id });
	});
});

describe('what the pages say', () => {
	it('counts down, rounds the minutes up and changes the line every few seconds', () => {
		expect(clock(HOLD_MS)).toBe('10:00');
		expect(clock(61_500)).toBe('1:02');
		expect(clock(-5)).toBe('0:00');
		expect(freeAgainText(6 * MINUTE + 1)).toBe('Free again in 7 min if they wander off');
		expect(freeAgainText(30_000)).toBe('Free again in a minute if they wander off');
		const lines = new Set([0, 4_000, 8_000, 12_000].map((t) => heldLine('fake00000000001', t)));
		expect(lines.size).toBe(4);
		for (const line of lines) expect(HELD_LINES).toContain(line);
	});

	it('reloads the room when a hold ends well before its time', () => {
		const before = untilFrom({ a: 5 * MINUTE, b: 2_000 }, T0);
		expect(endedEarly(before, { a: 1 }, T0)).toBe(false);
		// b ran out on its own: no reload
		expect(endedEarly(before, { a: 1 }, T0 + 1_000)).toBe(false);
		// a ended with minutes to go: someone booked it
		expect(endedEarly(before, {}, T0)).toBe(true);
	});
});
