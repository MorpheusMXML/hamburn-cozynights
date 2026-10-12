// tests/integration/book.test.ts — a booking in one PocketBase transaction
// (POST /api/cozy/book, pb_hooks/lib/book.js) and the unique index behind it
// (pb_migrations/1761100000_one_spot_per_ticket.js), on a real database. The
// app's rules around it: tests/booking-rules.test.ts.
import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import type PocketBase from 'pocketbase';
import {
	BookingService,
	BedUnavailableError,
	BookingClosedError,
	CheckedInError
} from '../../src/lib/server/booking';
import { decrypt } from '../../src/lib/server/crypto';
import { APP_SETTINGS_ID } from '../../src/lib/server/constants';
import { anonymous, seedHouse, seedTicket, serviceAccount } from '../stack-helpers';

let su: PocketBase;
let booking: BookingService;
const PHASE_FIELDS = ['is_booking_active', 'booking_closed', 'booking_timer_paused'] as const;
let before: Record<string, unknown>;

const setPhase = (fields: Record<string, boolean>) =>
	su.collection('app_settings').update(APP_SETTINGS_ID, {
		is_booking_active: false,
		booking_closed: false,
		booking_timer_paused: false,
		...fields
	});

beforeAll(async () => {
	su = await serviceAccount();
	booking = new BookingService(su as any);
	const settings = await su.collection('app_settings').getOne(APP_SETTINGS_ID);
	before = Object.fromEntries(PHASE_FIELDS.map((f) => [f, settings[f] ?? false]));
	await setPhase({ is_booking_active: true });
});
afterAll(async () => {
	await su.collection('app_settings').update(APP_SETTINGS_ID, before);
});

const bed = (id: string) => su.collection('beds').getOne(id);

describe('POST /api/cozy/book', () => {
	it('moves a booking in one go: the old spot free, the new one taken, the name written', async () => {
		const { beds } = await seedHouse(su, 2);
		const { order } = await seedTicket(su);
		await booking.bookBed(order as any, beds[0].id, 'First Light', { requireLivePhase: true });
		await booking.bookBed(order as any, beds[1].id, 'Second Wind', { requireLivePhase: true });

		expect(await bed(beds[0].id)).toMatchObject({ order: '', occupied: false });
		expect(await bed(beds[1].id)).toMatchObject({ order: order.id, occupied: true });
		const stored = await su.collection('orders').getOne(order.id);
		expect(decrypt(stored.burner_name)).toBe('Second Wind');
	});

	it('refuses a taken, a locked or a closed spot, and changes nothing', async () => {
		const { beds } = await seedHouse(su, 3);
		const { order: other } = await seedTicket(su);
		const { order } = await seedTicket(su);
		await booking.bookBed(other as any, beds[0].id, 'Owner');
		await su.collection('beds').update(beds[1].id, { is_locked: true });

		await expect(booking.bookBed(order as any, beds[0].id, 'Thief')).rejects.toBeInstanceOf(
			BedUnavailableError
		);
		await expect(booking.bookBed(order as any, beds[1].id, 'Thief')).rejects.toBeInstanceOf(
			BedUnavailableError
		);
		// the crew's confirmation books a locked spot
		await booking.bookBed(order as any, beds[1].id, 'Crew Pick', { allowLocked: true });
		expect(await bed(beds[1].id)).toMatchObject({ order: order.id });

		await setPhase({ booking_closed: true });
		try {
			await expect(
				booking.bookBed(order as any, beds[2].id, 'Late', { requireLivePhase: true })
			).rejects.toBeInstanceOf(BookingClosedError);
			expect(await bed(beds[2].id)).toMatchObject({ order: '', occupied: false });
			expect(await bed(beds[1].id)).toMatchObject({ order: order.id });
		} finally {
			await setPhase({ is_booking_active: true });
		}
	});

	it('renames the spot a ticket holds in Staging without freeing it', async () => {
		const { beds } = await seedHouse(su, 1);
		const { order } = await seedTicket(su);
		await booking.bookBed(order as any, beds[0].id, 'Crew Booked');
		await setPhase({});
		try {
			await booking.bookBed(order as any, beds[0].id, 'My Own Name', { requireLivePhase: true });
			expect(await bed(beds[0].id)).toMatchObject({ order: order.id, occupied: true });
			const stored = await su.collection('orders').getOne(order.id);
			expect(decrypt(stored.burner_name)).toBe('My Own Name');
		} finally {
			await setPhase({ is_booking_active: true });
		}
	});

	it('moves an arrived guest only for the crew, with the check-in', async () => {
		const { beds } = await seedHouse(su, 2);
		const { order } = await seedTicket(su);
		await booking.bookBed(order as any, beds[0].id, 'Arrived');
		const at = new Date().toISOString().replace('T', ' ');
		await su.collection('beds').update(beds[0].id, { checked_in_at: at, checked_in_by: 'crew@x' });

		await expect(booking.bookBed(order as any, beds[1].id, 'Arrived')).rejects.toBeInstanceOf(
			CheckedInError
		);
		await booking.bookBed(order as any, beds[1].id, 'Arrived', { allowCheckedIn: true });
		expect(await bed(beds[1].id)).toMatchObject({ order: order.id, checked_in_by: 'crew@x' });
		expect(await bed(beds[0].id)).toMatchObject({ order: '', checked_in_at: '' });
	});

	it('is for the service account only', async () => {
		await expect(
			anonymous().send('/api/cozy/book', { method: 'POST', body: { order: 'x', bed: 'y' } })
		).rejects.toMatchObject({ status: 401 });
	});
});

describe('one spot per ticket in the database', () => {
	it('refuses a second spot for a ticket, whoever writes it', async () => {
		const { beds } = await seedHouse(su, 2);
		const { order } = await seedTicket(su);
		await booking.bookBed(order as any, beds[0].id, 'Only One');
		await expect(
			su.collection('beds').update(beds[1].id, { order: order.id, occupied: true })
		).rejects.toMatchObject({ status: 400 });
		// a free spot (no ticket) is never a duplicate
		await su.collection('beds').update(beds[1].id, { occupied: true });
	});
});
