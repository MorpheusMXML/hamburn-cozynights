// tests/stack-helpers.ts — shared by tests/integration and tests/smoke.
// Connection details come from scripts/test-stack.sh (throwaway PocketBase).
import PocketBase, { ClientResponseError } from 'pocketbase';
import crypto from 'crypto';
import { expect } from 'vitest';

export const PB_TEST_URL = process.env.PB_TEST_URL || '';

/** PocketBase answers with one of these when an API rule or hook says no. */
const REFUSED = [400, 401, 403, 404];

/** The request must be refused by PocketBase (not merely fail for another reason). */
export async function expectRefused(promise: Promise<unknown>): Promise<void> {
	const outcome = await promise.then(
		() => 'it was allowed',
		(err) => err
	);
	expect(outcome).toBeInstanceOf(ClientResponseError);
	expect(REFUSED).toContain((outcome as ClientResponseError).status);
}

/** A client without any session: what a guest's browser could do at most. */
export function anonymous(): PocketBase {
	const pb = new PocketBase(PB_TEST_URL);
	pb.autoCancellation(false);
	return pb;
}

/** The app's service account (superuser), as created by scripts/test-stack.sh. */
export async function serviceAccount(): Promise<PocketBase> {
	if (!PB_TEST_URL || !process.env.PB_ADMIN_EMAIL || !process.env.PB_ADMIN_PASSWORD) {
		throw new Error(
			'PB_TEST_URL / PB_ADMIN_EMAIL / PB_ADMIN_PASSWORD are not set — run these tests with `npm run test:integration` or `npm run test:smoke`.'
		);
	}
	const pb = anonymous();
	await pb
		.collection('_superusers')
		.authWithPassword(process.env.PB_ADMIN_EMAIL, process.env.PB_ADMIN_PASSWORD);
	return pb;
}

/** Short unique suffix: tests share one database and must not collide. */
export function uid(): string {
	return crypto.randomBytes(4).toString('hex');
}

export type Role = 'pending' | 'admin' | 'superuser';

/**
 * Creates an `admins` record the way the server does (always born `pending`,
 * approved by a later update) and returns it with a signed-in client — the
 * stand-in for "this person signed in with Google" (incl. `last_sign_in`).
 */
export async function createAdmin(su: PocketBase, role: Role) {
	const password = crypto.randomBytes(24).toString('hex'); // never used: password login is off
	const record = await su.collection('admins').create({
		email: `test-${role}-${uid()}@mauersegler.art`,
		password,
		passwordConfirm: password,
		role: 'pending'
	});
	// A real Google sign-in records last_sign_in (pb_hooks/cozy_notify.pb.js);
	// without it the app asks for a fresh sign-in (weekly check).
	await su.collection('admins').update(record.id, {
		...(role !== 'pending' ? { role } : {}),
		last_sign_in: new Date().toISOString()
	});

	const client = await su.collection('admins').impersonate(record.id, 3600);
	client.autoCancellation(false);
	return { id: record.id, email: record.email as string, client };
}

/** The `pb_auth` cookie the app sets after a successful admin sign-in. */
export function adminCookie(client: PocketBase): string {
	const { token, record } = client.authStore;
	return 'pb_auth=' + encodeURIComponent(JSON.stringify({ token, record }));
}

/** One house with one room and `bedCount` free, enabled beds. */
export async function seedHouse(su: PocketBase, bedCount = 2) {
	const tag = uid();
	const house = await su.collection('houses').create({ name: `Test House ${tag}`, x: 10, y: 20 });
	const room = await su
		.collection('rooms')
		.create({ name: `Test Room ${tag}`, room_number: 1, house: house.id, amount_beds: bedCount });
	const beds = [];
	for (let i = 1; i <= bedCount; i++) {
		beds.push(
			await su
				.collection('beds')
				.create({ label: `Bed ${tag}-${i}`, room: room.id, enabled: true, occupied: false })
		);
	}
	return { house, room, beds };
}

/**
 * A ticket as it arrives from the ticket shop import: plain `order_number`, no
 * hash yet (the app adds the hash on first login).
 */
export async function seedTicket(su: PocketBase) {
	const code = `TEST-${uid()}`;
	const order = await su
		.collection('orders')
		.create({ order_number: code, customer_name: 'Test Guest' });
	return { code, order };
}
