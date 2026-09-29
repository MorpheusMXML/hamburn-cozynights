// tests/house-generator.test.ts — the house generator's server side: IGNITE
// HOUSE (/admin/house/new?/create) and ADD ROOMS (/admin/house/[id]?/createRooms)
// against the in-memory PocketBase. The real database (hooks, rules) is
// covered by tests/integration/house-generator.test.ts.
import { describe, expect, it, vi } from 'vitest';
import { actions as newHouseActions } from '../src/routes/admin/house/new/+page.server';
import { actions as houseActions } from '../src/routes/admin/house/[id]/+page.server';
import { APP_SETTINGS_ID } from '../src/lib/server/constants';
import { arePaired } from '../src/lib/bunks';
import { FakePb } from './fake-pb';

vi.mock('$env/dynamic/private', () => ({
	env: {
		ENCRYPTION_KEY: '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff',
		PB_ADMIN_EMAIL: 'admin@test.com',
		PB_ADMIN_PASSWORD: 'password'
	}
}));

type Row = Record<string, any>;

const admin = {
	id: 'admin1',
	email: 'crew@mauersegler.art',
	name: '',
	role: 'admin',
	isSuperuser: false
};

/** A browser's form post with these fields. */
function form(fields: Record<string, string>) {
	const data = new FormData();
	for (const [key, value] of Object.entries(fields)) data.append(key, value);
	return { formData: async () => data } as any;
}

/** A camp in Staging Mode (or live), and the two actions posted to it as an admin. */
function camp(phase: 'staging' | 'live' = 'staging') {
	const pb = new FakePb();
	pb.seed('app_settings', {
		id: APP_SETTINGS_ID,
		is_booking_active: phase === 'live',
		booking_unlock_at: ''
	});
	const locals = { pb, admin };
	const ignite = async (fields: Record<string, string>) =>
		(await newHouseActions.create({ request: form(fields), locals } as any)) as any;
	const addRooms = async (houseId: string, fields: Record<string, string>) =>
		(await houseActions.createRooms({
			request: form(fields),
			params: { id: houseId },
			locals
		} as any)) as any;
	const roomsOf = (houseId: string) =>
		pb
			.rows('rooms')
			.filter((room) => room.house === houseId)
			.sort((a, b) => a.room_number - b.room_number);
	const spotsOf = (roomId: string) => pb.rows('beds').filter((bed) => bed.room === roomId);
	return { pb, ignite, addRooms, roomsOf, spotsOf };
}

