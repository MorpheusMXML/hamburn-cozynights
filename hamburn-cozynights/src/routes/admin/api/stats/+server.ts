import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { liveStatsSnapshot } from '$lib/server/stats';

/**
 * GET /admin/api/stats — the live booking picture for the control center.
 *
 * Admin-only (hooks.server.ts already refuses everything under /admin/api/
 * without a session; the check here is the belt to that braces). The answer is
 * one small row per house — a few hundred bytes for the camp, 5 KB for the
 * 60-house stress camp of the layout test — the snapshot behind it is shared
 * by all admins for a few seconds, and an unchanged snapshot comes back as 304
 * without a body. A dashboard left open all weekend costs almost nothing.
 */
export const GET: RequestHandler = async ({ locals, request, setHeaders }) => {
	if (!locals.admin) throw error(403, 'Unauthorized');

	let snapshot;
	try {
		snapshot = await liveStatsSnapshot(locals.adminPb);
	} catch (err) {
		console.error('[Stats API] Snapshot failed:', (err as Error)?.message);
		throw error(503, 'The booking numbers could not be read from the database.');
	}

	// Private: an admin-only answer must not be kept by a shared proxy.
	setHeaders({ 'cache-control': 'no-store, private' });

	const etag = `"${snapshot.etag}"`;
	if (request.headers.get('if-none-match') === etag) {
		return new Response(null, { status: 304, headers: { etag } });
	}
	return json(snapshot.stats, { headers: { etag } });
};
