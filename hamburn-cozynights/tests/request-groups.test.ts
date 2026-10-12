// tests/request-groups.test.ts — request groups (docs/admin/special-needs.md,
// "Groups"): starting and joining from the request form, what a member sees
// of the group (names only), leaving, the crew's group steps (approve,
// decline, book, take out), the planner's proposal, and the PocketBase helper
// that deletes an empty group. Against the in-memory FakePb; the real
// database, its hook and the messages: tests/integration/special-needs.test.ts.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('$env/dynamic/private', () => ({
	env: {
		ENCRYPTION_KEY: '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff',
		PB_ADMIN_EMAIL: 'admin@test.com',
		PB_ADMIN_PASSWORD: 'password'
	}
}));

import { FakePb } from './fake-pb';
import { loadHookModule } from './hook-module';
import { createLookupHash, decrypt, encrypt } from '../src/lib/server/crypto';
import { APP_SETTINGS_ID } from '../src/lib/server/constants';
import { BedUnavailableError, BookingService } from '../src/lib/server/booking';
import { isSpotFixed, RequestError, withdrawRequest } from '../src/lib/server/special-requests';
import {
	assignGroup,
	decideGroup,
	getGuestGroup,
	GroupFieldError,
	leaveGroup,
	listGroups,
	removeFromGroup,
	saveGuestRequest,
	UNKNOWN_CODE
} from '../src/lib/server/request-groups';
import {
	GROUP_MAX,
	formatGroupCode,
	normalizeGroupCode,
	type GroupChoice,
	type RequestInput,
	type SpecialNeed,
	type SpotInfo
} from '../src/lib/special-needs';
import {
	ANYWHERE,
	defaultPlace,
	needsMet,
	noPlanNote,
	othersBooked,
	placeOptions,
	proposePlan,
	rankPlaces,
	recommendRooms,
	repick,
	type PlanMember
} from '../src/lib/group-plan';
import { PASS_ALPHABET } from '../src/lib/pass';

const admin = {
	id: 'a1',
	email: 'crew@mauersegler.art',
	name: 'Crew',
	role: 'admin' as const,
	isSuperuser: false
};

const ORIGIN = 'https://cozynights.test';
const TEXT = 'Our dome crew, six of us, we would love one room.';

function input(group: GroupChoice, needs: SpecialNeed[] = ['own_room']): RequestInput {
	return { needs, text: needs.length ? TEXT : '', burnerName: '', consent: true, group };
}

/** A camp with one room of four spots and a few tickets. */
function camp() {
	const pb = new FakePb();
	pb.seed('app_settings', {
		id: APP_SETTINGS_ID,
		is_booking_active: false,
		special_requests_open: true
	});
	const house = pb.seed('houses', { name: 'Villa' });
	const room = pb.seed('rooms', { name: 'Dorm', room_number: 2, house: house.id });
	const beds = ['B1', 'B2', 'B3', 'B4'].map((label) =>
		pb.seed('beds', {
			label,
			room: room.id,
			enabled: true,
			occupied: false,
			is_locked: false,
			is_special: label === 'B4',
			order: ''
		})
	);
	let n = 0;
	// `any`, like the other FakePb tests: rows stand in for PocketBase records.
	const ticket = (name: string, data: Record<string, unknown> = {}): any => {
		n++;
		const code = `HB-${1000 + n}`;
		return pb.seed('orders', {
			order_number: code,
			order_hash: createLookupHash(code),
			customer_name: name,
			email: `${name.split(' ')[0].toLowerCase()}@example.com`,
			burner_name: '',
			...data
		});
	};
	return { pb, house, room, beds, ticket };
}

type Camp = ReturnType<typeof camp>;

/** A group with the given requests in it (seeded directly, no hooks). */
function seedGroup(c: Camp, members: Record<string, unknown>[], code = 'KM7PQ2XR') {
	const group = c.pb.seed('request_groups', { code, name: encrypt('Neon Owls') });
	const requests = members.map((data, index) =>
		c.pb.seed('special_requests', {
			order: c.ticket(`Member ${index + 1}`).id,
			status: 'pending',
			request_group: group.id,
			...data
		})
	);
	return { group, requests };
}

const events = (c: Camp) => c.pb.rows('admin_events');
const row = (c: Camp, collection: string, id: string): any =>
	c.pb.rows(collection).find((r) => r.id === id)!;

afterEach(() => {
	vi.restoreAllMocks();
});

describe('starting a group', () => {
	it('makes a group with a random code and an encrypted name, with the request in it', async () => {
		const c = camp();
		const ada = c.ticket('Ada Lovelace');
		const outcome = await saveGuestRequest(
			c.pb as any,
			ada,
			input({ mode: 'start', name: 'Neon Owls' })
		);
		expect(outcome).toEqual({ saved: 'created', group: 'started' });

		const [group] = c.pb.rows('request_groups');
		expect(group.code).toMatch(new RegExp(`^[${PASS_ALPHABET}]{8}$`));
		expect(group.name).not.toContain('Neon');
		expect(decrypt(group.name)).toBe('Neon Owls');
		expect(c.pb.rows('special_requests')[0]).toMatchObject({
			order: ada.id,
			status: 'pending',
			request_group: group.id
		});
		// one line for the crew: a new request that started a group — not which one
		expect(events(c).map((e) => [e.action, e.details])).toEqual([
			['special_request_new', { open: 1, group: 'started' }]
		]);
		expect(JSON.stringify(events(c))).not.toMatch(/Neon|Ada|own_room/);
		expect(JSON.stringify(events(c))).not.toContain(group.code);
	});

	it('puts a waiting request into the new group without telling anyone', async () => {
		const c = camp();
		const ada = c.ticket('Ada Lovelace');
		await saveGuestRequest(c.pb as any, ada, input({ mode: 'none' }));
		const outcome = await saveGuestRequest(
			c.pb as any,
			ada,
			input({ mode: 'start', name: 'Neon Owls' })
		);
		expect(outcome).toEqual({ saved: 'updated', group: 'started' });
		expect(c.pb.rows('special_requests')).toHaveLength(1);
		expect(c.pb.rows('special_requests')[0].request_group).toBe(c.pb.rows('request_groups')[0].id);
		expect(events(c).map((e) => e.action)).toEqual(['special_request_new']);
	});

	it('leaves no group behind when the request is decided already', async () => {
		const c = camp();
		const ada = c.ticket('Ada Lovelace');
		c.pb.seed('special_requests', { order: ada.id, status: 'approved' });
		await expect(
			saveGuestRequest(c.pb as any, ada, input({ mode: 'start', name: 'Neon Owls' }))
		).rejects.toThrow(/already decided/);
		expect(c.pb.rows('request_groups')).toHaveLength(0);
		expect(c.pb.rows('special_requests')[0].request_group ?? '').toBe('');
	});

	it('refuses a second group while in one', async () => {
		const c = camp();
		const { requests } = seedGroup(c, [{}]);
		const order = row(c, 'orders', requests[0].order);
		const refused = await saveGuestRequest(
			c.pb as any,
			order,
			input({ mode: 'start', name: 'Other' })
		).catch((err) => err);
		expect(refused).toBeInstanceOf(GroupFieldError);
		expect(refused).toMatchObject({ field: 'groupName', status: 409 });
		expect(c.pb.rows('request_groups')).toHaveLength(1);
	});
});

