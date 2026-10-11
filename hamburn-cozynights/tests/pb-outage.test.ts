// tests/pb-outage.test.ts
// A short PocketBase outage (restart, hiccup under load) must stay short for the
// app: the service account keeps its token while PocketBase does not answer, and
// the guest map says "try again" instead of showing an empty, sold-out camp.
// Found by the opening load test of 2026-10-07: a 3 s outage became 13 s.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const pb = vi.hoisted(() => ({
	token: '',
	refresh: vi.fn(),
	login: vi.fn()
}));

vi.mock('pocketbase', () => ({
	default: class {
		authStore = {
			get isValid() {
				return !!pb.token;
			},
			clear() {
				pb.token = '';
			}
		};
		autoCancellation() {}
		collection() {
			return { authRefresh: pb.refresh, authWithPassword: pb.login };
		}
	}
}));

const outage = () => Object.assign(new Error('fetch failed'), { status: 0 });
const rejected = () =>
	Object.assign(new Error('The request requires valid record authorization token.'), {
		status: 401
	});

async function freshModule() {
	vi.resetModules();
	return import('../src/lib/server/pocketbase');
}

describe('service account through a PocketBase outage', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-10-20T18:00:00Z'));
		pb.token = '';
		pb.refresh.mockReset().mockImplementation(async () => {});
		pb.login.mockReset().mockImplementation(async () => {
			pb.token = 'service-token';
		});
		vi.spyOn(console, 'error').mockImplementation(() => {});
		vi.spyOn(console, 'log').mockImplementation(() => {});
	});
	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	it('signs in once, then trusts the token for five minutes', async () => {
		const { getAdminPb } = await freshModule();
		const client = await getAdminPb();
		expect(client.authStore.isValid).toBe(true);
		expect(pb.login).toHaveBeenCalledTimes(1);

		vi.advanceTimersByTime(4 * 60 * 1000);
		await getAdminPb();
		expect(pb.refresh).not.toHaveBeenCalled();
		expect(pb.login).toHaveBeenCalledTimes(1);
	});

	it('keeps the token when the five-minute check finds PocketBase down', async () => {
		const { getAdminPb } = await freshModule();
		await getAdminPb();

		vi.advanceTimersByTime(5 * 60 * 1000 + 1);
		pb.refresh.mockImplementation(async () => {
			throw outage();
		});
		const during = await getAdminPb();
		expect(pb.refresh).toHaveBeenCalledTimes(1);
		// still signed in: once PocketBase answers again, requests carry the token
		expect(during.authStore.isValid).toBe(true);
		expect(pb.login).toHaveBeenCalledTimes(1);

		// no check on every request while PocketBase is down
		vi.advanceTimersByTime(5 * 1000);
		await getAdminPb();
		expect(pb.refresh).toHaveBeenCalledTimes(1);

		// PocketBase is back: the next check after the pause succeeds, token unchanged
		pb.refresh.mockImplementation(async () => {});
		vi.advanceTimersByTime(5 * 1000 + 1);
		const after = await getAdminPb();
		expect(pb.refresh).toHaveBeenCalledTimes(2);
		expect(after.authStore.isValid).toBe(true);
		expect(pb.login).toHaveBeenCalledTimes(1);

		// verified again: quiet for the next five minutes
		vi.advanceTimersByTime(60 * 1000);
		await getAdminPb();
		expect(pb.refresh).toHaveBeenCalledTimes(2);
	});

	it('keeps the token on a server error or a rate limit too', async () => {
		const { getAdminPb } = await freshModule();
		await getAdminPb();
		for (const status of [500, 502, 503, 429]) {
			vi.advanceTimersByTime(5 * 60 * 1000 + 1);
			pb.refresh.mockImplementationOnce(async () => {
				throw Object.assign(new Error(`status ${status}`), { status });
			});
			const client = await getAdminPb();
			expect(client.authStore.isValid, `status ${status}`).toBe(true);
		}
		expect(pb.login).toHaveBeenCalledTimes(1);
	});

	it('drops a token PocketBase turns down and signs in again', async () => {
		const { getAdminPb } = await freshModule();
		await getAdminPb();

		vi.advanceTimersByTime(5 * 60 * 1000 + 1);
		pb.refresh.mockImplementation(async () => {
			throw rejected();
		});
		pb.login.mockImplementation(async () => {
			pb.token = 'new-service-token';
		});
		const client = await getAdminPb();
		expect(pb.login).toHaveBeenCalledTimes(2);
		expect(client.authStore.isValid).toBe(true);
		expect(pb.token).toBe('new-service-token');
	});

	it('waits ten seconds before it tries to sign in again after a failed login', async () => {
		pb.login.mockImplementation(async () => {
			throw outage();
		});
		const { getAdminPb } = await freshModule();
		const first = await getAdminPb();
		expect(first.authStore.isValid).toBe(false);
		expect(pb.login).toHaveBeenCalledTimes(1);

		vi.advanceTimersByTime(9 * 1000);
		await getAdminPb();
		expect(pb.login).toHaveBeenCalledTimes(1);

		pb.login.mockImplementation(async () => {
			pb.token = 'service-token';
		});
		vi.advanceTimersByTime(1 * 1000 + 1);
		const later = await getAdminPb();
		expect(pb.login).toHaveBeenCalledTimes(2);
		expect(later.authStore.isValid).toBe(true);
	});

	it('shares one check between requests that arrive together', async () => {
		const { getAdminPb } = await freshModule();
		await getAdminPb();
		vi.advanceTimersByTime(5 * 60 * 1000 + 1);
		await Promise.all([getAdminPb(), getAdminPb(), getAdminPb()]);
		expect(pb.refresh).toHaveBeenCalledTimes(1);
	});

	it('tells a refused token from a PocketBase that does not answer', async () => {
		const { tokenRejected } = await freshModule();
		for (const status of [400, 401, 403, 404]) {
			expect(tokenRejected({ status }), `status ${status}`).toBe(true);
		}
		for (const status of [0, 429, 500, 502, 503, 504]) {
			expect(tokenRejected({ status }), `status ${status}`).toBe(false);
		}
		expect(tokenRejected(new Error('socket hang up'))).toBe(false);
		expect(tokenRejected(undefined)).toBe(false);
	});
});

describe('guest map through a PocketBase outage', () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('getFullTree fails instead of answering with an empty camp', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		const { InventoryService } = await import('../src/lib/server/inventory');
		const down = {
			collection: () => ({
				getFullList: async () => {
					throw outage();
				}
			})
		};
		await expect(new InventoryService(down as any).getFullTree()).rejects.toThrow('fetch failed');
	});

	it('getFullTree still builds the tree when PocketBase answers', async () => {
		const { InventoryService } = await import('../src/lib/server/inventory');
		const data: Record<string, unknown[]> = {
			houses: [{ id: 'h1', name: 'Villa' }],
			rooms: [{ id: 'r1', house: 'h1', room_number: '101' }],
			beds: [
				{ id: 'b1', room: 'r1', label: 'A', occupied: false },
				{ id: 'b2', room: 'r1', label: 'B', occupied: true }
			]
		};
		const up = { collection: (name: string) => ({ getFullList: async () => data[name] }) };
		const [villa] = await new InventoryService(up as any).getFullTree();
		expect(villa).toMatchObject({ totalBeds: 2, occupiedBeds: 1, freeBeds: 1, isBookable: true });
	});
});
