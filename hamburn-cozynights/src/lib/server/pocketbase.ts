import PocketBase from 'pocketbase';
import { env as privateEnv } from '$env/dynamic/private';
import type { TypedPocketBase } from '$lib/pocketbase-types';

/**
 * Server-side PocketBase URL. The browser never talks to PocketBase, so on a
 * server this is the internal compose address (http://pocketbase:8090), not a
 * public URL.
 */
export const PB_URL = privateEnv.PB_URL || 'http://127.0.0.1:8090';

// Global singleton instance, shared across all concurrent requests from all
// users. Auto-cancellation is designed for a single browser client deduping
// its own rapid-fire requests — on a shared server instance it instead cancels
// unrelated users' in-flight requests that happen to hit the same endpoint
// shape at the same time, surfacing as random "autocancelled" failures.
export const adminPb = new PocketBase(PB_URL) as TypedPocketBase;
adminPb.autoCancellation(false);

// `authStore.isValid` only checks the token's local expiry. A token revoked on
// the server (e.g. the service account's password was rotated) still looks
// valid for up to a day, so it is re-verified against PocketBase periodically.
const REVALIDATE_AFTER_MS = 5 * 60 * 1000;
// After a failed login or check, don't hammer PocketBase on every incoming request.
const RETRY_AFTER_FAILURE_MS = 10 * 1000;

let lastVerifiedAt = 0;
let lastFailureAt = 0;
let pending: Promise<void> | null = null;

/**
 * PocketBase turned the token down (401, 403, …), as opposed to not answering
 * at all (status 0: down, restarting, unreachable), a server error (5xx) or a
 * rate limit (429): none of those says anything about the token.
 */
export function tokenRejected(err: unknown): boolean {
	const status = Number((err as { status?: unknown })?.status) || 0;
	return status >= 400 && status < 500 && status !== 429;
}

async function authenticate(): Promise<void> {
	const email = privateEnv.PB_ADMIN_EMAIL;
	const password = privateEnv.PB_ADMIN_PASSWORD;

	if (!email || !password) {
		console.error('[PocketBase] CRITICAL: PB_ADMIN_EMAIL/PB_ADMIN_PASSWORD missing in .env');
		return;
	}

	try {
		if (adminPb.authStore.isValid) {
			try {
				await adminPb.collection('_superusers').authRefresh();
				lastVerifiedAt = Date.now();
				return;
			} catch (err: any) {
				if (!tokenRejected(err)) {
					// PocketBase is down or restarting, the token is not the problem. Keep
					// it: without it the app would talk to PocketBase unauthenticated, and
					// the beds rule filters that down to an empty camp. With it, the app is
					// back the moment PocketBase is. The check runs again a bit later.
					lastFailureAt = Date.now();
					console.error(`[PocketBase] Service account check failed, token kept: ${err?.message}`);
					return;
				}
				adminPb.authStore.clear();
			}
		}

		await adminPb.collection('_superusers').authWithPassword(email, password);
		if (!adminPb.authStore.isValid) {
			// e.g. a proxy answered with an HTML page instead of the PocketBase API
			throw new Error(`no token received from ${PB_URL}`);
		}
		lastVerifiedAt = Date.now();
		console.log('[PocketBase] Service account authenticated');
	} catch (err: any) {
		adminPb.authStore.clear();
		lastFailureAt = Date.now();
		console.error(`[PocketBase] Service account authentication FAILED: ${err?.message}`);
	}
}

/**
 * Returns the authenticated service-account (superuser) instance.
 * Re-authenticates when the token is missing, expired, or was revoked.
 */
export async function getAdminPb(): Promise<TypedPocketBase> {
	const now = Date.now();
	const fresh = adminPb.authStore.isValid && now - lastVerifiedAt < REVALIDATE_AFTER_MS;
	if (fresh) return adminPb;
	// A failed login or check is retried after a pause, not on every request.
	if (now - lastFailureAt < RETRY_AFTER_FAILURE_MS) return adminPb;

	// Single flight: concurrent requests share one (re-)authentication.
	if (!pending) {
		pending = authenticate().finally(() => {
			pending = null;
		});
	}
	await pending;
	return adminPb;
}
