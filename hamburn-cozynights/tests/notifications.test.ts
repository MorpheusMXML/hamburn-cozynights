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
import { loadHookModule } from './hook-module';

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

// --- the delivery lock (pb_hooks/lib/notify.js) -------------------------------
//
// Delivery runs in PocketBase, so this drives the hook module directly with an
// in-memory stand-in for the JSVM's `app`. Real sending is covered by
// tests/integration/notifications.test.ts; what is checked here is what that
// stack can't provoke on purpose: a send that outlives the delivery lock.

type HookRow = Record<string, any>;

/** A PocketBase record as the JSVM hands it to a hook: getters, set, save-back. */
function hookRecord(collection: string, row: HookRow) {
	const draft: HookRow = { ...row };
	return {
		id: draft.id,
		raw: draft,
		getString: (field: string) => String(draft[field] ?? ''),
		getBool: (field: string) => !!draft[field],
		getInt: (field: string) => Number(draft[field] ?? 0),
		set: (field: string, value: unknown) => {
			draft[field] = value;
		},
		collection: () => ({ id: collection, name: collection }),
		original: () => hookRecord(collection, row)
	};
}

/** `due != '' && due <= @now`, `order = {:order}` — the filters delivery uses. */
function hookMatches(row: HookRow, filter: string, params: HookRow, now: number): boolean {
	return filter.split('&&').every((clause) => {
		const match = /^\s*(\w+)\s*(!=|<=|=)\s*(.+?)\s*$/.exec(clause);
		if (!match) throw new Error(`fake app: unsupported filter clause "${clause}"`);
		const [, field, op, rawWanted] = match;
		const have = String(row[field] ?? '');
		if (rawWanted === '@now') {
			if (op !== '<=') throw new Error(`fake app: @now with "${op}"`);
			return !!have && Date.parse(have.replace(' ', 'T')) <= now;
		}
		const wanted = rawWanted.startsWith('{:')
			? String(params[rawWanted.slice(2, -1)] ?? '')
			: rawWanted.replace(/^(['"])(.*)\1$/, '$2');
		return op === '=' ? have === wanted : have !== wanted;
	});
}

function fakeHookApp(tables: Record<string, HookRow[]>) {
	const store = new Map<string, unknown>();
	const sent: { to: string; subject: string }[] = [];
	const rows = (name: string) => (tables[name] ??= []);
	const app: any = {
		sent,
		findRecordById(collection: string, id: string) {
			const row = rows(collection).find((r) => r.id === id);
			if (!row) throw new Error(`${collection}/${id} not found`);
			return hookRecord(collection, row);
		},
		findRecordsByFilter(
			collection: string,
			filter: string,
			_sort: string,
			limit: number,
			_offset: number,
			params: HookRow = {}
		) {
			return rows(collection)
				.filter((row) => hookMatches(row, filter, params, Date.now()))
				.slice(0, limit || undefined)
				.map((row) => hookRecord(collection, row));
		},
		runInTransaction(fn: (tx: unknown) => void) {
			fn(app);
		},
		save(record: { id: string; raw: HookRow; collection: () => { name: string } }) {
			const row = rows(record.collection().name).find((r) => r.id === record.id);
			if (row) Object.assign(row, record.raw);
		},
		delete: () => {},
		store: () => ({
			get: (key: string) => store.get(key),
			set: (key: string, value: unknown) => store.set(key, value),
			setFunc: (key: string, fn: (old: unknown) => unknown) => store.set(key, fn(store.get(key)))
		}),
		settings: () => ({
			smtp: { enabled: true, host: 'smtp.test' },
			meta: {
				senderAddress: 'camp@cozy.test',
				senderName: 'CozyNights',
				appURL: 'https://cozy.test'
			}
		}),
		newMailClient: () => ({
			send: (message: { to: { address: string }[]; subject: string }) => {
				sent.push({ to: message.to[0].address, subject: message.subject });
				app.onSend?.();
			}
		}),
		onSend: null as null | (() => void)
	};
	return app;
}

describe('guest delivery does not send twice when a send outlives the lock', () => {
	const notify = loadHookModule('lib/notify.js', {
		MailerMessage: class {
			constructor(fields: Record<string, unknown>) {
				Object.assign(this, fields);
			}
		}
	});
	const cfg = {
		appUrl: 'https://cozy.test',
		label: '',
		mail: { enabled: true, replyTo: '' },
		telegram: { token: '', chatId: '', threadId: '', apiBase: '', guests: false },
		mailsPerMinute: 20,
		texts: {}
	};

	/** One ticket with an e-mail, a booked spot and a delivery that is due now. */
	function camp() {
		const due = new Date(Date.now() - 1000).toISOString().replace('T', ' ');
		return fakeHookApp({
			orders: [
				{
					id: 'order1',
					email: 'guest@example.com',
					customer_name: 'Ada',
					order_number: 'TICKET-1',
					pass_code: 'AAAABBBBCCCC'
				}
			],
			beds: [{ id: 'bed1', order: 'order1', label: 'B1', room: 'room1' }],
			rooms: [{ id: 'room1', name: 'Dorm', room_number: 1, house: 'house1' }],
			houses: [{ id: 'house1', name: 'Villa' }],
			special_requests: [],
			guest_notify: [{ id: 'n1', order: 'order1', due, attempts: 0 }]
		});
	}

	it('leases the record before the first send, so the next run skips it', () => {
		const app = camp();
		// The lock is gone by the time the send returns, and the run that takes
		// over goes looking for due records — exactly what the cron job does.
		let takeovers = 0;
		app.onSend = () => {
			if (takeovers++ > 0) return;
			notify.deliverDue(app, cfg, false, 0, () => true);
		};

		notify.deliverDue(app, cfg, false, 0, () => true);

		expect(app.sent).toHaveLength(1);
		expect(app.sent[0]).toMatchObject({ to: 'guest@example.com' });
		// Delivered: nothing is due any more, and the lease is gone with it.
		expect(app.findRecordById('guest_notify', 'n1').getString('due')).toBe('');
	});

	it('holds the record for minutes, not seconds, while the send runs', () => {
		const app = camp();
		let leaseDuringSend = '';
		app.onSend = () => {
			leaseDuringSend = app.findRecordById('guest_notify', 'n1').getString('due');
		};

		notify.deliverDue(app, cfg, false, 0, () => true);

		const heldFor = Date.parse(leaseDuringSend.replace(' ', 'T')) - Date.now();
		expect(heldFor).toBeGreaterThan(60_000);
		expect(app.sent).toHaveLength(1);
	});

	it('sends nothing once the loop has lost its lock', () => {
		const app = camp();
		const before = app.findRecordById('guest_notify', 'n1').getString('due');

		notify.deliverDue(app, cfg, false, 0, () => false);

		expect(app.sent).toHaveLength(0);
		// Untouched, so the next run picks it up straight away.
		expect(app.findRecordById('guest_notify', 'n1').getString('due')).toBe(before);
	});
});

describe('a release the crew keeps quiet (pb_hooks/lib/notify.js, setQuiet)', () => {
	const notify = loadHookModule('lib/notify.js');

	/** A ticket that was told about bed1, which is free again now. */
	function toldThenReleased() {
		return fakeHookApp({
			orders: [{ id: 'order1', email: 'guest@example.com' }],
			beds: [{ id: 'bed1', order: '', label: 'B1', room: 'room1' }],
			rooms: [{ id: 'room1', name: 'Dorm', room_number: 1, house: 'house1' }],
			houses: [{ id: 'house1', name: 'Villa' }],
			guest_notify: [
				{
					id: 'n1',
					order: 'order1',
					due: '',
					mail_to: 'guest@example.com',
					mail_spot: 'bed1',
					mail_label: 'B1 · Dorm #1 · Villa',
					tg_spot: 'bed1',
					tg_label: 'B1 · Dorm #1 · Villa'
				}
			]
		});
	}
	const stored = (app: any) => app.findRecordById('guest_notify', 'n1');

	it('queues nothing and takes the new state as told', () => {
		const app = toldThenReleased();
		notify.setQuiet(app, 60);
		expect(notify.isQuiet(app)).toBe(true);

		notify.markDue(app, 'order1');

		expect(stored(app).getString('due')).toBe('');
		// so a booking at the next opening is "booked", not "changed" from B1
		expect(stored(app).getString('mail_spot')).toBe('');
		expect(stored(app).getString('tg_spot')).toBe('');
	});

	it('queues as usual again once it has ended', () => {
		const app = toldThenReleased();
		notify.setQuiet(app, 60);
		notify.setQuiet(app, 0);
		expect(notify.isQuiet(app)).toBe(false);

		notify.markDue(app, 'order1');

		expect(stored(app).getString('due')).not.toBe('');
		expect(stored(app).getString('mail_spot')).toBe('bed1'); // still to be told
	});

	it('creates nothing for a ticket that was never told anything', () => {
		const app = fakeHookApp({ orders: [{ id: 'order2', email: 'new@example.com' }] });
		notify.setQuiet(app, 60);
		notify.markDue(app, 'order2');
		expect(app.findRecordsByFilter('guest_notify', "order = 'order2'", '', 0, 0)).toHaveLength(0);
	});

	it('does not count a ticket that was passed on as told', () => {
		// deliverOne remembers a hand-over per address (mail_to / mail_handover)
		// and has a branch that records both WITHOUT sending. The quiet path must
		// not do that, or the new holder would never get their own text.
		const app = fakeHookApp({
			orders: [
				{
					id: 'order1',
					email: 'new-holder@example.com',
					handed_over_at: '2026-09-20 10:00:00.000Z'
				}
			],
			beds: [{ id: 'bed1', order: '', label: 'B1', room: 'room1' }],
			guest_notify: [
				{
					id: 'n1',
					order: 'order1',
					due: new Date().toISOString().replace('T', ' '),
					mail_to: 'old-holder@example.com',
					mail_spot: 'bed1',
					mail_handover: ''
				}
			]
		});

		notify.setQuiet(app, 60);
		notify.markDue(app, 'order1');

		const rec = app.findRecordById('guest_notify', 'n1');
		expect(rec.getString('due')).toBe('');
		expect(rec.getString('mail_spot')).toBe('');
		// Untouched: the new address has still been told nothing at all.
		expect(rec.getString('mail_to')).toBe('old-holder@example.com');
		expect(rec.getString('mail_handover')).toBe('');
	});

	it('lasts ten minutes at most, whatever is asked for', () => {
		const app = fakeHookApp({});
		const until = notify.setQuiet(app, 86_400);
		expect(until - Date.now()).toBeLessThanOrEqual(600_000);
		expect(until - Date.now()).toBeGreaterThan(590_000);
		expect(notify.setQuiet(app, -5)).toBe(0);
		expect(notify.setQuiet(app, 'nonsense')).toBe(0);
	});
});

describe('a delivery that fails after its lease', () => {
	const notify = loadHookModule('lib/notify.js', {
		MailerMessage: class {
			constructor(fields: Record<string, unknown>) {
				Object.assign(this, fields);
			}
		}
	});
	const cfg = {
		appUrl: 'https://cozy.test',
		label: '',
		mail: { enabled: true, replyTo: '' },
		telegram: { token: '', chatId: '', threadId: '', apiBase: '', guests: false },
		mailsPerMinute: 20,
		texts: {}
	};

	it('still records the error and waits before the next try', () => {
		const due = new Date(Date.now() - 1000).toISOString().replace('T', ' ');
		const app = fakeHookApp({
			orders: [{ id: 'order1', email: 'guest@example.com', pass_code: 'AAAABBBBCCCC' }],
			beds: [{ id: 'bed1', order: 'order1', label: 'B1', room: 'room1' }],
			guest_notify: [{ id: 'n1', order: 'order1', due, attempts: 0 }]
		});
		// The first save is the lease; the second, the closing write, fails the
		// way a database hiccup would, after the mail went out.
		const save = app.save;
		let saves = 0;
		app.save = (record: any) => {
			if (++saves === 2) throw new Error('database hiccup');
			return save(record);
		};

		notify.deliverDue(app, cfg, false, 0, () => true);

		const stored = app.findRecordById('guest_notify', 'n1');
		expect(stored.getString('last_error')).toContain('database hiccup');
		const wait = Date.parse(stored.getString('due').replace(' ', 'T')) - Date.now();
		expect(wait).toBeGreaterThan(60_000); // not again on the next pass
	});
});
