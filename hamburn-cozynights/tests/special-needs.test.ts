// tests/special-needs.test.ts — special-needs requests: the form checks, what
// is stored (encrypted) and logged (never the guest's words), the decisions,
// assigning spots while booking is closed, pinned spots, special-needs beds
// in booking, counts and layout templates. Against real PocketBase:
// tests/integration/special-needs.test.ts.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$env/dynamic/private', () => ({
	env: {
		ENCRYPTION_KEY: '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff',
		PB_ADMIN_EMAIL: 'admin@test.com',
		PB_ADMIN_PASSWORD: 'password'
	}
}));

import { FakePb } from './fake-pb';
import { createLookupHash, decrypt } from '../src/lib/server/crypto';
import { isBedBookable } from '../src/lib/server/booking';
import { countSpots } from '../src/lib/occupancy';
import { InventoryService } from '../src/lib/server/inventory';
import { APP_SETTINGS_ID } from '../src/lib/server/constants';
import {
	HELPER_NEEDS_GROUP,
	REQUEST_PATHS,
	REQUEST_TEXT_MAX,
	cleanRequestText,
	countWords,
	isAccessNeed,
	isFormNeed,
	isProjectNeed,
	isSpecialNeed,
	needLabel,
	needsOutsidePath,
	parseRequestForm,
	requestKinds,
	requestPath,
	RETIRED_NEEDS,
	SPECIAL_NEEDS
} from '../src/lib/special-needs';
import {
	assignSpot,
	countRoomSpots,
	decideRequest,
	getGuestRequest,
	isSpotFixed,
	NEEDS_PADDED_LENGTH,
	releaseSpot,
	listAssignableSpots,
	listRequests,
	listSpecialSpots,
	RequestError,
	saveRequest,
	ticketName,
	withdrawRequest
} from '../src/lib/server/special-requests';
import { actions as requestPageActions } from '../src/routes/special-needs/+page.server';
import { actions as roomActions } from '../src/routes/room/[id]/+page.server';
import { actions as adminRequestActions } from '../src/routes/admin/requests/+page.server';
import { buildTemplate, parseTemplate, stringifyTemplate } from '../src/lib/template';
import { CONFIRMED_FIELDS } from '../src/lib/booking-check';

function form(fields: Record<string, string | string[]>): FormData {
	const data = new FormData();
	for (const [key, value] of Object.entries(fields)) {
		for (const v of Array.isArray(value) ? value : [value]) data.append(key, v);
	}
	return data;
}

const GOOD = {
	about: 'personal',
	needs: ['lower_bunk', 'quiet'],
	text: 'I need a lower bunk and a quiet room, please.',
	burnerName: 'Sparkle Pony',
	consent: 'yes'
};

const admin = {
	id: 'a1',
	email: 'crew@mauersegler.art',
	name: 'Crew',
	role: 'admin' as const,
	isSuperuser: false
};

/** A camp with one special-needs bed and one normal bed, a ticket and settings. */
function camp(settings: Record<string, unknown> = {}) {
	const pb = new FakePb();
	pb.seed('app_settings', {
		id: APP_SETTINGS_ID,
		is_booking_active: false,
		special_requests_open: true,
		...settings
	});
	const house = pb.seed('houses', { name: 'Villa' });
	const room = pb.seed('rooms', { name: 'Dorm', room_number: 2, house: house.id });
	const special = pb.seed('beds', {
		label: 'B1',
		room: room.id,
		enabled: true,
		occupied: false,
		is_locked: false,
		is_special: true,
		order: ''
	});
	const normal = pb.seed('beds', {
		label: 'B2',
		room: room.id,
		enabled: true,
		occupied: false,
		is_locked: false,
		is_special: false,
		order: ''
	});
	const code = 'HB-1001';
	const order = pb.seed('orders', {
		order_number: code,
		order_hash: createLookupHash(code),
		customer_name: 'Ada Lovelace',
		email: 'ada@example.com',
		burner_name: ''
	});
	return { pb, house, room, special, normal, code, order };
}

