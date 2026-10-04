// tests/integration/special-needs.test.ts — special-needs requests against a
// real PocketBase (migration 1759200000, pb_hooks/cozy_notify.pb.js,
// pb_hooks/lib/notify.js): who may read them, one per ticket, the messages to
// the guest and the crew (never what the guest wrote), the requests switch
// and the cleanup after the event. The app side is used like the app does,
// through $lib/server/special-requests with the service account.
// Request groups (migration 1760550000, pb_hooks/cozy_groups.pb.js) through
// $lib/server/request-groups: closed to the API, a group goes with its last
// member whichever way it leaves, each member hears only about their own
// request, forget-contacts takes the groups too.
import { describe, it, expect, beforeAll } from 'vitest';
import crypto from 'crypto';
import { spawnSync } from 'child_process';
import path from 'path';
import type PocketBase from 'pocketbase';
import { APP_SETTINGS_ID } from '../../src/lib/server/constants';
import { PASS_ALPHABET } from '../../src/lib/pass';
import {
	assignSpot,
	decideRequest,
	saveRequest,
	withdrawRequest
} from '../../src/lib/server/special-requests';
import {
	decideGroup,
	leaveGroup,
	removeFromGroup,
	saveGuestRequest
} from '../../src/lib/server/request-groups';
import { formatGroupCode, type RequestInput } from '../../src/lib/special-needs';
import {
	anonymous,
	cozyAdmin,
	createAdmin,
	expectRefused,
	seedHouse,
	seedTicket,
	serviceAccount,
	uid
} from '../stack-helpers';

const MOCK_URL = process.env.MOCK_URL || '';
const MAILPIT_URL = process.env.MAILPIT_URL || '';
const CREW_CHAT = '-1001234567890'; // docker-compose.test.yml
const APP_URL = `http://127.0.0.1:${process.env.TEST_APP_PORT || '3290'}`;

const SECRET_TEXT = 'Wheelchair user, I need step-free access to the room.';
const INPUT: RequestInput = {
	needs: ['step_free'],
	text: SECRET_TEXT,
	burnerName: 'Rolling Thunder',
	consent: true,
	group: { mode: 'none' }
};
const ADMIN = {
	id: 'a1',
	email: 'crew-lead@mauersegler.art',
	name: 'Crew Lead',
	role: 'admin' as const,
	isSuperuser: false
};

let su: PocketBase;

beforeAll(async () => {
	if (!MOCK_URL || !MAILPIT_URL) {
		throw new Error('MOCK_URL / MAILPIT_URL are not set — run with `npm run test:integration`.');
	}
	su = await serviceAccount();
});

// --- helpers (like tests/integration/notifications.test.ts) -------------------------

async function flush() {
	return su.send('/api/cozy/notify/flush?force=1', { method: 'POST' });
}

async function mock(route: string, body?: unknown) {
	const res = await fetch(MOCK_URL + route, {
		method: body === undefined ? 'GET' : 'POST',
		headers: { 'content-type': 'application/json' },
		body: body === undefined ? undefined : JSON.stringify(body)
	});
	return res.json();
}

async function telegramTo(chat: string | number): Promise<{ text: string }[]> {
	const sent: { chat_id: string; text: string }[] = await mock('/_mock/telegram/sent');
	return sent.filter((m) => m.chat_id === String(chat));
}

