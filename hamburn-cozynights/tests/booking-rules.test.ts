// tests/booking-rules.test.ts — one ticket = one booking, event-time helpers, rate limiting
import { describe, it, expect, vi } from 'vitest';
import { BookingService, BedUnavailableError } from '../src/lib/server/booking';
import { FailureRateLimiter } from '../src/lib/server/rate-limit';
import { berlinLocalToIso, isoToBerlinLocal } from '../src/lib/time';

vi.mock('$env/dynamic/private', () => ({
	env: { ENCRYPTION_KEY: '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff' }
}));

/** Minimal in-memory stand-in for the PocketBase beds/orders collections, with I/O latency. */
function makeFakePb(beds: Record<string, any>[]) {
	const tick = () => new Promise((resolve) => setTimeout(resolve, Math.random() * 5));
	const byId = new Map(beds.map((b) => [b.id, { ...b }]));
	const service = (name: string) => ({
		getOne: async (id: string) => {
			await tick();
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
