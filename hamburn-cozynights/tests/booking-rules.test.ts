// tests/booking-rules.test.ts — one ticket = one booking, event-time helpers, rate limiting
import { describe, it, expect, vi } from 'vitest';
import {
	BookingService,
	BedUnavailableError,
	BookingClosedError,
	ReleaseFailedError
} from '../src/lib/server/booking';
import { APP_SETTINGS_ID } from '../src/lib/server/constants';
import { FailureRateLimiter } from '../src/lib/server/rate-limit';
import { berlinLocalToIso, isoToBerlinLocal } from '../src/lib/time';

vi.mock('$env/dynamic/private', () => ({
	env: { ENCRYPTION_KEY: '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff' }
}));

/**
 * Minimal in-memory stand-in for the PocketBase beds/orders collections, with
 * I/O latency. `settings` is the app_settings record BookingService re-reads
 * after a claim; null makes that read fail.
 */
function makeFakePb(
	beds: Record<string, any>[],
	settings: Record<string, any> | null = { is_booking_active: true }
) {
	const tick = () => new Promise((resolve) => setTimeout(resolve, Math.random() * 5));
	const byId = new Map(beds.map((b) => [b.id, { ...b }]));
	const service = (name: string) => ({
		getOne: async (id: string) => {
			await tick();
			if (id === APP_SETTINGS_ID) {
				if (!settings) throw { status: 500 };
				return { ...settings };
			}
			const bed = byId.get(id);
			if (!bed) throw { status: 404 };
			return { ...bed };
		},
		getFullList: async ({ filter }: { filter: string }) => {
			await tick();
			const orderId = /order = '([^']+)'/.exec(filter)?.[1];
			const excluded = /id != '([^']+)'/.exec(filter)?.[1];
			return [...byId.values()].filter((b) => b.order === orderId && b.id !== excluded);
		},
		update: async (id: string, data: Record<string, any>) => {
			await tick();
			if (name === 'beds') Object.assign(byId.get(id)!, data);
			return {};
		}
	});
	const pb = {
		collection: (name: string) => service(name),
		filter: (expr: string, params: Record<string, string>) =>
			expr.replace(/\{:(\w+)\}/g, (_, key) => `'${params[key]}'`)
	};
	return { pb: pb as any, byId };
}

/**
 * Switching back to Staging Mode writes app_settings first and releases the
 * bookings right after (src/routes/admin/+page.server.ts). A guest request
 * that was already waiting for the per-bed lock would otherwise claim its spot
 * behind the release and keep it in a camp that is supposed to be empty.
 */
describe('BookingService: booking closes while a guest waits for the lock', () => {
	const order = { id: 'order1' } as any;
	const free = () => [{ id: 'bed1', occupied: false, order: '', enabled: true }];

	it('undoes the claim and refuses when booking is no longer open', async () => {
		for (const phase of [{}, { booking_closed: true }]) {
			const { pb, byId } = makeFakePb(free(), { is_booking_active: false, ...phase });
			const service = new BookingService(pb);

			await expect(
				service.bookBed(order, 'bed1', 'Alice', { requireLivePhase: true })
			).rejects.toBeInstanceOf(BookingClosedError);

			// Nothing is left behind for the release loop to miss.
			expect(byId.get('bed1')).toMatchObject({ occupied: false, order: null });
		}
	});

	it('says why, in the words the guest gets everywhere else', async () => {
		const { pb } = makeFakePb(free(), { booking_closed: true });
		await expect(
			new BookingService(pb).bookBed(order, 'bed1', 'Alice', { requireLivePhase: true })
		).rejects.toThrow('Booking has closed. Nothing was booked.');
	});

	it('books normally while booking is open', async () => {
		const { pb, byId } = makeFakePb(free());
		await new BookingService(pb).bookBed(order, 'bed1', 'Alice', { requireLivePhase: true });
		expect(byId.get('bed1')).toMatchObject({ occupied: true, order: 'order1' });
	});

	it('lets the booking stand when the phase itself cannot be read', async () => {
		// getBookingSettings answers "staging" for a failed read; undoing a
		// perfectly good booking over a database hiccup would be worse than the
		// rare stray one this guards against.
		const { pb, byId } = makeFakePb(free(), null);
		await new BookingService(pb).bookBed(order, 'bed1', 'Alice', { requireLivePhase: true });
		expect(byId.get('bed1')).toMatchObject({ occupied: true, order: 'order1' });
	});

	it('leaves the crew alone: they book in any phase', async () => {
		const { pb, byId } = makeFakePb(free(), { booking_closed: true });
		// No requireLivePhase: assigning a spot for a special-needs request
		// happens in Staging on purpose (src/lib/server/special-requests.ts).
		await new BookingService(pb).bookBed(order, 'bed1', 'Crew Pick');
		expect(byId.get('bed1')).toMatchObject({ occupied: true, order: 'order1' });
	});
});