describe('IGNITE HOUSE: a house with its rooms in one go', () => {
	it('creates the house, rooms with rolled names and active spots B1 … Bn', async () => {
		const { pb, ignite, roomsOf, spotsOf } = camp();

		const result = await ignite({
			name: 'Snoozy Sloth Lodge',
			x: '100',
			y: '200',
			sizes: '2x3,1x2'
		});

		expect(result).toMatchObject({ success: true, rooms: 3, spots: 8 });
		const house = pb.rows('houses')[0];
		expect(house).toMatchObject({ name: 'Snoozy Sloth Lodge', x: 100, y: 200 });
		expect(result.houseId).toBe(house.id);

		const rooms = roomsOf(house.id);
		expect(rooms.map((room) => room.room_number)).toEqual([1, 2, 3]);
		expect(rooms.map((room) => room.amount_beds)).toEqual([3, 3, 2]);
		expect(rooms.every((room) => room.kind === 'room')).toBe(true);
		const names = rooms.map((room) => room.name);
		expect(new Set(names).size).toBe(3);
		for (const name of names) expect(name).toMatch(/^\S+( \S+)+$/);

		const spots = spotsOf(rooms[0].id);
		expect(spots.map((spot) => spot.label)).toEqual(['B1', 'B2', 'B3']);
		for (const spot of pb.rows('beds')) {
			expect(spot).toMatchObject({ enabled: true, occupied: false });
			expect(spot.bed_type ?? '').toBe('');
		}
	});

	it('gives a hut group huts, and stacks bunk sizes in pairs on both sides', async () => {
		const { pb, ignite, roomsOf, spotsOf } = camp();

		await ignite({
			name: 'Glitter Village',
			x: '10',
			y: '10',
			kind: 'hut_group',
			sizes: '2x5b'
		});

		const house = pb.rows('houses')[0];
		expect(house.kind).toBe('hut_group');
		const rooms = roomsOf(house.id);
		expect(rooms.map((room) => room.kind)).toEqual(['hut', 'hut']);

		const spots = spotsOf(rooms[1].id);
		const byLabel = (label: string) => spots.find((spot) => spot.label === label) as Row;
		expect(byLabel('B1')).toMatchObject({ bed_type: 'bunk_lower', bunk_partner: byLabel('B2').id });
		expect(byLabel('B2')).toMatchObject({ bed_type: 'bunk_upper', bunk_partner: byLabel('B1').id });
		expect(arePaired(byLabel('B3') as any, byLabel('B4') as any)).toBe(true);
		// The fifth spot has nobody to stack with.
		expect(byLabel('B5').bunk_partner ?? '').toBe('');
		expect(byLabel('B5').bed_type ?? '').toBe('');
	});

	it('numbers floor blocks: 1–2, then 11–13', async () => {
		const { pb, ignite, roomsOf } = camp();

		await ignite({ name: 'Moonlit Manor', x: '1', y: '1', sizes: '2x4,3x6', floors: 'on' });

		const rooms = roomsOf(pb.rows('houses')[0].id);
		expect(rooms.map((room) => room.room_number)).toEqual([1, 2, 11, 12, 13]);
	});

	it('creates a house without rooms when there are no sizes', async () => {
		const { pb, ignite } = camp();

		const result = await ignite({ name: 'Empty Embassy', x: '5', y: '5', sizes: '' });

		expect(result).toMatchObject({ success: true, rooms: 0, spots: 0 });
		expect(pb.rows('houses')).toHaveLength(1);
		expect(pb.rows('rooms')).toHaveLength(0);
	});

	it('refuses a plan out of range, a taken name, an unknown kind — and creates nothing', async () => {
		const { pb, ignite } = camp();
		pb.seed('houses', { name: 'Villa', x: 0, y: 0 });

		const tooBig = await ignite({ name: 'Big Palace', x: '1', y: '1', sizes: '11x50' });
		const twice = await ignite({ name: 'villa', x: '1', y: '1', sizes: '1x2' });
		const kind = await ignite({
			name: 'Odd Outpost',
			x: '1',
			y: '1',
			kind: 'castle',
			sizes: '1x2'
		});
		const garbled = await ignite({ name: 'Odd Outpost', x: '1', y: '1', sizes: 'lots' });

		expect(tooBig.status).toBe(400);
		expect(tooBig.data).toMatchObject({ field: 'sizes' });
		expect(tooBig.data.error).toMatch(/550 spots in one go/);
		expect(twice.data).toMatchObject({ field: 'name' });
		expect(kind.data).toMatchObject({ field: 'kind' });
		expect(garbled.data).toMatchObject({ field: 'sizes' });
		expect(pb.rows('houses')).toHaveLength(1);
		expect(pb.rows('rooms')).toHaveLength(0);
	});

	it('refuses while the layout is locked', async () => {
		const { pb, ignite } = camp('live');

		const result = await ignite({ name: 'Late Lodge', x: '1', y: '1', sizes: '1x2' });

		expect(result.status).toBe(403);
		expect(pb.rows('houses')).toHaveLength(0);
	});

	it('removes the half-made house again when the database refuses a spot', async () => {
		const { pb, ignite } = camp();
		const beds = pb.collection('beds');
		let calls = 0;
		const original = pb.collection.bind(pb);
		vi.spyOn(pb, 'collection').mockImplementation((name: string) => {
			if (name !== 'beds') return original(name);
			return {
				...beds,
				create: async (data: Row) => {
					if (++calls === 5) {
						throw Object.assign(new Error('Failed to create record.'), {
							status: 400,
							response: { data: { label: { message: 'Cannot be blank.' } } }
						});
					}
					return beds.create(data);
				}
			} as any;
		});

		const result = await ignite({ name: 'Wobbly Tower', x: '1', y: '1', sizes: '3x2' });

		expect(result.status).toBe(500);
		expect(result.data.error).toMatch(
			/^The database refused spot B1 of room #3 \(label: Cannot be blank\.\)\. The house was not created\.$/
		);
		// The fake has no cascade: the generator removed its rooms, the action the house.
		expect(pb.rows('houses')).toHaveLength(0);
		expect(pb.rows('rooms')).toHaveLength(0);
	});
});

