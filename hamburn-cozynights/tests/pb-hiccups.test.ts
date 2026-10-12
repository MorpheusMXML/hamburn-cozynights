// tests/pb-hiccups.test.ts — PocketBase hiccups (release v1.32.3, R3): a read
// gives up after 10 s and a write never does; a booking phase that couldn't
// be read is never "Staging" for a guest — the pages say "not reachable", the
// actions change nothing and say so (503), and the last good read stands in
// for 30 s for what pages show. Also: the roulette reads only what its drum
// shows, and nothing outside Live Booking. The service account's own time
// limits: tests/pb-outage.test.ts; the admin session: tests/admin-auth.test.ts.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import PocketBase from 'pocketbase';

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
import { limitReads, READ_TIMEOUT_MS, tokenRejected } from '../src/lib/server/pocketbase';
import {
	forgetLastSettings,
	getBookingSettings,
	SETTINGS_UNREACHABLE
} from '../src/lib/server/settings';
import { CONFIRMED_FIELDS } from '../src/lib/booking-check';
import { load as roomLoad, actions as roomActions } from '../src/routes/room/[id]/+page.server';
import { load as houseLoad, actions as houseActions } from '../src/routes/house/[id]/+page.server';
import {
	load as rouletteLoad,
	actions as rouletteActions
} from '../src/routes/random-bed/+page.server';

const outage = () => Object.assign(new Error('fetch failed'), { status: 0 });

