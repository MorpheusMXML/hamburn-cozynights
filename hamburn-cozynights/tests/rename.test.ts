// tests/rename.test.ts — renaming the camp layout after it was created: a
// click on the house's or room's title, or on a spot's label (InlineRename),
// posts to these actions. Only in Staging Mode, and with the rules of
// creating them: not empty, not too long, a house name once in the camp, a
// room number once in its house, a spot label once in its room.
import { describe, it, expect } from 'vitest';
import { actions as roomActions } from '../src/routes/admin/room/[id]/+page.server';
import { actions as houseActions } from '../src/routes/admin/house/[id]/+page.server';
import { actions as controlCenterActions } from '../src/routes/admin/+page.server';
import { APP_SETTINGS_ID } from '../src/lib/server/constants';
import { NAMES_LOCKED } from '../src/lib/server/names';
import { TEMPLATE_LIMITS } from '../src/lib/template';
import { FakePb } from './fake-pb';

const admin = { email: 'crew@mauersegler.art', role: 'admin', isSuperuser: false };

/** A browser's form post with these fields. */
const form = (fields: Record<string, string>) => {
	const data = new FormData();
	for (const [key, value] of Object.entries(fields)) data.append(key, value);
	return { formData: async () => data } as any;
};

/**
 * Two houses; the Villa has the Dorm #1 (spots B1, B2) and the Attic #2 (spot
 * A1). `live` puts the camp into Live Booking, where the layout is locked.
 */
function camp(live = false) {
	const pb = new FakePb();
	pb.seed('app_settings', { id: APP_SETTINGS_ID, is_booking_active: live });
	const villa = pb.seed('houses', { name: 'Villa', x: 1, y: 2 });
	const lodge = pb.seed('houses', { name: 'Lodge', x: 3, y: 4 });
	const dorm = pb.seed('rooms', { name: 'Dorm', room_number: 1, house: villa.id });
	const attic = pb.seed('rooms', { name: 'Attic', room_number: 2, house: villa.id });
	const b1 = pb.seed('beds', { label: 'B1', room: dorm.id });
	const b2 = pb.seed('beds', { label: 'B2', room: dorm.id });
	const a1 = pb.seed('beds', { label: 'A1', room: attic.id });
	const post =
		(actions: Record<string, any>, id: string) =>
		async (action: string, fields: Record<string, string>, locals: Record<string, unknown> = {}) =>
			(await actions[action]({
				request: form(fields),
				params: { id },
				locals: { pb, admin, ...locals }
			} as any)) as any;
	const row = (collection: string, id: string) => pb.rows(collection).find((r) => r.id === id)!;
	return {
		pb,
		ids: {
			villa: villa.id,
			lodge: lodge.id,
			dorm: dorm.id,
			attic: attic.id,
			b1: b1.id,
			b2: b2.id,
			a1: a1.id
		},
		house: post(houseActions, villa.id),
		room: post(roomActions, dorm.id),
		controlCenter: post(controlCenterActions, ''),
		row
	};
}

describe('renaming a house', () => {
	it('takes a new name from the house page', async () => {
		const { ids, house, row } = camp();
		expect(await house('renameHouse', { name: '  Seeblick  ' })).toEqual({ success: true });
		expect(row('houses', ids.villa).name).toBe('Seeblick');
		// its own name in other letters is fine: it is still the same house
		expect(await house('renameHouse', { name: 'SEEBLICK' })).toEqual({ success: true });
	});

	it('refuses a name another house has, an empty one and a too long one', async () => {
		const { ids, house, row } = camp();
		const taken = await house('renameHouse', { name: 'lodge' });
		expect(taken.status).toBe(400);
		expect(taken.data.message).toBe('There is already a house called "Lodge". Pick another name.');
		expect((await house('renameHouse', { name: '   ' })).data.message).toBe(
			'Enter a name for the house.'
		);
		const long = await house('renameHouse', {
			name: 'x'.repeat(TEMPLATE_LIMITS.houseNameLength + 1)
		});
		expect(long.data.message).toMatch(/too long/);
		expect(row('houses', ids.villa).name).toBe('Villa');
	});

	it('applies the same rules on the map (the Control Center action)', async () => {
		const { ids, controlCenter, row } = camp();
		const taken = await controlCenter('renameHouse', { id: ids.villa, name: 'LODGE' });
		expect(taken.status).toBe(400);
		expect(taken.data.error).toBe('There is already a house called "Lodge". Pick another name.');
		expect(await controlCenter('renameHouse', { id: ids.villa, name: 'Seeblick' })).toEqual({
			success: true
		});
		expect(row('houses', ids.villa).name).toBe('Seeblick');
	});
});

