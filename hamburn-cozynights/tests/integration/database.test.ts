// tests/integration/database.test.ts — is the database there, and does it work?
// Runs against an EMPTY PocketBase that applied pb_migrations/ on start, i.e.
// what a first deployment (or a restore + restart) ends up with.
import { describe, it, expect, beforeAll } from 'vitest';
import type PocketBase from 'pocketbase';
import { APP_SETTINGS_ID } from '../../src/lib/server/constants';
import { readFeatures } from '../../src/lib/accommodation';
import {
	anonymous,
	createAdmin,
	expectRefused,
	seedHouse,
	seedTicket,
	serviceAccount,
	uid
} from '../stack-helpers';

let su: PocketBase;
const guest = anonymous();

beforeAll(async () => {
	su = await serviceAccount();
});

describe('availability', () => {
	it('PocketBase answers its health check', async () => {
		const health = await guest.health.check();
		expect(health.code).toBe(200);
	});

	it("the app's service account can sign in", () => {
		expect(su.authStore.isValid).toBe(true);
		expect(su.authStore.isSuperuser).toBe(true);
	});
});

describe('schema from pb_migrations/', () => {
	it('created every collection the app uses', async () => {
		const names = (await su.collections.getFullList()).map((c) => c.name);
		expect(names).toEqual(
			expect.arrayContaining(['orders', 'app_settings', 'houses', 'rooms', 'beds', 'admins'])
		);
	});

	it('seeded the app_settings singleton with bookings closed', async () => {
		const settings = await guest.collection('app_settings').getOne(APP_SETTINGS_ID);
		expect(settings.is_booking_active).toBe(false);
	});

	it('gave orders the fields the booking flow relies on', async () => {
		const orders = await su.collections.getOne('orders');
		const fields = orders.fields.map((f: { name: string }) => f.name);
		expect(fields).toEqual(
			expect.arrayContaining([
				'order_number',
				'order_hash',
				'customer_name',
				'burner_name',
				'created'
			])
		);
	});
});

describe('the details of a place (pb_migrations/1759900000_accommodation.js)', () => {
	it('gave houses, rooms and spots their kind, features and description', async () => {
		const fieldsOf = async (name: string) =>
			(await su.collections.getOne(name)).fields.map((f: { name: string }) => f.name);

		expect(await fieldsOf('houses')).toEqual(
			expect.arrayContaining(['kind', 'features', 'description'])
		);
		expect(await fieldsOf('rooms')).toEqual(
			expect.arrayContaining(['kind', 'features', 'description'])
		);
		expect(await fieldsOf('beds')).toEqual(expect.arrayContaining(['bed_type', 'features']));
		// pb_migrations/1759970000_bunk_beds.js: the other spot of a bunk bed.
		expect(await fieldsOf('beds')).toEqual(expect.arrayContaining(['bunk_partner']));
	});

	it('stores what the catalogue allows on the level it belongs to', async () => {
		const { house, room, beds } = await seedHouse(su, 1);
		const saved = await su.collection('houses').update(house.id, {
			kind: 'hut_group',
			features: ['ground_floor', 'toilets_inside'],
			description: 'Wash house 50 m away.'
		});
		expect(saved.kind).toBe('hut_group');
		expect(saved.features).toEqual(['ground_floor', 'toilets_inside']);
		expect(saved.description).toBe('Wash house 50 m away.');

		const savedRoom = await su
			.collection('rooms')
			.update(room.id, { kind: 'hut', features: ['own_bathroom', 'power'] });
		expect(savedRoom.features).toEqual(['own_bathroom', 'power']);

		const savedBed = await su
			.collection('beds')
			.update(beds[0].id, { bed_type: 'bunk_lower', features: ['power'] });
		expect(savedBed.bed_type).toBe('bunk_lower');
		// A select that allows one value comes back as that value, not as a list.
		expect(readFeatures(savedBed.features, 'spot')).toEqual(['power']);
	});

	it('refuses values the catalogue does not know, and features of another level', async () => {
		const { house, room, beds } = await seedHouse(su, 1);
		await expectRefused(su.collection('houses').update(house.id, { kind: 'castle' }));
		// own_bathroom describes a room, not a building
		await expectRefused(su.collection('houses').update(house.id, { features: ['own_bathroom'] }));
		await expectRefused(su.collection('rooms').update(room.id, { features: ['toilets_inside'] }));
		await expectRefused(su.collection('beds').update(beds[0].id, { bed_type: 'hammock' }));
		await expectRefused(su.collection('beds').update(beds[0].id, { features: ['quiet'] }));
	});

	it('leaves a place that nobody described empty', async () => {
		const { house, beds } = await seedHouse(su, 1);
		const fresh = await su.collection('houses').getOne(house.id);
		expect(fresh.kind).toBe('');
		expect(fresh.features).toEqual([]);
		expect(fresh.description).toBe('');
		const bed = await su.collection('beds').getOne(beds[0].id);
		expect(bed.bed_type).toBe('');
		expect(readFeatures(bed.features, 'spot')).toEqual([]);
	});
});

