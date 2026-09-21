// tests/respin.test.ts — ☢ Nuke & Respin on the roulette page: the nuke
// (releaseBed) deletes exactly the spot the warning showed, right away, the
// roulette then rolls from a pool that includes it, and the guest hears about
// the move once instead of "released" plus "booked". Against real
// PocketBase: tests/integration/booking.test.ts and tests/smoke/app.test.ts.
// The messages themselves: tests/notify-messages.test.ts.
import { describe, it, expect, vi } from 'vitest';

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
import { BookingService, SpotChangedError } from '../src/lib/server/booking';
import { actions, load } from '../src/routes/random-bed/+page.server';
import { actions as roomActions } from '../src/routes/room/[id]/+page.server';
import { RESPIN_HOLD_MINUTES } from '../src/lib/server/notifications';

function form(fields: Record<string, string>): FormData {
	const data = new FormData();
	for (const [key, value] of Object.entries(fields)) data.append(key, value);
	return data;
}

/** The settle time PocketBase waits before it sends (notify.js SETTLE_SECONDS). */
const SETTLE_MS = 10_000;

/** A room with three spots; the ticket holds B1. */
function camp(settings: Record<string, unknown> = {}) {
	const pb = new FakePb();
	pb.seed('app_settings', { id: APP_SETTINGS_ID, is_booking_active: true, ...settings });
	const house = pb.seed('houses', { name: 'Firework Villa' });
	const room = pb.seed('rooms', { name: 'Dorm', room_number: 4, house: house.id });
	const [b1, b2, b3] = ['B1', 'B2', 'B3'].map((label) =>
		pb.seed('beds', {
			label,
			room: room.id,
			enabled: true,
			occupied: false,
			is_locked: false,
			is_special: false,
			order: ''
		})
	);
	const code = 'HB-2001';
	const order = pb.seed('orders', {
		order_number: code,
		order_hash: createLookupHash(code),
		customer_name: 'Ada Lovelace',
		email: 'ada@example.com',
		burner_name: ''
	});
	Object.assign(b1, { occupied: true, order: order.id });
	// What PocketBase's bed hook leaves behind on every change: the ticket is
	// marked for a delivery run about ten seconds later (pb_hooks/lib/notify.js).
	const notify = pb.seed('guest_notify', {
		order: order.id,
		due: new Date(Date.now() + SETTLE_MS).toISOString(),
		mail_to: 'ada@example.com',
		mail_spot: b1.id,
		mail_label: 'B1 · Dorm · Firework Villa'
	});
	const locals = { pb, adminPb: pb, orderNumber: code, admin: null };
	const bed = (id: string) => pb.rows('beds').find((row) => row.id === id)!;
	const dueIn = () => Date.parse(pb.rows('guest_notify')[0].due) - Date.now();
	return { pb, b1, b2, b3, order, locals, bed, notify, dueIn };
}

function nuke(c: ReturnType<typeof camp>, fields: Record<string, string>) {
	return actions.releaseBed({
		request: { formData: async () => form(fields) },
		locals: c.locals
	} as any) as Promise<any>;
}

