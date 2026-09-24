// tests/pass.test.ts — booking passes: code format, lookup, the guest's pass
// page, the crew's check page. PocketBase mocked; the real hooks that create
// codes are covered by tests/integration/pass.test.ts.
import { describe, it, expect, vi } from 'vitest';

vi.mock('$env/dynamic/private', () => ({
	env: {
		ENCRYPTION_KEY: '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff',
		PB_ADMIN_EMAIL: 'admin@test.com',
		PB_ADMIN_PASSWORD: 'password'
	}
}));

import { FakePb } from './fake-pb';
import { formatPassCode, isPassCode, normalizePassInput, PASS_ALPHABET } from '../src/lib/pass';
import {
	ensurePassCode,
	findPass,
	passQrGif,
	passQrSvg,
	passSummary,
	passUrl
} from '../src/lib/server/pass';
import { createLookupHash, encrypt } from '../src/lib/server/crypto';
import { APP_SETTINGS_ID } from '../src/lib/server/constants';
import { load as passLoad } from '../src/routes/pass/[code]/+page.server';
import { GET as passGif } from '../src/routes/pass/[code]/qr.gif/+server';
import { actions as checkActions } from '../src/routes/admin/check/+page.server';
import { load as houseLoad } from '../src/routes/house/[id]/+page.server';
import { load as roomLoad } from '../src/routes/room/[id]/+page.server';
import { load as mapLoad } from '../src/routes/map/+page.server';
import { load as rouletteLoad } from '../src/routes/random-bed/+page.server';

const CODE = '7F3K9QXM2CWD';
const notFound = Object.assign(new Error('not found'), { status: 404 });

const ORDER = {
	id: 'order1',
	pass_code: CODE,
	customer_name: 'Ada Lovelace',
	email: 'ada@example.com',
	order_number: 'HB-1001',
	burner_name: encrypt('Disco Druid')
};
const BED = {
	id: 'bed1',
	room: 'room1',
	label: 'B1',
	enabled: true,
	is_locked: false,
	updated: '2026-09-18 12:00:00.000Z',
	expand: {
		room: { name: 'Blue Room', room_number: 2, expand: { house: { name: 'Brahmsee-Villa' } } }
	}
};

/** adminPb stand-in: orders and beds answer per collection. */
function fakeAdminPb({ order = ORDER as any, bed = BED as any } = {}) {
	const orders = {
		getFirstListItem: vi.fn(async () => {
			if (!order) throw notFound;
			return order;
		})
	};
	const beds = {
		getFirstListItem: vi.fn(async () => {
			if (!bed) throw notFound;
			return bed;
		})
	};
	return {
		collection: vi.fn((name: string) => (name === 'orders' ? orders : beds)),
		filter: vi.fn((q: string, p: object) => `${q} ${JSON.stringify(p)}`),
		send: vi.fn(async () => ({ code: 'NEWCODE23456' }))
	} as any;
}

function passEvent(code: string, locals: Record<string, unknown>) {
	const headers: Record<string, string> = {};
	return {
		event: {
			params: { code },
			locals,
			url: new URL(`https://cozy.example/pass/${code}`),
			setHeaders: (h: Record<string, string>) => Object.assign(headers, h),
			getClientAddress: () => '203.0.113.7'
		} as any,
		headers
	};
}

async function outcome(promise: unknown) {
	try {
		return { value: await promise };
	} catch (e: any) {
		return { status: e.status, location: e.location, message: e.body?.message };
	}
}