describe('BookingService: one ticket code = one booking', () => {
	it('never leaves one order holding several beds under concurrent requests', async () => {
		const { pb, byId } = makeFakePb([
			{ id: 'bed1', occupied: false, order: '', enabled: true },
			{ id: 'bed2', occupied: false, order: '', enabled: true },
			{ id: 'bed3', occupied: false, order: '', enabled: true }
		]);
		const service = new BookingService(pb);
		const order = { id: 'order1' } as any;

		await Promise.all(['bed1', 'bed2', 'bed3'].map((bed) => service.bookBed(order, bed, 'Alice')));

		const held = [...byId.values()].filter((b) => b.order === 'order1');
		expect(held).toHaveLength(1);
		expect(held[0].occupied).toBe(true);
	});

	it('never gives the same bed to two orders', async () => {
		const { pb, byId } = makeFakePb([{ id: 'bed1', occupied: false, order: '', enabled: true }]);
		const service = new BookingService(pb);

		const results = await Promise.allSettled([
			service.bookBed({ id: 'a' } as any, 'bed1', 'A'),
			service.bookBed({ id: 'b' } as any, 'bed1', 'B')
		]);

		expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
		const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
		expect(rejected.reason).toBeInstanceOf(BedUnavailableError);
		expect(['a', 'b']).toContain(byId.get('bed1')!.order);
	});

	it('undoes the new claim when the previous spot cannot be released (never two beds)', async () => {
		const { pb, byId } = makeFakePb([
			{ id: 'bed1', occupied: true, order: 'order1', enabled: true },
			{ id: 'bed2', occupied: false, order: '', enabled: true }
		]);
		const original = pb.collection.bind(pb);
		let failOnce = true;
		pb.collection = (name: string) => {
			const service = original(name);
			if (name !== 'beds') return service;
			return {
				...service,
				update: async (id: string, data: Record<string, any>) => {
					if (id === 'bed1' && failOnce) {
						failOnce = false;
						throw new Error('database gone away');
					}
					return service.update(id, data);
				}
			};
		};
		const service = new BookingService(pb);

		await expect(service.bookBed({ id: 'order1' } as any, 'bed2', 'Alice')).rejects.toBeInstanceOf(
			ReleaseFailedError
		);
		expect(byId.get('bed1')).toMatchObject({ occupied: true, order: 'order1' });
		expect(byId.get('bed2')).toMatchObject({ occupied: false, order: null });
	});

	it('treats infrastructure errors as errors, not as "code not found"', async () => {
		const pb = {
			collection: () => ({
				getFirstListItem: async () => {
					throw { status: 0, message: 'connection refused' };
				}
			}),
			filter: (expr: string) => expr
		} as any;
		await expect(new BookingService(pb).getOrderByNumber('CODE')).rejects.toMatchObject({
			status: 0
		});
	});
});

describe('event time (Europe/Berlin)', () => {
	it('converts datetime-local values independent of the server timezone', () => {
		expect(berlinLocalToIso('2026-09-20T18:00')).toBe('2026-09-20T16:00:00.000Z'); // CEST
		expect(berlinLocalToIso('2026-01-15T00:30')).toBe('2026-01-14T23:30:00.000Z'); // CET
		expect(berlinLocalToIso('garbage')).toBe('');
	});

	it('round-trips for the timer input prefill', () => {
		expect(isoToBerlinLocal(berlinLocalToIso('2026-10-24T21:15'))).toBe('2026-10-24T21:15');
	});
});

describe('FailureRateLimiter', () => {
	it('blocks a key after too many failures and releases it after the window', () => {
		const limiter = new FailureRateLimiter(3, 1000);
		for (let i = 0; i < 3; i++) limiter.recordFailure('1.2.3.4', 0);

		expect(limiter.isBlocked('1.2.3.4', 10)).toBe(true);
		expect(limiter.isBlocked('5.6.7.8', 10)).toBe(false);
		expect(limiter.isBlocked('1.2.3.4', 1000)).toBe(false);
	});
});