describe('ADD ROOMS: more rooms for a house that stands', () => {
	function withHouse(kind = '') {
		const setup = camp();
		const house = setup.pb.seed('houses', { name: 'Brahmsee-Villa', x: 0, y: 0, kind });
		for (const [number, name] of [
			[1, 'Ground Floor 1'],
			[2, 'Ground Floor 2'],
			[11, 'First Floor 1']
		] as const) {
			setup.pb.seed('rooms', { name, room_number: number, house: house.id, amount_beds: 0 });
		}
		return { ...setup, house };
	}

	it('continues after the last number, rolls fresh names and makes the spots', async () => {
		const { addRooms, house, roomsOf, spotsOf } = withHouse('house');

		const result = await addRooms(house.id, { sizes: '2x4b' });

		expect(result).toMatchObject({ success: true, rooms: 2, spots: 8 });
		expect(result.names).toHaveLength(2);
		const rooms = roomsOf(house.id);
		expect(rooms.map((room) => room.room_number)).toEqual([1, 2, 11, 12, 13]);
		const added = rooms.slice(3);
		expect(added.map((room) => room.name)).toEqual(result.names);
		for (const room of added) {
			expect(room.kind).toBe('room');
			expect(spotsOf(room.id)).toHaveLength(4);
		}
	});

	it('starts at the next block of ten with floor blocks, or where the admin says', async () => {
		const blocks = withHouse();
		await blocks.addRooms(blocks.house.id, { sizes: '1x2', floors: 'on' });
		expect(blocks.roomsOf(blocks.house.id).map((room) => room.room_number)).toEqual([1, 2, 11, 21]);

		const typed = withHouse();
		await typed.addRooms(typed.house.id, { sizes: '2x2', first_number: '2' });
		// #2 is taken: 3 and 4.
		expect(typed.roomsOf(typed.house.id).map((room) => room.room_number)).toEqual([1, 2, 3, 4, 11]);
	});

	it('says huts in a hut group', async () => {
		const { pb, addRooms, house } = withHouse('hut_group');
		for (let i = 0; i < 47; i++)
			pb.seed('rooms', { name: `Hut ${i}`, room_number: 100 + i, house: house.id });

		const result = await addRooms(house.id, { sizes: '1x8b' });

		expect(result.status).toBe(400);
		expect(result.data.message).toBe('A house holds up to 50 huts, and this one has 50 already.');
	});

	it('refuses an empty plan, a locked layout and a house that is gone', async () => {
		const { pb, addRooms, house } = withHouse();

		const empty = await addRooms(house.id, { sizes: '' });
		const gone = await addRooms('nohouse', { sizes: '1x2' });
		pb.rows('app_settings')[0].is_booking_active = true;
		const locked = await addRooms(house.id, { sizes: '1x2' });

		expect(empty.status).toBe(400);
		expect(empty.data.message).toBe('Add at least one room size.');
		expect(gone.status).toBe(404);
		expect(locked.status).toBe(403);
		expect(pb.rows('rooms')).toHaveLength(3);
	});
});
