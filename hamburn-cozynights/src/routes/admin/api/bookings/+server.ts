import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { readBookings } from '$lib/server/bookings';

/**
 * GET /admin/api/bookings — the booked spots with the ticket behind each one
 * (masked like at the check-in desk), for the bookings list, the room and
 * house pages and the map's house sidebar. `?house=<id>` or `?room=<id>`
 * narrows it.
 *
 * The pages ask again only when the live numbers (/admin/api/stats) moved,
 * so this is not polled. Admin-only: hooks.server.ts refuses /admin/api/
 * without a session, the check here is the second line.
 */
export const GET: RequestHandler = async ({ locals, url, setHeaders }) => {
	if (!locals.admin) throw error(403, 'Unauthorized');

	const houseId = url.searchParams.get('house') ?? '';
	const roomId = url.searchParams.get('room') ?? '';
	// Record ids only: anything else can't name a house or a room.
	const id = /^[a-z0-9]{1,30}$/;
	if ((houseId && !id.test(houseId)) || (roomId && !id.test(roomId))) {
		throw error(400, 'Unknown house or room.');
	}

	let bookings;
	try {
		bookings = await readBookings(locals.adminPb, {
			houseId: houseId || undefined,
			roomId: roomId || undefined
		});
	} catch (err) {
		console.error('[Bookings API] Read failed:', (err as Error)?.message);
		throw error(503, 'The bookings could not be read from the database.');
	}

	// Names of guests: never kept by a browser cache or a proxy.
	setHeaders({ 'cache-control': 'no-store, private' });
	return json({ bookings });
};
