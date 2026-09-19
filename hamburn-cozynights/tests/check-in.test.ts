// tests/check-in.test.ts — the check-in at arrival: the booking service's
// rules (only the crew changes a spot whose guest arrived, and a move by the
// crew takes the check-in along), the guest pages that refuse to release such
// a spot, and the guest map that never shows a check-in. PocketBase mocked;
// the hook that drops a check-in with its booking is covered by
// tests/booked-stamp.test.ts and tests/integration/check-in.test.ts, the admin
// check page by tests/pass.test.ts.
import { describe, it, expect, vi } from 'vitest';

vi.mock('$env/dynamic/private', () => ({
	env: {
		ENCRYPTION_KEY: '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff',
		PB_ADMIN_EMAIL: 'admin@test.com',
		PB_ADMIN_PASSWORD: 'password'
	}
}));

import { FakePb } from './fake-pb';
import { BookingService, CheckedInError } from '../src/lib/server/booking';
import { InventoryService } from '../src/lib/server/inventory';
import { createLookupHash, encrypt } from '../src/lib/server/crypto';
import { APP_SETTINGS_ID } from '../src/lib/server/constants';
import { CHECKED_IN_NOTE } from '../src/lib/check-in';
import { actions as roomActions, load as roomLoad } from '../src/routes/room/[id]/+page.server';
import { actions as houseActions, load as houseLoad } from '../src/routes/house/[id]/+page.server';
import {
	actions as rouletteActions,
	load as rouletteLoad
} from '../src/routes/random-bed/+page.server';

const IN = '2026-09-19 12:00:00.000Z';
const BY = 'crew@mauersegler.art';

/** Live booking; HB-1001 holds B1 and is checked in there, B2 is free. */
function camp({ checkedIn = true } = {}) {
	const pb = new FakePb();
	pb.seed('app_settings', { id: APP_SETTINGS_ID, is_booking_active: true });
	const house = pb.seed('houses', { name: 'Brahmsee-Villa', x: 10, y: 20 });
	const room = pb.seed('rooms', { name: 'Blue Room', room_number: 2, house: house.id });
	const order = pb.seed('orders', {
		order_number: 'HB-1001',
		order_hash: createLookupHash('HB-1001'),
		customer_name: 'Ada Lovelace',
		pass_code: '7F3K9QXM2CWD',
		burner_name: encrypt('Disco Druid')
	});
	const bed = pb.seed('beds', {
		label: 'B1',
		room: room.id,
		enabled: true,
		occupied: true,
		order: order.id,
		booked_at: '2026-09-17 09:00:00.000Z',
		checked_in_at: checkedIn ? IN : '',
		checked_in_by: checkedIn ? BY : ''
	});
	const free = pb.seed('beds', { label: 'B2', room: room.id, enabled: true, occupied: false });
	const locals = { pb, adminPb: pb, orderNumber: 'HB-1001', admin: null };
	return { pb, house, room, order, bed, free, locals };
}

const bedRow = (pb: FakePb, id: string) => pb.rows('beds').find((b) => b.id === id)!;