describe('bunk beds (pb_hooks/cozy_bunks.pb.js)', () => {
	it('keeps the two spots of a bunk bed pointing at each other, whoever wrote one of them', async () => {
		const { beds } = await seedHouse(su, 3);
		const [lower, upper, third] = beds;
		// One side written: PocketBase completes the other.
		await su
			.collection('beds')
			.update(lower.id, { bunk_partner: upper.id, bed_type: 'bunk_lower' });
		expect((await su.collection('beds').getOne(upper.id)).bunk_partner).toBe(lower.id);

		// The lower spot picks another partner: the old one stands alone again.
		await su.collection('beds').update(lower.id, { bunk_partner: third.id });
		expect((await su.collection('beds').getOne(third.id)).bunk_partner).toBe(lower.id);
		expect((await su.collection('beds').getOne(upper.id)).bunk_partner).toBe('');

		// Unstacked: the partner lets go as well.
		await su.collection('beds').update(lower.id, { bunk_partner: '' });
		expect((await su.collection('beds').getOne(third.id)).bunk_partner).toBe('');
	});

	it('leaves the partner standing alone when a spot is deleted', async () => {
		const { beds } = await seedHouse(su, 2);
		await su.collection('beds').update(beds[0].id, { bunk_partner: beds[1].id });
		await su.collection('beds').delete(beds[0].id);
		const left = await su.collection('beds').getOne(beds[1].id);
		expect(left.bunk_partner).toBe('');
	});

	it('refuses a partner that is the spot itself or in another room', async () => {
		const { beds } = await seedHouse(su, 1);
		const other = await seedHouse(su, 1);
		await expectRefused(su.collection('beds').update(beds[0].id, { bunk_partner: beds[0].id }));
		await expectRefused(
			su.collection('beds').update(beds[0].id, { bunk_partner: other.beds[0].id })
		);
	});
});

describe('reading and writing', () => {
	it('stores a house → room → bed tree; houses and rooms are public, beds are for admins', async () => {
		const { house, room, beds } = await seedHouse(su, 2);

		expect((await guest.collection('houses').getOne(house.id)).name).toBe(house.name);
		expect((await guest.collection('rooms').getOne(room.id)).house).toBe(house.id);
		// beds carry the booking's ticket, the special-needs flag and the booking
		// time: guests get spots only through the app's pages. A list rule that
		// does not match filters everything out (empty list); a view rule refuses.
		expect(
			await guest
				.collection('beds')
				.getFullList({ filter: guest.filter('room = {:room}', { room: room.id }) })
		).toEqual([]);
		await expectRefused(guest.collection('beds').getOne(beds[0].id));
		const admin = await createAdmin(su, 'admin');
		const listed = await admin.client
			.collection('beds')
			.getFullList({ filter: admin.client.filter('room = {:room}', { room: room.id }) });
		expect(listed.map((b) => b.id).sort()).toEqual(beds.map((b) => b.id).sort());
		expect(listed[0]).toHaveProperty('is_special');
	});

	it('updates and deletes records', async () => {
		const { house } = await seedHouse(su, 1);
		await su.collection('houses').update(house.id, { name: 'Renamed' });
		expect((await su.collection('houses').getOne(house.id)).name).toBe('Renamed');

		await su.collection('houses').delete(house.id);
		await expectRefused(su.collection('houses').getOne(house.id));
	});

	it('removes rooms and beds together with their house', async () => {
		const { house, room, beds } = await seedHouse(su, 2);
		await su.collection('houses').delete(house.id);

		await expectRefused(su.collection('rooms').getOne(room.id));
		await expectRefused(su.collection('beds').getOne(beds[0].id));
	});

	it('rejects invalid data (a room needs a house)', async () => {
		await expectRefused(su.collection('rooms').create({ name: 'Orphan' }));
	});
});

describe('tickets (orders)', () => {
	it('allows a ticket hash only once', async () => {
		const order_hash = `hash-${uid()}`;
		await su.collection('orders').create({ order_number: uid(), customer_name: 'A', order_hash });
		await expectRefused(
			su.collection('orders').create({ order_number: uid(), customer_name: 'B', order_hash })
		);
	});

	it('accepts many imported tickets that have no hash yet', async () => {
		const first = await seedTicket(su);
		const second = await seedTicket(su);
		expect(first.order.id).not.toBe(second.order.id);
	});
});

describe('what guests (no session) may do', () => {
	it('never read tickets: they hold names and ticket codes', async () => {
		const { order } = await seedTicket(su);
		await expectRefused(guest.collection('orders').getFullList());
		await expectRefused(guest.collection('orders').getOne(order.id));
	});

	it('never touch the internal collections (guest_notify, admin_events), nor do admins', async () => {
		const { order } = await seedTicket(su);
		const admin = await createAdmin(su, 'admin');
		for (const pb of [guest, admin.client]) {
			await expectRefused(pb.collection('guest_notify').getFullList());
			await expectRefused(pb.collection('guest_notify').create({ order: order.id }));
			await expectRefused(pb.collection('admin_events').getFullList());
			await expectRefused(pb.collection('admin_events').create({ action: 'x', actor: 'y' }));
		}
	});

	it('never write houses, rooms, beds, settings or tickets', async () => {
		const { house, room, beds } = await seedHouse(su, 1);

		await expectRefused(guest.collection('houses').create({ name: 'Squat' }));
		await expectRefused(guest.collection('houses').update(house.id, { name: 'Squat' }));
		await expectRefused(guest.collection('houses').delete(house.id));
		await expectRefused(guest.collection('rooms').delete(room.id));
		await expectRefused(guest.collection('beds').update(beds[0].id, { occupied: true }));
		await expectRefused(
			guest.collection('app_settings').update(APP_SETTINGS_ID, { is_booking_active: true })
		);
		await expectRefused(
			guest.collection('orders').create({ order_number: 'FREE-TICKET', customer_name: 'Nobody' })
		);
	});

	it('cannot sign up in the default users collection', async () => {
		await expectRefused(
			guest.collection('users').create({
				email: `intruder-${uid()}@example.com`,
				password: 'a-long-enough-password',
				passwordConfirm: 'a-long-enough-password'
			})
		);
	});
});
