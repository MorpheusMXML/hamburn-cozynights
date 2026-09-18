// tests/notifications.test.ts — the app side of the booking notifications:
// what guests see, the Telegram link, the audit log. Sending itself happens in
// PocketBase and is covered by tests/integration/notifications.test.ts.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'crypto';

vi.mock('$env/dynamic/private', () => ({
	env: {
		ENCRYPTION_KEY: '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff',
		PB_ADMIN_EMAIL: 'admin@test.com',
		PB_ADMIN_PASSWORD: 'password'
	}
}));

import {
	disconnectTelegram,
	getGuestNotifyStatus,
	maskEmail,
	startTelegramLink,
	telegramDeepLink,
	telegramLinkToken
} from '../src/lib/server/notifications';
import { getBookingSettings } from '../src/lib/server/settings';
import { logAdminEvent } from '../src/lib/server/admin-events';
import { actions as roomActions } from '../src/routes/room/[id]/+page.server';

/** A PocketBase client stand-in: collection(name) → the service below. */
function fakePb(service: Record<string, any>) {
	return {
		collection: vi.fn(() => service),
		filter: vi.fn((q: string, params: Record<string, unknown>) => `${q} ${JSON.stringify(params)}`)
	} as any;
}

const notFound = Object.assign(new Error('not found'), { status: 404 });

describe('maskEmail', () => {
	it('keeps the first letter and the domain', () => {
		expect(maskEmail('max@example.com')).toBe('m•••@example.com');
		expect(maskEmail('a@b.de')).toBe('a•••@b.de');
	});

	it('shows nothing useful for odd values', () => {
		expect(maskEmail('')).toBe('');
		expect(maskEmail(undefined)).toBe('');
		expect(maskEmail('@example.com')).toBe('•••');
		expect(maskEmail('no-at-sign')).toBe('•••');
	});
});

describe('Telegram link', () => {
	it('uses a token Telegram accepts as start parameter, and stores only its hash', () => {
		const { token, hash } = telegramLinkToken();
		expect(token).toMatch(/^[A-Za-z0-9_-]{32}$/);
		expect(hash).toBe(crypto.createHash('sha256').update(token).digest('hex'));
		expect(telegramLinkToken().token).not.toBe(token);
		expect(telegramDeepLink('cozy_test_bot', token)).toBe(
			`https://t.me/cozy_test_bot?start=${token}`
		);
	});

	it('creates the notification record of a ticket, or refreshes the token of an existing one', async () => {
		const service = {
			getFirstListItem: vi.fn().mockRejectedValueOnce(notFound),
			create: vi.fn(async () => ({})),
			update: vi.fn(async () => ({}))
		};
		const link = await startTelegramLink(fakePb(service), 'order1', 'cozy_test_bot');
		expect(link).toMatch(/^https:\/\/t\.me\/cozy_test_bot\?start=[A-Za-z0-9_-]{32}$/);
		const created = (service.create.mock.calls[0] as any[])[0];
		expect(created.order).toBe('order1');
		expect(created.tg_token_hash).toBe(
			crypto.createHash('sha256').update(link.split('start=')[1]).digest('hex')
		);
		const expires = Date.parse(created.tg_token_exp) - Date.now();
		expect(expires).toBeGreaterThan(29 * 60 * 1000);
		expect(expires).toBeLessThanOrEqual(30 * 60 * 1000);

		service.getFirstListItem.mockResolvedValueOnce({ id: 'n1', order: 'order1' });
		await startTelegramLink(fakePb(service), 'order1', 'cozy_test_bot');
		expect(service.update).toHaveBeenCalledWith(
			'n1',
			expect.objectContaining({ tg_token_hash: expect.any(String) })
		);
	});

	it('uses the record PocketBase created in the meantime', async () => {
		const service = {
			getFirstListItem: vi
				.fn()
				.mockRejectedValueOnce(notFound)
				.mockResolvedValueOnce({ id: 'n2', order: 'order1' }),
			create: vi.fn(async () => {
				throw Object.assign(new Error('unique'), { status: 400 });
			}),
			update: vi.fn(async () => ({}))
		};
		await startTelegramLink(fakePb(service), 'order1', 'cozy_test_bot');
		expect(service.update).toHaveBeenCalledWith('n2', expect.any(Object));
	});

	it('turns updates off by forgetting the chat', async () => {
		const service = {
			getFirstListItem: vi.fn().mockResolvedValueOnce({ id: 'n3', tg_chat: '777' }),
			update: vi.fn(async () => ({}))
		};
		await disconnectTelegram(fakePb(service), 'order1');
		expect(service.update).toHaveBeenCalledWith(
			'n3',
			expect.objectContaining({ tg_chat: '', tg_token_hash: '' })
		);

		service.getFirstListItem.mockRejectedValueOnce(notFound);
		await disconnectTelegram(fakePb(service), 'order1'); // nothing linked: nothing to do
		expect(service.update).toHaveBeenCalledTimes(1);
	});
});