describe('joining a group', () => {
	let c: Camp;
	beforeEach(() => {
		c = camp();
	});

	it('puts a new request into the group with this code', async () => {
		const { group } = seedGroup(c, [{}]);
		const bea = c.ticket('Bea Booker');
		const outcome = await saveGuestRequest(
			c.pb as any,
			bea,
			input({ mode: 'join', code: group.code }, [])
		);
		expect(outcome).toEqual({ saved: 'created', group: 'joined' });
		const mine = c.pb.rows('special_requests').find((r) => r.order === bea.id)!;
		expect(mine).toMatchObject({ status: 'pending', request_group: group.id });
		expect(JSON.parse(decrypt(mine.needs))).toEqual([]);
		expect(events(c).map((e) => [e.action, e.details])).toEqual([
			['special_request_new', { open: 2, group: 'joined' }]
		]);
	});

	it('says so when the request is in this group already, and writes nothing about it', async () => {
		const { group, requests } = seedGroup(c, [{}]);
		const order = row(c, 'orders', requests[0].order);
		const outcome = await saveGuestRequest(
			c.pb as any,
			order,
			input({ mode: 'join', code: group.code })
		);
		expect(outcome).toEqual({ saved: 'updated', group: 'already' });
		expect(row(c, 'special_requests', requests[0].id).request_group).toBe(group.id);
		expect(events(c)).toHaveLength(0);
	});

	it('writes nothing for a code no group has', async () => {
		seedGroup(c, [{}]);
		const bea = c.ticket('Bea Booker');
		const refused = await saveGuestRequest(
			c.pb as any,
			bea,
			input({ mode: 'join', code: 'ZZZZZZZZ' })
		).catch((err) => err);
		expect(refused).toBeInstanceOf(GroupFieldError);
		expect(refused).toMatchObject({ field: 'groupCode', status: 400, message: UNKNOWN_CODE });
		expect(c.pb.rows('special_requests').some((r) => r.order === bea.id)).toBe(false);
		expect(events(c)).toHaveLength(0);
	});

	it(`stops at ${GROUP_MAX} people`, async () => {
		const { group } = seedGroup(
			c,
			Array.from({ length: GROUP_MAX }, () => ({}))
		);
		const bea = c.ticket('Bea Booker');
		const refused = await saveGuestRequest(
			c.pb as any,
			bea,
			input({ mode: 'join', code: group.code })
		).catch((err) => err);
		expect(refused).toBeInstanceOf(GroupFieldError);
		expect(refused).toMatchObject({ field: 'groupCode', status: 409 });
		expect(refused.message).toMatch(new RegExp(`at most ${GROUP_MAX} people`));
		expect(c.pb.rows('special_requests')).toHaveLength(GROUP_MAX);
	});

	it('keeps everyone in a group from before the limit went down, and lets nobody new in', async () => {
		const { group, requests } = seedGroup(
			c,
			Array.from({ length: GROUP_MAX + 2 }, () => ({}))
		);
		const bea = c.ticket('Bea Booker');
		const refused = await saveGuestRequest(
			c.pb as any,
			bea,
			input({ mode: 'join', code: group.code })
		).catch((err) => err);
		expect(refused).toMatchObject({ field: 'groupCode', status: 409 });
		expect(c.pb.rows('special_requests')).toHaveLength(GROUP_MAX + 2);
		const view = await getGuestGroup(c.pb as any, requests[0].order, ORIGIN);
		expect(view).toMatchObject({ max: GROUP_MAX, full: true });
		expect(view?.members).toHaveLength(GROUP_MAX + 2);
	});

	it('refuses another group while in one', async () => {
		const first = seedGroup(c, [{}], 'KM7PQ2XR');
		const second = seedGroup(c, [{}], 'ABCDEF23');
		const order = row(c, 'orders', first.requests[0].order);
		const refused = await saveGuestRequest(
			c.pb as any,
			order,
			input({ mode: 'join', code: second.group.code })
		).catch((err) => err);
		expect(refused).toMatchObject({ field: 'groupCode', status: 409 });
		expect(row(c, 'special_requests', first.requests[0].id).request_group).toBe(first.group.id);
	});

	it('keeps a decided request out of the group', async () => {
		const { group } = seedGroup(c, [{}]);
		const bea = c.ticket('Bea Booker');
		const decided = c.pb.seed('special_requests', { order: bea.id, status: 'declined' });
		const refused = await saveGuestRequest(
			c.pb as any,
			bea,
			input({ mode: 'join', code: group.code })
		).catch((err) => err);
		expect(refused).toBeInstanceOf(RequestError);
		expect(refused).not.toBeInstanceOf(GroupFieldError);
		expect(refused.message).toMatch(/already decided/);
		expect(row(c, 'special_requests', decided.id).request_group ?? '').toBe('');
	});
});

describe('what a member sees of the group', () => {
	it('shows the name, the code, the link and the burner names — nothing else of anyone', async () => {
		const c = camp();
		const { group, requests } = seedGroup(c, [
			{
				burner_name: encrypt('Neon Owl'),
				needs: encrypt(JSON.stringify(['lower_bunk'])),
				reason: encrypt(TEXT)
			},
			{ status: 'approved', needs: encrypt(JSON.stringify(['quiet'])) },
			{ status: 'declined' }
		]);
		// the second member's only name is their booking's: it never shows, or the
		// others could tell that the crew booked them a spot
		c.pb.rows('orders').find((o) => o.id === requests[1].order)!.burner_name =
			encrypt('Disco Druid');
		const view = await getGuestGroup(c.pb as any, requests[0].order, ORIGIN);
		expect(view).toEqual({
			name: 'Neon Owls',
			code: 'KM7P-Q2XR',
			link: `${ORIGIN}/special-needs?group=KM7PQ2XR`,
			members: [
				{ name: 'Neon Owl', you: true },
				{ name: 'A fellow burner', you: false },
				{ name: 'A fellow burner', you: false }
			],
			max: GROUP_MAX,
			full: false
		});

		const json = JSON.stringify(view);
		for (const secret of [
			'Disco Druid',
			'lower_bunk',
			'quiet',
			TEXT,
			'@example.com',
			'Member 1',
			'Member 2',
			'pending',
			'approved',
			'declined',
			group.id,
			...requests.flatMap((r) => [r.id, r.order])
		]) {
			expect(json).not.toContain(secret);
		}
	});

	it('is null without a group', async () => {
		const c = camp();
		const ada = c.ticket('Ada Lovelace');
		expect(await getGuestGroup(c.pb as any, ada.id, ORIGIN)).toBeNull();
		c.pb.seed('special_requests', { order: ada.id, status: 'pending' });
		expect(await getGuestGroup(c.pb as any, ada.id, ORIGIN)).toBeNull();
	});
});

