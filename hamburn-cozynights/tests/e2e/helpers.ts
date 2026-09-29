import PocketBase from 'pocketbase';
import * as dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { APP_SETTINGS_ID } from '../../src/lib/server/constants';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env'), override: true });

export const TEST_CODE = 'XXXXX';
export const PB_URL = process.env.PB_URL || process.env.PUBLIC_PB_URL || 'http://127.0.0.1:8090';
export const APP_URL = 'http://localhost:5173';
// Admin sign-in is Google-only; the tests impersonate an invited admin instead.
const E2E_ADMIN_EMAIL = 'e2e-admin@mauersegler.art';

/** PocketBase client signed in as the app's service superuser (from .env). */
export async function superuserClient(): Promise<PocketBase> {
	const pb = new PocketBase(PB_URL);
	pb.autoCancellation(false);
	await pb
		.collection('_superusers')
		.authWithPassword(process.env.PB_ADMIN_EMAIL!, process.env.PB_ADMIN_PASSWORD!);
	return pb;
}

/** Session cookie of an approved admin, minted via superuser impersonation. */
export async function adminSessionCookie(pb: PocketBase, role: 'admin' | 'superuser' = 'admin') {
	let admin;
	try {
		admin = await pb.collection('admins').getFirstListItem(`email="${E2E_ADMIN_EMAIL}"`);
	} catch {
		// pb_hooks only lets new accounts in as access requests (role pending).
		const password = `${crypto.randomUUID()}Aa1!`;
		admin = await pb.collection('admins').create({
			email: E2E_ADMIN_EMAIL,
			role: 'pending',
			password,
			passwordConfirm: password
		});
	}
	// A recent last_sign_in stands in for the Google sign-in the app asks for weekly.
	admin = await pb
		.collection('admins')
		.update(admin.id, { role, last_sign_in: new Date().toISOString() });

	const impersonated = await pb.collection('admins').impersonate(admin.id, 3600);
	const exported = impersonated.authStore.exportToCookie({ httpOnly: false, secure: false });
	const value = exported.split(';')[0].slice('pb_auth='.length);
	return { name: 'pb_auth', value, url: APP_URL };
}

export async function setBookingPhase(pb: PocketBase, live: boolean) {
	await pb
		.collection('app_settings')
		.update(APP_SETTINGS_ID, { is_booking_active: live, booking_unlock_at: '' });
}

/** Frees whatever the test ticket currently holds. */
export async function releaseTestBooking(pb: PocketBase) {
	const order = await pb.collection('orders').getFirstListItem(`order_number="${TEST_CODE}"`);
	const beds = await pb.collection('beds').getFullList({ filter: `order = "${order.id}"` });
	for (const bed of beds) {
		await pb.collection('beds').update(bed.id, { occupied: false, order: null });
	}
}