type Mail = { ID: string; Subject: string };
async function mailsTo(address: string): Promise<Mail[]> {
	const res = await fetch(
		`${MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:"${address}"`)}`
	);
	return [...((await res.json()).messages || [])].reverse();
}

async function mailBody(id: string): Promise<{ Text: string; HTML: string }> {
	return (await fetch(`${MAILPIT_URL}/api/v1/message/${id}`)).json();
}

async function guestWithEmail() {
	const ticket = await seedTicket(su);
	const email = `special-${uid()}@example.com`;
	const name = `Guest ${uid()}`;
	await su.collection('orders').update(ticket.order.id, { email, customer_name: name });
	return { ...ticket, email, name };
}

async function notifyRecord(orderId: string) {
	return su
		.collection('guest_notify')
		.getFirstListItem(su.filter('order = {:orderId}', { orderId }))
		.catch(() => null);
}

async function requestOf(orderId: string) {
	return su
		.collection('special_requests')
		.getFirstListItem(su.filter('order = {:orderId}', { orderId }))
		.catch(() => null);
}

async function specialBed() {
	const { house, room, beds } = await seedHouse(su, 1);
	await su.collection('beds').update(beds[0].id, { is_special: true });
	return { house, room, bed: beds[0] };
}

async function crewTexts(): Promise<string> {
	return (await telegramTo(CREW_CHAT)).map((m) => m.text).join('\n---\n');
}

const GROUP_NAME = 'Glitter Dome Workshop';

/** A code no group has (yet): for groups written straight into the database. */
function randomCode(): string {
	return Array.from(
		{ length: 8 },
		() => PASS_ALPHABET[crypto.randomInt(PASS_ALPHABET.length)]
	).join('');
}

/** The guest starts a group with their request, through the app. */
async function startGroup(order: { id: string }, name = GROUP_NAME, input: RequestInput = INPUT) {
	const outcome = await saveGuestRequest(su as any, order, {
		...input,
		group: { mode: 'start', name }
	});
	expect(outcome).toEqual({ saved: 'created', group: 'started' });
	const request = await requestOf(order.id);
	const group = await su.collection('request_groups').getOne(request!.request_group);
	return { request: request!, group };
}

/** Joins with nothing of their own, like a member of a project. */
async function joinGroup(order: { id: string }, code: string, burnerName = '') {
	const outcome = await saveGuestRequest(su as any, order, {
		needs: [],
		text: '',
		burnerName,
		consent: true,
		group: { mode: 'join', code }
	});
	expect(outcome.group).toBe('joined');
	return (await requestOf(order.id))!;
}

async function groupExists(id: string): Promise<boolean> {
	return su
		.collection('request_groups')
		.getOne(id)
		.then(
			() => true,
			() => false
		);
}

// --- storage -------------------------------------------------------------------------

describe('special-needs requests in the database', () => {
	it('are for the service account only: guests and admins get nothing through the API', async () => {
		const guest = await seedTicket(su);
		await saveRequest(su as any, guest.order as any, INPUT);
		const { client } = await createAdmin(su, 'admin');

		for (const pb of [anonymous(), client]) {
			await expectRefused(pb.collection('special_requests').getFullList());
			const listed = await pb
				.collection('special_requests')
				.getList(1, 50)
				.catch(() => ({ items: [] }));
			expect(listed.items).toHaveLength(0);
			await expectRefused(
				pb.collection('special_requests').create({
					order: guest.order.id,
					status: 'approved',
					consent_at: new Date().toISOString()
				})
			);
		}
	});

	it("hold the guest's words only encrypted", async () => {
		const guest = await seedTicket(su);
		await saveRequest(su as any, guest.order as any, INPUT);
		const stored = await requestOf(guest.order.id);
		expect(stored?.status).toBe('pending');
		expect(JSON.stringify(stored)).not.toContain('Wheelchair');
		expect(JSON.stringify(stored)).not.toContain('Rolling Thunder');
		expect(JSON.stringify(stored)).not.toContain('step_free');
		expect(stored?.consent_at).toBeTruthy();
	});

	it('allow one request per ticket and go with the ticket', async () => {
		const guest = await seedTicket(su);
		await saveRequest(su as any, guest.order as any, INPUT);
		await expectRefused(
			su.collection('special_requests').create({
				order: guest.order.id,
				status: 'pending',
				consent_at: new Date().toISOString()
			})
		);

		await su.collection('orders').delete(guest.order.id);
		expect(await requestOf(guest.order.id)).toBeNull();
	});

	it('let a booked bed be deleted (room removed, template import): the request forgets it', async () => {
		const guest = await seedTicket(su);
		const { room, bed } = await specialBed();
		await saveRequest(su as any, guest.order as any, INPUT);
		const request = await requestOf(guest.order.id);
		await assignSpot(su as any, ADMIN, request!.id, bed.id);
		expect((await requestOf(guest.order.id))?.bed).toBe(bed.id);

		await su.collection('rooms').delete(room.id); // its beds go with it
		const after = await requestOf(guest.order.id);
		expect(after?.status).toBe('approved');
		expect(after?.bed).toBe('');
	});

	it('mark beds as special-needs spots, normal by default', async () => {
		const { beds } = await seedHouse(su, 1);
		expect(beds[0].is_special).toBe(false);
		const settings = await su.collection('app_settings').getOne(APP_SETTINGS_ID);
		expect(typeof settings.special_requests_open).toBe('boolean');
	});
});

describe('request groups in the database', () => {
	it('are for the service account only: guests and admins get nothing through the API', async () => {
		const lead = await seedTicket(su);
		const { group } = await startGroup(lead.order);
		const { client } = await createAdmin(su, 'admin');

		for (const pb of [anonymous(), client]) {
			await expectRefused(pb.collection('request_groups').getFullList());
			const listed = await pb
				.collection('request_groups')
				.getList(1, 50)
				.catch(() => ({ items: [] }));
			expect(listed.items).toHaveLength(0);
			await expectRefused(pb.collection('request_groups').getOne(group.id));
			await expectRefused(
				pb.collection('request_groups').create({ code: randomCode(), name: 'Sneaky' })
			);
			await expectRefused(pb.collection('request_groups').delete(group.id));
		}
		expect(await groupExists(group.id)).toBe(true);
	});

	it('hold the name only encrypted, and every code once', async () => {
		const lead = await seedTicket(su);
		const { request, group } = await startGroup(lead.order);
		expect(request.request_group).toBe(group.id);
		expect(group.code).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/);
		expect(group.name).not.toBe(GROUP_NAME);
		expect(JSON.stringify(group)).not.toContain('Glitter');

		// the unique index and the alphabet hold even for the service account
		await expectRefused(su.collection('request_groups').create({ code: group.code, name: 'x' }));
		await expectRefused(
			su.collection('request_groups').create({ code: group.code.toLowerCase(), name: 'x' })
		);
		await expectRefused(su.collection('request_groups').create({ code: 'ABCD0FGH', name: 'x' }));
	});

	it('go when the last member withdraws, and stay while someone is in them', async () => {
		const lead = await seedTicket(su);
		const member = await seedTicket(su);
		const { group } = await startGroup(lead.order);
		await joinGroup(member.order, group.code);

		expect(await withdrawRequest(su as any, member.order.id)).toBe(true);
		expect(await groupExists(group.id)).toBe(true);
		expect(await withdrawRequest(su as any, lead.order.id)).toBe(true);
		expect(await groupExists(group.id)).toBe(false);
	});

	it('go with the ticket of their last member (cascade)', async () => {
		const lead = await seedTicket(su);
		const { request, group } = await startGroup(lead.order);
		await su.collection('orders').delete(lead.order.id);
		expect(await requestOf(lead.order.id)).toBeNull();
		await expect(su.collection('special_requests').getOne(request.id)).rejects.toMatchObject({
			status: 404
		});
		expect(await groupExists(group.id)).toBe(false);
	});

	it('go when the last request is taken out of them; the requests stay', async () => {
		const lead = await seedTicket(su);
		const member = await seedTicket(su);
		const { request, group } = await startGroup(lead.order);
		const joined = await joinGroup(member.order, group.code, 'Second Spark');

		// the lead has needs of their own: leaving unlinks the request
		expect(await leaveGroup(su as any, lead.order.id)).toEqual({ outcome: 'left', members: 1 });
		expect(await groupExists(group.id)).toBe(true);
		expect((await su.collection('special_requests').getOne(request.id)).request_group).toBe('');

		// a plain update of the relation (the dashboard, a script) prunes too
		await su.collection('special_requests').update(joined.id, { request_group: '' });
		expect(await groupExists(group.id)).toBe(false);
		const kept = await su.collection('special_requests').getOne(joined.id);
		expect(kept).toMatchObject({ status: 'pending', request_group: '' });
	});

	it('go when the crew takes the last one out, or when a member leaves with nothing of their own', async () => {
		const lead = await seedTicket(su);
		const member = await seedTicket(su);
		const { request, group } = await startGroup(lead.order);
		await joinGroup(member.order, group.code);

		// nothing ticked: leaving deletes the request, like a withdrawal
		expect(await leaveGroup(su as any, member.order.id)).toEqual({
			outcome: 'withdrawn',
			members: 1
		});
		expect(await requestOf(member.order.id)).toBeNull();
		expect(await groupExists(group.id)).toBe(true);

		await removeFromGroup(su as any, ADMIN, request.id);
		expect(await groupExists(group.id)).toBe(false);
		expect((await requestOf(lead.order.id))?.status).toBe('pending');
	});
});

// --- messages -------------------------------------------------------------------------

describe('messages about a request', () => {
	it('confirm a new request to the guest and tell the crew, without names or what was written', async () => {
		const guest = await guestWithEmail();
		await saveRequest(su as any, guest.order as any, INPUT);
		await flush();

		const mails = await mailsTo(guest.email);
		expect(mails.map((m) => m.Subject)).toEqual(['[TEST] We got your special-needs request']);
		const body = await mailBody(mails[0].ID);
		expect(body.Text).toContain(`${APP_URL}/special-needs`);
		expect(body.Text).not.toContain('Wheelchair');
		expect(body.Text).not.toContain(guest.code);

		const crew = await crewTexts();
		expect(crew).toContain('🧡 New special-needs request');
		expect(crew).toContain(`${APP_URL}/admin/requests`);
		expect(crew).not.toContain('Wheelchair');
		expect(crew).not.toContain(guest.name);
		expect(crew).not.toContain('Rolling Thunder');
	});

	it('send one e-mail when the crew approves and books at once, with the pass, while booking is closed', async () => {
		await su.collection('app_settings').update(APP_SETTINGS_ID, { is_booking_active: false });
		const guest = await guestWithEmail();
		const { house, room, bed } = await specialBed();
		await saveRequest(su as any, guest.order as any, INPUT);
		await flush(); // "We got your request"

		const request = await requestOf(guest.order.id);
		await assignSpot(su as any, ADMIN, request!.id, bed.id);
		await flush();

		const booked = await su.collection('beds').getOne(bed.id);
		expect(booked.order).toBe(guest.order.id);
		const mails = await mailsTo(guest.email);
		expect(mails).toHaveLength(2);
		expect(mails[1].Subject).toBe(
			`[TEST] Your special-needs spot: ${bed.label} · ${room.name} #1 · ${house.name}`
		);
		const body = await mailBody(mails[1].ID);
		expect(body.Text).toContain('the crew approved your special-needs request');
		expect(body.Text).toContain('/pass/');
		expect(body.Text).toContain('please contact the crew to change it');
		expect(body.Text).not.toContain('To change or release it');

		const crew = await crewTexts();
		expect(crew).toContain(`✅ Special-needs request approved by ${ADMIN.email}`);
		expect(crew).toContain(`♿ Special-needs spot booked for a guest by ${ADMIN.email}`);
	});

	it('tell the guest about a decline in plain words', async () => {
		const guest = await guestWithEmail();
		await saveRequest(su as any, guest.order as any, INPUT);
		await flush();
		const request = await requestOf(guest.order.id);
		await decideRequest(su as any, ADMIN, request!.id, 'declined');
		await flush();

		const mails = await mailsTo(guest.email);
		expect(mails.map((m) => m.Subject)).toEqual([
			'[TEST] We got your special-needs request',
			'[TEST] About your special-needs request'
		]);
		expect((await mailBody(mails[1].ID)).Text).toContain(
			'the crew could not offer you a special-needs spot'
		);
		expect(await crewTexts()).toContain(`✋ Special-needs request declined by ${ADMIN.email}`);
	});

	it('stay quiet about a withdrawal, and treat a request sent afterwards as new', async () => {
		const guest = await guestWithEmail();
		await saveRequest(su as any, guest.order as any, INPUT);
		await flush();
		expect(await withdrawRequest(su as any, guest.order.id)).toBe(true);
		await flush();

		expect(await mailsTo(guest.email)).toHaveLength(1);
		expect((await notifyRecord(guest.order.id))?.mail_req).toBe('');
		expect(await crewTexts()).toContain('🧡 A guest withdrew their special-needs request');

		await saveRequest(su as any, guest.order as any, INPUT);
		await flush();
		const mails = await mailsTo(guest.email);
		expect(mails.map((m) => m.Subject)).toEqual([
			'[TEST] We got your special-needs request',
			'[TEST] We got your special-needs request'
		]);
	});

	it('show the request in the Telegram "connected" message and send the decision there', async () => {
		const guest = await seedTicket(su);
		await saveRequest(su as any, guest.order as any, INPUT);
		const chat = 800000 + Math.floor(Math.random() * 100000);
		const token = crypto.randomBytes(24).toString('base64url');
		const data = {
			tg_token_hash: crypto.createHash('sha256').update(token).digest('hex'),
			tg_token_exp: new Date(Date.now() + 30 * 60 * 1000).toISOString()
		};
		const existing = await notifyRecord(guest.order.id);
		if (existing) await su.collection('guest_notify').update(existing.id, data);
		else await su.collection('guest_notify').create({ order: guest.order.id, ...data });

		await mock('/_mock/telegram/update', { chat_id: chat, text: `/start ${token}` });
		await flush();
		let messages = await telegramTo(chat);
		expect(messages).toHaveLength(1);
		expect(messages[0].text).toContain('Your special-needs request: waiting for the crew');

		const request = await requestOf(guest.order.id);
		await decideRequest(su as any, ADMIN, request!.id, 'approved');
		await flush();
		messages = await telegramTo(chat);
		expect(messages).toHaveLength(2);
		expect(messages[1].text).toContain('Your special-needs request was approved');
		expect(messages.map((m) => m.text).join()).not.toContain('Wheelchair');
	});

	it('tell each member of an approved group on their own, naming nobody else', async () => {
		const groupName = `Moop Mappers ${uid()}`;
		const lead = await guestWithEmail();
		const second = await guestWithEmail();
		const third = await guestWithEmail();
		const { group } = await startGroup(lead.order, groupName, {
			...INPUT,
			burnerName: 'Lead Thunder'
		});
		await joinGroup(second.order, group.code, 'Second Spark');
		await saveGuestRequest(su as any, third.order, {
			needs: ['quiet'],
			text: 'A quiet corner, please.',
			burnerName: 'Third Glow',
			consent: true,
			group: { mode: 'join', code: group.code }
		});
		await flush(); // "We got your request", for each of them
		const crewBefore = await crewTexts();
		expect(crewBefore).toContain('🧡 New special-needs request (started a group)');
		expect(crewBefore).toContain('🧡 New special-needs request (joined a group)');
		const singleApprovals = (crewBefore.match(/✅ Special-needs request approved/g) ?? []).length;

		expect(await decideGroup(su as any, ADMIN, group.id, 'approved')).toEqual({
			changed: 3,
			skipped: 0
		});
		await flush();

		const guests = [
			{ ...lead, burner: 'Lead Thunder' },
			{ ...second, burner: 'Second Spark' },
			{ ...third, burner: 'Third Glow' }
		];
		for (const guest of guests) {
			const mails = await mailsTo(guest.email);
			expect(mails.map((m) => m.Subject)).toEqual([
				'[TEST] We got your special-needs request',
				'[TEST] Your special-needs request was approved'
			]);
			for (const mail of mails) {
				const body = await mailBody(mail.ID);
				const text = `${mail.Subject}\n${body.Text}\n${body.HTML}`;
				for (const other of guests.filter((g) => g !== guest)) {
					expect(text).not.toContain(other.name);
					expect(text).not.toContain(other.burner);
					expect(text).not.toContain(other.email);
				}
				expect(text).not.toContain(groupName);
				expect(text).not.toContain(group.code);
				expect(text).not.toContain(formatGroupCode(group.code));
			}
			expect((await requestOf(guest.order.id))?.status).toBe('approved');
		}

		// one line for the group in the crew chat, none per member, no names or codes
		const crew = await crewTexts();
		expect(crew).toContain(`✅ Request group approved by ${ADMIN.email}: 3 request(s)`);
		expect((crew.match(/✅ Special-needs request approved/g) ?? []).length).toBe(singleApprovals);
		for (const secret of [groupName, group.code, formatGroupCode(group.code), 'Second Spark']) {
			expect(crew).not.toContain(secret);
		}
		for (const guest of guests) expect(crew).not.toContain(guest.name);
	});
});