describe('the booking service', () => {
	it('lets guests not release a spot they are checked in at; the crew can', async () => {
		const c = camp();
		const service = new BookingService(c.pb as any);
		await expect(service.unbookOrder(c.order.id)).rejects.toBeInstanceOf(CheckedInError);
		expect(bedRow(c.pb, c.bed.id)).toMatchObject({ order: c.order.id, occupied: true });

		await service.unbookOrder(c.order.id, { allowCheckedIn: true });
		expect(bedRow(c.pb, c.bed.id)).toMatchObject({ order: null, occupied: false });
	});

	it('moves a guest who arrived only for the crew, and the check-in comes along', async () => {
		const c = camp();
		const service = new BookingService(c.pb as any);
		await expect(service.bookBed(c.order as any, c.free.id, 'Disco Druid')).rejects.toBeInstanceOf(
			CheckedInError
		);
		expect(bedRow(c.pb, c.free.id).order ?? '').toBe('');

		await service.bookBed(c.order as any, c.free.id, 'Disco Druid', {
			allowLocked: true,
			allowCheckedIn: true
		});
		expect(bedRow(c.pb, c.free.id)).toMatchObject({
			order: c.order.id,
			checked_in_at: IN,
			checked_in_by: BY
		});
		expect(bedRow(c.pb, c.bed.id)).toMatchObject({ order: null, occupied: false });
	});

	it('keeps renaming the own spot possible after the check-in', async () => {
		const c = camp();
		await new BookingService(c.pb as any).bookBed(c.order as any, c.bed.id, 'Neon Owl');
		expect(bedRow(c.pb, c.bed.id)).toMatchObject({ order: c.order.id, checked_in_at: IN });
	});

	it('checks in once, undoes, and resets for a new holder', async () => {
		const c = camp({ checkedIn: false });
		const crew = new BookingService(c.pb as any);

		const first = await crew.checkIn(c.order.id, BY);
		expect(first.status).toBe('checkedin');
		expect(bedRow(c.pb, c.bed.id).checked_in_by).toBe(BY);
		const at = bedRow(c.pb, c.bed.id).checked_in_at;
		expect(Date.parse(at)).toBeGreaterThan(Date.now() - 60_000);

		const again = await crew.checkIn(c.order.id, 'someone@mauersegler.art');
		expect(again.status).toBe('already');
		expect(bedRow(c.pb, c.bed.id)).toMatchObject({ checked_in_at: at, checked_in_by: BY });

		expect((await crew.undoCheckIn(c.order.id)).status).toBe('undone');
		expect(bedRow(c.pb, c.bed.id)).toMatchObject({ order: c.order.id, checked_in_at: '' });
		expect((await crew.undoCheckIn(c.order.id)).status).toBe('booked');

		await crew.checkIn(c.order.id, BY);
		expect(await crew.resetCheckIn(c.order.id)).toBe(true);
		expect(bedRow(c.pb, c.bed.id)).toMatchObject({ order: c.order.id, checked_in_at: '' });
		expect(await crew.resetCheckIn(c.order.id)).toBe(false);
	});

	it('has nothing to check in for a ticket without a spot', async () => {
		const c = camp({ checkedIn: false });
		await new BookingService(c.pb as any).unbookOrder(c.order.id);
		const outcome = await new BookingService(c.pb as any).checkIn(c.order.id, BY);
		expect(outcome).toEqual({ status: 'nospot', bed: null });
	});

	it("runs the check-in in the ticket's queue: a release can't slip in between", async () => {
		const c = camp({ checkedIn: false });
		const service = new BookingService(c.pb as any);
		// The guest releases while the crew checks in: whichever runs first wins
		// completely, never a checked-in spot without its booking.
		const [released, checked] = await Promise.allSettled([
			service.unbookOrder(c.order.id),
			service.checkIn(c.order.id, BY)
		]);
		expect(released.status).toBe('fulfilled');
		expect(checked).toMatchObject({ status: 'fulfilled', value: { status: 'nospot' } });
		expect(bedRow(c.pb, c.bed.id)).toMatchObject({ order: null, checked_in_at: '' });
	});
});

describe('guest pages', () => {
	it('the room page says the spot is final and refuses to release it', async () => {
		const c = camp();
		const data: any = await roomLoad({
			params: { id: c.room.id },
			locals: c.locals,
			cookies: { delete: () => {} }
		} as any);
		expect(data.checkedIn).toBe(true);
		expect(JSON.stringify(data)).not.toMatch(/crew@|checked_in/);

		const released: any = await roomActions.unbookBed({ locals: c.locals } as any);
		expect(released.status).toBe(409);
		expect(released.data.error).toBe(CHECKED_IN_NOTE);
		expect(bedRow(c.pb, c.bed.id)).toMatchObject({ order: c.order.id, checked_in_at: IN });
	});

	it('so do the house page and the roulette', async () => {
		const c = camp();
		const house: any = await houseLoad({
			params: { id: c.house.id },
			locals: c.locals,
			cookies: { delete: () => {} }
		} as any);
		expect(house.checkedIn).toBe(true);
		const roulette: any = await rouletteLoad({
			locals: c.locals,
			cookies: { delete: () => {} }
		} as any);
		expect(roulette.checkedIn).toBe(true);

		for (const release of [houseActions.unbookBed, rouletteActions.releaseBed]) {
			const result: any = await (release as any)({ locals: c.locals });
			expect(result.status).toBe(409);
			expect(result.data.error).toBe(CHECKED_IN_NOTE);
		}
		expect(bedRow(c.pb, c.bed.id).order).toBe(c.order.id);
	});

	it('guests who are not checked in still release as before', async () => {
		const c = camp({ checkedIn: false });
		const data: any = await roomLoad({
			params: { id: c.room.id },
			locals: c.locals,
			cookies: { delete: () => {} }
		} as any);
		expect(data.checkedIn).toBe(false);
		expect(await roomActions.unbookBed({ locals: c.locals } as any)).toEqual({
			success: true,
			released: true
		});
	});

	it('the public map never shows a check-in', async () => {
		const c = camp();
		const tree = await new InventoryService(c.pb as any).getFullTree();
		const beds = tree.flatMap((h) => h.rooms.flatMap((r) => r.beds));
		expect(beds).toHaveLength(2);
		for (const bed of beds) {
			expect(bed.checked_in_at).toBe('');
			expect(bed.checked_in_by).toBe('');
		}
		expect(JSON.stringify(tree)).not.toMatch(/crew@|2026-09-19/);
	});
});