describe('pass codes', () => {
	it('use 12 characters without look-alikes and show in groups of four', () => {
		expect(PASS_ALPHABET).not.toMatch(/[01ILO]/);
		expect(isPassCode(CODE)).toBe(true);
		expect(formatPassCode(CODE)).toBe('7F3K-9QXM-2CWD');
	});

	it('are read from what people type and what scanners send', () => {
		for (const input of [
			'7F3K-9QXM-2CWD',
			'7f3k 9qxm 2cwd',
			'  7F3K9QXM2CWD\n',
			'https://test-cozynights.hamburn.de/pass/7F3K-9QXM-2CWD',
			'https://test-cozynights.hamburn.de/pass/7f3k-9qxm-2cwd?x=1#top',
			'/pass/7F3K%2D9QXM%2D2CWD'
		]) {
			expect(normalizePassInput(input), input).toBe(CODE);
		}
	});

	it('refuse anything else', () => {
		for (const input of [
			'',
			'7F3K-9QXM-2CW',
			'7F3K-9QXM-2CWDX',
			'0F3K-9QXM-2CWD', // 0 is not in the alphabet
			'IF3K-9QXM-2CWD',
			'https://evil.example/room/7F3K-9QXM-2CWD',
			'/pass/%E0%A4%A',
			42,
			null
		]) {
			expect(normalizePassInput(input), String(input)).toBeNull();
		}
	});
});

describe('findPass', () => {
	it('returns the ticket, where it sleeps and the burner name', async () => {
		const pass = await findPass(fakeAdminPb(), CODE);
		expect(pass?.order.id).toBe('order1');
		expect(pass?.burnerName).toBe('Disco Druid');
		expect(pass?.spot).toMatchObject({
			house: 'Brahmsee-Villa',
			room: 'Blue Room #2',
			spot: 'B1',
			roomId: 'room1',
			enabled: true,
			locked: false
		});
	});

	it('knows tickets without a spot, and unknown codes', async () => {
		expect((await findPass(fakeAdminPb({ bed: null }), CODE))?.spot).toBeNull();
		expect(await findPass(fakeAdminPb({ order: null }), CODE)).toBeNull();
	});

	it('dates the booking by booked_at, not by the last change of the spot', async () => {
		const booked = { ...BED, booked_at: '2026-09-15 07:32:00.000Z' };
		expect((await findPass(fakeAdminPb({ bed: booked }), CODE))?.spot?.bookedAt).toBe(
			'2026-09-15 07:32:00.000Z'
		);
		// spots booked before booked_at existed
		expect((await findPass(fakeAdminPb(), CODE))?.spot?.bookedAt).toBe(BED.updated);
	});
});

describe('ensurePassCode', () => {
	it('asks PocketBase only when the ticket has no code yet', async () => {
		const pb = fakeAdminPb();
		expect(await ensurePassCode(pb, { id: 'order1', pass_code: CODE })).toBe(CODE);
		expect(pb.send).not.toHaveBeenCalled();
		expect(await ensurePassCode(pb, { id: 'order1', pass_code: '' })).toBe('NEWCODE23456');
		expect(pb.send).toHaveBeenCalledWith('/api/cozy/pass/order1', { method: 'POST' });
	});
});

/** Two houses; ticket HB-1001 sleeps in the first (B1), HB-2002 holds no spot. */
function campWithGuest({ phase = 'closed', passCode = CODE } = {}) {
	const pb = new FakePb();
	pb.seed('app_settings', {
		id: APP_SETTINGS_ID,
		is_booking_active: phase === 'live',
		booking_closed: phase === 'closed'
	});
	const villa = pb.seed('houses', { name: 'Brahmsee-Villa', x: 10, y: 20 });
	const huts = pb.seed('houses', { name: 'Waldhütten', x: 30, y: 40 });
	const blue = pb.seed('rooms', { name: 'Blue Room', room_number: 2, house: villa.id });
	const hut = pb.seed('rooms', { name: 'Hut', room_number: 1, house: huts.id });
	const order = pb.seed('orders', {
		order_number: 'HB-1001',
		order_hash: createLookupHash('HB-1001'),
		customer_name: 'Ada Lovelace',
		pass_code: passCode,
		burner_name: encrypt('Disco Druid')
	});
	const bed = pb.seed('beds', {
		label: 'B1',
		room: blue.id,
		enabled: true,
		occupied: true,
		order: order.id
	});
	pb.seed('beds', { label: 'H1', room: hut.id, enabled: true, occupied: false, order: '' });
	pb.seed('orders', {
		order_number: 'HB-2002',
		order_hash: createLookupHash('HB-2002'),
		customer_name: 'Grace Hopper'
	});
	return { pb, huts, hut, order, bed };
}