describe('request form', () => {
	it('accepts ticked needs, a short text, a burner name and consent', () => {
		const parsed = parseRequestForm(form(GOOD));
		expect(parsed).toEqual({
			ok: true,
			value: {
				needs: ['lower_bunk', 'quiet'],
				text: GOOD.text,
				burnerName: 'Sparkle Pony',
				consent: true,
				group: { mode: 'none' }
			}
		});
	});

	it('takes a project request on the same form', () => {
		const parsed = parseRequestForm(
			form({
				...GOOD,
				about: 'project',
				needs: ['own_room', 'near_project'],
				text: 'Our dome glows all night: someone has to sleep next to it.'
			})
		);
		expect(parsed.ok).toBe(true);
		expect(parsed.value.needs).toEqual(['own_room', 'near_project']);
		expect(requestKinds(parsed.value.needs)).toEqual({
			access: false,
			project: true,
			helper: false,
			groupOnly: false
		});
	});

	it('offers three paths, each with its own needs', () => {
		expect(REQUEST_PATHS.map((path) => [path.value, path.label])).toEqual([
			['personal', 'A personal need: a medical reason or a disability'],
			['helper', 'I come as the helper of someone with a personal need'],
			['project', 'An art project or a crew']
		]);
		expect(SPECIAL_NEEDS.map((need) => need.value)).toEqual([
			'lower_bunk',
			'step_free',
			'near_toilet',
			'quiet',
			'stable_light',
			'other',
			'helper',
			'own_room',
			'near_project'
		]);
		expect(needLabel('quiet')).toBe('A quiet area');
		expect(needLabel('stable_light')).toBe('Stable light conditions');
		expect(needLabel('own_room')).toBe('A room for our art project or crew');
		expect(needLabel('near_project')).toBe('A bed close to our art piece or project');
		expect(needLabel('helper')).toBe('I come as the helper of someone with a personal need');
		// stable light is a personal need; a helper and "Something else" are no ♿ need of their own
		expect(isAccessNeed('stable_light')).toBe(true);
		expect(isAccessNeed('helper')).toBe(false);
		expect(isAccessNeed('other')).toBe(false);
		expect(isProjectNeed('near_project')).toBe(true);
		expect(isProjectNeed('close_together')).toBe(true);
		expect(isProjectNeed('helper')).toBe(false);
	});

	it('keeps a personal need with every box of its path', () => {
		const all = ['lower_bunk', 'step_free', 'near_toilet', 'quiet', 'stable_light', 'other'];
		const parsed = parseRequestForm(form({ ...GOOD, needs: all }));
		expect(parsed.ok).toBe(true);
		expect(parsed.value.needs).toEqual(all);
		expect(requestKinds(parsed.value.needs)).toMatchObject({ access: true, helper: false });
		// what, not why: five characters are enough
		expect(parseRequestForm(form({ ...GOOD, text: 'Light' })).ok).toBe(true);
	});

	it('keeps only the needs of the chosen path (a browser without JavaScript posts them all)', () => {
		const mixed = ['lower_bunk', 'own_room', 'helper', 'near_project', 'quiet'];
		const personal = parseRequestForm(form({ ...GOOD, about: 'personal', needs: mixed }));
		expect(personal.value.needs).toEqual(['lower_bunk', 'quiet']);
		const project = parseRequestForm(
			form({ ...GOOD, about: 'project', needs: mixed, text: 'We guard the dome at night, please.' })
		);
		expect(project.ok).toBe(true);
		expect(project.value.needs).toEqual(['own_room', 'near_project']);
		// a path that ticks nothing of its own
		const bare = parseRequestForm(form({ ...GOOD, about: 'project', needs: ['quiet'] }));
		expect(bare.ok).toBe(false);
		if (!bare.ok) expect(bare.errors.needs).toBe('Tick a room or a bed.');
		const none = parseRequestForm(form({ ...GOOD, about: 'personal', needs: ['own_room'] }));
		expect(none.ok).toBe(false);
		if (!none.ok) {
			expect(none.errors.needs).toBe(
				'Tick at least one thing. If none fits, tick "Something else".'
			);
		}
	});

	it('asks to choose a path, and never guesses one from ticked boxes', () => {
		const parsed = parseRequestForm(form({ ...GOOD, about: '' }));
		expect(parsed.ok).toBe(false);
		if (!parsed.ok) expect(parsed.errors).toEqual({ about: 'Choose what your request is about.' });
		// what was ticked comes back, so a guest without JavaScript loses nothing
		expect(parsed.value.needs).toEqual(['lower_bunk', 'quiet']);
		const junk = parseRequestForm(form({ ...GOOD, about: 'friends' }));
		expect(junk.ok).toBe(false);
		if (!junk.ok) expect(junk.errors.about).toBe('Choose what your request is about.');
	});

	it('stores a helper as the helper alone, and only in a group', () => {
		const helper = {
			about: 'helper',
			needs: ['lower_bunk', 'own_room'],
			text: 'I need to sleep in the same room as the person I help.',
			consent: 'yes'
		};
		const alone = parseRequestForm(form(helper));
		expect(alone.ok).toBe(false);
		if (!alone.ok) expect(alone.errors).toEqual({ group: HELPER_NEEDS_GROUP });
		expect(alone.value.needs).toEqual(['helper']);
		expect(HELPER_NEEDS_GROUP).toBe(
			'A helper asks together with the person they help: join their group, or start one and share the link.'
		);

		const joining = parseRequestForm(
			form({ ...helper, groupMode: 'join', groupCode: 'ABCD-EF23' })
		);
		expect(joining).toEqual({
			ok: true,
			value: {
				needs: ['helper'],
				text: helper.text,
				burnerName: '',
				consent: true,
				group: { mode: 'join', code: 'ABCDEF23' }
			}
		});
		const starting = parseRequestForm(form({ ...helper, groupMode: 'start', groupName: 'Ada' }));
		expect(starting.ok).toBe(true);
		expect(parseRequestForm(form(helper), { inGroup: true }).ok).toBe(true);
		expect(requestKinds(['helper'])).toEqual({
			access: false,
			project: false,
			helper: true,
			groupOnly: false
		});

		// a helper says what the crew should know, in a group too
		const silent = parseRequestForm(
			form({ ...helper, text: '', groupMode: 'join', groupCode: 'ABCD-EF23' })
		);
		expect(silent.ok).toBe(false);
		if (!silent.ok) {
			expect(silent.errors).toEqual({
				text: 'Tell the crew in a few words what they should know.'
			});
		}
		// a typed group name without "Start a group" is said first
		const named = parseRequestForm(form({ ...helper, groupName: 'Ada' }));
		expect(named.ok).toBe(false);
		if (!named.ok) expect(Object.keys(named.errors)).toEqual(['groupName']);
	});

	it('wants at least five words from an art project or a crew', () => {
		const project = (text: string) =>
			parseRequestForm(form({ ...GOOD, about: 'project', needs: ['near_project'], text }));
		const four = project('Our dome needs guarding');
		expect(four.ok).toBe(false);
		if (!four.ok) {
			expect(four.errors.text).toBe(
				'Describe in at least 5 words what you need and why your art piece or project would be at risk without it.'
			);
		}
		expect(project('Our dome needs night guarding').ok).toBe(true);
		// a dash or an emoji alone is no word
		expect(project('Our dome needs — 🔥 guarding').ok).toBe(false);
		expect(countWords('  one\ntwo  three – 4 ✨ ')).toBe(4);
		// a personal need has no word count, only the few characters
		expect(parseRequestForm(form({ ...GOOD, text: 'Quiet' })).ok).toBe(true);
	});

	it('tells the path of a stored request, for changing it', () => {
		expect(requestPath(['helper'])).toBe('helper');
		expect(requestPath(['own_room'])).toBe('project');
		expect(requestPath(['near_project', 'own_room'])).toBe('project');
		expect(requestPath(['close_together'])).toBe('project');
		expect(requestPath(['quiet', 'other'])).toBe('personal');
		expect(requestPath(['other'])).toBe('personal');
		expect(requestPath(['power'])).toBe('personal');
		// from before the paths: what the guest needs wins, so changing the
		// request never drops it; a retired value never decides
		expect(requestPath(['quiet', 'own_room'])).toBe('personal');
		expect(requestPath(['lower_bunk', 'own_room'])).toBe('personal');
		expect(requestPath(['close_together', 'quiet'])).toBe('personal');
		expect(requestPath(['close_together', 'other'])).toBe('personal');
		// only part of a group
		expect(requestPath([])).toBeNull();
	});

	it('names what a path leaves out of a request from before the paths', () => {
		expect(needsOutsidePath(['lower_bunk', 'own_room'], 'personal')).toEqual(['own_room']);
		expect(needsOutsidePath(['lower_bunk', 'own_room'], 'project')).toEqual(['lower_bunk']);
		expect(needsOutsidePath(['lower_bunk', 'own_room'], 'helper')).toEqual([
			'lower_bunk',
			'own_room'
		]);
		// retired values are dropped anyway, so they are never named
		expect(needsOutsidePath(['quiet', 'close_together', 'power'], 'personal')).toEqual([]);
		// a request of one path has nothing outside it
		for (const needs of [['quiet', 'other'], ['helper'], ['own_room', 'near_project'], []]) {
			const path = requestPath(needs);
			if (path) expect(needsOutsidePath(needs, path), needs.join(',')).toEqual([]);
		}
	});

	it('no longer offers the power socket, but old requests keep it', () => {
		expect(SPECIAL_NEEDS.map((need) => need.value)).not.toContain('power');
		expect(isFormNeed('power')).toBe(false);
		expect(isSpecialNeed('power')).toBe(true);
		expect(needLabel('power')).toBe(RETIRED_NEEDS[0].label);
		expect(needLabel('power')).toMatch(/\(old form\)$/);

		const withQuiet = parseRequestForm(form({ ...GOOD, needs: ['power', 'quiet'] }));
		expect(withQuiet.value.needs).toEqual(['quiet']);
		const alone = parseRequestForm(form({ ...GOOD, needs: ['power'] }));
		expect(alone.ok).toBe(false);
		if (!alone.ok) expect(alone.errors.needs).toMatch(/Tick at least one thing/);
	});

	it('no longer offers "spots close together", but old requests keep it', () => {
		expect(isFormNeed('close_together')).toBe(false);
		expect(isSpecialNeed('close_together')).toBe(true);
		expect(needLabel('close_together')).toBe('Spots close to the people I come with (old form)');
		expect(requestKinds(['close_together'])).toMatchObject({ project: true, access: false });

		const posted = parseRequestForm(
			form({
				...GOOD,
				about: 'project',
				needs: ['close_together', 'own_room'],
				text: 'Our crew builds the dome together.'
			})
		);
		expect(posted.ok).toBe(true);
		expect(posted.value.needs).toEqual(['own_room']);
		const alone = parseRequestForm(form({ ...GOOD, about: 'project', needs: ['close_together'] }));
		expect(alone.ok).toBe(false);
		if (!alone.ok) expect(alone.errors.needs).toBe('Tick a room or a bed.');
	});

	it('tells what a request is about from its needs', () => {
		expect(requestKinds(['quiet'])).toEqual({
			access: true,
			project: false,
			helper: false,
			groupOnly: false
		});
		// unclear: treated as needing a special-needs spot
		expect(requestKinds(['other']).access).toBe(true);
		expect(requestKinds(['power']).access).toBe(true);
		expect(requestKinds(['stable_light']).access).toBe(true);
		// a request from before the paths may be both
		expect(requestKinds(['own_room', 'lower_bunk'])).toEqual({
			access: true,
			project: true,
			helper: false,
			groupOnly: false
		});
		expect(requestKinds(['near_project'])).toMatchObject({ access: false, project: true });
		// a helper never counts as needing a ♿ spot
		expect(requestKinds(['helper'])).toMatchObject({ access: false, project: false, helper: true });
		expect(requestKinds([])).toEqual({
			access: false,
			project: false,
			helper: false,
			groupOnly: true
		});
	});

	it('lets a group member leave needs and text empty, but a ticked need wants a few words', () => {
		const joining = { groupMode: 'join', groupCode: 'ABCD-EF23', consent: 'yes' };
		const bare = parseRequestForm(form(joining));
		expect(bare).toEqual({
			ok: true,
			value: {
				needs: [],
				text: '',
				burnerName: '',
				consent: true,
				group: { mode: 'join', code: 'ABCDEF23' }
			}
		});
		const ticked = parseRequestForm(form({ ...joining, about: 'personal', needs: ['quiet'] }));
		expect(ticked.ok).toBe(false);
		if (!ticked.ok) expect(Object.keys(ticked.errors)).toEqual(['text']);
		// a box ticked without a path still asks for one
		const unchosen = parseRequestForm(
			form({ ...joining, needs: ['quiet'], text: 'Quiet, please.' })
		);
		expect(unchosen.ok).toBe(false);
		if (!unchosen.ok) expect(Object.keys(unchosen.errors)).toEqual(['about']);
		// a path chosen, nothing ticked: still only part of the group
		const pathOnly = parseRequestForm(form({ ...joining, about: 'project' }));
		expect(pathOnly.ok).toBe(true);
		expect(pathOnly.value.needs).toEqual([]);

		// already in a group: the membership stays, whatever the form says
		const kept = parseRequestForm(form({ consent: 'yes', groupMode: 'start' }), { inGroup: true });
		expect(kept.ok).toBe(true);
		expect(kept.value.group).toEqual({ mode: 'keep' });
		// a text stays limited
		const long = parseRequestForm(form({ ...joining, text: 'x'.repeat(REQUEST_TEXT_MAX + 1) }));
		expect(long.ok).toBe(false);

		// starting a group follows the normal rules: the crew needs to know what it is about
		const starting = parseRequestForm(
			form({ groupMode: 'start', groupName: 'Neon Owls', consent: 'yes' })
		);
		expect(starting.ok).toBe(false);
		if (!starting.ok) expect(Object.keys(starting.errors).sort()).toEqual(['about', 'text']);
	});

	it('asks for a group name of 2 to 40 characters when starting one', () => {
		const start = (groupName: string) =>
			parseRequestForm(form({ ...GOOD, groupMode: 'start', groupName }));
		const good = start('  Neon \n Owls ');
		expect(good.ok).toBe(true);
		expect(good.value.group).toEqual({ mode: 'start', name: 'Neon Owls' });
		for (const name of ['', 'N', 'x'.repeat(41)]) {
			const bad = start(name);
			expect(bad.ok).toBe(false);
			if (!bad.ok) {
				expect(bad.errors.groupName).toBe('Give your group a name (2 to 40 characters).');
			}
		}
		expect(start('x'.repeat(40)).ok).toBe(true);
	});

	it('takes a group code however it is typed or pasted', () => {
		const join = (groupCode: string) =>
			parseRequestForm(form({ ...GOOD, groupMode: 'join', groupCode })).value.group;
		for (const typed of [
			'ABCDEF23',
			'abcd ef23',
			'ABCD-EF23',
			' abcd-ef23 ',
			'https://cozynights.hamburn.de/special-needs?group=ABCDEF23',
			'https://x.test/special-needs?group=abcdef23&utm=1'
		]) {
			expect(join(typed)).toEqual({ mode: 'join', code: 'ABCDEF23' });
		}
		for (const bad of ['', 'ABCDEF2', 'ABCDEF234', 'ABCDEF01', 'ABCD-EFIO']) {
			const parsed = parseRequestForm(form({ ...GOOD, groupMode: 'join', groupCode: bad }));
			expect(parsed.ok).toBe(false);
			if (!parsed.ok) {
				expect(parsed.errors.groupCode).toBe(
					'A group code has 8 letters and digits, like ABCD-EF23.'
				);
			}
		}
		// anything else than start or join is "just for me"
		expect(parseRequestForm(form({ ...GOOD, groupMode: 'lead' })).value.group).toEqual({
			mode: 'none'
		});
	});

	it('refuses a group name typed while "Just for me" stays picked (no JavaScript)', () => {
		const named = parseRequestForm(form({ ...GOOD, groupMode: 'none', groupName: ' Neon Owls ' }));
		expect(named.ok).toBe(false);
		if (!named.ok) {
			expect(named.errors).toEqual({
				groupName: 'You named a group: choose “Start a group”, or clear the name.'
			});
		}
		// an invite fills in the code: picking "Just for me" with it is fine
		const invited = parseRequestForm(
			form({ ...GOOD, groupMode: 'none', groupName: '  ', groupCode: 'ABCDEF23' })
		);
		expect(invited.ok).toBe(true);
		expect(invited.value.group).toEqual({ mode: 'none' });
	});

	it('always asks for consent, in a group too', () => {
		const parsed = parseRequestForm(form({ groupMode: 'join', groupCode: 'ABCDEF23' }));
		expect(parsed.ok).toBe(false);
		if (!parsed.ok) expect(Object.keys(parsed.errors)).toEqual(['consent']);
	});

	it('asks for at least one need, a text and consent — in English', () => {
		const parsed = parseRequestForm(form({ text: 'hi' }));
		expect(parsed.ok).toBe(false);
		if (parsed.ok) return;
		expect(Object.keys(parsed.errors).sort()).toEqual(['about', 'consent', 'text']);
		expect(parsed.errors.consent).toMatch(/consent/i);
	});

	it('drops needs that are not on the list and duplicates', () => {
		const parsed = parseRequestForm(
			form({ ...GOOD, needs: ['quiet', 'quiet', 'jacuzzi', '<script>'] })
		);
		expect(parsed.value.needs).toEqual(['quiet']);
	});

	it('limits the text and the burner name', () => {
		const long = parseRequestForm(form({ ...GOOD, text: 'x'.repeat(REQUEST_TEXT_MAX + 1) }));
		expect(long.ok).toBe(false);
		if (!long.ok) expect(long.errors.text).toMatch(/at most 500/);

		const name = parseRequestForm(form({ ...GOOD, burnerName: 'n'.repeat(81) }));
		expect(name.ok).toBe(false);
		if (!name.ok) expect(name.errors.burnerName).toBeTruthy();
	});

	it('cleans line breaks, control and invisible characters', () => {
		const raw = ' Lower bunk\r\n\r\n\r\n\r\nplease\u0007 \u200b ok\ttoo ';
		expect(cleanRequestText(raw)).toBe('Lower bunk\n\nplease ok too');
	});

	it('offers each need once', () => {
		const values = [...SPECIAL_NEEDS, ...RETIRED_NEEDS].map((need) => need.value);
		expect(new Set(values).size).toBe(values.length);
	});
});