// --- the migration ------------------------------------------------------------------------

const COMPOSE_FILE = path.resolve(__dirname, '../../docker-compose.test.yml');

/** A shell script in the stack's PocketBase container (stdin from `input`). */
function inPocketBase(script: string, env: Record<string, string> = {}, input = '') {
	const run = spawnSync(
		'docker',
		[
			'compose',
			'-f',
			COMPOSE_FILE,
			'exec',
			'-T',
			...Object.entries(env).flatMap(([key, value]) => ['-e', `${key}=${value}`]),
			'pocketbase',
			'sh',
			'-c',
			script
		],
		{ input, encoding: 'utf8' }
	);
	return { ok: run.status === 0, out: `${run.stdout}${run.stderr}` };
}

/**
 * Takes the database back to what v0.29.0 had: requests, no groups — and
 * forgets that 1760550000 ran, so the next `migrate up` applies it again.
 * Doesn't depend on which migrations come after it (`migrate down N` would).
 */
const REVERT_TO_0_29_0 = `
migrate((app) => {
	const requests = app.findCollectionByNameOrId('special_requests');
	requests.fields.removeByName('request_group');
	requests.indexes = requests.indexes.filter((idx) => idx.indexOf('idx_special_requests_request_group') < 0);
	app.save(requests);
	app.delete(app.findCollectionByNameOrId('request_groups'));
	app.db().newQuery("DELETE FROM {{_migrations}} WHERE [[file]] = '1760550000_request_groups.js'").execute();
}, () => {});
`;