describe('leaving a group', () => {
	it('keeps a request with own needs, without the group, and tells nobody', async () => {
		const c = camp();
		const { requests } = seedGroup(c, [
			{ needs: encrypt(JSON.stringify(['quiet'])), status: 'approved' },
			{}
		]);
		expect(await leaveGroup(c.pb as any, requests[0].order)).toEqual({
			outcome: 'left',
			members: 1
		});
		expect(row(c, 'special_requests', requests[0].id)).toMatchObject({
			status: 'approved',
			request_group: ''
		});
		expect(events(c)).toHaveLength(0);
	});

	it('deletes a request that was only about the group, like a withdrawal', async () => {
		const c = camp();
		const { requests } = seedGroup(c, [{ needs: encrypt(JSON.stringify([])) }, {}]);
		expect(await leaveGroup(c.pb as any, requests[0].order)).toEqual({
			outcome: 'withdrawn',
			members: 1
		});
		expect(c.pb.rows('special_requests').map((r) => r.id)).toEqual([requests[1].id]);
		expect(events(c).map((e) => [e.action, e.subject, e.details])).toEqual([
			['special_request_withdrawn', requests[0].id, { status: 'pending', group: true }]
		]);
	});

	it('needs a group to leave', async () => {
		const c = camp();
		const ada = c.ticket('Ada Lovelace');
		await expect(leaveGroup(c.pb as any, ada.id)).rejects.toMatchObject({ status: 404 });
		c.pb.seed('special_requests', { order: ada.id, status: 'pending' });
		await expect(leaveGroup(c.pb as any, ada.id)).rejects.toThrow('You are not in a group.');
	});
});

describe('groups in the admin area', () => {
	it('lists each group with its name, code and members, and drops empty ones', async () => {
		const c = camp();
		const { group, requests } = seedGroup(c, [{}, {}]);
		c.pb.seed('request_groups', { code: 'ABCDEF23', name: encrypt('Gone') });
		c.pb.seed('request_groups', { code: 'ABCDEF24', name: 'unreadable:x:y' });
		c.pb.seed('special_requests', {
			order: c.ticket('Solo').id,
			status: 'pending',
			request_group: c.pb.rows('request_groups')[2].id
		});
		const groups = await listGroups(c.pb as any);
		expect(groups).toEqual([
			{
				id: group.id,
				name: 'Neon Owls',
				code: 'KM7P-Q2XR',
				created: group.created,
				memberIds: requests.map((r) => r.id)
			},
			expect.objectContaining({ name: '(unreadable name)', code: 'ABCD-EF24' })
		]);
	});
});

describe('deciding for a group', () => {
	/** Waiting, approved, declined, and approved with a spot the crew booked. */
	function mixed() {
		const c = camp();
		const { group, requests } = seedGroup(c, [
			{},
			{ status: 'approved' },
			{ status: 'declined' },
			{ status: 'approved' }
		]);
		const fixed = requests[3];
		c.pb.rows('beds')[0].order = fixed.order;
		c.pb.rows('beds')[0].occupied = true;
		row(c, 'special_requests', fixed.id).bed = c.pb.rows('beds')[0].id;
		return { c, group, requests };
	}
	const statuses = (c: Camp) => c.pb.rows('special_requests').map((r) => r.status);

	it('approves only the waiting requests, with one line for the crew', async () => {
		const { c, group } = mixed();
		expect(await decideGroup(c.pb as any, admin, group.id, 'approved')).toEqual({
			changed: 1,
			skipped: 0
		});
		expect(statuses(c)).toEqual(['approved', 'approved', 'declined', 'approved']);
		expect(events(c).map((e) => [e.action, e.subject, e.details])).toEqual([
			['request_group_approved', group.id, { changed: 1, skipped: 0 }]
		]);
	});

	it('declines the rest, but keeps a spot the crew booked', async () => {
		const { c, group, requests } = mixed();
		expect(await decideGroup(c.pb as any, admin, group.id, 'declined')).toEqual({
			changed: 2,
			skipped: 1
		});
		expect(statuses(c)).toEqual(['declined', 'declined', 'declined', 'approved']);
		expect(await isSpotFixed(c.pb as any, requests[3].order)).toBe(true);
		expect(events(c).map((e) => [e.action, e.details])).toEqual([
			['request_group_declined', { changed: 2, skipped: 1 }]
		]);
	});

	it('says when nothing waits for it', async () => {
		const c = camp();
		const { group } = seedGroup(c, [{ status: 'declined' }, { status: 'declined' }]);
		await expect(decideGroup(c.pb as any, admin, group.id, 'declined')).rejects.toMatchObject({
			status: 409,
			message: expect.stringMatching(/^Nothing to change/)
		});
		await expect(decideGroup(c.pb as any, admin, group.id, 'approved')).rejects.toBeInstanceOf(
			RequestError
		);
		expect(events(c)).toHaveLength(0);
	});
});

