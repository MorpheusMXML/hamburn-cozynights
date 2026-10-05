// tests/special-needs-groups-guest.test.ts — request groups on the guest page
// /special-needs (docs/guide/special-needs.md, "Asking as a group"): the
// invite link across the sign-in, what the page loads, starting and joining
// from the request form, the limits on wrong codes, and leaving. The ticket
// always comes from the session. The group logic itself:
// tests/request-groups.test.ts; the page's other actions:
// tests/special-needs.test.ts.
import { describe, it, expect, vi } from 'vitest';

vi.mock('$env/dynamic/private', () => ({
	env: {
		ENCRYPTION_KEY: '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff',
		PB_ADMIN_EMAIL: 'admin@test.com',
		PB_ADMIN_PASSWORD: 'password'
	}
}));

import { FakePb } from './fake-pb';
import { createLookupHash, decrypt, encrypt } from '../src/lib/server/crypto';
import { APP_SETTINGS_ID } from '../src/lib/server/constants';
import { safeReturnPath, signInUrl } from '../src/lib/server/guest-session';
import { UNKNOWN_CODE } from '../src/lib/server/request-groups';
import { GROUP_MAX } from '../src/lib/special-needs';
import { actions, load } from '../src/routes/special-needs/+page.server';

const CODE = 'KM7PQ2XR';
const ORIGIN = 'https://cozynights.test';
const TEXT = 'Our dome crew, six of us, we would love one room.';

function form(fields: Record<string, string | string[]>): FormData {
	const data = new FormData();
	for (const [key, value] of Object.entries(fields)) {
		for (const v of Array.isArray(value) ? value : [value]) data.append(key, v);
	}
	return data;
}

/** A camp with request settings and a way to add tickets. */
function camp(settings: Record<string, unknown> = {}) {
	const pb = new FakePb();
	pb.seed('app_settings', {
		id: APP_SETTINGS_ID,
		is_booking_active: false,
		special_requests_open: true,
		...settings
	});
	let n = 0;
	// `any`, like the other FakePb tests: rows stand in for PocketBase records.
	const ticket = (name: string): any => {
		n++;
		const code = `HB-${2000 + n}`;
		return pb.seed('orders', {
			order_number: code,
			order_hash: createLookupHash(code),
			customer_name: name,
			email: `${name.split(' ')[0].toLowerCase()}@example.com`,
			burner_name: ''
		});
	};
	return { pb, ticket };
}

type Camp = ReturnType<typeof camp>;

/** A group with this code and one request per ticket in it (seeded, no hooks). */
function seedGroup(c: Camp, members: Record<string, unknown>[], code = CODE) {
	const group = c.pb.seed('request_groups', { code, name: encrypt('Neon Owls') });
	const requests = members.map((data, index) =>
		c.pb.seed('special_requests', {
			order: c.ticket(`Member ${index + 1}`).id,
			status: 'pending',
			needs: '',
			request_group: group.id,
			...data
		})
	);
	return { group, requests };
}

const as = (c: Camp, order: { order_number: string } | null) => ({
	pb: c.pb,
	adminPb: c.pb,
	orderNumber: order?.order_number ?? null,
	admin: null
});

const save = (c: Camp, order: { order_number: string } | null, fields: Record<string, any>) =>
	actions.save({
		request: { formData: async () => form(fields) },
		locals: as(c, order)
	} as any) as Promise<any>;

const leave = (c: Camp, order: { order_number: string } | null) =>
	actions.leaveGroup({ locals: as(c, order) } as any) as Promise<any>;

/** Runs the page load; a redirect comes back as the thrown value. */
async function open(c: Camp, order: { order_number: string } | null, path = '/special-needs') {
	const setHeaders = vi.fn();
	const data: any = await Promise.resolve(
		load({
			locals: as(c, order),
			url: new URL(path, ORIGIN),
			cookies: { delete: () => {} },
			setHeaders
		} as any)
	).catch((thrown: unknown) => thrown);
	return { data, setHeaders };
}

const JOIN = { groupMode: 'join', groupCode: CODE, consent: 'yes' };
const requestOf = (c: Camp, order: { id: string }): any =>
	c.pb.rows('special_requests').find((r) => r.order === order.id);