describe('☢ Nuke & Respin', () => {
	it('deletes the spot the warning showed, then rolls from a pool that includes it', async () => {
		const c = camp();

		expect(await nuke(c, { bedId: c.b1.id })).toEqual({ success: true, released: true });
		expect(c.bed(c.b1.id)).toMatchObject({ occupied: false, order: null });

		// the page reloads: no spot any more, and the old one is up for grabs again
		const page: any = await load({ locals: c.locals, cookies: { delete: vi.fn() } } as any);
		expect(page.userBed).toBeNull();
		expect(page.freeBeds.map((b: { label: string }) => b.label)).toEqual(['B1', 'B2', 'B3']);

		const booked: any = await actions.bookRandom({
			request: { formData: async () => form({ bedId: c.b3.id, guestName: 'Solar Flare #123' }) },
			locals: c.locals
		} as any);
		expect(booked).toEqual({ success: true, bedId: c.b3.id });
		expect(c.bed(c.b3.id)).toMatchObject({ occupied: true, order: c.order.id });
	});

	it('deletes nothing when the ticket holds another spot by now (second tab)', async () => {
		const c = camp();

		const stale = await nuke(c, { bedId: c.b2.id });
		expect(stale.status).toBe(409);
		expect(stale.data.error).toMatch(/nothing was deleted/);
		expect(c.bed(c.b1.id)).toMatchObject({ occupied: true, order: c.order.id });

		await expect(
			new BookingService(c.pb as any).unbookOrder(c.order.id, { onlyBed: c.b2.id })
		).rejects.toBeInstanceOf(SpotChangedError);
		expect(c.bed(c.b1.id).order).toBe(c.order.id);
	});

	it('goes ahead when the spot is gone already', async () => {
		const c = camp();
		Object.assign(c.b1, { occupied: false, order: '' });

		expect(await nuke(c, { bedId: c.b1.id })).toEqual({ success: true, released: false });
	});

	it('is refused outside Live Booking, and the spot stays', async () => {
		const c = camp({ is_booking_active: false });

		const result = await nuke(c, { bedId: c.b1.id });
		expect(result.status).toBe(403);
		expect(c.bed(c.b1.id).order).toBe(c.order.id);
	});

	it('is refused once the crew checked the guest in', async () => {
		const c = camp();
		Object.assign(c.b1, { checked_in_at: '2026-09-20 10:00:00.000Z', checked_in_by: 'crew@x' });

		const result = await nuke(c, { bedId: c.b1.id });
		expect(result.status).toBe(409);
		expect(result.data.error).toMatch(/checked you in/);
		expect(c.bed(c.b1.id).order).toBe(c.order.id);
	});

	it('keeps a spot the crew picked for a special-needs request', async () => {
		const c = camp();
		c.pb.seed('special_requests', { order: c.order.id, status: 'approved', bed: c.b1.id });

		const result = await nuke(c, { bedId: c.b1.id });
		expect(result.status).toBe(409);
		expect(result.data.error).toMatch(/only the crew can change it/);
		expect(c.bed(c.b1.id).order).toBe(c.order.id);
	});

	it('still refuses a second spot from the roulette without the nuke', async () => {
		const c = camp();

		const result: any = await actions.bookRandom({
			request: { formData: async () => form({ bedId: c.b2.id, guestName: 'Neon Owl #1' }) },
			locals: c.locals
		} as any);
		expect(result.status).toBe(409);
		expect(c.bed(c.b2.id).occupied).toBe(false);
		expect(c.bed(c.b1.id).order).toBe(c.order.id);
	});
});

// PocketBase decides from the ticket's state what to send: the spot each
// channel last confirmed against the spot the ticket holds now. So the whole
// respin needs one thing — the release must not be delivered while the guest
// is still rolling. The nuke pushes the ticket's delivery run out; the new
// booking marks it again and the guest gets one "changed" message. Nobody
// rolls: the hold runs out and the release is the news after all.
describe('☢ respin: one message for the guest, not two', () => {
	const held = RESPIN_HOLD_MINUTES * 60_000;

	it('holds the release back, keeping the old spot as what the guest knows', async () => {
		const c = camp();

		expect(await nuke(c, { bedId: c.b1.id })).toEqual({ success: true, released: true });
		expect(c.dueIn()).toBeGreaterThan(held - 5_000);
		expect(c.dueIn()).toBeLessThanOrEqual(held);
		// Untouched, so the next message is "changed" with B1 as the old spot.
		expect(c.pb.rows('guest_notify')[0]).toMatchObject({
			mail_spot: c.b1.id,
			mail_label: 'B1 · Dorm · Firework Villa'
		});
	});

	it('leaves the mark alone when there was nothing to release', async () => {
		const c = camp();
		Object.assign(c.b1, { occupied: false, order: '' });

		expect(await nuke(c, { bedId: c.b1.id })).toEqual({ success: true, released: false });
		expect(c.dueIn()).toBeLessThanOrEqual(SETTLE_MS);
	});

	it('nukes a spot of a ticket nobody can be notified about', async () => {
		const c = camp();
		c.pb.tables.guest_notify = [];

		expect(await nuke(c, { bedId: c.b1.id })).toEqual({ success: true, released: true });
		expect(c.bed(c.b1.id)).toMatchObject({ occupied: false, order: null });
	});

	it('releases the spot even when the message cannot be held back', async () => {
		const c = camp();
		const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
		const collection = c.pb.collection.bind(c.pb);
		vi.spyOn(c.pb, 'collection').mockImplementation((name: string) => {
			const service = collection(name);
			if (name !== 'guest_notify') return service;
			return {
				...service,
				update: async () => {
					throw new Error('database is busy');
				}
			};
		});

		expect(await nuke(c, { bedId: c.b1.id })).toEqual({ success: true, released: true });
		expect(c.bed(c.b1.id)).toMatchObject({ occupied: false, order: null });
		expect(errors).toHaveBeenCalled();
		vi.restoreAllMocks();
	});

	it('does not hold back a plain release on the room page', async () => {
		const c = camp();

		const result: any = await roomActions.unbookBed({ locals: c.locals } as any);
		expect(result).toEqual({ success: true, released: true });
		expect(c.bed(c.b1.id)).toMatchObject({ occupied: false, order: null });
		expect(c.dueIn()).toBeLessThanOrEqual(SETTLE_MS);
	});
});