describe('booking spots for a group', () => {
	function grouped() {
		const c = camp();
		const { group, requests } = seedGroup(c, [{}, { status: 'approved' }, { status: 'pending' }]);
		const [b1, b2, b3, b4] = c.pb.rows('beds');
		return { c, group, requests, b1, b2, b3, b4 };
	}
	const bedOf = (c: Camp, id: string) => row(c, 'beds', id).order;

	it('books every pick — a ♿ spot too — fixes it and approves waiting requests on the way', async () => {
		const { c, group, requests, b1, b4 } = grouped();
		const outcome = await assignGroup(c.pb as any, admin, group.id, [
			{ requestId: requests[0].id, bedId: b4.id },
			{ requestId: requests[1].id, bedId: b1.id },
			{ requestId: requests[2].id, bedId: '' }
		]);
		expect(outcome).toEqual({ booked: 2, approved: 1, failed: [] });
		expect(bedOf(c, b4.id)).toBe(requests[0].order);
		expect(bedOf(c, b1.id)).toBe(requests[1].order);
		expect(await isSpotFixed(c.pb as any, requests[0].order)).toBe(true);
		expect(await isSpotFixed(c.pb as any, requests[1].order)).toBe(true);
		expect(c.pb.rows('special_requests').map((r) => r.status)).toEqual([
			'approved',
			'approved',
			'pending'
		]);
		// one line for the whole group, none per request
		expect(events(c).map((e) => [e.action, e.subject, e.details])).toEqual([
			['request_group_booked', group.id, { booked: 2, approved: 1, failed: 0 }]
		]);
	});

	it('books a group across two rooms, and a locked spot when the crew picks it on purpose', async () => {
		const { c, group, requests, b1 } = grouped();
		// a second room in the house, its only spot locked 🔒 (out of service)
		const loft = c.pb.seed('rooms', { name: 'Loft', room_number: 3, house: c.house.id });
		const l1 = c.pb.seed('beds', {
			label: 'L1',
			room: loft.id,
			enabled: true,
			occupied: false,
			is_locked: true,
			is_special: false,
			order: ''
		});
		const picks = [
			{ requestId: requests[0].id, bedId: b1.id },
			{ requestId: requests[1].id, bedId: l1.id },
			{ requestId: requests[2].id, bedId: '' }
		];
		// the dialog warned about L1, so the page confirms it (blockedOk)
		const outcome = await assignGroup(c.pb as any, admin, group.id, picks, [l1.id]);
		expect(outcome).toEqual({ booked: 2, approved: 1, failed: [] });
		expect(bedOf(c, b1.id)).toBe(requests[0].order);
		expect(bedOf(c, l1.id)).toBe(requests[1].order);
		// the lock stays: still out of service for guests once the booking goes
		expect(row(c, 'beds', l1.id).is_locked).toBe(true);
		expect(await isSpotFixed(c.pb as any, requests[1].order)).toBe(true);
	});

	it('books nothing when a picked spot was locked since the page loaded', async () => {
		const { c, group, requests, b1, b2 } = grouped();
		// B2 broke meanwhile: no dialog warned about it, so nothing confirms it
		row(c, 'beds', b2.id).is_locked = true;
		const attempt = (blockedOk: string[]) =>
			assignGroup(
				c.pb as any,
				admin,
				group.id,
				[
					{ requestId: requests[0].id, bedId: b1.id },
					{ requestId: requests[1].id, bedId: b2.id }
				],
				blockedOk
			).catch((err) => err);
		for (const blockedOk of [[], [b1.id]]) {
			expect(await attempt(blockedOk)).toMatchObject({
				status: 409,
				message:
					'🔒 B2 · Dorm #2 · Villa is blocked (out of service) now, so nothing was booked. Reload the page and pick again, or confirm it.'
			});
		}
		expect([b1, b2].map((b) => bedOf(c, b.id))).toEqual(['', '']);
		expect(events(c)).toHaveLength(0);
		// the box of the page without JavaScript confirms whatever the form picked
		expect(await attempt(['all'])).toMatchObject({ booked: 2, failed: [] });
		expect(bedOf(c, b2.id)).toBe(requests[1].order);
	});

	it('checks every pick first, and books nothing when one is wrong', async () => {
		const { c, group, requests, b1, b2, b3 } = grouped();
		const other = c.ticket('Someone Else');
		c.pb.rows('beds')[2].order = other.id; // B3 taken meanwhile
		c.pb.rows('beds')[2].occupied = true;
		const stranger = c.pb.seed('special_requests', { order: c.ticket('Stranger').id });
		const attempt = (picks: { requestId: string; bedId: string }[]) =>
			assignGroup(c.pb as any, admin, group.id, picks).catch((err) => err);

		const taken = await attempt([
			{ requestId: requests[0].id, bedId: b1.id },
			{ requestId: requests[1].id, bedId: b3.id }
		]);
		expect(taken).toMatchObject({ status: 409 });
		expect(taken.message).toBe(
			'B3 · Dorm #2 · Villa is not free anymore, so nothing was booked. Reload the page and pick again.'
		);
		const twice = await attempt([
			{ requestId: requests[0].id, bedId: b2.id },
			{ requestId: requests[1].id, bedId: b2.id }
		]);
		expect(twice).toMatchObject({ status: 400, message: expect.stringMatching(/same spot/) });
		const outsider = await attempt([{ requestId: stranger.id, bedId: b1.id }]);
		expect(outsider).toMatchObject({
			status: 409,
			message: expect.stringMatching(/left the group/)
		});
		const nothing = await attempt([{ requestId: requests[0].id, bedId: '' }]);
		expect(nothing).toMatchObject({ status: 400, message: 'Pick a spot for at least one member.' });

		row(c, 'special_requests', requests[2].id).status = 'declined';
		const declined = await attempt([
			{ requestId: requests[0].id, bedId: b1.id },
			{ requestId: requests[2].id, bedId: b2.id }
		]);
		expect(declined).toMatchObject({ status: 409 });
		expect(declined.message).toBe(
			"Member 3's request is declined: approve it first, or leave their spot on Keep as is."
		);

		expect([b1, b2].map((b) => bedOf(c, b.id))).toEqual(['', '']);
		expect(c.pb.rows('special_requests').filter((r) => r.status === 'approved')).toHaveLength(1);
		expect(events(c)).toHaveLength(0);
	});

	it('leaves a member on their current spot alone', async () => {
		const { c, group, requests, b1 } = grouped();
		c.pb.rows('beds')[0].order = requests[0].order;
		c.pb.rows('beds')[0].occupied = true;
		await expect(
			assignGroup(c.pb as any, admin, group.id, [{ requestId: requests[0].id, bedId: b1.id }])
		).rejects.toMatchObject({ status: 400 });
	});

	it('books what works when one booking fails on the way, and reports that one', async () => {
		const { c, group, requests, b1, b2, b3 } = grouped();
		const real = BookingService.prototype.bookBed;
		vi.spyOn(BookingService.prototype, 'bookBed')
			.mockImplementationOnce(async function (this: BookingService, ...args) {
				return real.apply(this, args);
			})
			.mockRejectedValueOnce(new BedUnavailableError('This spot is already claimed.'));
		const outcome = await assignGroup(c.pb as any, admin, group.id, [
			{ requestId: requests[0].id, bedId: b1.id },
			{ requestId: requests[1].id, bedId: b2.id },
			{ requestId: requests[2].id, bedId: b3.id }
		]);
		expect(outcome.booked).toBe(2);
		expect(outcome.approved).toBe(2);
		expect(outcome.failed).toEqual([
			{
				requestId: requests[1].id,
				name: 'Member 2',
				message: 'This spot is already claimed. Pick another spot.'
			}
		]);
		expect([b1, b2, b3].map((b) => bedOf(c, b.id))).toEqual([
			requests[0].order,
			'',
			requests[2].order
		]);
		expect(events(c).map((e) => [e.action, e.details])).toEqual([
			['request_group_booked', { booked: 2, approved: 2, failed: 1 }]
		]);
	});

	it('refuses a group that is gone', async () => {
		const c = camp();
		await expect(
			assignGroup(c.pb as any, admin, 'gone12345678901', [{ requestId: 'x', bedId: 'y' }])
		).rejects.toMatchObject({ status: 404 });
	});
});

describe('taking a request out of its group', () => {
	it('unlinks it, keeps it as it is and tells only the crew chat', async () => {
		const c = camp();
		const { requests } = seedGroup(c, [{ status: 'approved' }, {}]);
		await removeFromGroup(c.pb as any, admin, requests[0].id);
		expect(row(c, 'special_requests', requests[0].id)).toMatchObject({
			status: 'approved',
			request_group: ''
		});
		expect(events(c).map((e) => [e.action, e.subject, e.details])).toEqual([
			['request_group_member_removed', requests[0].id, {}]
		]);
		await expect(removeFromGroup(c.pb as any, admin, requests[0].id)).rejects.toMatchObject({
			status: 409
		});
		await expect(removeFromGroup(c.pb as any, admin, 'gone12345678901')).rejects.toMatchObject({
			status: 404
		});
	});

	it("keeps the ticket out for good: the code doesn't let it back in, not even after a withdrawal", async () => {
		const c = camp();
		const { group, requests } = seedGroup(c, [{}, {}]);
		const stranger = row(c, 'orders', requests[1].order);
		await removeFromGroup(c.pb as any, admin, requests[1].id);
		expect(row(c, 'request_groups', group.id).removed).toEqual([stranger.id]);
		const join = () =>
			saveGuestRequest(c.pb as any, stranger, input({ mode: 'join', code: group.code }, [])).catch(
				(err) => err
			);

		// still waiting: straight back in
		const again = await join();
		expect(again).toBeInstanceOf(GroupFieldError);
		expect(again).toMatchObject({
			field: 'groupCode',
			status: 403,
			message: "You can't join this group. Please contact the crew."
		});
		// declined, withdrawn, and a new request with the same code
		row(c, 'special_requests', requests[1].id).status = 'declined';
		expect(await withdrawRequest(c.pb as any, stranger.id)).toBe(true);
		const fresh = await join();
		expect(fresh).toMatchObject({ field: 'groupCode', status: 403 });
		expect(fresh.message).not.toBe(UNKNOWN_CODE);
		expect(c.pb.rows('special_requests').map((r) => r.id)).toEqual([requests[0].id]);

		// anyone else still joins with the code
		const bea = c.ticket('Bea Booker');
		expect(
			await saveGuestRequest(c.pb as any, bea, input({ mode: 'join', code: group.code }, []))
		).toEqual({ saved: 'created', group: 'joined' });
	});
});