/** Runs after 1760550000 again: throws (and the migration fails) when something is missing. */
const CHECK_AFTERWARDS = `
migrate((app) => {
	const fail = (what) => { throw new Error('migration check: ' + what); };
	const requests = app.findCollectionByNameOrId('special_requests');
	if (!requests.fields.getByName('request_group')) fail('no special_requests.request_group');
	if (!requests.indexes.some((idx) => idx.indexOf('idx_special_requests_request_group') >= 0)) fail('no index');
	const rows = app.findRecordsByFilter('special_requests', "id != ''", '', 0, 0);
	const expected = Number($os.getenv('EXPECT_REQUESTS'));
	if (rows.length !== expected) fail(rows.length + ' requests instead of ' + expected);
	const group = new Record(app.findCollectionByNameOrId('request_groups'));
	group.set('code', $security.randomStringWithAlphabet(8, '${PASS_ALPHABET}'));
	group.set('name', 'check');
	app.save(group);
	rows[0].set('request_group', group.id);
	app.save(rows[0]);
	if (app.findRecordById('special_requests', rows[0].id).getString('request_group') !== group.id) {
		fail('an old request could not join a group');
	}
}, () => {});
`;

describe('the request groups migration (1760550000)', () => {
	it('applies on a database that already holds requests', async () => {
		const guest = await seedTicket(su);
		await saveRequest(su as any, guest.order as any, INPUT);
		const requests = (await su.collection('special_requests').getList(1, 1)).totalItems;
		expect(requests).toBeGreaterThan(0);

		// A copy of this stack's database (a backup), so the running PocketBase
		// is never touched; migrations from a copy of pb_migrations.
		const backup = `migration-check-${uid()}.zip`;
		await su.backups.create(backup);
		const dir = `/tmp/${backup.replace(/\.zip$/, '')}`;
		const migrate = (args: string) =>
			`/usr/local/bin/pocketbase migrate ${args} --dir=${dir}/data --hooksDir=/pb_hooks ` +
			`--migrationsDir=${dir}/migrations --encryptionEnv=PB_ENCRYPTION_KEY --automigrate=false`;
		try {
			let run = inPocketBase(
				`set -e; mkdir -p ${dir}/data ${dir}/migrations; ` +
					`unzip -q /pb_data/backups/${backup} -d ${dir}/data; ` +
					`cp /pb_migrations/*.js ${dir}/migrations/; ` +
					`cat > ${dir}/migrations/1799999998_revert_to_0_29_0.js`,
				{},
				REVERT_TO_0_29_0
			);
			expect(run.ok, run.out).toBe(true);

			// The copy as v0.29.0 left it: no groups, and 1760550000 not applied.
			run = inPocketBase(migrate('up'));
			expect(run.ok, run.out).toBe(true);
			expect(run.out).toContain('1799999998_revert_to_0_29_0.js');
			expect(run.out).not.toContain('1760550000_request_groups.js');

			// Now the real thing, on a database full of requests.
			run = inPocketBase(
				`set -e; rm ${dir}/migrations/1799999998_revert_to_0_29_0.js; ` +
					`cat > ${dir}/migrations/1799999999_check_afterwards.js`,
				{},
				CHECK_AFTERWARDS
			);
			expect(run.ok, run.out).toBe(true);
			run = inPocketBase(migrate('up'), { EXPECT_REQUESTS: String(requests) });
			expect(run.ok, run.out).toBe(true);
			expect(run.out).toContain('1760550000_request_groups.js');
			expect(run.out).toContain('1799999999_check_afterwards.js');
		} finally {
			inPocketBase(`rm -rf ${dir}`);
			await su.backups.delete(backup).catch(() => {});
		}
	});
});