describe('renaming a room', () => {
	it('takes a new name and number', async () => {
		const { ids, room, row } = camp();
		expect(await room('renameRoom', { name: 'Dorm North', room_number: '5' })).toEqual({
			success: true
		});
		expect(row('rooms', ids.dorm)).toMatchObject({ name: 'Dorm North', room_number: 5 });
		// keeping its own number is fine
		expect(await room('renameRoom', { name: 'Dorm', room_number: '5' })).toEqual({ success: true });
	});

	it('refuses a number another room of the house has, or no number at all', async () => {
		const { ids, room, row } = camp();
		const taken = await room('renameRoom', { name: 'Dorm', room_number: '2' });
		expect(taken.status).toBe(400);
		expect(taken.data.message).toBe(
			'Room number 2 is already used by "Attic" in this house. Pick another number.'
		);
		for (const room_number of ['', '0', 'abc', '1.5', String(TEMPLATE_LIMITS.roomNumber + 1)]) {
			const wrong = await room('renameRoom', { name: 'Dorm', room_number });
			expect(wrong.data.message).toMatch(/Enter a room number: a whole number from 1 to 9999/);
		}
		expect((await room('renameRoom', { name: '', room_number: '1' })).data.message).toBe(
			'Enter a name for the room.'
		);
		expect(row('rooms', ids.dorm)).toMatchObject({ name: 'Dorm', room_number: 1 });
	});
});

describe('renaming a spot', () => {
	it('takes a new label, and only the label', async () => {
		const { ids, pb, room, row } = camp();
		Object.assign(row('beds', ids.b1), { bed_type: 'bunk_lower', features_off: ['quiet'] });
		expect(await room('renameSpot', { id: ids.b1, label: 'Top' })).toEqual({ success: true });
		expect(row('beds', ids.b1)).toMatchObject({
			label: 'Top',
			bed_type: 'bunk_lower',
			features_off: ['quiet']
		});
		expect(pb.rows('beds').map((bed) => bed.label)).toEqual(['Top', 'B2', 'A1']);
	});

	it('refuses a label the room has already, or a spot of another room', async () => {
		const { ids, room, row } = camp();
		const taken = await room('renameSpot', { id: ids.b1, label: 'b2' });
		expect(taken.status).toBe(400);
		expect(taken.data.message).toBe(
			'This room already has a spot called "b2". Pick another label.'
		);
		// A1 is in the Attic: the Dorm's page doesn't rename it
		const elsewhere = await room('renameSpot', { id: ids.a1, label: 'Z9' });
		expect(elsewhere.status).toBe(400);
		expect(row('beds', ids.a1).label).toBe('A1');
		// the same label in another room is fine
		expect(await room('renameSpot', { id: ids.b1, label: 'A1' })).toEqual({ success: true });
	});
});

describe('while booking is live or closed', () => {
	it('leaves every name as it is', async () => {
		const { ids, house, room, row } = camp(true);
		for (const result of [
			await house('renameHouse', { name: 'Seeblick' }),
			await room('renameRoom', { name: 'Dorm North', room_number: '5' }),
			await room('renameSpot', { id: ids.b1, label: 'Top' })
		]) {
			expect(result.status).toBe(403);
			expect(result.data.message).toBe(NAMES_LOCKED);
		}
		expect(row('houses', ids.villa).name).toBe('Villa');
		expect(row('rooms', ids.dorm)).toMatchObject({ name: 'Dorm', room_number: 1 });
		expect(row('beds', ids.b1).label).toBe('B1');
	});

	it('refuses anyone who is not an admin', async () => {
		const { house, room, ids } = camp();
		const guest = { admin: null };
		expect((await house('renameHouse', { name: 'X' }, guest)).status).toBe(403);
		expect((await room('renameRoom', { name: 'X', room_number: '3' }, guest)).status).toBe(403);
		expect((await room('renameSpot', { id: ids.b1, label: 'X' }, guest)).status).toBe(403);
	});
});
