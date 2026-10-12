// tests/booking-rules.test.ts — one ticket = one booking, event-time helpers, rate limiting
import { describe, it, expect, vi } from 'vitest';
import {
	BookingService,
	BedUnavailableError,
	BookingClosedError,
	lockCount,
	withLock
} from '../src/lib/server/booking';
import { recordId } from '../src/lib/server/record-id';
import { fakeBook, refusedBy } from './fake-book';
import { APP_SETTINGS_ID } from '../src/lib/server/constants';
import { FailureRateLimiter } from '../src/lib/server/rate-limit';
import { berlinLocalToIso, isoToBerlinLocal } from '../src/lib/time';

vi.mock('$env/dynamic/private', () => ({
	env: { ENCRYPTION_KEY: '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff' }
}));

/**
 * Minimal in-memory stand-in for the PocketBase beds collection and the
 * booking route (POST /api/cozy/book, tests/fake-book.ts), with I/O latency.
 * `settings` is the app_settings record the route reads when it writes.
 */
function makeFakePb(
	beds: Record<string, any>[],
	settings: Record<string, any> = { is_booking_active: true }
) {
	const tick = () => new Promise((resolve) => setTimeout(resolve, Math.random() * 5));
	const byId = new Map(beds.map((b) => [b.id, { ...b }]));
	const orders = new Map<string, Record<string, any>>();
	const service = (name: string) => ({
		getOne: async (id: string) => {
			await tick();
			if (id === APP_SETTINGS_ID) return { ...settings };
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
			expr.replace(/\{:(\w+)\}/g, (_, key) => `'${params[key]}'`),
		send: async (path: string, options: { body: Record<string, any> }) => {
			await tick();
			if (path !== '/api/cozy/book') throw new Error(`no route ${path}`);
			const outcome = fakeBook(
				{
					bed: (id) => byId.get(id),
					order: (id) => (orders.has(id) ? orders.get(id) : orders.set(id, { id }).get(id)),
					bedsOf: (orderId) => [...byId.values()].filter((b) => b.order === orderId),
					settings: () => settings
				},
				options.body
			);
			if (!outcome.ok) throw refusedBy(outcome);
			return outcome;
		}
	};
	return { pb: pb as any, byId, settings };
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

	it('refuses when booking is no longer open, and writes nothing', async () => {
		for (const phase of [{}, { booking_closed: true }]) {
			const { pb, byId } = makeFakePb(free(), { is_booking_active: false, ...phase });
			const service = new BookingService(pb);

			await expect(
				service.bookBed(order, 'bed1', 'Alice', { requireLivePhase: true })
			).rejects.toBeInstanceOf(BookingClosedError);

			// Nothing is left behind for the release loop to miss.
			expect(byId.get('bed1')).toMatchObject({ occupied: false, order: '' });
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

	it('checks the phase when PocketBase writes the booking, not when the request came in', async () => {
		const { pb, byId, settings } = makeFakePb([
			...free(),
			{ id: 'bed2', occupied: false, order: '', enabled: true }
		]);
		const service = new BookingService(pb);
		const first = service.bookBed(order, 'bed1', 'Alice', { requireLivePhase: true });
		// The second waits for the ticket's lock; meanwhile the crew switches back to Staging.
		const second = service.bookBed(order, 'bed2', 'Alice', { requireLivePhase: true });
		await first;
		settings.is_booking_active = false;
		await expect(second).rejects.toBeInstanceOf(BookingClosedError);
		expect(byId.get('bed1')).toMatchObject({ occupied: true, order: 'order1' });
		expect(byId.get('bed2')).toMatchObject({ occupied: false, order: '' });
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

	it('changes nothing when the booking transaction fails (never two spots, never none)', async () => {
		const { pb, byId } = makeFakePb([
			{ id: 'bed1', occupied: true, order: 'order1', enabled: true },
			{ id: 'bed2', occupied: false, order: '', enabled: true }
		]);
		pb.send = async () => {
			throw Object.assign(new Error('database gone away'), { status: 500 });
		};
		await expect(
			new BookingService(pb).bookBed({ id: 'order1' } as any, 'bed2', 'Alice')
		).rejects.toMatchObject({ status: 500 });
		expect(byId.get('bed1')).toMatchObject({ occupied: true, order: 'order1' });
		expect(byId.get('bed2')).toMatchObject({ occupied: false, order: '' });
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

describe('withLock', () => {
	it('runs holders of one key one after the other', async () => {
		const order: string[] = [];
		const slow = withLock('bed:x', async () => {
			await new Promise((r) => setTimeout(r, 20));
			order.push('first');
		});
		const fast = withLock('bed:x', async () => {
			order.push('second');
		});
		await Promise.all([slow, fast]);
		expect(order).toEqual(['first', 'second']);
	});

	it('forgets a key once its last holder is done, also after a failure', async () => {
		const before = lockCount();
		await Promise.all(
			Array.from({ length: 200 }, (_, i) =>
				withLock(`bed:never-seen-${i}`, async () => {
					if (i % 2) throw new Error('boom');
				}).catch(() => {})
			)
		);
		await new Promise((r) => setTimeout(r, 0));
		expect(lockCount()).toBe(before);
	});
});

describe('recordId', () => {
	const form = (value: string) => {
		const data = new FormData();
		data.set('bedId', value);
		return data;
	};

	it('passes a PocketBase id', () => {
		expect(recordId(form('a1b2c3d4e5f6g7h'), 'bedId')).toBe('a1b2c3d4e5f6g7h');
	});

	it('turns down anything a lock key should never be', () => {
		for (const value of [
			'',
			'x'.repeat(33),
			'a'.repeat(500_000),
			'ABC',
			'a b',
			'a/b',
			'../x',
			'id"'
		]) {
			expect(recordId(form(value), 'bedId')).toBe('');
		}
		expect(recordId(new FormData(), 'bedId')).toBe('');
	});
});
