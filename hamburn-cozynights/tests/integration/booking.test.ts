// tests/integration/booking.test.ts — the app's BookingService on a real database.
// tests/booking-rules.test.ts checks the same rules against an in-memory fake;
// here the real filters, relations and the service account do the work.
import { describe, it, expect, beforeAll } from 'vitest';
import type PocketBase from 'pocketbase';
import { BookingService, BedUnavailableError } from '../../src/lib/server/booking';
import { createLookupHash, decrypt } from '../../src/lib/server/crypto';
import { anonymous, seedHouse, seedTicket, serviceAccount } from '../stack-helpers';

let su: PocketBase;
let booking: BookingService;

beforeAll(async () => {
	su = await serviceAccount();
	booking = new BookingService(su as any);
});

describe('guest login by ticket code', () => {
	it('finds an imported ticket and migrates it to the hash lookup', async () => {
		const { code, order } = await seedTicket(su);

		expect((await booking.getOrderByNumber(code))?.id).toBe(order.id);
		expect((await su.collection('orders').getOne(order.id)).order_hash).toBe(
			createLookupHash(code)
		);
		// second login goes through the hash
		expect((await booking.getOrderByNumber(code))?.id).toBe(order.id);
	});

	it('returns null for an unknown code', async () => {
		expect(await booking.getOrderByNumber('NO-SUCH-TICKET')).toBeNull();
	});

	it('fails loudly when the service account is not signed in (must not look like "unknown code")', async () => {
		const { code } = await seedTicket(su);
		const broken = new BookingService(anonymous() as any);
		await expect(broken.getOrderByNumber(code)).rejects.toBeTruthy();
	});
});

describe('one ticket = one bed', () => {
	it('books a bed and stores the burner name encrypted', async () => {
		const { beds } = await seedHouse(su, 2);
		const { order } = await seedTicket(su);

		await booking.bookBed(order as any, beds[0].id, 'Dusty Nomad');

		const bed = await su.collection('beds').getOne(beds[0].id);
		expect(bed.occupied).toBe(true);
		expect(bed.order).toBe(order.id);
		expect((await booking.getBedForOrder(order.id))?.id).toBe(beds[0].id);

		const stored = (await su.collection('orders').getOne(order.id)).burner_name;
		expect(stored).not.toContain('Dusty Nomad');
		expect(decrypt(stored)).toBe('Dusty Nomad');
	});

	it('stamps booked_at when a spot gets a ticket and clears it on release', async () => {
		const { beds } = await seedHouse(su, 1);
		const { order } = await seedTicket(su);
		const before = Date.now();

		await booking.bookBed(order as any, beds[0].id, 'Stamp');
		const booked = await su.collection('beds').getOne(beds[0].id);
		expect(booked.booked_at).toBeTruthy();
		expect(Math.abs(new Date(booked.booked_at).getTime() - before)).toBeLessThan(60_000);

		await booking.unbookOrder(order.id);
		expect((await su.collection('beds').getOne(beds[0].id)).booked_at).toBe('');
	});

	it('frees the bed when its ticket is deleted (order unset, occupied cleared)', async () => {
		const { beds } = await seedHouse(su, 1);
		const { order } = await seedTicket(su);
		await booking.bookBed(order as any, beds[0].id, 'Gone Soon');
		expect((await su.collection('beds').getOne(beds[0].id)).occupied).toBe(true);

		await su.collection('orders').delete(order.id);
		const bed = await su.collection('beds').getOne(beds[0].id);
		expect(bed.order).toBe('');
		expect(bed.occupied).toBe(false);
		expect(bed.booked_at).toBe('');
	});

	it('moves the booking when the same ticket picks another bed', async () => {
		const { beds } = await seedHouse(su, 2);
		const { order } = await seedTicket(su);

		await booking.bookBed(order as any, beds[0].id, 'Mover');
		await booking.bookBed(order as any, beds[1].id, 'Mover');

		expect((await su.collection('beds').getOne(beds[0].id)).occupied).toBe(false);
		expect((await su.collection('beds').getOne(beds[1].id)).order).toBe(order.id);
	});

	it("refuses a bed that is someone else's, locked or deactivated", async () => {
		const { beds } = await seedHouse(su, 3);
		const first = await seedTicket(su);
		const second = await seedTicket(su);

		await booking.bookBed(first.order as any, beds[0].id, 'First');
		await su.collection('beds').update(beds[1].id, { is_locked: true });
		await su.collection('beds').update(beds[2].id, { enabled: false });

		for (const bed of beds) {
			await expect(booking.bookBed(second.order as any, bed.id, 'Second')).rejects.toBeInstanceOf(
				BedUnavailableError
			);
		}
		expect((await su.collection('beds').getOne(beds[0].id)).order).toBe(first.order.id);

		// admins may use locked beds
		await booking.bookBed(second.order as any, beds[1].id, 'Second', { allowLocked: true });
		expect((await su.collection('beds').getOne(beds[1].id)).order).toBe(second.order.id);
	});

	it('gives a bed to exactly one of two guests racing for it', async () => {
		const { beds } = await seedHouse(su, 1);
		const a = await seedTicket(su);
		const b = await seedTicket(su);

		const results = await Promise.allSettled([
			booking.bookBed(a.order as any, beds[0].id, 'A'),
			booking.bookBed(b.order as any, beds[0].id, 'B')
		]);

		expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
		expect([a.order.id, b.order.id]).toContain(
			(await su.collection('beds').getOne(beds[0].id)).order
		);
	});

	it('releases the bed again', async () => {
		const { beds } = await seedHouse(su, 1);
		const { order } = await seedTicket(su);

		await booking.bookBed(order as any, beds[0].id, 'Leaver');
		await booking.unbookOrder(order.id);

		const bed = await su.collection('beds').getOne(beds[0].id);
		expect(bed.occupied).toBe(false);
		expect(bed.order).toBe('');
		expect(await booking.getBedForOrder(order.id)).toBeNull();
	});
});