describe('getGuestNotifyStatus', () => {
	const order = { id: 'order1', email: 'max@example.com' } as any;

	it('shows the masked address only when the server sends e-mail', async () => {
		const pb = fakePb({ getFirstListItem: vi.fn() });
		expect(await getGuestNotifyStatus(pb, order, { notifyMail: true, telegramBot: '' })).toEqual({
			email: 'm•••@example.com',
			telegram: null
		});
		expect(
			(await getGuestNotifyStatus(pb, order, { notifyMail: false, telegramBot: '' })).email
		).toBe('');
		expect(pb.collection).not.toHaveBeenCalled();
	});

	it('tells whether a Telegram chat is linked', async () => {
		const settings = { notifyMail: true, telegramBot: 'cozy_test_bot' };
		const linked = fakePb({ getFirstListItem: vi.fn(async () => ({ tg_chat: '777' })) });
		expect((await getGuestNotifyStatus(linked, order, settings)).telegram).toEqual({
			bot: 'cozy_test_bot',
			connected: true
		});
		const none = fakePb({ getFirstListItem: vi.fn().mockRejectedValue(notFound) });
		expect((await getGuestNotifyStatus(none, order, settings)).telegram?.connected).toBe(false);
	});
});

describe('getBookingSettings', () => {
	it('passes on what PocketBase can send, and only a plausible bot name', async () => {
		const settings = (record: object) =>
			getBookingSettings(fakePb({ getOne: vi.fn(async () => record) }));
		expect(await settings({ notify_mail: true, telegram_bot: 'cozy_test_bot' })).toMatchObject({
			notifyMail: true,
			telegramBot: 'cozy_test_bot'
		});
		expect((await settings({ telegram_bot: 'evil.com/x?' })).telegramBot).toBe('');
		expect(await settings({})).toMatchObject({ notifyMail: false, telegramBot: '' });
	});
});

describe('room page: Telegram actions', () => {
	let adminService: Record<string, any>;
	let locals: any;

	beforeEach(() => {
		adminService = {
			getFirstListItem: vi.fn(),
			create: vi.fn(async () => ({})),
			update: vi.fn(async () => ({}))
		};
		locals = {
			pb: fakePb({ getOne: vi.fn(async () => ({ telegram_bot: 'cozy_test_bot' })) }),
			adminPb: fakePb(adminService),
			orderNumber: 'TEST-CODE'
		};
	});

	it('sends the guest to Telegram with a one-time link', async () => {
		adminService.getFirstListItem
			.mockResolvedValueOnce({ id: 'order1', order_number: 'TEST-CODE' }) // ticket (hash lookup)
			.mockRejectedValueOnce(notFound); // no notification record yet
		const outcome = await (roomActions.connectTelegram as any)({ locals }).catch((e: any) => e);
		expect(outcome.status).toBe(303);
		expect(outcome.location).toMatch(/^https:\/\/t\.me\/cozy_test_bot\?start=/);
		expect(adminService.create).toHaveBeenCalledWith(expect.objectContaining({ order: 'order1' }));
	});

	it('refuses without a ticket, or when the server has no bot', async () => {
		expect(
			(await (roomActions.connectTelegram as any)({ locals: { ...locals, orderNumber: null } }))
				.status
		).toBe(401);
		locals.pb = fakePb({ getOne: vi.fn(async () => ({ telegram_bot: '' })) });
		expect((await (roomActions.connectTelegram as any)({ locals })).status).toBe(400);
	});

	it('turns Telegram updates off', async () => {
		adminService.getFirstListItem
			.mockResolvedValueOnce({ id: 'order1', order_number: 'TEST-CODE' })
			.mockResolvedValueOnce({ id: 'n1', tg_chat: '777' });
		expect(await (roomActions.disconnectTelegram as any)({ locals })).toEqual({
			success: true,
			telegramDisconnected: true
		});
		expect(adminService.update).toHaveBeenCalledWith(
			'n1',
			expect.objectContaining({ tg_chat: '' })
		);
	});
});

describe('logAdminEvent', () => {
	it('records who did what', async () => {
		const create = vi.fn(async () => ({}));
		await logAdminEvent(
			fakePb({ create }),
			{ id: 'a', email: 'max@mauersegler.art', name: 'Max', role: 'superuser', isSuperuser: true },
			'bookings_cleared',
			'',
			{ released: 3 }
		);
		expect(create).toHaveBeenCalledWith({
			action: 'bookings_cleared',
			actor: 'max@mauersegler.art',
			subject: '',
			details: { released: 3 }
		});
	});

	it('never fails the action it reports on', async () => {
		const create = vi.fn(async () => {
			throw new Error('PocketBase is down');
		});
		const log = vi.spyOn(console, 'error').mockImplementation(() => {});
		await expect(
			logAdminEvent(fakePb({ create }), null, 'template_imported', 'Camp', {})
		).resolves.toBeUndefined();
		log.mockRestore();
	});
});
