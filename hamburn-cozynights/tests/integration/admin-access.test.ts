// tests/integration/admin-access.test.ts — the admin access model, enforced by
// the real PocketBase (API rules from pb_migrations/, guards from pb_hooks/).
//
// The Google consent screen itself can't run in a test. Everything around it
// can: who may get an `admins` record, what each role may do with its token,
// and that approving / removing an account takes effect on the next request
// (the app calls authRefresh on every request, see src/hooks.server.ts).
// tests/admin-auth.test.ts covers the app side of the sign-in with mocks.
import { describe, it, expect, beforeAll } from 'vitest';
import type PocketBase from 'pocketbase';
import { toAdminSession, toPendingAdmin } from '../../src/lib/server/admin-auth';
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

describe('getting an admin account', () => {
	it('offers no password login, only OAuth2', async () => {
		const methods = await guest.collection('admins').listAuthMethods();
		expect(methods.password.enabled).toBe(false);
		expect(methods.otp.enabled).toBe(false);

		await expectRefused(
			guest.collection('admins').authWithPassword('someone@mauersegler.art', 'whatever-password')
		);
	});

	it('cannot be created through the public records API', async () => {
		const password = `pw-${uid()}-long-enough`;
		await expectRefused(
			guest.collection('admins').create({
				email: `intruder-${uid()}@mauersegler.art`,
				password,
				passwordConfirm: password,
				role: 'superuser'
			})
		);
	});

	it('is always born pending and @mauersegler.art, whoever creates it (pb_hooks guard)', async () => {
		const password = `pw-${uid()}-long-enough`;
		const base = { password, passwordConfirm: password };

		await expectRefused(
			su
				.collection('admins')
				.create({ ...base, email: `x-${uid()}@mauersegler.art`, role: 'admin' })
		);
		await expectRefused(
			su.collection('admins').create({ ...base, email: `x-${uid()}@gmail.com`, role: 'pending' })
		);
	});
});

describe('a pending access request', () => {
	it('is recognized by the app as pending, not as an admin', async () => {
		const pending = await createAdmin(su, 'pending');
		const record = pending.client.authStore.record;

		expect(toAdminSession(record)).toBeNull();
		expect(toPendingAdmin(record)?.email).toBe(pending.email);
	});

	it('has no rights at all and cannot approve itself', async () => {
		const pending = await createAdmin(su, 'pending');
		const { house } = await seedHouse(su, 1);

		await expectRefused(pending.client.collection('houses').create({ name: 'Nope' }));
		await expectRefused(pending.client.collection('houses').delete(house.id));
		await expectRefused(pending.client.collection('admins').update(pending.id, { role: 'admin' }));
		await expectRefused(pending.client.collection('orders').getFullList());
	});

	it('becomes an admin on its next request once a superuser approves it', async () => {
		const pending = await createAdmin(su, 'pending');
		await su.collection('admins').update(pending.id, { role: 'admin' });

		await pending.client.collection('admins').authRefresh();
		expect(toAdminSession(pending.client.authStore.record)?.role).toBe('admin');
	});
});

describe('an approved admin', () => {
	it('is recognized by the app with its role', async () => {
		const admin = await createAdmin(su, 'admin');
		const boss = await createAdmin(su, 'superuser');

		expect(toAdminSession(admin.client.authStore.record)).toMatchObject({
			email: admin.email,
			role: 'admin',
			isSuperuser: false
		});
		expect(toAdminSession(boss.client.authStore.record)?.isSuperuser).toBe(true);
	});

	it('manages houses, rooms, beds and the booking switch', async () => {
		const admin = await createAdmin(su, 'admin');

		const house = await admin.client.collection('houses').create({ name: `Admin House ${uid()}` });
		const room = await admin.client
			.collection('rooms')
			.create({ name: 'Room', room_number: 1, house: house.id });
		const bed = await admin.client
			.collection('beds')
			.create({ label: 'A', room: room.id, enabled: true });
		await admin.client.collection('beds').update(bed.id, { is_locked: true });

		const before = await guest.collection('app_settings').getOne(APP_SETTINGS_ID);
		await admin.client
			.collection('app_settings')
			.update(APP_SETTINGS_ID, { is_booking_active: !before.is_booking_active });
		await admin.client
			.collection('app_settings')
			.update(APP_SETTINGS_ID, { is_booking_active: before.is_booking_active });

		await admin.client.collection('houses').delete(house.id);
	});

	it('still cannot read tickets, other admins, or change roles', async () => {
		const admin = await createAdmin(su, 'admin');
		const other = await createAdmin(su, 'pending');
		await seedTicket(su);

		await expectRefused(admin.client.collection('orders').getFullList());
		await expectRefused(admin.client.collection('admins').getFullList());
		await expectRefused(admin.client.collection('admins').update(other.id, { role: 'admin' }));
		await expectRefused(admin.client.collection('admins').update(admin.id, { role: 'superuser' }));
		await expectRefused(admin.client.collection('app_settings').delete(APP_SETTINGS_ID));
	});

	it('loses access on the next request when the account is removed', async () => {
		const admin = await createAdmin(su, 'admin');
		await su.collection('admins').delete(admin.id);

		await expectRefused(admin.client.collection('admins').authRefresh());
		await expectRefused(admin.client.collection('houses').create({ name: 'Too late' }));
	});
});