describe('group codes', () => {
	it('come in capitals without dashes, from whatever was typed or pasted', () => {
		expect(normalizeGroupCode('km7p q2xr')).toBe('KM7PQ2XR');
		expect(normalizeGroupCode(' KM7P-Q2XR ')).toBe('KM7PQ2XR');
		expect(normalizeGroupCode('https://x.test/special-needs?group=KM7PQ2XR')).toBe('KM7PQ2XR');
		expect(normalizeGroupCode('/special-needs?group=km7pq2xr#top')).toBe('KM7PQ2XR');
		for (const bad of [undefined, null, 42, '', 'KM7PQ2X', 'KM7PQ2XRS', 'KM7PQ2X0', 'KM7P Q2XI']) {
			expect(normalizeGroupCode(bad)).toBe('');
		}
	});

	it('show with a dash in the middle', () => {
		expect(formatGroupCode('KM7PQ2XR')).toBe('KM7P-Q2XR');
		expect(formatGroupCode('')).toBe('');
	});
});

describe('the group planner', () => {
	const ROOMS: Record<string, { room: string; house: string; houseId: string }> = {
		r1: { room: 'Dorm #1', house: 'Villa', houseId: 'h1' },
		r2: { room: 'Dorm #2', house: 'Villa', houseId: 'h1' },
		r3: { room: 'Den', house: 'Hut', houseId: 'h2' },
		r4: { room: 'Bunks', house: 'Hut', houseId: 'h2' }
	};
	function spot(
		bedId: string,
		roomId: string,
		label: string,
		extra: Partial<SpotInfo> = {}
	): SpotInfo {
		const { room, house, houseId } = ROOMS[roomId];
		return {
			bedId,
			roomId,
			houseId,
			label: `${label} · ${room} · ${house}`,
			spot: label,
			room,
			house,
			special: false,
			locked: false,
			bedType: '',
			features: [],
			...extra
		};
	}
	// Villa: Dorm #1 with 2 free spots, Dorm #2 with 4 (one ♿); Hut: Den with 3.
	const SPOTS = [
		spot('a1', 'r1', 'B1'),
		spot('a2', 'r1', 'B2'),
		spot('b1', 'r2', 'B1', { special: true }),
		spot('b2', 'r2', 'B2'),
		spot('b3', 'r2', 'B3'),
		spot('b4', 'r2', 'B4'),
		spot('c1', 'r3', 'B1'),
		spot('c2', 'r3', 'B2'),
		spot('c3', 'r3', 'B3')
	];
	const member = (
		requestId: string,
		needs: SpecialNeed[] = [],
		extra: Partial<PlanMember> = {}
	) => ({
		requestId,
		name: requestId,
		needs,
		declined: false,
		crewSpotLabel: '',
		...extra
	});
	const three = [member('m1'), member('m2'), member('m3')];

	it('offers the rooms with the most ♿ spots for the group first, then the snuggest, then houses, then the rest', () => {
		const options = placeOptions(SPOTS, 3);
		expect(options.map((o) => [o.key, o.label, o.fits])).toEqual([
			['', ANYWHERE, true],
			['room:r2', 'Dorm #2 · Villa — 4 free (♿ 1) · fits all 3', true],
			['room:r3', 'Den · Hut — 3 free · fits all 3', true],
			['house:h1', 'Villa, whole house — 6 free (♿ 1) · fits all 3', true],
			['house:h2', 'Hut, whole house — 3 free · fits all 3', true],
			['room:r1', 'Dorm #1 · Villa — 2 free · too small', false]
		]);
		expect(options[0]).toMatchObject({ free: 9, special: 1, locked: 0 });
		// too big for every single place: the roomiest first
		expect(placeOptions(SPOTS, 7).map((o) => o.key)).toEqual([
			'',
			'house:h1',
			'room:r2',
			'room:r3',
			'house:h2',
			'room:r1'
		]);
	});

	it('fills the ♿ spots first, for every member — who needs something chooses first among them', () => {
		// Room A (Lodge): 4 free, A1 + A2 ♿ (a lower and an upper bunk); Room B (Barn): 5 free
		const at = (roomId: string, room: string, houseId: string, house: string, label: string) => ({
			roomId,
			room,
			houseId,
			house,
			label: `${label} · ${room} · ${house}`
		});
		const roomA = (label: string) => at('rA', 'Room A', 'hA', 'Lodge', label);
		const rooms = [
			spot('a1', 'r1', 'A1', { ...roomA('A1'), special: true, bedType: 'bunk_lower' }),
			spot('a2', 'r1', 'A2', { ...roomA('A2'), special: true, bedType: 'bunk_upper' }),
			spot('a3', 'r1', 'A3', roomA('A3')),
			spot('a4', 'r1', 'A4', roomA('A4')),
			...['B1', 'B2', 'B3', 'B4', 'B5'].map((label, i) =>
				spot(`b${i + 1}`, 'r1', label, at('rB', 'Room B', 'hB', 'Barn', label))
			)
		];
		const options = placeOptions(rooms, 4);
		// Room A gives the group two ♿ spots: it comes before the roomier Room B
		expect(options.map((o) => [o.key, o.label])).toEqual([
			['', ANYWHERE],
			['room:rA', 'Room A · Lodge — 4 free (♿ 2) · fits all 4'],
			['room:rB', 'Room B · Barn — 5 free · fits all 4'],
			['house:hA', 'Lodge, whole house — 4 free (♿ 2) · fits all 4'],
			['house:hB', 'Barn, whole house — 5 free · fits all 4']
		]);
		// an art project's crew: the ♿ spots are the pool for every request
		const crew = ['m1', 'm2', 'm3', 'm4'].map((id) => member(id, ['own_room']));
		expect(recommendRooms(options, crew, rooms).map((o) => o.key)).toEqual(['room:rA', 'room:rB']);
		expect(defaultPlace(options, crew, rooms)).toBe('room:rA');
		expect(proposePlan(crew, rooms, 'room:rA')).toEqual({ m1: 'a1', m2: 'a2', m3: 'a3', m4: 'a4' });
		// m2 needs no ladder: the ♿ lower bunk is theirs, m1 takes the other ♿ spot
		const needy = [member('m1'), member('m2', ['lower_bunk'])];
		expect(proposePlan(needy, rooms, 'room:rA')).toEqual({ m1: 'a2', m2: 'a1' });
	});

	it('puts everyone into a room that fits all, the ♿ spot first', () => {
		expect(proposePlan(three, SPOTS, 'room:r2')).toEqual({ m1: 'b1', m2: 'b2', m3: 'b3' });
		// someone who needs something gets the ♿ spot
		const needy = proposePlan([member('m1'), member('m2', ['quiet'])], SPOTS, 'room:r2');
		expect(needy).toEqual({ m1: 'b2', m2: 'b1' });
	});

	it('places a helper on a ♿ spot too, after the one they help', () => {
		// the helper first in the group, the one they help second
		const pair = [member('helper', ['helper']), member('helped', ['stable_light'])];
		expect(proposePlan(pair, SPOTS, 'room:r2')).toEqual({ helper: 'b2', helped: 'b1' });
		// a helper alone takes it
		expect(proposePlan([member('helper', ['helper'])], SPOTS, 'room:r2')).toEqual({
			helper: 'b1'
		});
	});

	it('gives the lower bunk to the member who needs it', () => {
		const bunks = [
			spot('d1', 'r4', 'B1', { bedType: 'bunk_upper' }),
			spot('d2', 'r4', 'B2', { bedType: 'bunk_lower' })
		];
		expect(proposePlan([member('m1'), member('m2', ['lower_bunk'])], bunks, 'room:r4')).toEqual({
			m1: 'd1',
			m2: 'd2'
		});
	});

	it('repairs a clear mismatch that a swap removes: who the layout can check picks first', () => {
		// X needs stable light (only a person can match it), Y no ladder; B1 is
		// the ♿ lower bunk, B2 an upper bunk (♿ or not)
		for (const upperSpecial of [false, true]) {
			const room = [
				spot('e1', 'r4', 'B1', { bedType: 'bunk_lower', special: true }),
				spot('e2', 'r4', 'B2', { bedType: 'bunk_upper', special: upperSpecial })
			];
			for (const xNeeds of [['stable_light'], ['stable_light', 'near_toilet']] as SpecialNeed[][]) {
				const pair = [member('x', xNeeds), member('y', ['lower_bunk'])];
				expect(proposePlan(pair, room, 'room:r4')).toEqual({ x: 'e2', y: 'e1' });
				expect(needsMet(pair, room, 'room:r4')).toEqual({ met: 1, of: xNeeds.length });
			}
		}
	});

	it('swaps when that answers more needs and keeps as many on ♿ spots', () => {
		// S: the ♿ spot, its bed not described; P: a single bed
		const room = [
			spot('s', 'r4', 'S', { special: true }),
			spot('p', 'r4', 'P', { bedType: 'single' })
		];
		const pair = [member('a', ['lower_bunk']), member('h', ['helper'])];
		expect(proposePlan(pair, room, 'room:r4')).toEqual({ a: 'p', h: 's' });
		expect(needsMet(pair, room, 'room:r4')).toEqual({ met: 1, of: 1 });
		// the same with the ground floor switched off for the ♿ spot alone
		const floor = [
			spot('s', 'r4', 'S', { special: true, features: [] }),
			spot('p', 'r4', 'P', { features: ['ground_floor'] })
		];
		const stepFree = [member('a', ['step_free']), member('h', ['helper'])];
		expect(proposePlan(stepFree, floor, 'room:r4')).toEqual({ a: 'p', h: 's' });
		// alone, the member keeps the ♿ spot: the pool comes before what a spot answers
		expect(proposePlan([member('a', ['lower_bunk'])], room, 'room:r4')).toEqual({ a: 's' });
	});

	it('packs a whole house into the fewest rooms', () => {
		const plan = proposePlan(three, SPOTS, 'house:h1');
		expect(Object.values(plan).sort()).toEqual(['b1', 'b2', 'b3']);
	});

	it('leaves a member without a spot when the place is too small, and never moves the rest', () => {
		const members = [
			...three,
			member('declined', [], { declined: true }),
			member('kept', [], { crewSpotLabel: 'B9 · Dorm · Villa' })
		];
		expect(proposePlan(members, SPOTS, 'room:r1')).toEqual({
			m1: 'a1',
			m2: 'a2',
			m3: '',
			declined: '',
			kept: ''
		});
		expect(Object.values(proposePlan(three, SPOTS, 'room:gone'))).toEqual(['', '', '']);
	});

	it('suggests, among places with as many ♿ spots, those that answer what the members need first', () => {
		// Den is quiet, and Bunks (Hut) has 3 more free spots; m1 needs quiet
		const quiet = [
			...SPOTS.map((s) => (s.roomId === 'r3' ? { ...s, features: ['quiet'] } : s)),
			spot('d1', 'r4', 'B1'),
			spot('d2', 'r4', 'B2'),
			spot('d3', 'r4', 'B3')
		];
		const members = [member('m1', ['quiet']), member('m2'), member('m3')];
		const options = placeOptions(quiet, 3);
		expect(options.map((o) => o.key)).toEqual([
			'',
			'room:r2',
			'room:r4',
			'room:r3',
			'house:h1',
			'house:h2',
			'room:r1'
		]);
		expect(needsMet(members, quiet, 'room:r2')).toEqual({ met: 0, of: 1 });
		expect(needsMet(members, quiet, 'room:r3')).toEqual({ met: 1, of: 1 });
		// the ♿ spot first; then the places that answer the needs, else placeOptions' order
		expect(
			rankPlaces(options, members, quiet).map((o) => [o.key, o.needs.met, o.needs.of])
		).toEqual([
			['room:r2', 0, 1],
			['house:h1', 0, 1],
			['room:r3', 1, 1],
			['house:h2', 1, 1],
			['room:r4', 0, 1]
		]);
		expect(defaultPlace(options, members, quiet)).toBe('room:r2');
		expect(recommendRooms(options, members, quiet).map((o) => o.key)).toEqual([
			'room:r2',
			'room:r3',
			'room:r4'
		]);
		// nobody needs anything: the ♿ spot first, then placeOptions' order
		expect(rankPlaces(options, three, quiet).map((o) => o.key)).toEqual([
			'room:r2',
			'house:h1',
			'room:r4',
			'room:r3',
			'house:h2'
		]);
		// no place fits everyone: no plan
		expect(defaultPlace(placeOptions(quiet, 12), members, quiet)).toBeNull();
	});

	it('recommends one room only: when just a whole house fits everyone, there is no plan', () => {
		// Villa: Dorm #1 has 2 free, Dorm #2 has 4 — the house fits 5, no room does
		const five = ['m1', 'm2', 'm3', 'm4', 'm5'].map((id) => member(id));
		const options = placeOptions(SPOTS, 5);
		expect(options.find((o) => o.key === 'house:h1')).toMatchObject({ fits: true });
		expect(recommendRooms(options, five, SPOTS)).toEqual([]);
		expect(defaultPlace(options, five, SPOTS)).toBeNull();
		expect(noPlanNote(options, five, SPOTS)).toBe(
			'No room has 5 free spots together: pick a spot for each with Change.'
		);
		// three fit into Dorm #2 (with its ♿ spot) or Den: rooms only
		expect(recommendRooms(placeOptions(SPOTS, 3), three, SPOTS).map((o) => o.key)).toEqual([
			'room:r2',
			'room:r3'
		]);
		expect(noPlanNote(placeOptions(SPOTS, 3), three, SPOTS)).toBe('');
	});

	it('never plans a spot the crew locked, nor counts it as free: a room fits with its other spots', () => {
		// Room 2: B1 + B2 locked, B3 + B4 free; Room 3: 5 free — one house
		const at = (roomId: string, room: string) => ({ roomId, room, houseId: 'h1', house: 'Villa' });
		const locked = [
			...['B1', 'B2', 'B3', 'B4'].map((label, i) =>
				spot(`r2-${i + 1}`, 'r1', label, {
					...at('rq2', 'Room 2'),
					label: `${label} · Room 2 · Villa`,
					locked: i < 2
				})
			),
			...['B1', 'B2', 'B3', 'B4', 'B5'].map((label, i) =>
				spot(`r3-${i + 1}`, 'r1', label, {
					...at('rq3', 'Room 3'),
					label: `${label} · Room 3 · Villa`
				})
			)
		];
		const four = ['m1', 'm2', 'm3', 'm4'].map((id) => member(id));
		const options = placeOptions(locked, 4);
		// Room 2 has 2 spots for the group, not 4: too small
		expect(options.map((o) => [o.key, o.label, o.free, o.locked, o.fits])).toEqual([
			['', ANYWHERE, 7, 2, true],
			['room:rq3', 'Room 3 · Villa — 5 free · fits all 4', 5, 0, true],
			['house:h1', 'Villa, whole house — 7 free · fits all 4', 7, 2, true],
			['room:rq2', 'Room 2 · Villa — 2 free · too small', 2, 2, false]
		]);
		expect(recommendRooms(options, four, locked).map((o) => o.key)).toEqual(['room:rq3']);
		expect(defaultPlace(options, four, locked)).toBe('room:rq3');
		// put into Room 2 anyway: its free spots, and nothing for the rest
		expect(proposePlan(four, locked, 'room:rq2')).toEqual({
			m1: 'r2-3',
			m2: 'r2-4',
			m3: '',
			m4: ''
		});
		// not in a whole house, not anywhere: nine members, seven spots
		expect(
			Object.values(proposePlan(four, locked, 'house:h1')).every((bedId) => bedId.startsWith('r3-'))
		).toBe(true);
		const nine = ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8', 'm9'].map((id) => member(id));
		const anywhere = Object.values(proposePlan(nine, locked, ''));
		expect(anywhere.filter((bedId) => bedId === '')).toHaveLength(2);
		expect(anywhere).not.toContain('r2-1');
		expect(anywhere).not.toContain('r2-2');
		// a quiet Room 2 doesn't help: it still can't take everyone
		const quiet = locked.map((s) => (s.roomId === 'rq2' ? { ...s, features: ['quiet'] } : s));
		const needy = [member('m1', ['quiet']), member('m2'), member('m3'), member('m4')];
		expect(rankPlaces(placeOptions(quiet, 4), needy, quiet).map((o) => o.key)).toEqual([
			'house:h1',
			'room:rq3'
		]);
	});

	it('fills a ♿ spot first, also next to a locked spot', () => {
		// Room A: a1 + a2 free, a3 locked, a4 ♿; Room B: 5 free — a group of 3, no needs
		const at = (roomId: string, room: string, label: string) => ({
			roomId,
			room,
			houseId: 'h1',
			house: 'Villa',
			label: `${label} · ${room} · Villa`
		});
		const spots = [
			spot('a1', 'r1', 'A1', at('ra', 'Room A', 'A1')),
			spot('a2', 'r1', 'A2', at('ra', 'Room A', 'A2')),
			spot('a3', 'r1', 'A3', { ...at('ra', 'Room A', 'A3'), locked: true }),
			spot('a4', 'r1', 'A4', { ...at('ra', 'Room A', 'A4'), special: true }),
			...['B1', 'B2', 'B3', 'B4', 'B5'].map((label, i) =>
				spot(`b${i + 1}`, 'r1', label, at('rb', 'Room B', label))
			)
		];
		const options = placeOptions(spots, 3);
		expect(options.map((o) => [o.key, o.label])).toEqual([
			['', ANYWHERE],
			['room:ra', 'Room A · Villa — 3 free (♿ 1) · fits all 3'],
			['room:rb', 'Room B · Villa — 5 free · fits all 3'],
			['house:h1', 'Villa, whole house — 8 free (♿ 1) · fits all 3']
		]);
		expect(defaultPlace(options, three, spots)).toBe('room:ra');
		expect(proposePlan(three, spots, 'room:ra')).toEqual({ m1: 'a4', m2: 'a1', m3: 'a2' });
		// someone who needs something gets the ♿ spot
		const needy = [member('m1'), member('m2', ['step_free']), member('m3')];
		expect(proposePlan(needy, spots, 'room:ra')).toEqual({ m1: 'a1', m2: 'a4', m3: 'a2' });
		// a fourth member: Room A is too small without its locked spot
		const four = [...three, member('m4')];
		expect(defaultPlace(placeOptions(spots, 4), four, spots)).toBe('room:rb');
		expect(proposePlan(four, spots, 'room:ra')).toEqual({ m1: 'a4', m2: 'a1', m3: 'a2', m4: '' });
	});

	it('spreads a group over a house into the room with the most free spots, never a locked one', () => {
		// Room X: x1 + x2 free, x3 + x4 locked; Room Y: 3 free — a group of 3
		const at = (roomId: string, room: string, label: string) => ({
			roomId,
			room,
			houseId: 'hx',
			house: 'Hut',
			label: `${label} · ${room} · Hut`
		});
		const spots = [
			spot('x1', 'r1', 'B1', at('rx', 'Room X', 'B1')),
			spot('x2', 'r1', 'B2', at('rx', 'Room X', 'B2')),
			spot('x3', 'r1', 'B3', { ...at('rx', 'Room X', 'B3'), locked: true }),
			spot('x4', 'r1', 'B4', { ...at('rx', 'Room X', 'B4'), locked: true }),
			spot('y1', 'r1', 'B1', at('ry', 'Room Y', 'B1')),
			spot('y2', 'r1', 'B2', at('ry', 'Room Y', 'B2')),
			spot('y3', 'r1', 'B3', at('ry', 'Room Y', 'B3'))
		];
		expect(proposePlan(three, spots, 'house:hx')).toEqual({ m1: 'y1', m2: 'y2', m3: 'y3' });
		// a fourth member: Room Y is full, then Room X's free spots
		expect(Object.values(proposePlan([...three, member('m4')], spots, 'house:hx'))).toEqual([
			'y1',
			'y2',
			'y3',
			'x1'
		]);
		// six: the locked spots stay out, the sixth member gets none
		const six = [...three, member('m4'), member('m5'), member('m6')];
		expect(Object.values(proposePlan(six, spots, 'house:hx'))).toEqual([
			'y1',
			'y2',
			'y3',
			'x1',
			'x2',
			''
		]);
	});

	it('keeps the rest of a group with the members the crew booked already', () => {
		// Room X (Villa): the crew booked two members there, 4 spots still free;
		// Room Z (Hut): exactly 3 free — three members still need a spot
		const at = (roomId: string, label: string) => ({
			roomId,
			room: roomId === 'rx' ? 'Room X' : 'Room Z',
			houseId: roomId === 'rx' ? 'hx' : 'hz',
			house: roomId === 'rx' ? 'Villa' : 'Hut',
			label: `${label} · ${roomId === 'rx' ? 'Room X · Villa' : 'Room Z · Hut'}`
		});
		const spots = [
			...['B3', 'B4', 'B5', 'B6'].map((label, i) =>
				spot(`x${i + 3}`, 'r1', label, at('rx', label))
			),
			...['B1', 'B2', 'B3'].map((label, i) => spot(`z${i + 1}`, 'r1', label, at('rz', label)))
		];
		const booked = (id: string, label: string) =>
			member(id, [], { crewSpotLabel: `${label} · Room X · Villa`, crewRoomId: 'rx' });
		const group = [booked('k1', 'B1'), booked('k2', 'B2'), ...three];
		const options = placeOptions(spots, 3);
		// on their own, the three would go to the snuggest room, Room Z …
		expect(defaultPlace(options, three, spots)).toBe('room:rz');
		// … but two of the group sleep in Room X already: the rest joins them
		expect(recommendRooms(options, group, spots).map((o) => o.key)).toEqual(['room:rx', 'room:rz']);
		expect(defaultPlace(options, group, spots)).toBe('room:rx');
		expect(noPlanNote(options, group, spots)).toBe('');
		// Room X can't take the rest: no plan, the rows start on Keep as is …
		const fewer = spots.filter((s) => s.bedId !== 'x5' && s.bedId !== 'x6');
		expect(defaultPlace(placeOptions(fewer, 3), group, fewer)).toBeNull();
		// … and the card says why — Room Z still has 3 free spots together
		expect(noPlanNote(placeOptions(fewer, 3), group, fewer)).toBe(
			'The room where k1 and k2 sleep has no space for all 3 others (2 free): choose a room for the rest, or pick each with Change.'
		);
		const one = [booked('k1', 'B1'), ...three];
		expect(noPlanNote(placeOptions(fewer, 3), one, fewer)).toBe(
			'The room where k1 sleeps has no space for all 3 others (2 free): choose a room for the rest, or pick each with Change.'
		);
		// "full" only when Room X has no free spot at all
		const none = spots.filter((s) => s.roomId !== 'rx');
		expect(noPlanNote(placeOptions(none, 3), group, none)).toBe(
			'The room where k1 and k2 sleep is full: choose a room for the rest, or pick each with Change.'
		);
		// no room has space for the three: that is what it says then
		const tiny = fewer.filter((s) => s.roomId === 'rx');
		expect(noPlanNote(placeOptions(tiny, 3), group, tiny)).toBe(
			'No room has 3 free spots together: pick a spot for each with Change.'
		);
	});

	it('names every room of members the crew booked, when they are in more than one', () => {
		const at = (roomId: string, room: string, label: string) => ({
			roomId,
			room,
			houseId: 'h1',
			house: 'Villa',
			label: `${label} · ${room} · Villa`
		});
		const spots = [
			spot('x1', 'r1', 'B1', at('rx', 'Room X', 'B1')),
			spot('z1', 'r1', 'B1', at('rz', 'Room Z', 'B1')),
			...['B1', 'B2', 'B3'].map((label, i) =>
				spot(`w${i + 1}`, 'r1', label, at('rw', 'Room W', label))
			)
		];
		const group = [
			member('k1', [], { crewSpotLabel: 'B2 · Room X · Villa', crewRoomId: 'rx' }),
			member('k2', [], { crewSpotLabel: 'B2 · Room Z · Villa', crewRoomId: 'rz' }),
			...three
		];
		const options = placeOptions(spots, 3);
		expect(recommendRooms(options, group, spots).map((o) => o.key)).toEqual(['room:rw']);
		expect(defaultPlace(options, group, spots)).toBeNull();
		expect(noPlanNote(options, group, spots)).toBe(
			'The rooms where k1 and k2 sleep have no space for all 3 others: choose a room for the rest, or pick each with Change.'
		);
		// both rooms without a free spot
		const rest = spots.filter((s) => s.roomId === 'rw');
		expect(noPlanNote(placeOptions(rest, 3), group, rest)).toBe(
			'The rooms where k1 and k2 sleep are full: choose a room for the rest, or pick each with Change.'
		);
	});

	it("counts a room's spots that other guests booked, not the group's own", () => {
		const booked = { rx: 3, ry: 1 };
		// the first member sleeps in Room X already
		const members = [{ roomId: 'rx' }, { roomId: '' }, {}];
		expect(othersBooked('rx', booked, members)).toBe(2);
		expect(othersBooked('ry', booked, members)).toBe(1);
		expect(othersBooked('rz', booked, members)).toBe(0);
		expect(othersBooked('ry', booked, [{ roomId: 'ry' }, { roomId: 'ry' }])).toBe(0);
	});

	it('swaps two planned spots, and sends a member back to Keep as is when the other row had none', () => {
		const plan = { a: 'b1', b: 'b2', c: '' };
		expect(repick(plan, 'a', 'b2')).toEqual({ changes: { a: 'b2', b: 'b1' }, bumped: '' });
		// c had no spot: a loses b1 and keeps nothing
		expect(repick(plan, 'c', 'b1')).toEqual({ changes: { c: 'b1', a: '' }, bumped: 'a' });
		// a free spot nobody is planned on
		expect(repick(plan, 'c', 'b9')).toEqual({ changes: { c: 'b9' }, bumped: '' });
		expect(repick(plan, 'a', 'b1')).toEqual({ changes: { a: 'b1' }, bumped: '' });
	});

	it('proposes the same, whatever order the spots come in', () => {
		const members = [member('m1', ['quiet']), member('m2'), member('m3', ['other'])];
		for (const key of ['', 'room:r2', 'house:h1', 'house:h2']) {
			expect(proposePlan(members, [...SPOTS].reverse(), key)).toEqual(
				proposePlan(members, SPOTS, key)
			);
		}
	});
});