describe('an invite link', () => {
	it('keeps its code across the sign-in, and nothing else', () => {
		expect(safeReturnPath(`/special-needs?group=${CODE}`)).toBe(`/special-needs?group=${CODE}`);
		expect(signInUrl({} as App.Locals, `/special-needs?group=${CODE}`)).toBe(
			`/?login=required&next=%2Fspecial-needs%3Fgroup%3D${CODE}`
		);
		for (const refused of [
			'/special-needs?group=km7pq2xr', // the page sends the code in capitals
			'/special-needs?group=KM7PQ2X', // too short
			'/special-needs?group=KM7PQ2XRA', // too long
			'/special-needs?group=KM7PQ2X0', // 0 is not in the pass alphabet
			`/special-needs?group=${CODE}&next=//evil.example`,
			'/special-needs?edit',
			`/map?group=${CODE}`,
			`//evil.example/special-needs?group=${CODE}`
		]) {
			expect(safeReturnPath(refused), refused).toBeNull();
		}
	});

	it('sends a guest who is not signed in to the start page with the code', async () => {
		const c = camp();
		const { data: invited } = await open(c, null, '/special-needs?group=km7p-q2xr');
		expect(invited).toMatchObject({
			status: 303,
			location: `/?login=required&next=%2Fspecial-needs%3Fgroup%3D${CODE}`
		});
		// something that is no code is dropped, the page stays
		const { data: junk } = await open(c, null, '/special-needs?group=%3Cscript%3E');
		expect(junk).toMatchObject({ status: 303, location: '/?login=required&next=%2Fspecial-needs' });
	});

	it('fills in the form without looking the code up, so the page tells nobody whether it exists', async () => {
		const c = camp();
		seedGroup(c, [{}]);
		const bea = c.ticket('Bea Booker');
		const read = vi.spyOn(c.pb, 'collection');

		const known = await open(c, bea, `/special-needs?group=${CODE}`);
		const unknown = await open(c, bea, '/special-needs?group=ZZZZZZZZ');
		const collections = read.mock.calls.map(([name]) => name);
		expect(collections).toContain('special_requests');
		expect(collections).not.toContain('request_groups');
		expect(known.data).toMatchObject({
			request: null,
			group: null,
			invite: 'KM7P-Q2XR',
			groupMax: GROUP_MAX
		});
		expect({ ...unknown.data, invite: known.data.invite }).toEqual(known.data);
		// what a guest wrote is never kept in a cache
		expect(known.setHeaders).toHaveBeenCalledWith({ 'cache-control': 'no-store' });
	});

	it('loads the group of a member: its name, the link to share and the burner names', async () => {
		const c = camp();
		const { requests } = seedGroup(c, [{ burner_name: encrypt('Neon Owl') }, {}]);
		const member = c.pb.rows('orders').find((o) => o.id === requests[0].order)!;
		const { data } = await open(c, member as any);
		expect(data.invite).toBeNull();
		expect(data.group).toEqual({
			name: 'Neon Owls',
			code: 'KM7P-Q2XR',
			link: `${ORIGIN}/special-needs?group=${CODE}`,
			members: [
				{ name: 'Neon Owl', you: true },
				{ name: 'A fellow burner', you: false }
			],
			max: GROUP_MAX,
			full: false
		});
	});
});

