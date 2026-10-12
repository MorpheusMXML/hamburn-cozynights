// src/routes/room/[id]/holds/+server.ts — which spots of this room other
// guests are booking right now ($lib/server/spot-holds), for the room page to
// ask every few seconds while Live Booking runs. Cheap on purpose, since a
// camp full of open room pages asks at the opening rush: the hook skips the
// ticket lookup for this path (hooks.server.ts), the guest is known by the
// cookie's signature alone, and the answer comes from memory. No PocketBase
// read, and no session ends here: a cookie that doesn't check out gets a 401,
// and the page reloads, where the usual session check says why.
// The page also reloads when a hold ends early: that is usually a booking.
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createLookupHash } from '$lib/server/crypto';
import { readGuestCookie } from '$lib/server/guest-session';
import { roomHolds } from '$lib/server/spot-holds';

export const GET: RequestHandler = async ({ params, cookies }) => {
	const code = readGuestCookie(cookies);
	if (!code) return json({ error: 'Not signed in.' }, { status: 401 });
	return json(
		{ held: roomHolds(params.id, { ticket: createLookupHash(code) }) },
		{ headers: { 'cache-control': 'no-store' } }
	);
};
