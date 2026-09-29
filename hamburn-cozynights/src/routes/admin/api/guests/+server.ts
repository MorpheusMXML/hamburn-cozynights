import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { readGuests } from '$lib/server/guests';

/**
 * GET /admin/api/guests — every ticket with everything attached (masked like
 * at the check-in desk), for the guest list. The page asks again when the
 * live numbers (/admin/api/stats) moved, on its Refresh button and when its
 * tab comes back to the front, so this is not polled. Admin-only:
 * hooks.server.ts refuses /admin/api/ without a session, the check here is
 * the second line.
 */
export const GET: RequestHandler = async ({ locals, setHeaders }) => {
	if (!locals.admin) throw error(403, 'Unauthorized');

	let guests;
	try {
		guests = await readGuests(locals.adminPb);
	} catch (err) {
		console.error('[Guests API] Read failed:', (err as Error)?.message);
		throw error(503, 'The guest list could not be read from the database.');
	}

	// Names of guests: never kept by a browser cache or a proxy.
	setHeaders({ 'cache-control': 'no-store, private' });
	return json({ guests });
};