// --- the switch and the cleanup ---------------------------------------------------------

describe('requests switch and cleanup', () => {
	it('tell the crew who opened or closed requests', async () => {
		const { client, email } = await createAdmin(su, 'admin');
		await client
			.collection('app_settings')
			.update(APP_SETTINGS_ID, { special_requests_open: true });
		await client
			.collection('app_settings')
			.update(APP_SETTINGS_ID, { special_requests_open: false });
		await flush();

		const events = await su.collection('admin_events').getFullList({
			filter: su.filter("actor = {:email} && action ~ 'requests_'", { email }),
			sort: 'created'
		});
		expect(events.map((e) => e.action)).toEqual(['requests_opened', 'requests_closed']);
		const crew = await crewTexts();
		expect(crew).toContain(`🧡 Special-needs requests OPENED by ${email}`);
		expect(crew).toContain(`🧡 Special-needs requests closed by ${email}`);
	});

	it('forget-contacts deletes every request and every group after the event, bookings stay', async () => {
		const guest = await guestWithEmail();
		const { bed } = await specialBed();
		await saveRequest(su as any, guest.order as any, INPUT);
		const request = await requestOf(guest.order.id);
		await assignSpot(su as any, ADMIN, request!.id, bed.id);
		// a group with two members, and one nobody is in any more (left behind
		// by a failed write): both go
		const lead = await seedTicket(su);
		const { group } = await startGroup(lead.order);
		await joinGroup((await seedTicket(su)).order, group.code, 'Late Joiner');
		const orphan = await su.collection('request_groups').create({ code: randomCode(), name: 'x' });

		const output = cozyAdmin(['tickets', 'forget-contacts', '--yes']);
		expect(output).toMatch(/special-needs request\(s\)/);
		const counted = output.match(/(\d+) request group\(s\)/);
		expect(counted, output).not.toBeNull();
		expect(Number(counted![1])).toBeGreaterThanOrEqual(2);
		expect(await su.collection('special_requests').getFullList()).toHaveLength(0);
		expect(await su.collection('request_groups').getFullList()).toHaveLength(0);
		expect(await groupExists(orphan.id)).toBe(false);
		expect((await su.collection('beds').getOne(bed.id)).order).toBe(guest.order.id);
	});
});