beforeEach(() => {
	forgetLastSettings();
	vi.spyOn(console, 'error').mockImplementation(() => {});
	vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe('time limits of the PocketBase connections', () => {
	/** A connection as the app makes them (hooks.server.ts, $lib/server/pocketbase). */
	function connection() {
		const pb = limitReads(new PocketBase('http://pb.test'));
		pb.autoCancellation(false);
		return pb;
	}

	/** A fetch that answers at once and remembers what it was asked. */
	function recorder() {
		const seen: { method: string; signal: AbortSignal | null | undefined }[] = [];
		const fetch = async (_url: RequestInfo | URL, init?: RequestInit) => {
			seen.push({ method: String(init?.method), signal: init?.signal });
			return new Response(JSON.stringify({ id: 'b1', items: [], totalItems: 0 }), {
				status: 200,
				headers: { 'content-type': 'application/json' }
			});
		};
		return { seen, fetch };
	}

	it('gives every read ten seconds, and never a write', async () => {
		const timeout = vi.spyOn(AbortSignal, 'timeout');
		const pb = connection();
		const { seen, fetch } = recorder();

		await pb.collection('beds').getOne('b1', { fetch });
		await pb.collection('beds').getList(1, 1, { fetch });
		await pb.collection('beds').update('b1', { occupied: true }, { fetch });
		await pb.collection('beds').create({ label: 'B1' }, { fetch });
		await pb.collection('beds').delete('b1', { fetch });
		await pb.send('/api/cozy/book', { method: 'POST', body: {}, fetch });

		expect(seen.map((call) => [call.method, call.signal instanceof AbortSignal])).toEqual([
			['GET', true],
			['GET', true],
			['PATCH', false],
			['POST', false],
			['DELETE', false],
			['POST', false]
		]);
		expect(timeout.mock.calls).toEqual([[READ_TIMEOUT_MS], [READ_TIMEOUT_MS]]);
		expect(READ_TIMEOUT_MS).toBe(10_000);
	});

	it('keeps a signal the caller passed', async () => {
		const pb = connection();
		const { seen, fetch } = recorder();
		const own = new AbortController().signal;
		await pb.collection('beds').getOne('b1', { fetch, signal: own });
		expect(seen[0].signal).toBe(own);
	});

	it('a read that hangs gives up like a PocketBase that does not answer', async () => {
		const shortly = AbortSignal.timeout.bind(AbortSignal);
		vi.spyOn(AbortSignal, 'timeout').mockImplementation(() => shortly(5));
		const pb = connection();
		const hanging = (_url: RequestInfo | URL, init?: RequestInit) =>
			new Promise<Response>((_, reject) =>
				init?.signal?.addEventListener('abort', () => reject(init.signal?.reason))
			);

		const err = await pb
			.collection('beds')
			.getOne('b1', { fetch: hanging })
			.catch((e) => e);
		expect(err).toMatchObject({ status: 0 });
		// …so the service account keeps its token, an admin keeps the session
		expect(tokenRejected(err)).toBe(false);
	});
});

describe('the booking phase when PocketBase does not answer', () => {
	const pbWith = (getOne: () => Promise<unknown>) => ({ collection: () => ({ getOne }) }) as any;
	const live = { id: APP_SETTINGS_ID, is_booking_active: true, telegram_bot: 'cozy_test_bot' };

	it('says so instead of answering "Staging"', async () => {
		const settings = await getBookingSettings(
			pbWith(async () => {
				throw outage();
			})
		);
		expect(settings).toMatchObject({ reachable: false, known: false });
	});

	it('shows the last good read for 30 seconds, then nothing it knows', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-10-20T18:00:00Z'));
		expect(await getBookingSettings(pbWith(async () => live))).toMatchObject({
			phase: 'live',
			reachable: true,
			known: true
		});

		const down = pbWith(async () => {
			throw outage();
		});
		vi.advanceTimersByTime(29 * 1000);
		expect(await getBookingSettings(down)).toMatchObject({
			phase: 'live',
			isBookingActive: true,
			telegramBot: 'cozy_test_bot',
			reachable: false,
			known: true
		});

		vi.advanceTimersByTime(2 * 1000);
		expect(await getBookingSettings(down)).toMatchObject({
			phase: 'staging',
			reachable: false,
			known: false
		});
	});

	it('takes a missing record as the defaults: that is an answer', async () => {
		const settings = await getBookingSettings(
			pbWith(async () => {
				throw Object.assign(new Error('not found'), { status: 404 });
			})
		);
		expect(settings).toMatchObject({ phase: 'staging', reachable: true, known: true });
	});
});

describe('guests while the booking phase cannot be read', () => {
	/** A live camp: one room, B1 booked by the ticket, B2 free. */
	function camp() {
		const pb = new FakePb();
		pb.seed('app_settings', { id: APP_SETTINGS_ID, is_booking_active: true });
		const house = pb.seed('houses', { name: 'Firework Villa' });
		const room = pb.seed('rooms', { name: 'Dorm', room_number: 4, house: house.id });
		const spot = (label: string) =>
			pb.seed('beds', {
				label,
				room: room.id,
				enabled: true,
				occupied: false,
				is_locked: false,
				is_special: false,
				order: ''
			});
		const [b1, b2] = [spot('B1'), spot('B2')];
		const code = 'HB-3001';
		const order = pb.seed('orders', {
			order_number: code,
			order_hash: createLookupHash(code),
			customer_name: 'Ada Lovelace',
			email: 'ada@example.com',
			burner_name: ''
		});
		Object.assign(b1, { occupied: true, order: order.id });
		// The guest's own connection reads app_settings; PocketBase doesn't answer.
		const down = new Proxy(pb, {
			get(target, prop) {
				if (prop === 'collection') {
					return (name: string) =>
						name === 'app_settings'
							? {
									getOne: async () => {
										throw outage();
									}
								}
							: target.collection(name);
				}
				const value = Reflect.get(target, prop);
				return typeof value === 'function' ? value.bind(target) : value;
			}
		});
		const locals = { pb: down, adminPb: pb, orderNumber: code, order, admin: null };
		const bed = (id: string) => pb.rows('beds').find((row) => row.id === id)!;
		return { pb, house, room, b1, b2, order, locals, bed };
	}

	const post = (fields: Record<string, string>) => ({
		formData: async () => {
			const data = new FormData();
			for (const [key, value] of Object.entries(fields)) data.append(key, value);
			return data;
		}
	});

	it('change nothing and say so: no "booking is not open"', async () => {
		const c = camp();
		const results: any[] = [
			await roomActions.bookBed({
				locals: c.locals,
				request: post({ bedId: c.b2.id, guestName: 'Dust Owl', ...CONFIRMED_FIELDS })
			} as any),
			// a new name for the own spot is no exception: Closed refuses it, and
			// whether booking closed can't be told right now
			await roomActions.bookBed({
				locals: c.locals,
				request: post({ bedId: c.b1.id, guestName: 'Dust Owl' })
			} as any),
			await roomActions.unbookBed({ locals: c.locals, request: post({}) } as any),
			await houseActions.unbookBed({ locals: c.locals, request: post({}) } as any),
			await rouletteActions.bookRandom({
				locals: c.locals,
				request: post({ bedId: c.b2.id, guestName: 'Dust Owl', ...CONFIRMED_FIELDS })
			} as any),
			await rouletteActions.releaseBed({
				locals: c.locals,
				request: post({ bedId: c.b1.id })
			} as any),
			await roomActions.askSwap({ locals: c.locals, request: post({ bedId: c.b2.id }) } as any)
		];
		for (const result of results) {
			expect(result).toMatchObject({ status: 503, data: { error: SETTINGS_UNREACHABLE } });
		}
		expect(SETTINGS_UNREACHABLE).toBe(
			'The booking system is not reachable right now. Nothing was changed. Please try again in a moment.'
		);
		expect(c.bed(c.b1.id)).toMatchObject({ occupied: true, order: c.order.id });
		expect(c.bed(c.b2.id)).toMatchObject({ occupied: false, order: '' });
	});

	it('the pages say "not reachable" instead of "not open yet"', async () => {
		const c = camp();
		const cookies = { delete: vi.fn() };
		const url = new URL('http://test.local/');
		for (const page of [
			roomLoad({ params: { id: c.room.id }, locals: c.locals, cookies, url } as any),
			houseLoad({ params: { id: c.house.id }, locals: c.locals, cookies, url } as any),
			rouletteLoad({ locals: c.locals, cookies, url } as any)
		]) {
			await expect(page).rejects.toMatchObject({
				status: 503,
				body: { message: expect.stringContaining('not reachable') }
			});
		}
	});

	it('a hiccup right after a good read still shows the real phase', async () => {
		const c = camp();
		await getBookingSettings(c.pb as any); // the last good read: Live Booking
		const page: any = await roomLoad({
			params: { id: c.room.id },
			locals: c.locals,
			cookies: { delete: vi.fn() },
			url: new URL('http://test.local/')
		} as any);
		expect(page).toMatchObject({ phase: 'live', isBookingActive: true });
		// …but nothing is changed on it
		const result: any = await roomActions.unbookBed({ locals: c.locals, request: post({}) } as any);
		expect(result.status).toBe(503);
	});
});

describe('the roulette reads only what the drum shows', () => {
	function camp(phase: Record<string, unknown>) {
		const pb = new FakePb();
		pb.seed('app_settings', { id: APP_SETTINGS_ID, ...phase });
		const house = pb.seed('houses', { name: 'Firework Villa', features: [] });
		const room = pb.seed('rooms', { name: 'Dorm', room_number: 4, house: house.id });
		for (const label of ['B1', 'B2']) {
			pb.seed('beds', {
				label,
				room: room.id,
				enabled: true,
				occupied: false,
				is_locked: false,
				is_special: false,
				order: ''
			});
		}
		const code = 'HB-3002';
		const order = pb.seed('orders', { order_number: code, order_hash: createLookupHash(code) });
		// every list read of the beds, with its options
		const bedLists: Record<string, unknown>[] = [];
		const collection = pb.collection.bind(pb);
		pb.collection = ((name: string) => {
			const service = collection(name);
			if (name !== 'beds') return service;
			return {
				...service,
				getFullList: async (options: Record<string, unknown> = {}) => {
					bedLists.push(options);
					return service.getFullList(options);
				}
			};
		}) as typeof pb.collection;
		const locals = { pb, adminPb: pb, orderNumber: code, order, admin: null };
		return { locals, bedLists };
	}
	const open = (c: ReturnType<typeof camp>) =>
		rouletteLoad({
			locals: c.locals,
			cookies: { delete: vi.fn() },
			url: new URL('http://test.local/random-bed')
		} as any) as Promise<any>;

	it('during Live Booking: the free spots, with only the fields the reels and wishes need', async () => {
		const c = camp({ is_booking_active: true });
		const page = await open(c);
		expect(page.freeBeds.map((spot: { label: string }) => spot.label)).toEqual(['B1', 'B2']);
		expect(page.freeBeds[0]).toMatchObject({ roomName: 'Dorm #4', houseName: 'Firework Villa' });

		const free = c.bedLists.find((options) => String(options.filter).includes('occupied = false'));
		expect(String(free?.fields).split(',')).toEqual([
			'id',
			'label',
			'room',
			'bed_type',
			'features_off',
			'expand.room.name',
			'expand.room.room_number',
			'expand.room.features',
			'expand.room.features_off',
			'expand.room.expand.house.name',
			'expand.room.expand.house.features'
		]);
	});

	it('outside Live Booking: no list at all, the machine rests', async () => {
		for (const phase of [{ is_booking_active: false }, { booking_closed: true }]) {
			const c = camp(phase);
			const page = await open(c);
			expect(page).toMatchObject({ isBookingActive: false, freeBeds: [], freeTotal: 0 });
			expect(
				c.bedLists.some((options) => String(options.filter).includes('occupied = false'))
			).toBe(false);
		}
	});
});
