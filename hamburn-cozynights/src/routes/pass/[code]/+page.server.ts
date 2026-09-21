// src/routes/pass/[code]/+page.server.ts — a booking pass (docs/admin/passes.md).
// Anyone with the link sees the spot and the burner name (both are visible to
// other guests anyway), never the ticket code, the ticket holder's name or
// address, or the check-in. A signed-in admin sees the booking on top, with a
// Check in button: that's what happens when the crew scans the QR code with a
// phone camera. Opening the page never changes anything; the button posts to
// /admin/check, which only admins reach.
import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { formatPassCode, normalizePassInput } from '$lib/pass';
import { findPass, passQrSvg, passUrl, unknownPassCodes } from '$lib/server/pass';
import { maskEmail } from '$lib/server/notifications';
import { displayTicketName } from '$lib/tickets';

export const load: PageServerLoad = async ({
	params,
	locals,
	url,
	setHeaders,
	getClientAddress
}) => {
	// The code is in the URL: no referrer to other sites, no search engines, no caches.
	setHeaders({
		'referrer-policy': 'no-referrer',
		'x-robots-tag': 'noindex, nofollow',
		'cache-control': 'private, no-store'
	});

	const code = normalizePassInput(params.code);
	if (!code) throw error(404, "This isn't a CozyNights booking pass. Check the code or the link.");
	if (params.code !== formatPassCode(code)) throw redirect(308, `/pass/${formatPassCode(code)}`);

	let client = 'unknown';
	try {
		client = getClientAddress();
	} catch {
		/* no address header (e.g. a direct local request) */
	}
	if (!locals.admin && unknownPassCodes.isBlocked(client)) {
		throw error(429, 'Too many unknown passes from your connection. Please wait a few minutes.');
	}

	let pass;
	try {
		pass = await findPass(locals.adminPb, code);
	} catch (err) {
		console.error('[Pass] Lookup failed:', (err as Error)?.message);
		throw error(
			503,
			'The booking system is not reachable right now. Please try again in a minute.'
		);
	}
	if (!pass) {
		unknownPassCodes.recordFailure(client);
		throw error(404, 'This booking pass is unknown. Check the code, or ask the crew.');
	}

	const link = passUrl(url.origin, code);
	return {
		code: formatPassCode(code),
		qrSvg: passQrSvg(link),
		spot: pass.spot ? { house: pass.spot.house, room: pass.spot.room, spot: pass.spot.spot } : null,
		burnerName: pass.spot ? pass.burnerName : '',
		// Only for the crew: who the ticket belongs to, and anything odd about the spot.
		check: locals.admin
			? {
					ticketName: displayTicketName(pass.order),
					email: maskEmail(pass.order.email),
					roomId: pass.spot?.roomId ?? null,
					enabled: pass.spot?.enabled ?? true,
					locked: pass.spot?.locked ?? false,
					bookedAt: pass.spot?.bookedAt ?? null,
					checkIn: pass.spot?.checkIn ?? null
				}
			: null
	};
};