describe('special-needs beds in booking and counts', () => {
	it("are only for the crew's request flow, not even for admins with a ticket", () => {
		const bed = { enabled: true, is_locked: false, is_special: true };
		expect(isBedBookable(bed)).toBe(false);
		expect(isBedBookable(bed, { allowLocked: true })).toBe(false);
		expect(isBedBookable(bed, { allowSpecial: true })).toBe(true);
		expect(isBedBookable({ enabled: true, is_locked: false })).toBe(true);
		// a locked spot stays for admins with a ticket
		const locked = { enabled: true, is_locked: true, is_special: false };
		expect(isBedBookable(locked)).toBe(false);
		expect(isBedBookable(locked, { allowLocked: true })).toBe(true);
		expect(isBedBookable(locked, { allowSpecial: true })).toBe(false);
		// both: the request flow may (it passes both)
		const both = { enabled: true, is_locked: true, is_special: true };
		expect(isBedBookable(both, { allowLocked: true })).toBe(false);
		expect(isBedBookable(both, { allowLocked: true, allowSpecial: true })).toBe(true);
		// deactivated: nobody
		expect(
			isBedBookable({ ...bed, enabled: false }, { allowLocked: true, allowSpecial: true })
		).toBe(false);
	});

	it('stay closed on the room page for an admin with a ticket; a locked spot does not', async () => {
		const c = camp({ is_booking_active: true });
		await c.pb.collection('beds').update(c.normal.id, { is_locked: true });
		const locals = { pb: c.pb, adminPb: c.pb, orderNumber: c.code, admin };

		const { load } = await import('../src/routes/room/[id]/+page.server');
		const data: any = await load({
			params: { id: c.room.id },
			locals,
			cookies: { delete: () => {} }
		} as any);
		expect(data.beds.map((b: any) => [b.label, b.bookable])).toEqual([
			['B1', false],
			['B2', true]
		]);

		// a hand-made post doesn't get it either
		const special: any = await roomActions.bookBed({
			request: {
				formData: async () => form({ bedId: c.special.id, guestName: 'X', ...CONFIRMED_FIELDS })
			},
			locals
		} as any);
		expect(special.status).toBe(409);
		expect(special.data.error).toMatch(/not available/);
		expect(c.pb.rows('beds').find((b) => b.id === c.special.id)!.order).toBe('');

		const locked: any = await roomActions.bookBed({
			request: {
				formData: async () => form({ bedId: c.normal.id, guestName: 'X', ...CONFIRMED_FIELDS })
			},
			locals
		} as any);
		expect(locked).toEqual({ success: true });
		expect(c.pb.rows('beds').find((b) => b.id === c.normal.id)!.order).toBe(c.order.id);
	});

	it('never count as free', () => {
		expect(
			countSpots([
				{ enabled: true, occupied: false, is_locked: false, is_special: true },
				{ enabled: true, occupied: false, is_locked: false, is_special: false }
			])
		).toMatchObject({ total: 2, occupied: 0, free: 1, checkedIn: 0, special: 1 });
	});

	it('look taken on the public map, which never learns which beds are special', async () => {
		const { pb } = camp();
		const [house] = await new InventoryService(pb as any).getFullTree();
		const beds = house.rooms[0].beds;
		expect(beds.map((b) => [b.label, b.occupied])).toEqual([
			['B1', true],
			['B2', false]
		]);
		expect(beds.every((b) => b.is_special === false)).toBe(true);
		expect(house.freeBeds).toBe(1);
	});
});