describe('starting and joining from the request form', () => {
	it('takes the ticket from the session, never from the form', async () => {
		const c = camp();
		const ada = c.ticket('Ada Lovelace');
		const other = c.ticket('Someone Else');
		const result = await save(c, ada, {
			needs: ['own_room'],
			text: TEXT,
			groupMode: 'start',
			groupName: 'Neon Owls',
			consent: 'yes',
			order: other.id
		});
		expect(result).toEqual({ success: true, saved: 'created', group: 'started' });
		const [group] = c.pb.rows('request_groups');
		expect(decrypt(group.name)).toBe('Neon Owls');
		expect(requestOf(c, ada).request_group).toBe(group.id);
		expect(requestOf(c, other)).toBeUndefined();
	});

	it('joins with a code however it is typed or pasted, without needs of its own', async () => {
		const c = camp();
		const { group } = seedGroup(c, [{}]);
		const bea = c.ticket('Bea Booker');
		const cid = c.ticket('Cid Camper');

		expect(await save(c, bea, { ...JOIN, groupCode: 'km7p q2xr' })).toEqual({
			success: true,
			saved: 'created',
			group: 'joined'
		});
		expect(
			await save(c, cid, { ...JOIN, groupCode: `${ORIGIN}/special-needs?group=${CODE}` })
		).toMatchObject({ success: true, group: 'joined' });
		expect(requestOf(c, bea)).toMatchObject({ status: 'pending', request_group: group.id });
		expect(requestOf(c, cid).request_group).toBe(group.id);
	});

	it('puts a waiting request into the group', async () => {
		const c = camp();
		const { group } = seedGroup(c, [{}]);
		const bea = c.ticket('Bea Booker');
		await save(c, bea, { needs: ['quiet'], text: 'A quiet room, please.', consent: 'yes' });
		const result = await save(c, bea, { ...JOIN, needs: ['quiet'], text: 'A quiet room, please.' });
		expect(result).toEqual({ success: true, saved: 'updated', group: 'joined' });
		expect(requestOf(c, bea).request_group).toBe(group.id);
		expect(c.pb.rows('special_requests').filter((r) => r.order === bea.id)).toHaveLength(1);
	});

	it('keeps the group of a request that is in one: a posted start or join changes nothing', async () => {
		const c = camp();
		const first = seedGroup(c, [{}]);
		seedGroup(c, [{}], 'ABCDEF23');
		const member: any = c.pb.rows('orders').find((o) => o.id === first.requests[0].order);

		// the form shows no group choice to a member, so whatever is posted is ignored
		const joined = await save(c, member, { ...JOIN, groupCode: 'ABCDEF23' });
		expect(joined).toEqual({ success: true, saved: 'updated', group: null });
		const started = await save(c, member, {
			groupMode: 'start',
			groupName: 'Other',
			consent: 'yes'
		});
		expect(started).toEqual({ success: true, saved: 'updated', group: null });
		expect(requestOf(c, member).request_group).toBe(first.group.id);
		expect(c.pb.rows('request_groups')).toHaveLength(2);
	});

	it('marks a wrong code at its field and gives back everything that was typed', async () => {
		const c = camp();
		seedGroup(c, [{}]);
		const bea = c.ticket('Bea Booker');
		const fields = {
			needs: ['quiet'],
			text: 'A quiet room, please.',
			burnerName: 'Neon Owl',
			groupMode: 'join',
			groupName: '',
			groupCode: 'zzzz-zzzz',
			consent: 'yes'
		};
		const unknown = await save(c, bea, fields);
		expect(unknown.status).toBe(400);
		expect(unknown.data).toEqual({
			errors: { groupCode: UNKNOWN_CODE },
			values: {
				needs: ['quiet'],
				text: 'A quiet room, please.',
				burnerName: 'Neon Owl',
				groupMode: 'join',
				groupName: '',
				groupCode: 'zzzz-zzzz'
			}
		});
		expect(requestOf(c, bea)).toBeUndefined();

		// not a code at all: refused by the form check, as typed
		const malformed = await save(c, bea, { ...fields, groupCode: 'not a code' });
		expect(malformed.status).toBe(400);
		expect(malformed.data.errors.groupCode).toMatch(/8 letters and digits/);
		expect(malformed.data.values.groupCode).toBe('not a code');
	});

	it('asks for a name of 2 to 40 characters to start a group', async () => {
		const c = camp();
		const ada = c.ticket('Ada Lovelace');
		const result = await save(c, ada, {
			needs: ['own_room'],
			text: TEXT,
			groupMode: 'start',
			groupName: 'X',
			consent: 'yes'
		});
		expect(result.status).toBe(400);
		expect(result.data.errors).toEqual({
			groupName: 'Give your group a name (2 to 40 characters).'
		});
		expect(result.data.values).toMatchObject({ groupMode: 'start', groupName: 'X', text: TEXT });
		expect(c.pb.rows('request_groups')).toHaveLength(0);
	});

	it(`refuses a full group of ${GROUP_MAX}`, async () => {
		const c = camp();
		seedGroup(
			c,
			Array.from({ length: GROUP_MAX }, () => ({}))
		);
		const bea = c.ticket('Bea Booker');
		const result = await save(c, bea, JOIN);
		expect(result.status).toBe(409);
		expect(result.data.errors.groupCode).toMatch(/at most 12 people/);
		expect(requestOf(c, bea)).toBeUndefined();
	});

	it('keeps a decided request out of a group', async () => {
		const c = camp();
		seedGroup(c, [{}]);
		const bea = c.ticket('Bea Booker');
		c.pb.seed('special_requests', { order: bea.id, status: 'declined', needs: '' });
		const result = await save(c, bea, JOIN);
		expect(result.status).toBe(409);
		expect(result.data.error).toMatch(/already decided/);
		expect(result.data.values.groupCode).toBe(CODE);
		expect(requestOf(c, bea).request_group ?? '').toBe('');
	});

	it('starts and joins nothing while requests are closed', async () => {
		const c = camp({ special_requests_open: false });
		seedGroup(c, [{}]);
		const bea = c.ticket('Bea Booker');
		const result = await save(c, bea, JOIN);
		expect(result.status).toBe(403);
		expect(result.data.values).toMatchObject({ groupMode: 'join', groupCode: CODE });
		expect(requestOf(c, bea)).toBeUndefined();
	});

	it('stops guessing: after 5 wrong codes the 6th try waits, whatever the code', async () => {
		const c = camp();
		const { group } = seedGroup(c, [{}]);
		const bea = c.ticket('Bea Booker');
		for (let miss = 0; miss < 5; miss++) {
			const wrong = await save(c, bea, { ...JOIN, groupCode: 'ZZZZZZZZ' });
			expect(wrong.data.errors).toEqual({ groupCode: UNKNOWN_CODE });
		}
		const blocked = await save(c, bea, JOIN);
		expect(blocked.status).toBe(429);
		expect(blocked.data.error).toBe(
			'Too many wrong group codes. Please wait 15 minutes, then try again.'
		);
		expect(requestOf(c, bea)).toBeUndefined();

		// only joining waits: a request without a group still goes through
		const own = await save(c, bea, { needs: ['quiet'], text: 'A quiet room.', consent: 'yes' });
		expect(own).toEqual({ success: true, saved: 'created', group: null });
		expect(requestOf(c, bea).request_group ?? '').not.toBe(group.id);
		// another ticket is not affected
		const cid = c.ticket('Cid Camper');
		expect(await save(c, cid, JOIN)).toMatchObject({ success: true, group: 'joined' });
	});
});

