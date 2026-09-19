// tests/integration/database.test.ts — is the database there, and does it work?
// Runs against an EMPTY PocketBase that applied pb_migrations/ on start, i.e.
// what a first deployment (or a restore + restart) ends up with.
import { describe, it, expect, beforeAll } from 'vitest';
import type PocketBase from 'pocketbase';
import { APP_SETTINGS_ID } from '../../src/lib/server/constants';
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
