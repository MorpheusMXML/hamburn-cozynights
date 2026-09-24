import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getAdminPb } from '$lib/server/pocketbase';
import { APP_COMMIT, APP_VERSION } from '$lib/version';

/**
 * GET /api/health — readiness for the deploy script's health check and the
 * smoke tests. 200 only when PocketBase answers AND the app's service account
 * is signed in; 503 otherwise. A plain "/" would answer 200 even with a broken
 * service account, so a deploy could look healthy while every guest gets
 * "booking system not reachable". The answer is public, so it says nothing
 * about the failure; it does name the running version and build, which the
 * deploy runbook compares with the release it just approved.
 */
export const GET: RequestHandler = async ({ setHeaders }) => {
	setHeaders({ 'cache-control': 'no-store' });
	const pb = await getAdminPb();
	let ok = pb.authStore.isValid;
	if (ok) {
		try {
			await pb.health.check();
		} catch {
			ok = false;
		}
	}
	return json(
		{ status: ok ? 'ok' : 'degraded', version: APP_VERSION, commit: APP_COMMIT },
		{ status: ok ? 200 : 503 }
	);
};