describe('leaving the group', () => {
	it('works while requests are closed; a request with own needs stays, without the group', async () => {
		const c = camp({ special_requests_open: false });
		const { requests } = seedGroup(c, [
			{ needs: encrypt(JSON.stringify(['lower_bunk'])), status: 'approved' },
			{}
		]);
		const member: any = c.pb.rows('orders').find((o) => o.id === requests[0].order);
		expect(await leave(c, member)).toEqual({ success: true, left: 'left' });
		expect(requestOf(c, member)).toMatchObject({ status: 'approved', request_group: '' });
		// leaving tells nobody
		expect(c.pb.rows('admin_events')).toHaveLength(0);
	});

	it('deletes a request that was only about the group', async () => {
		const c = camp();
		const { requests } = seedGroup(c, [{}, {}]);
		const member: any = c.pb.rows('orders').find((o) => o.id === requests[0].order);
		expect(await leave(c, member)).toEqual({ success: true, left: 'withdrawn' });
		expect(requestOf(c, member)).toBeUndefined();
		expect(c.pb.rows('admin_events').map((e) => [e.action, e.details])).toEqual([
			['special_request_withdrawn', { status: 'pending', group: true }]
		]);
	});

	it('needs a session and a group', async () => {
		const c = camp();
		const ada = c.ticket('Ada Lovelace');
		expect((await leave(c, null)).status).toBe(401);
		const alone = await leave(c, ada);
		expect(alone.status).toBe(404);
		expect(alone.data.error).toBe('You are not in a group.');
	});
});