/** What the small ticket shows for HB-1001. */
const TICKET = {
	code: '7F3K-9QXM-2CWD',
	house: 'Brahmsee-Villa',
	room: 'Blue Room #2',
	spot: 'B1',
	burnerName: 'Disco Druid'
};

/** Like hooks.server.ts: the ticket of the cookie, read once per request. */
function guestLocals(pb: FakePb, orderNumber = 'HB-1001') {
	const order = pb.tables.orders?.find((row) => row.order_number === orderNumber) ?? null;
	return { pb, adminPb: pb, orderNumber, order, admin: null };
}
const cookies = { delete: () => {} };

describe('passSummary', () => {
	it('gives the small ticket the pass code and where the ticket sleeps', async () => {
		const c = campWithGuest();
		expect(await passSummary(c.pb as any, c.order as any, c.bed as any)).toEqual(TICKET);
	});

	it('makes the pass code on first use', async () => {
		const c = campWithGuest({ passCode: '' });
		const send = vi.fn(async () => ({ code: 'NEWCODE23456' }));
		Object.assign(c.pb, { send });
		expect((await passSummary(c.pb as any, c.order as any, c.bed as any)).code).toBe(
			'NEWC-ODE2-3456'
		);
		expect(send).toHaveBeenCalledWith(`/api/cozy/pass/${c.order.id}`, { method: 'POST' });
	});
});

describe("the guest's own pass on other pages", () => {
	it('house and room pages give guests with a spot their ticket', async () => {
		const c = campWithGuest();
		const house: any = await houseLoad({
			url: new URL('http://test.local/'),
			params: { id: c.huts.id },
			locals: guestLocals(c.pb),
			cookies
		} as any);
		expect(house.pass).toEqual(TICKET);
		const room: any = await roomLoad({
			url: new URL('http://test.local/'),
			params: { id: c.hut.id },
			locals: guestLocals(c.pb),
			cookies
		} as any);
		expect(room.pass).toEqual(TICKET);

		const noSpot: any = await houseLoad({
			url: new URL('http://test.local/'),
			params: { id: c.huts.id },
			locals: guestLocals(c.pb, 'HB-2002'),
			cookies
		} as any);
		expect(noSpot.pass).toBeNull();
	});

	it('a pass that cannot be made leaves the page working', async () => {
		const c = campWithGuest({ passCode: '' });
		Object.assign(c.pb, {
			send: vi.fn(async () => {
				throw new Error('PocketBase is down');
			})
		});
		const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
		const house: any = await houseLoad({
			url: new URL('http://test.local/'),
			params: { id: c.huts.id },
			locals: guestLocals(c.pb),
			cookies
		} as any);
		quiet.mockRestore();
		expect(house.userBedId).toBe(c.bed.id);
		expect(house.pass).toBeNull();
	});

	it('the map shows it on the Closed panel, and knows tickets without a spot', async () => {
		const closed = campWithGuest();
		expect(
			await mapLoad({ url: new URL('http://test.local/'), locals: guestLocals(closed.pb) } as any)
		).toMatchObject({
			phase: 'closed',
			pass: TICKET,
			noSpot: false
		});
		expect(
			await mapLoad({
				url: new URL('http://test.local/'),
				locals: guestLocals(closed.pb, 'HB-2002')
			} as any)
		).toMatchObject({
			pass: null,
			noSpot: true
		});
		// the map is public: nobody signed in, nothing to show
		expect(
			await mapLoad({
				url: new URL('http://test.local/'),
				locals: guestLocals(closed.pb, '')
			} as any)
		).toMatchObject({
			pass: null,
			noSpot: false
		});

		const live = campWithGuest({ phase: 'live' });
		expect(
			await mapLoad({ url: new URL('http://test.local/'), locals: guestLocals(live.pb) } as any)
		).toMatchObject({
			phase: 'live',
			pass: null,
			noSpot: false
		});
	});
});