describe('layout templates keep special-needs spots', () => {
	it('round-trips the flag and leaves files without special spots unchanged', () => {
		const records = {
			houses: [{ id: 'h1', name: 'Villa', x: 1, y: 2 }],
			rooms: [{ id: 'r1', house: 'h1', name: 'Dorm', room_number: 1 }],
			beds: [
				{ room: 'r1', label: 'B1', enabled: true, is_locked: false, is_special: true },
				{ room: 'r1', label: 'B2', enabled: true, is_locked: false, is_special: false }
			]
		};
		const text = stringifyTemplate(buildTemplate(records));
		expect(text).toContain(
			'{ "label": "B1", "enabled": true, "is_locked": false, "is_special": true }'
		);
		expect(text).toContain('{ "label": "B2", "enabled": true, "is_locked": false }');

		const parsed = parseTemplate(text);
		expect(parsed.ok).toBe(true);
		if (!parsed.ok) return;
		const beds = parsed.template.houses[0].rooms[0].beds;
		expect(beds[0].is_special).toBe(true);
		expect(beds[1]).not.toHaveProperty('is_special');
		expect(parsed.summary).toMatchObject({ beds: 2, activeBeds: 1, specialBeds: 1 });
	});

	it('refuses a flag that is not true or false', () => {
		const parsed = parseTemplate(
			JSON.stringify({
				format: 'cozynights-layout',
				version: '2.0',
				houses: [
					{
						name: 'Villa',
						x: 1,
						y: 1,
						rooms: [{ name: 'Dorm', room_number: 1, beds: [{ label: 'B1', is_special: 'yes' }] }]
					}
				]
			})
		);
		expect(parsed.ok).toBe(false);
		if (!parsed.ok) expect(parsed.errors[0]).toMatch(/is_special must be true or false/);
	});
});

