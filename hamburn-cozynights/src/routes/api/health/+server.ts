import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getAdminPb } from '$lib/server/pocketbase';

/**
 * GET /api/health — readiness for the deploy script's health check and the
 * smoke tests. 200 only when PocketBase answers AND the app's service account
 * is signed in; 503 otherwise. A plain "/" would answer 200 even with a broken
 * service account, so a deploy could look healthy while every guest gets
 * "booking system not reachable". No details are exposed: the answer is public.
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
	return json({ status: ok ? 'ok' : 'degraded' }, { status: ok ? 200 : 503 });
};