describe("the roulette's own pass and name", () => {
	it('shows a guest with a spot that spot as the booking pass, in every phase', async () => {
		for (const phase of ['live', 'closed']) {
			const c = campWithGuest({ phase });
			const page: any = await rouletteLoad({ locals: guestLocals(c.pb), cookies } as any);
			expect(page.pass).toEqual(TICKET);
			expect(page.userBed).toEqual({
				id: c.bed.id,
				label: 'B1',
				roomId: c.bed.room,
				roomName: 'Blue Room #2',
				houseName: 'Brahmsee-Villa'
			});
			// a guest with a spot spins nothing: no list of free spots is sent
			expect(page.freeBeds).toEqual([]);
		}
	});

	it("gives the name plate the ticket's burner name, and the reels flat free spots", async () => {
		const c = campWithGuest({ phase: 'live' });
		const mine: any = await rouletteLoad({ locals: guestLocals(c.pb), cookies } as any);
		expect(mine.burnerName).toBe('Disco Druid');

		const fresh: any = await rouletteLoad({
			locals: guestLocals(c.pb, 'HB-2002'),
			cookies
		} as any);
		expect(fresh.burnerName).toBe('');
		expect(fresh.pass).toBeNull();
		expect(fresh.userBed).toBeNull();
		expect(fresh.freeBeds).toEqual([
			{
				id: expect.any(String),
				label: 'H1',
				roomId: c.hut.id,
				roomName: 'Hut #1',
				houseName: 'Waldhütten'
			}
		]);
	});

	it('a pass that cannot be made leaves the roulette working', async () => {
		const c = campWithGuest({ phase: 'live', passCode: '' });
		Object.assign(c.pb, {
			send: vi.fn(async () => {
				throw new Error('PocketBase is down');
			})
		});
		const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
		const page: any = await rouletteLoad({ locals: guestLocals(c.pb), cookies } as any);
		quiet.mockRestore();
		expect(page.userBed.id).toBe(c.bed.id);
		expect(page.pass).toBeNull();
	});
});

describe('QR codes', () => {
	it('hold the pass link, as SVG for pages and GIF for saving', () => {
		const url = passUrl('https://cozy.example', CODE);
		expect(url).toBe('https://cozy.example/pass/7F3K-9QXM-2CWD');
		expect(passQrSvg(url)).toMatch(/^<svg /);
		expect(new TextDecoder().decode(passQrGif(url).slice(0, 6))).toBe('GIF87a');
	});
});