describe('special-needs requests', () => {
	let c: ReturnType<typeof camp>;
	beforeEach(() => {
		c = camp();
	});

	it('stores what the guest wrote encrypted and tells the crew only that a request arrived', async () => {
		const parsed = parseRequestForm(form(GOOD));
		if (!parsed.ok) throw new Error('form');
		expect(await saveRequest(c.pb as any, c.order as any, parsed.value)).toBe('created');

		const [stored] = c.pb.rows('special_requests');
		expect(stored).toMatchObject({ order: c.order.id, status: 'pending' });
		// what was ticked is health data too: stored encrypted like the text
		expect(stored.needs).not.toContain('lower_bunk');
		expect(JSON.parse(decrypt(stored.needs))).toEqual(GOOD.needs);
		expect(stored.reason).not.toContain('lower bunk');
		expect(decrypt(stored.reason)).toBe(GOOD.text);
		expect(decrypt(stored.burner_name)).toBe('Sparkle Pony');
		expect(stored.consent_at).toBeTruthy();

		const events = c.pb.rows('admin_events');
		expect(events.map((e) => e.action)).toEqual(['special_request_new']);
		const logged = JSON.stringify(events);
		expect(logged).not.toContain('lower bunk');
		expect(logged).not.toContain('Ada');
		expect(logged).not.toContain('Sparkle');
		expect(events[0].details).toEqual({ open: 1 });

		expect(await getGuestRequest(c.pb as any, c.order.id)).toMatchObject({
			status: 'pending',
			text: GOOD.text,
			needs: GOOD.needs
		});
	});

	it('changes a waiting request instead of creating a second one', async () => {
		const parsed = parseRequestForm(form(GOOD));
		if (!parsed.ok) throw new Error('form');
		await saveRequest(c.pb as any, c.order as any, parsed.value);
		expect(
			await saveRequest(c.pb as any, c.order as any, { ...parsed.value, text: 'Only quiet.' })
		).toBe('updated');
		expect(c.pb.rows('special_requests')).toHaveLength(1);
		expect(c.pb.rows('admin_events')).toHaveLength(1);
	});

	it('keeps a decided request as it is', async () => {
		c.pb.seed('special_requests', { order: c.order.id, status: 'declined', needs: ['quiet'] });
		const parsed = parseRequestForm(form(GOOD));
		if (!parsed.ok) throw new Error('form');
		await expect(saveRequest(c.pb as any, c.order as any, parsed.value)).rejects.toBeInstanceOf(
			RequestError
		);
	});

	it('deletes a withdrawn request completely', async () => {
		c.pb.seed('special_requests', { order: c.order.id, status: 'pending', reason: 'x' });
		expect(await withdrawRequest(c.pb as any, c.order.id)).toBe(true);
		expect(c.pb.rows('special_requests')).toHaveLength(0);
		expect(c.pb.rows('admin_events').map((e) => e.action)).toEqual(['special_request_withdrawn']);
		expect(await withdrawRequest(c.pb as any, c.order.id)).toBe(false);
	});

	it('books a special-needs spot while booking is closed, approving the request on the way', async () => {
		const request = c.pb.seed('special_requests', { order: c.order.id, status: 'pending' });
		// the only way a ♿ spot is booked: the crew's request flow, also in Staging
		expect(await assignSpot(c.pb as any, admin, request.id, c.special.id)).toEqual({
			approved: true
		});

		const bed = c.pb.rows('beds').find((b) => b.id === c.special.id)!;
		expect(bed).toMatchObject({ occupied: true, order: c.order.id });
		expect(c.pb.rows('special_requests')[0]).toMatchObject({
			status: 'approved',
			decided_by: admin.email,
			bed: c.special.id
		});
		// no burner name anywhere: a random one, like a guest booking without one
		expect(decrypt(c.pb.rows('orders')[0].burner_name)).toMatch(/ #\d{3}$/);
		expect(c.pb.rows('admin_events').map((e) => e.action)).toEqual([
			'special_request_approved',
			'special_spot_assigned'
		]);
		expect(await isSpotFixed(c.pb as any, c.order.id)).toBe(true);
	});

	it('changes nothing when the spot is taken meanwhile', async () => {
		const request = c.pb.seed('special_requests', { order: c.order.id, status: 'pending' });
		await c.pb.collection('beds').update(c.special.id, { occupied: true, order: 'someone-else' });
		await expect(assignSpot(c.pb as any, admin, request.id, c.special.id)).rejects.toThrow(
			/already claimed/
		);
		expect(c.pb.rows('special_requests')[0].status).toBe('pending');
		expect(c.pb.rows('admin_events')).toHaveLength(0);
	});

	it('only fixes the spot the crew booked, not one the guest booked themselves', async () => {
		const request = c.pb.seed('special_requests', { order: c.order.id, status: 'pending' });
		await c.pb.collection('beds').update(c.normal.id, { occupied: true, order: c.order.id });
		await decideRequest(c.pb as any, admin, request.id, 'approved');
		expect(await isSpotFixed(c.pb as any, c.order.id)).toBe(false);

		// declining is fine: the guest keeps their own spot
		await decideRequest(c.pb as any, admin, request.id, 'declined');
		expect(c.pb.rows('beds').find((b) => b.id === c.normal.id)!.order).toBe(c.order.id);
	});

	it('forgets the booked spot when the crew releases it', async () => {
		const request = c.pb.seed('special_requests', { order: c.order.id, status: 'approved' });
		await assignSpot(c.pb as any, admin, request.id, c.special.id);
		await releaseSpot(c.pb as any, admin, request.id);
		expect(c.pb.rows('special_requests')[0]).toMatchObject({ status: 'approved', bed: '' });
		expect(c.pb.rows('beds').find((b) => b.id === c.special.id)!.order).toBeNull();
		expect(await isSpotFixed(c.pb as any, c.order.id)).toBe(false);
	});

	it('keeps the burner name the guest uses when the crew moves them', async () => {
		const { encrypt } = await import('../src/lib/server/crypto');
		const request = c.pb.seed('special_requests', {
			order: c.order.id,
			status: 'approved',
			burner_name: encrypt('Old Wish')
		});
		await c.pb.collection('orders').update(c.order.id, { burner_name: encrypt('Renamed Later') });
		await assignSpot(c.pb as any, admin, request.id, c.normal.id);
		expect(decrypt(c.pb.rows('orders')[0].burner_name)).toBe('Renamed Later');
	});

	it('uses the burner name from the request', async () => {
		const request = c.pb.seed('special_requests', { order: c.order.id, status: 'approved' });
		const parsed = parseRequestForm(form(GOOD));
		if (!parsed.ok) throw new Error('form');
		await c.pb.collection('special_requests').update(request.id, {
			burner_name: (await import('../src/lib/server/crypto')).encrypt('Neon Owl')
		});
		await assignSpot(c.pb as any, admin, request.id, c.normal.id);
		expect(decrypt(c.pb.rows('orders')[0].burner_name)).toBe('Neon Owl');
	});

	it('refuses to book for a declined request, and to decline a request whose ticket holds a spot', async () => {
		const request = c.pb.seed('special_requests', { order: c.order.id, status: 'declined' });
		await expect(assignSpot(c.pb as any, admin, request.id, c.special.id)).rejects.toThrow(
			/declined/
		);

		await decideRequest(c.pb as any, admin, request.id, 'approved');
		await assignSpot(c.pb as any, admin, request.id, c.special.id);
		await expect(decideRequest(c.pb as any, admin, request.id, 'declined')).rejects.toThrow(
			/Release the spot first/
		);
	});

	it('lists requests for admins with the ticket, never a ticket code as name', async () => {
		c.pb.seed('special_requests', { order: c.order.id, status: 'pending', needs: ['quiet'] });
		const other = c.pb.seed('orders', { order_number: 'HB-2002', customer_name: 'Ticket HB-2002' });
		c.pb.seed('special_requests', { order: other.id, status: 'pending', needs: ['other'] });

		const list = await listRequests(c.pb as any);
		expect(list.map((r) => r.ticket.name)).toEqual(['Ada Lovelace', '']);
		expect(JSON.stringify(list)).not.toContain('HB-2002');
		expect(ticketName({ customer_name: 'Ticket HB-2002', order_number: 'HB-2002' })).toBe('');
	});

	it('offers free spots, special-needs spots first', async () => {
		const spots = await listAssignableSpots(c.pb as any);
		expect(spots.map((s) => [s.label, s.special])).toEqual([
			['B1 · Dorm #2 · Villa', true],
			['B2 · Dorm #2 · Villa', false]
		]);
	});

	it('tells the spot picker the kinds, what the room offers, the bunk partner and the room sizes', async () => {
		Object.assign(c.house, { kind: 'house', features: ['quiet', 'toilets_inside'] });
		Object.assign(c.room, { kind: 'room', features: ['ground_floor'], features_off: ['quiet'] });
		Object.assign(c.special, { bed_type: 'bunk_lower', bunk_partner: c.normal.id });
		Object.assign(c.normal, {
			bed_type: 'bunk_upper',
			bunk_partner: c.special.id,
			features_off: ['ground_floor']
		});
		// taken and inactive spots: in the room's size only when active
		c.pb.seed('beds', { label: 'B3', room: c.room.id, enabled: true, occupied: true, order: '' });
		c.pb.seed('beds', { label: 'B4', room: c.room.id, enabled: false, occupied: false, order: '' });

		const spots = await listAssignableSpots(c.pb as any);
		expect(
			spots.map((s) => [s.spot, s.houseKind, s.roomKind, s.bunkPartner, s.roomFeatures, s.features])
		).toEqual([
			[
				'B1',
				'house',
				'room',
				c.normal.id,
				['ground_floor', 'toilets_inside'],
				['ground_floor', 'toilets_inside']
			],
			['B2', 'house', 'room', c.special.id, ['ground_floor', 'toilets_inside'], ['toilets_inside']]
		]);
		expect(await countRoomSpots(c.pb as any)).toEqual({ [c.room.id]: 3 });
	});

	it('sums a spot up without what its room or the spot itself switched off', async () => {
		// A superuser's call (features_off, src/lib/accommodation.ts): the Dorm
		// in a heated, quiet Villa stays cold, and B1 gives up the quiet as well —
		// so the ♿ matching never offers B1 to a guest who needs quiet.
		Object.assign(c.house, { features: ['heated', 'quiet'] });
		Object.assign(c.room, { features_off: ['heated'] });
		Object.assign(c.special, { features_off: ['quiet'] });
		const spots = await listAssignableSpots(c.pb as any);
		expect(spots.map((s) => [s.spot, s.features])).toEqual([
			['B1', []],
			['B2', ['quiet']]
		]);
	});

	it('still reads a power socket from an old request', async () => {
		const { encrypt } = await import('../src/lib/server/crypto');
		c.pb.seed('special_requests', {
			order: c.order.id,
			status: 'pending',
			// stored before v0.30.0: not padded
			needs: encrypt(JSON.stringify(['power', 'quiet']))
		});
		expect((await getGuestRequest(c.pb as any, c.order.id))?.needs).toEqual(['power', 'quiet']);
		expect((await listRequests(c.pb as any))[0].needs).toEqual(['power', 'quiet']);
	});

	it('pads the needs, so the stored length does not tell what was ticked', async () => {
		const other = c.pb.seed('orders', { order_number: 'HB-2002', customer_name: 'Bea' });
		const base = { text: 'Our dome crew.', burnerName: '', consent: true };
		await saveRequest(c.pb as any, c.order as any, { ...base, needs: [] });
		await saveRequest(c.pb as any, other as any, {
			...base,
			needs: ['lower_bunk', 'step_free', 'near_toilet']
		});
		const [a, b] = c.pb.rows('special_requests');
		expect(a.needs.length).toBe(b.needs.length);
		expect(JSON.parse(decrypt(b.needs))).toEqual(['lower_bunk', 'step_free', 'near_toilet']);
		// 24 + 32 + 480 hex characters and two colons: within the field's 1000
		expect(a.needs.length).toBe(538);
		expect(await getGuestRequest(c.pb as any, c.order.id)).toMatchObject({ needs: [] });
	});

	it('pads even the longest list: every value of the form and the old ones together', async () => {
		const every = [...SPECIAL_NEEDS, ...RETIRED_NEEDS].map((need) => need.value);
		expect(JSON.stringify(every).length).toBeLessThanOrEqual(NEEDS_PADDED_LENGTH);
		const other = c.pb.seed('orders', { order_number: 'HB-2002', customer_name: 'Bea' });
		const base = { text: 'x'.repeat(10), burnerName: '', consent: true };
		await saveRequest(c.pb as any, c.order as any, { ...base, needs: ['helper'] });
		await saveRequest(c.pb as any, other as any, { ...base, needs: every as any });
		const [a, b] = c.pb.rows('special_requests');
		expect(a.needs.length).toBe(538);
		expect(b.needs.length).toBe(538);
		expect(JSON.parse(decrypt(b.needs))).toEqual(every);
	});

	it('tells admins which group a request is in', async () => {
		const group = c.pb.seed('request_groups', { code: 'ABCDEF23', name: 'x' });
		c.pb.seed('special_requests', {
			order: c.order.id,
			status: 'pending',
			request_group: group.id
		});
		const other = c.pb.seed('orders', { order_number: 'HB-2002', customer_name: 'Bea' });
		c.pb.seed('special_requests', { order: other.id, status: 'pending' });
		expect((await listRequests(c.pb as any)).map((r) => r.groupId)).toEqual([group.id, '']);
	});

	it('keeps an empty text empty, and tells it apart from one that can not be read', async () => {
		const { encrypt } = await import('../src/lib/server/crypto');
		// a group member who wrote nothing
		await saveRequest(c.pb as any, c.order as any, {
			needs: [],
			text: '',
			burnerName: '',
			consent: true
		});
		expect(c.pb.rows('special_requests')[0].reason).toBe('');
		expect(await getGuestRequest(c.pb as any, c.order.id)).toMatchObject({ text: '' });

		const seed = (number: string, reason: string) =>
			c.pb.seed('special_requests', {
				order: c.pb.seed('orders', { order_number: number, customer_name: number }).id,
				status: 'pending',
				reason
			});
		// stored as encrypt('') before: an IV and a tag, no ciphertext
		seed('HB-2002', encrypt(''));
		// another ENCRYPTION_KEY
		seed('HB-2003', `${'a'.repeat(24)}:${'b'.repeat(32)}:${'cd'.repeat(8)}`);
		const list = await listRequests(c.pb as any);
		expect(list.map((r) => [r.text, r.textUnreadable])).toEqual([
			['', false],
			['', false],
			['', true]
		]);
	});

	it('lists every ♿ spot with its state and who holds it', async () => {
		const room = c.room.id;
		const spot = (label: string, data: Record<string, unknown>) =>
			c.pb.seed('beds', {
				label,
				room,
				enabled: true,
				occupied: false,
				is_locked: false,
				is_special: true,
				order: '',
				...data
			});
		const bea = c.pb.seed('orders', { order_number: 'HB-2002', customer_name: 'Bea Booker' });
		spot('B3', { occupied: true, order: bea.id }); // booked by a guest
		spot('B4', { occupied: true }); // TAKEN without a ticket
		spot('B5', { enabled: false }); // deactivated
		spot('B6', { is_locked: true }); // free, but locked
		const request = c.pb.seed('special_requests', { order: c.order.id, status: 'approved' });
		await assignSpot(c.pb as any, admin, request.id, c.special.id);

		const spots = await listSpecialSpots(c.pb as any);
		expect(spots.map((s) => [s.spot, s.state, s.holder, s.locked])).toEqual([
			['B1', 'request', 'Ada Lovelace', false],
			['B3', 'booked', 'Bea Booker', false],
			['B4', 'blocked', '', false],
			['B5', 'inactive', '', false],
			['B6', 'free', '', true]
		]);
		// the normal spot B2 is no ♿ spot
		expect(spots.every((s) => s.special)).toBe(true);
		expect(spots[0]).toMatchObject({
			label: 'B1 · Dorm #2 · Villa',
			roomId: room,
			houseId: c.house.id
		});
	});
});

describe('guest page actions', () => {
	it('refuses new requests while requests are closed', async () => {
		const c = camp({ special_requests_open: false });
		const result: any = await requestPageActions.save({
			request: { formData: async () => form(GOOD) },
			locals: { pb: c.pb, adminPb: c.pb, orderNumber: c.code, admin: null }
		} as any);
		expect(result.status).toBe(403);
		expect(c.pb.rows('special_requests')).toHaveLength(0);
		// what the guest typed comes back, so nothing is lost
		expect(result.data.values.text).toBe(GOOD.text);
	});

	it('takes the ticket from the session, never from the form', async () => {
		const c = camp();
		const result: any = await requestPageActions.save({
			request: { formData: async () => form({ ...GOOD, order: 'someone-else' }) },
			locals: { pb: c.pb, adminPb: c.pb, orderNumber: c.code, admin: null }
		} as any);
		expect(result).toEqual({ success: true, saved: 'created', group: null });
		expect(c.pb.rows('special_requests')[0].order).toBe(c.order.id);
	});

	it('needs a ticket code', async () => {
		const c = camp();
		const result: any = await requestPageActions.save({
			request: { formData: async () => form(GOOD) },
			locals: { pb: c.pb, adminPb: c.pb, orderNumber: null, admin: null }
		} as any);
		expect(result.status).toBe(401);
	});

	it('keeps a spot the crew picked: no moving, no releasing, a new name is fine', async () => {
		const c = camp({ is_booking_active: true });
		const request = c.pb.seed('special_requests', { order: c.order.id, status: 'approved' });
		await assignSpot(c.pb as any, admin, request.id, c.special.id);
		const locals = { pb: c.pb, adminPb: c.pb, orderNumber: c.code, admin: null };

		const moved: any = await roomActions.bookBed({
			request: { formData: async () => form({ bedId: c.normal.id, guestName: 'X' }) },
			locals
		} as any);
		expect(moved.status).toBe(409);
		expect(moved.data.error).toMatch(/only the crew can change it/);

		const released: any = await roomActions.unbookBed({ locals } as any);
		expect(released.status).toBe(409);

		const renamed: any = await roomActions.bookBed({
			request: { formData: async () => form({ bedId: c.special.id, guestName: 'Neon Owl' }) },
			locals
		} as any);
		expect(renamed).toEqual({ success: true });
		expect(c.pb.rows('beds').find((b) => b.id === c.special.id)!.order).toBe(c.order.id);
	});
});

describe('what guests can learn about spots', () => {
	it('taken spots look the same, whether special-needs, locked or normal', async () => {
		const c = camp({ is_booking_active: true });
		const other = c.pb.seed('orders', { order_number: 'HB-3003', customer_name: 'Other' });
		await c.pb.collection('beds').update(c.special.id, { occupied: true, order: other.id });
		await c.pb.collection('beds').update(c.normal.id, { occupied: true, order: 'third' });
		const { load } = await import('../src/routes/room/[id]/+page.server');
		const data: any = await load({
			params: { id: c.room.id },
			locals: { pb: c.pb, adminPb: c.pb, orderNumber: c.code, admin: null },
			cookies: { delete: () => {} }
		} as any);
		expect(data.beds.map((b: any) => [b.label, b.occupied, b.bookable])).toEqual([
			['B1', true, false],
			['B2', true, false]
		]);
		expect(JSON.stringify(data)).not.toMatch(/is_special|is_locked/);
	});

	it('a guest can still rename a spot they hold after the crew locked it', async () => {
		const c = camp({ is_booking_active: true });
		await c.pb
			.collection('beds')
			.update(c.normal.id, { occupied: true, order: c.order.id, is_locked: true });
		const locals = { pb: c.pb, adminPb: c.pb, orderNumber: c.code, admin: null };
		const renamed: any = await roomActions.bookBed({
			request: { formData: async () => form({ bedId: c.normal.id, guestName: 'New Name' }) },
			locals
		} as any);
		expect(renamed).toEqual({ success: true });

		// ...but a locked or special-needs spot they don't hold stays closed
		const claimed: any = await roomActions.bookBed({
			request: { formData: async () => form({ bedId: c.special.id, guestName: 'X' }) },
			locals
		} as any);
		expect(claimed.status).toBe(409);
	});
});

describe('admin request actions', () => {
	it('are for admins only', async () => {
		const c = camp();
		const locals = { pb: c.pb, adminPb: c.pb, admin: null };
		for (const name of ['approve', 'decline', 'assign', 'release', 'toggleRequests'] as const) {
			const result: any = await adminRequestActions[name]({
				request: { formData: async () => form({ id: 'x', bedId: 'y', open: 'true' }) },
				locals
			} as any);
			expect(result.status).toBe(403);
		}
	});

	it('checks the ids it gets', async () => {
		const c = camp();
		const locals = { pb: c.pb, adminPb: c.pb, admin };
		const result: any = await adminRequestActions.assign({
			request: { formData: async () => form({ id: 'not an id', bedId: c.special.id }) },
			locals
		} as any);
		expect(result.status).toBe(400);
	});

	it('explains a taken spot instead of failing', async () => {
		const c = camp();
		const request = c.pb.seed('special_requests', { order: c.order.id, status: 'approved' });
		await c.pb.collection('beds').update(c.special.id, { occupied: true, order: 'other' });
		const result: any = await adminRequestActions.assign({
			request: { formData: async () => form({ id: request.id, bedId: c.special.id }) },
			locals: { pb: c.pb, adminPb: c.pb, admin }
		} as any);
		expect(result.status).toBe(409);
		expect(result.data.error).toMatch(/Pick another spot/);
	});
});
