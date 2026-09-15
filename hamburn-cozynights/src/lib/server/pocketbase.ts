import PocketBase from 'pocketbase';
import { env as publicEnv } from '$env/dynamic/public';
import { env as privateEnv } from '$env/dynamic/private';
import type { TypedPocketBase } from '$lib/pocketbase-types';

const PB_URL = publicEnv.PUBLIC_PB_URL || 'http://127.0.0.1:8090';

// Global singleton instance, shared across all concurrent requests from all
// users. Auto-cancellation is designed for a single browser client deduping
// its own rapid-fire requests — on a shared server instance it instead cancels
// unrelated users' in-flight requests that happen to hit the same endpoint
// shape at the same time, surfacing as random "autocancelled" failures.
export const adminPb = new PocketBase(PB_URL) as TypedPocketBase;
adminPb.autoCancellation(false);

let isAuthenticating = false;

/**
 * Returns an authenticated admin instance.
 * Re-authenticates only if the token is missing or invalid.
 */
export async function getAdminPb(): Promise<TypedPocketBase> {
	if (adminPb.authStore.isValid) {
		return adminPb;
	}

	if (isAuthenticating) {
		// Wait for current auth attempt to finish
		while (isAuthenticating) {
			await new Promise((resolve) => setTimeout(resolve, 50));
		}
		return adminPb;
	}

	const email = privateEnv.PB_ADMIN_EMAIL;
	const password = privateEnv.PB_ADMIN_PASSWORD;

	if (!email || !password) {
		console.error('[PocketBase] CRITICAL: Missing credentials in .env');
		return adminPb;
	}

	isAuthenticating = true;
	try {
		try {
			// New PocketBase (v0.23+) uses _superusers
			await adminPb.collection('_superusers').authWithPassword(email, password);
		} catch {
			// Old PocketBase uses .admins
			await adminPb.admins.authWithPassword(email, password);
		}
		console.log(`[PocketBase] Successfully authenticated as admin (${email})`);
	} catch (err: any) {
		console.error(`[PocketBase] Authentication FAILED for ${email}: ${err.message}`);
	} finally {
		isAuthenticating = false;
	}

	return adminPb;
}