describe('pass page', () => {
	it('shows guests their spot and the QR code, never who the ticket belongs to', async () => {
		const { event, headers } = passEvent('7F3K-9QXM-2CWD', { adminPb: fakeAdminPb(), admin: null });
		const data: any = await passLoad(event);
		expect(data.code).toBe('7F3K-9QXM-2CWD');
		expect(data.spot).toEqual({ house: 'Brahmsee-Villa', room: 'Blue Room #2', spot: 'B1' });
		expect(data.burnerName).toBe('Disco Druid');
		expect(data.qrSvg).toMatch(/^<svg /);
		expect(data.check).toBeNull();
		expect(JSON.stringify(data)).not.toMatch(/Ada|ada@|HB-1001/);
		expect(headers['referrer-policy']).toBe('no-referrer');
		expect(headers['x-robots-tag']).toContain('noindex');
	});

	it('shows signed-in admins the check result on top', async () => {
		const admin = { email: 'crew@mauersegler.art', role: 'admin' };
		const { event } = passEvent('7F3K-9QXM-2CWD', { adminPb: fakeAdminPb(), admin });
		const data: any = await passLoad(event);
		expect(data.check).toMatchObject({
			ticketName: 'Ada Lovelace',
			email: 'a•••@example.com',
			roomId: 'room1',
			enabled: true,
			bookedAt: BED.updated, // no booked_at stamp: the bed's last change
			checkIn: null
		});
	});

	it('never shows the code of a ticket without a name, not even to admins', async () => {
		// "Ticket HB-1001" is the label such a ticket gets, and HB-1001 signs its
		// guest in — so the crew sees the masked label instead.
		const admin = { email: 'crew@mauersegler.art', role: 'admin' };
		const order = { ...ORDER, customer_name: 'Ticket HB-1001' };
		const { event } = passEvent('7F3K-9QXM-2CWD', { adminPb: fakeAdminPb({ order }), admin });
		const data: any = await passLoad(event);
		expect(data.check.ticketName).toBe('Ticket H•••');
		expect(JSON.stringify(data)).not.toContain('HB-1001');
	});

	it('shows admins the check-in, and guests nothing about it', async () => {
		const bed = {
			...BED,
			booked_at: '2026-09-17 09:00:00.000Z',
			checked_in_at: '2026-09-19 12:00:00.000Z',
			checked_in_by: 'crew@mauersegler.art'
		};
		const admin = { email: 'other@mauersegler.art', role: 'admin' };
		const crew: any = await passLoad(
			passEvent('7F3K-9QXM-2CWD', { adminPb: fakeAdminPb({ bed }), admin }).event
		);
		expect(crew.check).toMatchObject({
			bookedAt: '2026-09-17 09:00:00.000Z',
			checkIn: { at: '2026-09-19 12:00:00.000Z', by: 'crew@mauersegler.art' }
		});

		const guest: any = await passLoad(
			passEvent('7F3K-9QXM-2CWD', { adminPb: fakeAdminPb({ bed }), admin: null }).event
		);
		expect(guest.check).toBeNull();
		expect(JSON.stringify(guest)).not.toMatch(/crew@|2026-09-19|checkIn|checked_in/);
	});

	it('redirects to the canonical code and refuses unknown or malformed ones', async () => {
		const pb = fakeAdminPb();
		expect(await outcome(passLoad(passEvent('7f3k9qxm2cwd', { adminPb: pb }).event))).toMatchObject(
			{
				status: 308,
				location: '/pass/7F3K-9QXM-2CWD'
			}
		);
		expect(await outcome(passLoad(passEvent('nope', { adminPb: pb }).event))).toMatchObject({
			status: 404
		});
		const unknown = fakeAdminPb({ order: null });
		expect(
			await outcome(passLoad(passEvent('AAAA-BBBB-CCCC', { adminPb: unknown }).event))
		).toMatchObject({ status: 404 });
	});

	it('offers the QR code as an image to save', async () => {
		const res = await passGif({
			params: { code: '7F3K-9QXM-2CWD' },
			locals: { adminPb: fakeAdminPb() },
			url: new URL('https://cozy.example/pass/7F3K-9QXM-2CWD/qr.gif')
		} as any);
		expect(res.headers.get('content-type')).toBe('image/gif');
		expect(res.headers.get('content-disposition')).toContain('cozynights-pass-7F3K-9QXM-2CWD.gif');
	});
});

