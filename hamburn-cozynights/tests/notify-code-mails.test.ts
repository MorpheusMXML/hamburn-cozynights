// tests/notify-code-mails.test.ts — "send me my code" (pb_hooks/lib/notify.js,
// deliverCodeMails): a guest who mistyped their ticket code asked the start
// page to mail it, and the app added a code_mails row (src/lib/server/
// code-mail.ts). PocketBase mails the codes of every paid ticket of that
// address, once: leased like every guest message, retried a few times, and
// the rows go after two days. Driven outside PocketBase with an in-memory
// stand-in for the JSVM's `app`. Also here: the crew line when the start page
// sees too many wrong codes (eventText, sign_in_guard).
import { describe, expect, it } from 'vitest';
import { loadHookModule } from './hook-module';

type Row = Record<string, any>;

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const pbDate = (ms: number) => new Date(ms).toISOString().replace('T', ' ');
const toMs = (value: string) => Date.parse(value.replace(' ', 'T'));

/** A record as the JSVM hands it out: a copy that app.save() writes back. */
function record(collection: string, row: Row) {
	const draft: Row = { ...row };
	return {
		id: draft.id as string,
		raw: draft,
		get: (field: string) => draft[field],
		getString: (field: string) => String(draft[field] ?? ''),
		getBool: (field: string) => !!draft[field],
		getInt: (field: string) => Number(draft[field] ?? 0),
		set: (field: string, value: unknown) => {
			draft[field] = value;
		},
		collection: () => ({ id: collection, name: collection })
	};
}
type HookRecord = ReturnType<typeof record>;

/**
 * The filters delivery writes: =, != and ~ (SQL's LIKE: a substring, any
 * case), < and <= on dates, @now, {:params} — joined by &&.
 */
