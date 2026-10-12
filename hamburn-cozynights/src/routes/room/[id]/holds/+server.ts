// src/routes/room/[id]/holds/+server.ts — which spots of this room other
// guests are booking right now ($lib/server/spot-holds), for the room page to
// ask every few seconds while Live Booking runs. Answered from memory: no
// database read beyond the session check every guest request has, so a
// camp full of open room pages costs next to nothing at the opening rush.
// The page reloads itself when a hold ends early: that is usually a booking.
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { roomHolds } from '$lib/server/spot-holds';

export const GET: RequestHandler = async ({ params, locals }) => {
	if (!locals.orderNumber) return json({ error: 'Not signed in.' }, { status: 401 });
	// The session check couldn't read the ticket (PocketBase hiccup): ask again later.
	if (!locals.order) return json({ error: 'Try again.' }, { status: 503 });
	return json(
		{ held: roomHolds(params.id, locals.order.id) },
		{ headers: { 'cache-control': 'no-store' } }
	);
};