describe('admin check page', () => {
	const admin = { email: 'crew@mauersegler.art', role: 'admin' };

	function act(kind: 'checkin' | 'undo', code: string, locals: Record<string, unknown>) {
		const body = new FormData();
		body.set('code', code);
		return (checkActions[kind] as any)({ request: { formData: async () => body }, locals });
	}

	/** The admin's own connection writes; the service account only reads. */
	function crewLocals(pb: FakePb, who: Record<string, unknown> | null = admin) {
		const serviceAccount = {
			filter: pb.filter.bind(pb),
			collection: (name: string) => ({
				...pb.collection(name),
				update: vi.fn(async () => {
					throw new Error('the service account must not write the check-in');
				})
			})
		};
		return { admin: who, pb, adminPb: serviceAccount };
	}

	it('checks the guest in, and a second check says when and by whom', async () => {
		const c = campWithGuest();
		const first = await act('checkin', 'https://x/pass/7F3K-9QXM-2CWD', crewLocals(c.pb));
		expect(first.result).toMatchObject({
			status: 'checkedin',
			code: '7F3K-9QXM-2CWD',
			ticketName: 'Ada Lovelace',
			spot: { spot: 'B1', room: 'Blue Room #2', house: 'Brahmsee-Villa', roomId: c.bed.room },
			burnerName: 'Disco Druid',
			checkIn: { by: 'crew@mauersegler.art' },
			warning: ''
		});
		const bed = c.pb.rows('beds').find((b) => b.id === c.bed.id)!;
		expect(bed.checked_in_at).toBe(first.result.checkIn.at);
		expect(bed).toMatchObject({ order: c.order.id, checked_in_by: 'crew@mauersegler.art' });

		const other = { email: 'other@mauersegler.art', role: 'superuser' };
		const again = await act('checkin', '7f3k9qxm2cwd', crewLocals(c.pb, other));
		expect(again.result).toMatchObject({
			status: 'already',
			checkIn: { at: first.result.checkIn.at, by: 'crew@mauersegler.art' }
		});
		expect(c.pb.rows('beds').find((b) => b.id === c.bed.id)!.checked_in_by).toBe(
			'crew@mauersegler.art'
		);
	});

	it('undoes a check-in: the booking stays, the audit log knows', async () => {
		const c = campWithGuest();
		await act('checkin', CODE, crewLocals(c.pb));
		const undone = await act('undo', CODE, crewLocals(c.pb));
		expect(undone.result).toMatchObject({ status: 'undone', checkIn: null, spot: { spot: 'B1' } });
		expect(c.pb.rows('beds').find((b) => b.id === c.bed.id)).toMatchObject({
			order: c.order.id,
			occupied: true,
			checked_in_at: '',
			checked_in_by: ''
		});
		expect(c.pb.rows('admin_events')).toEqual([
			expect.objectContaining({
				action: 'check_in_undone',
				actor: 'crew@mauersegler.art',
				subject: 'B1 · Blue Room #2 · Brahmsee-Villa'
			})
		]);
		// nothing left to undo
		expect((await act('undo', CODE, crewLocals(c.pb))).result.status).toBe('booked');
		expect(c.pb.rows('admin_events')).toHaveLength(1);
	});

	it('has nothing to check in without a spot, and knows unknown codes', async () => {
		const c = campWithGuest();
		c.pb.rows('orders')[1].pass_code = 'NSPTABCDEFGH';
		const noSpot = await act('checkin', 'NSPT-ABCD-EFGH', crewLocals(c.pb));
		expect(noSpot.result).toMatchObject({
			status: 'nospot',
			ticketName: 'Grace Hopper',
			spot: null,
			checkIn: null
		});
		expect((await act('checkin', 'AAAA-BBBB-CCCC', crewLocals(c.pb))).result.status).toBe(
			'unknown'
		);
		expect(c.pb.rows('beds').some((b) => b.checked_in_at)).toBe(false);
	});

	it('names a ticket without a name by its masked code at the gate', async () => {
		const c = campWithGuest();
		c.pb.rows('orders')[0].customer_name = 'Ticket HB-1001';
		const result = (await act('checkin', CODE, crewLocals(c.pb))).result;
		expect(result).toMatchObject({ status: 'checkedin', ticketName: 'Ticket H•••' });
		expect(JSON.stringify(result)).not.toContain('HB-1001');
	});

	it('says when the spot was deactivated or locked, and checks in anyway', async () => {
		const c = campWithGuest();
		c.bed.enabled = false;
		const result = (await act('checkin', CODE, crewLocals(c.pb))).result;
		expect(result.status).toBe('checkedin');
		expect(result.warning).toContain('deactivated');
	});

	it('refuses non-admins and input that is no pass code, and stores nothing', async () => {
		const c = campWithGuest();
		for (const kind of ['checkin', 'undo'] as const) {
			expect((await act(kind, CODE, crewLocals(c.pb, null))).status).toBe(403);
		}
		expect((await act('checkin', 'HB-1001', crewLocals(c.pb))).status).toBe(400);
		expect(c.pb.rows('beds').some((b) => b.checked_in_at)).toBe(false);
	});
});