describe('the PocketBase helper that deletes an empty group', () => {
	const { pruneGroup } = loadHookModule('lib/groups.js');

	function fakeApp(requests: { request_group: string }[], groups: { id: string }[]) {
		return {
			findRecordsByFilter: (
				_collection: string,
				_filter: string,
				_sort: string,
				limit: number,
				_offset: number,
				params: { g: string }
			) => requests.filter((r) => r.request_group === params.g).slice(0, limit || undefined),
			findRecordById: (_collection: string, id: string) => {
				const found = groups.find((g) => g.id === id);
				if (!found) throw new Error('sql: no rows in result set');
				return found;
			},
			delete: (record: { id: string }) => {
				groups.splice(groups.indexOf(record), 1);
			}
		};
	}

	it('deletes the group only when nobody is in it, and never throws', () => {
		const groups = [{ id: 'g1' }, { id: 'g2' }];
		const requests = [{ request_group: 'g1' }];
		const app = fakeApp(requests, groups);
		expect(pruneGroup(app, 'g1')).toBe(false);
		expect(pruneGroup(app, 'g2')).toBe(true);
		expect(groups).toEqual([{ id: 'g1' }]);
		expect(pruneGroup(app, '')).toBe(false);
		// gone already
		expect(pruneGroup(app, 'g2')).toBe(false);
		requests.length = 0;
		expect(pruneGroup(app, 'g1')).toBe(true);
		expect(groups).toEqual([]);
	});
});