function matches(row: Row, filter: string, params: Row): boolean {
	return filter.split('&&').every((clause) => {
		const match = /^\s*(\w+)\s*(!=|<=|<|=|~)\s*(.+?)\s*$/.exec(clause);
		if (!match) throw new Error(`fake app: unsupported filter clause "${clause}"`);
		const [, field, op, raw] = match;
		let wanted: unknown;
		if (raw === '@now') wanted = pbDate(Date.now());
		else if (raw.startsWith('{:')) wanted = params[raw.slice(2, -1)];
		else if (raw === 'true' || raw === 'false') wanted = raw === 'true';
		else wanted = raw.replace(/^(['"])(.*)\1$/, '$2');
		const have = row[field] ?? (typeof wanted === 'boolean' ? false : '');
		if (op === '=') return have === wanted;
		if (op === '!=') return have !== wanted;
		if (op === '~') return String(have).toLowerCase().includes(String(wanted).toLowerCase());
		if (!have) return false;
		return op === '<'
			? toMs(String(have)) < toMs(String(wanted))
			: toMs(String(have)) <= toMs(String(wanted));
	});
}

type SentMail = { to: string; subject: string; text: string; html: string };

/** The JSVM's `app` over rows per collection; a collection that isn't given doesn't exist. */
function fakeApp(tables: Record<string, Row[]>) {
	const store = new Map<string, unknown>();
	const sent: SentMail[] = [];
	const rows = (name: string) => {
		if (!tables[name]) throw new Error(`no such collection: ${name}`);
		return tables[name];
	};
	const app: any = {
		sent,
		onSend: null as null | (() => void),
		failSend: null as null | (() => Error),
		findRecordById(collection: string, id: string) {
			const row = rows(collection).find((r) => r.id === id);
			if (!row) throw new Error(`${collection}/${id} not found`);
			return record(collection, row);
		},
		findRecordsByFilter(
			collection: string,
			filter: string,
			sort: string,
			limit: number,
			_offset: number,
			params: Row = {}
		) {
			let found = rows(collection).filter((row) => matches(row, filter, params));
			if (sort) {
				const desc = sort.startsWith('-');
				const key = sort.replace(/^[-+]/, '');
				found = [...found].sort(
					(a, b) => String(a[key] ?? '').localeCompare(String(b[key] ?? '')) * (desc ? -1 : 1)
				);
			}
			return found.slice(0, limit || undefined).map((row) => record(collection, row));
		},
		findAllRecords(collection: string) {
			return rows(collection).map((row) => record(collection, row));
		},
		runInTransaction(fn: (tx: unknown) => void) {
			fn(app);
		},
		save(rec: HookRecord) {
			const row = rows(rec.collection().name).find((r) => r.id === rec.id);
			if (row) Object.assign(row, rec.raw);
		},
		delete(rec: HookRecord) {
			const list = rows(rec.collection().name);
			const index = list.findIndex((r) => r.id === rec.id);
			if (index >= 0) list.splice(index, 1);
		},
		store: () => ({
			get: (key: string) => store.get(key),
			set: (key: string, value: unknown) => store.set(key, value),
			setFunc: (key: string, fn: (old: unknown) => unknown) => store.set(key, fn(store.get(key))),
			remove: (key: string) => store.delete(key)
		}),
		settings: () => ({
			smtp: { enabled: true, host: 'smtp.test' },
			meta: { senderAddress: 'camp@cozy.test', senderName: 'CozyNights', appURL: '' }
		}),
		newMailClient: () => ({
			send: (message: {
				to: { address: string }[];
				subject: string;
				text: string;
				html: string;
			}) => {
				if (app.failSend) throw app.failSend();
				sent.push({
					to: message.to[0].address,
					subject: message.subject,
					text: message.text,
					html: message.html
				});
				app.onSend?.();
			}
		})
	};
	return app;
}

const MailerMessage = class {
	constructor(fields: Record<string, unknown>) {
		Object.assign(this, fields);
	}
};
const notify = loadHookModule('lib/notify.js', { MailerMessage });

const cfg = {
	appUrl: 'https://cozy.test',
	label: '',
	mail: { enabled: true, replyTo: '' },
	telegram: { token: '', chatId: '', threadId: '', apiBase: '', guests: false },
	mailsPerMinute: 20,
	texts: {}
};

/** Ada has two paid tickets (her address typed two ways) and one unpaid; Nada's address contains hers. */
const tickets = (): Row[] => [
	{ id: 'o1', order_number: 'HB-1001', email: 'ada@example.com', customer_name: 'Ada' },
	{ id: 'o2', order_number: 'HB-1002', email: 'Ada@Example.com', customer_name: 'Ada' },
	{
		id: 'o3',
		order_number: 'HB-1003',
		email: 'ada@example.com',
		customer_name: 'Ada',
		unpaid: true
	},
	{ id: 'o4', order_number: 'HB-1004', email: 'nada@example.com', customer_name: 'Nada' },
	{ id: 'o5', order_number: 'HB-1005', email: 'bo@example.org', customer_name: 'Bo' }
];

let asks = 0;
/**
 * A code_mails row as the app adds it: the address in lower case, due now.
 * The fake app stores this very object, so it shows every write.
 */
function ask(email: string, extra: Row = {}): Row {
	const now = Date.now();
	asks++;
	return {
		id: `cm${asks}`,
		email,
		due: pbDate(now - 1000),
		attempts: 0,
		last_error: '',
		sent: '',
		created: pbDate(now - 1000),
		...extra
	};
}

const deliver = (app: any, settings = cfg, keepAlive = () => true) =>
	notify.deliverCodeMails(app, settings, 0, keepAlive);
const stored = (app: any, id: string) => app.findRecordById('code_mails', id);

describe('a code e-mail a guest asked for', () => {
	it('carries every paid code of the address, goes out once and is stamped sent', () => {
		const row = ask('ada@example.com');
		const app = fakeApp({ orders: tickets(), code_mails: [row] });

		expect(deliver(app)).toEqual({ sent: 1, retry: 0, other: 0 });

		expect(app.sent).toHaveLength(1);
		const [mail] = app.sent as SentMail[];
		expect(mail.to).toBe('ada@example.com');
		expect(mail.subject).toBe('Your CozyNights ticket code');
		expect(mail.text).toContain(
			'Hi Ada,\n\nsomeone — probably you — asked for the ticket code that belongs to this e-mail address:\n\n' +
				'  Ticket code: HB-1001\n  Ticket code: HB-1002\n\n' +
				'To sign in, open https://cozy.test and enter your ticket code.\n' +
				"Didn't ask for it? Then just ignore this e-mail: it came only to you, and nobody can sign in with your ticket without the code."
		);
		expect(mail.html).toContain('<td style="padding:4px 0;font-weight:bold">HB-1002</td>');
		expect(mail.html).toContain('<a href="https://cozy.test" style="color:#7a3cff">');
		// not the unpaid ticket, not the address that only contains hers
		expect(mail.text).not.toContain('HB-1003');
		expect(mail.text).not.toContain('HB-1004');

		const done = stored(app, row.id);
		expect(toMs(done.getString('sent'))).toBeGreaterThan(Date.now() - MINUTE);
		expect(done.getString('due')).toBe('');
		expect(done.getInt('attempts')).toBe(0);

		// sent is sent: the next pass has nothing to do
		expect(deliver(app)).toEqual({ sent: 0, retry: 0, other: 0 });
		expect(app.sent).toHaveLength(1);
	});

	it('greets by name only when every ticket of the address has the same one', () => {
		const orders = tickets();
		orders[1].customer_name = 'Ada Lovelace';
		const app = fakeApp({ orders, code_mails: [ask('ada@example.com')] });
		deliver(app);
		expect(app.sent[0].text).toMatch(/^Hi,\n\nsomeone/);

		// a "name" that carries the code is no name (pb_hooks/lib/tickets.js)
		const nameless = fakeApp({
			orders: [
				{ id: 'o9', order_number: 'X7Q2P', email: 'cy@example.com', customer_name: 'Ticket X7Q2P' }
			],
			code_mails: [ask('cy@example.com')]
		});
		deliver(nameless);
		expect(nameless.sent[0].text).toMatch(/^Hi,\n/);
		expect(nameless.sent[0].text).toContain('  Ticket code: X7Q2P\n');
	});

	it('closes the row without a mail when no paid ticket is left for the address', () => {
		const orders = tickets();
		orders.push({ id: 'o6', order_number: 'HB-1006', email: 'cy@example.com', unpaid: true });
		// Cy's only ticket is unpaid again, Dee's was removed since they asked
		const unpaid = ask('cy@example.com');
		const removed = ask('dee@example.com');
		const app = fakeApp({ orders, code_mails: [unpaid, removed] });

		expect(deliver(app)).toEqual({ sent: 0, retry: 0, other: 2 });

		expect(app.sent).toHaveLength(0);
		for (const id of [unpaid.id, removed.id]) {
			const row = stored(app, id);
			expect(row.getString('due')).toBe('');
			expect(row.getString('sent')).toBe('');
			expect(row.getInt('attempts')).toBe(0);
			expect(row.getString('last_error')).toContain('nothing sent');
		}
	});

	it('never puts more than ten codes into one e-mail', () => {
		const orders = Array.from({ length: 12 }, (_, i) => ({
			id: `t${i}`,
			order_number: `CREW-${String(i).padStart(2, '0')}`,
			email: 'crew@example.com',
			customer_name: 'Crew'
		}));
		const app = fakeApp({ orders, code_mails: [ask('crew@example.com')] });
		deliver(app);
		expect(app.sent[0].text.split('Ticket code:')).toHaveLength(11);
		expect(app.sent[0].text).toContain('CREW-09');
		expect(app.sent[0].text).not.toContain('CREW-10');
	});
});

describe('the mail quota and the delivery lock', () => {
	it('waits for a mail slot without counting an attempt', () => {
		const first = ask('ada@example.com');
		const second = ask('bo@example.org');
		const dueBefore = second.due;
		const app = fakeApp({ orders: tickets(), code_mails: [first, second] });

		expect(deliver(app, { ...cfg, mailsPerMinute: 1 })).toEqual({ sent: 1, retry: 0, other: 1 });

		expect(app.sent.map((m: SentMail) => m.to)).toEqual(['ada@example.com']);
		const waiting = stored(app, second.id);
		expect(waiting.getString('due')).toBe(dueBefore); // still due, for the next pass
		expect(waiting.getInt('attempts')).toBe(0);
		expect(waiting.getString('last_error')).toBe('');

		// the next minute has a slot again
		app.store().remove('cozy_mail_window');
		expect(deliver(app, { ...cfg, mailsPerMinute: 1 })).toEqual({ sent: 1, retry: 0, other: 0 });
		expect(app.sent.map((m: SentMail) => m.to)).toEqual(['ada@example.com', 'bo@example.org']);
	});

	it('holds the row for minutes while the send runs, so a run that takes over sends nothing', () => {
		const row = ask('ada@example.com');
		const app = fakeApp({ orders: tickets(), code_mails: [row] });
		let leaseDuringSend = '';
		let takeovers = 0;
		app.onSend = () => {
			leaseDuringSend = stored(app, row.id).getString('due');
			if (takeovers++ === 0) deliver(app);
		};

		deliver(app);

		expect(app.sent).toHaveLength(1);
		expect(toMs(leaseDuringSend) - Date.now()).toBeGreaterThan(MINUTE);
		expect(stored(app, row.id).getString('sent')).not.toBe('');
	});

	it('sends nothing once the loop has lost its lock', () => {
		const row = ask('ada@example.com');
		const dueBefore = row.due;
		const app = fakeApp({ orders: tickets(), code_mails: [row] });
		deliver(app, cfg, () => false);
		expect(app.sent).toHaveLength(0);
		expect(stored(app, row.id).getString('due')).toBe(dueBefore);
	});
});

describe('a code e-mail that fails', () => {
	it('is retried after 1, 5 and 15 minutes, then given up, the error kept without the address', () => {
		const row = ask('ada@example.com');
		const app = fakeApp({ orders: tickets(), code_mails: [row] });
		// mail servers quote the recipient back
		app.failSend = () => new Error('550 5.1.1 <ada@example.com>: mailbox unavailable');

		for (const [attempt, minutes] of [
			[1, 1],
			[2, 5],
			[3, 15]
		]) {
			expect(deliver(app)).toEqual({ sent: 0, retry: 1, other: 0 });
			const failed = stored(app, row.id);
			expect(failed.getInt('attempts')).toBe(attempt);
			const wait = toMs(failed.getString('due')) - Date.now();
			expect(wait).toBeGreaterThan((minutes - 0.1) * MINUTE);
			expect(wait).toBeLessThanOrEqual(minutes * MINUTE);
			expect(failed.getString('last_error')).toBe(
				'550 5.1.1 <a•••@example.com>: mailbox unavailable'
			);
			// not due before its time…
			expect(deliver(app)).toEqual({ sent: 0, retry: 0, other: 0 });
			// …then the time has come (`row` is the stored row itself)
			row.due = pbDate(Date.now() - 1000);
		}

		expect(deliver(app)).toEqual({ sent: 0, retry: 0, other: 1 });
		const gaveUp = stored(app, row.id);
		expect(gaveUp.getInt('attempts')).toBe(4);
		expect(gaveUp.getString('due')).toBe('');
		expect(gaveUp.getString('sent')).toBe('');
		expect(gaveUp.getString('last_error')).toContain('mailbox unavailable');
		expect(app.sent).toHaveLength(0);
	});
});

describe('housekeeping', () => {
	it('deletes rows older than two days, sent or not', () => {
		const now = Date.now();
		const oldSent = ask('ada@example.com', {
			created: pbDate(now - 3 * DAY),
			sent: pbDate(now - 3 * DAY),
			due: ''
		});
		const oldUnsent = ask('bo@example.org', { created: pbDate(now - 2 * DAY - MINUTE), due: '' });
		const yesterday = ask('ada@example.com', {
			created: pbDate(now - DAY),
			sent: pbDate(now - DAY),
			due: ''
		});
		const app = fakeApp({ orders: tickets(), code_mails: [oldSent, oldUnsent, yesterday] });

		deliver(app);

		expect(app.findAllRecords('code_mails').map((r: HookRecord) => r.id)).toEqual([yesterday.id]);
		expect(app.sent).toHaveLength(0);
	});

	it('leaves due rows alone while this server sends no e-mail, and still tidies up', () => {
		const old = ask('bo@example.org', { created: pbDate(Date.now() - 3 * DAY) });
		const waiting = ask('ada@example.com');
		const dueBefore = waiting.due;
		const app = fakeApp({ orders: tickets(), code_mails: [old, waiting] });

		const off = { ...cfg, mail: { enabled: false, replyTo: '' } };
		expect(deliver(app, off)).toEqual({ sent: 0, retry: 0, other: 0 });

		expect(app.sent).toHaveLength(0);
		expect(app.findAllRecords('code_mails').map((r: HookRecord) => r.id)).toEqual([waiting.id]);
		expect(stored(app, waiting.id).getString('due')).toBe(dueBefore);
	});

	it('does nothing on a database from before code mails', () => {
		const app = fakeApp({ orders: tickets() });
		expect(deliver(app)).toEqual({ sent: 0, retry: 0, other: 0 });
	});
});

describe('in the delivery pass', () => {
	it('goes before the other guest messages: a guest is waiting for it', () => {
		const env: Record<string, string> = {
			COZY_APP_URL: 'https://cozy.test',
			COZY_MAILS_PER_MINUTE: '1'
		};
		const withRuntime = loadHookModule('lib/notify.js', {
			MailerMessage,
			$os: { getenv: (name: string) => env[name] ?? '' },
			$security: { randomString: () => 'owner' }
		});
		const due = pbDate(Date.now() - 1000);
		const app = fakeApp({
			orders: [
				...tickets(),
				{ id: 'o7', order_number: 'HB-1007', email: 'eve@example.net', pass_code: 'AAAABBBBCCCC' }
			],
			beds: [{ id: 'bed1', order: 'o7', label: 'B1', room: 'room1' }],
			rooms: [{ id: 'room1', name: 'Dorm', room_number: 1, house: 'house1' }],
			houses: [{ id: 'house1', name: 'Villa' }],
			special_requests: [],
			message_texts: [],
			// Eve's booking was due first, Ada asked for her code after that
			guest_notify: [{ id: 'n1', order: 'o7', due: pbDate(Date.now() - 60_000), attempts: 0 }],
			code_mails: [ask('ada@example.com', { due })]
		});

		const result = withRuntime.flush(app, false);

		expect(app.sent.map((m: SentMail) => m.subject)).toEqual(['Your CozyNights ticket code']);
		expect(result.codes).toEqual({ sent: 1, retry: 0, other: 0 });
		// the booking waits for the next minute's slot
		expect(result.guests).toEqual({ done: 0, retry: 0, other: 1 });
	});
});

describe('the code e-mail as a message text', () => {
	it('is in the catalogue, uses a changed text, and is in the preview', () => {
		const texts = loadHookModule('lib/texts.js');
		expect(texts.GROUPS.map((g: { id: string }) => g.id)).toContain('mail.code');
		const keys = texts.TEXTS.filter((e: { group: string }) => e.group === 'mail.code').map(
			(e: { key: string }) => e.key
		);
		expect(keys).toEqual([
			'mail.code.subject',
			'mail.code.intro',
			'mail.code.signin',
			'mail.code.ignore'
		]);

		const custom = { ...cfg, texts: { 'mail.code.signin': 'Sign in here: {appUrl}' } };
		const m = notify.codeMail(custom, '', ['HB-1001']);
		expect(m.text).toMatch(/^Hi,\n/);
		expect(m.text).toContain('Sign in here: https://cozy.test');
		expect(m.html).toContain('Sign in here: <a href="https://cozy.test"');

		const preview = notify.previewMessages(cfg);
		const sample = preview.mail.find((mail: { id: string }) => mail.id === 'code');
		expect(sample.subject).toBe('Your CozyNights ticket code');
		expect(sample.text).toContain('  Ticket code: HB-1001\n  Ticket code: HB-1002\n');
		expect(sample.html).not.toContain('<img');
	});

	it('names the booking page without a configured address', () => {
		const m = notify.codeMail({ ...cfg, appUrl: '' }, 'Ada', ['HB-1001']);
		expect(m.text).toContain('To sign in, open the booking page and enter your ticket code.');
	});
});

describe('the crew chat', () => {
	const event = (action: string, details: object) => ({
		getString: (field: string) =>
			({ action, actor: 'guest', subject: '', details: JSON.stringify(details) })[field] ?? ''
	});

	it('hears when the start page asks for the e-mail address as well', () => {
		const text = notify.eventText(
			event('sign_in_guard', { failures: 213, minutes: 10, lockMinutes: 30 })
		);
		expect(text).toBe(
			"🚨 Many wrong ticket codes: 213 within 10 minutes. For the next 30 minutes the start page asks for the ticket's e-mail address as well."
		);
		expect(text).not.toContain('guest');
	});
});
