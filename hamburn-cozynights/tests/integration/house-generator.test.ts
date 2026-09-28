// tests/integration/house-generator.test.ts — the house generator against the
// real PocketBase: an approved admin's own session may create the whole tree
// (API rules), the bunk hook (pb_hooks/cozy_bunks.pb.js) accepts the pairs the
// generator writes, and deleting the house takes everything with it.
// tests/house-generator.test.ts covers the actions' checks with a fake.
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import type PocketBase from 'pocketbase';
import { APP_SETTINGS_ID } from '../../src/lib/server/constants';
import { arePaired, groupBunks } from '../../src/lib/bunks';
import { actions as newHouseActions } from '../../src/routes/admin/house/new/+page.server';
import { actions as houseActions } from '../../src/routes/admin/house/[id]/+page.server';
import { createAdmin, serviceAccount, uid } from '../stack-helpers';

let su: PocketBase;
let crew: Awaited<ReturnType<typeof createAdmin>>;
let original: Record<string, unknown>;

beforeAll(async () => {
	su = await serviceAccount();
	crew = await createAdmin(su, 'admin');
	const settings = await su.collection('app_settings').getOne(APP_SETTINGS_ID);
	original = {
		is_booking_active: settings.is_booking_active,
		booking_closed: settings.booking_closed
	};
	// Staging: the layout can change.
	await su.collection('app_settings').update(APP_SETTINGS_ID, {
		is_booking_active: false,
		booking_closed: false,
		booking_unlock_at: '',
		booking_close_at: ''
	});
});

afterEach(async () => {
	await su.collection('app_settings').update(APP_SETTINGS_ID, {
		is_booking_active: false,
		booking_closed: false
	});
});

/** Posts to an action as the approved admin, with the admin's own PocketBase session. */
function post(action: (event: any) => unknown, fields: Record<string, string>, params = {}) {
	const data = new FormData();
	for (const [key, value] of Object.entries(fields)) data.append(key, value);
	const locals = {
		pb: crew.client,
		admin: { id: crew.id, email: crew.email, name: '', role: 'admin', isSuperuser: false }
	};
	return action({ request: { formData: async () => data }, locals, params }) as Promise<any>;
}

async function treeOf(houseId: string) {
	const rooms = await su
		.collection('rooms')
		.getFullList({ filter: su.filter('house = {:id}', { id: houseId }), sort: 'room_number' });
	const beds = await su
		.collection('beds')
		.getFullList({ filter: su.filter('room.house = {:id}', { id: houseId }) });
	return { rooms, beds };
}

describe('the house generator in the real database', () => {
	it('lets an admin ignite a hut group of bunk huts in one go', async () => {
		const name = `Glitter Village ${uid()}`;
		const result = await post(newHouseActions.create, {
			name,
			x: '120',
			y: '140',
			kind: 'hut_group',
			sizes: '2x4b,1x3'
		});

		expect(result).toMatchObject({ success: true, rooms: 3, spots: 11 });
		const house = await su.collection('houses').getOne(result.houseId);
		expect(house).toMatchObject({ name, kind: 'hut_group', x: 120, y: 140 });

		const { rooms, beds } = await treeOf(house.id);
		expect(rooms.map((room) => room.room_number)).toEqual([1, 2, 3]);
		expect(rooms.map((room) => room.kind)).toEqual(['hut', 'hut', 'hut']);
		expect(rooms.map((room) => room.amount_beds)).toEqual([4, 4, 3]);
		expect(new Set(rooms.map((room) => room.name)).size).toBe(3);
		expect(beds.every((bed) => bed.enabled && !bed.occupied)).toBe(true);

		// Two bunk beds in each of the first two huts, paired on both sides.
		for (const room of rooms.slice(0, 2)) {
			const own = beds.filter((bed) => bed.room === room.id);
			const units = groupBunks(own.sort((a, b) => a.label.localeCompare(b.label)));
			expect(units.map((unit) => unit.kind)).toEqual(['bunk', 'bunk']);
			for (const unit of units) {
				if (unit.kind !== 'bunk') continue;
				expect(arePaired(unit.lower, unit.upper)).toBe(true);
				expect(unit.lower.bed_type).toBe('bunk_lower');
				expect(unit.upper.bed_type).toBe('bunk_upper');
			}
		}
		// The third hut has plain spots.
		const plain = beds.filter((bed) => bed.room === rooms[2].id);
		expect(plain.map((bed) => bed.label).sort()).toEqual(['B1', 'B2', 'B3']);
		expect(plain.every((bed) => !bed.bunk_partner && !bed.bed_type)).toBe(true);

		await su.collection('houses').delete(house.id);
	});

	it('adds rooms to a house that stands, in floor blocks after its last number', async () => {
		const made = await post(newHouseActions.create, {
			name: `Moonlit Manor ${uid()}`,
			x: '300',
			y: '300',
			sizes: '4x2'
		});
		const added = await post(
			houseActions.createRooms,
			{ sizes: '2x6b', floors: 'on' },
			{
				id: made.houseId
			}
		);

		expect(added).toMatchObject({ success: true, rooms: 2, spots: 12 });
		const { rooms, beds } = await treeOf(made.houseId);
		expect(rooms.map((room) => room.room_number)).toEqual([1, 2, 3, 4, 11, 12]);
		expect(beds).toHaveLength(4 * 2 + 2 * 6);

		// Deleting the house takes every generated room and spot with it.
		await su.collection('houses').delete(made.houseId);
		const after = await treeOf(made.houseId);
		expect(after.rooms).toHaveLength(0);
		expect(after.beds).toHaveLength(0);
	});

	it('refuses while booking is live and creates nothing', async () => {
		await su.collection('app_settings').update(APP_SETTINGS_ID, { is_booking_active: true });
		const name = `Late Lodge ${uid()}`;

		const result = await post(newHouseActions.create, { name, x: '1', y: '1', sizes: '1x2' });

		expect(result.status).toBe(403);
		const found = await su
			.collection('houses')
			.getFullList({ filter: su.filter('name = {:name}', { name }) });
		expect(found).toHaveLength(0);
	});
});

afterAll(async () => {
	await su.collection('app_settings').update(APP_SETTINGS_ID, original);
});
