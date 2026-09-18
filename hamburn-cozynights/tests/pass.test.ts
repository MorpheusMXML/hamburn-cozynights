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

import { formatPassCode, isPassCode, normalizePassInput, PASS_ALPHABET } from '../src/lib/pass';
import { ensurePassCode, findPass, passQrGif, passQrSvg, passUrl } from '../src/lib/server/pass';
import { encrypt } from '../src/lib/server/crypto';
import { load as passLoad } from '../src/routes/pass/[code]/+page.server';
import { GET as passGif } from '../src/routes/pass/[code]/qr.gif/+server';
import { actions as checkActions } from '../src/routes/admin/check/+page.server';

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
			enabled: true
		});
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
	function check(code: string, locals: Record<string, unknown>) {
		const body = new FormData();
		body.set('code', code);
		return (checkActions.check as any)({ request: { formData: async () => body }, locals });
	}

	it('answers valid, no spot or unknown', async () => {
		const valid = await check('https://x/pass/7F3K-9QXM-2CWD', { admin, adminPb: fakeAdminPb() });
		expect(valid.result).toMatchObject({
			status: 'valid',
			code: '7F3K-9QXM-2CWD',
			ticketName: 'Ada Lovelace',
			spot: { spot: 'B1', room: 'Blue Room #2', house: 'Brahmsee-Villa', roomId: 'room1' },
			burnerName: 'Disco Druid',
			warning: ''
		});
		expect((await check(CODE, { admin, adminPb: fakeAdminPb({ bed: null }) })).result.status).toBe(
			'nospot'
		);
		expect(
			(await check(CODE, { admin, adminPb: fakeAdminPb({ order: null }) })).result.status
		).toBe('unknown');
	});

	it('says when the spot was deactivated or locked', async () => {
		const pb = fakeAdminPb({ bed: { ...BED, enabled: false } });
		expect((await check(CODE, { admin, adminPb: pb })).result.warning).toContain('deactivated');
	});

	it('refuses non-admins and input that is no pass code', async () => {
		expect((await check(CODE, { admin: null, adminPb: fakeAdminPb() })).status).toBe(403);
		expect((await check('HB-1001', { admin, adminPb: fakeAdminPb() })).status).toBe(400);
	});
});
