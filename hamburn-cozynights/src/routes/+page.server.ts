// src/routes/+page.server.ts
import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { BookingService } from '$lib/server/booking';
import {
	clearGuestSession,
	readGuestRound,
	safeReturnPath,
	setGuestSession
} from '$lib/server/guest-session';
import { FailureRateLimiter } from '$lib/server/rate-limit';

// Ticket codes are bearer secrets: slow down guessing them.
const RATE_LIMIT_WINDOW_MINUTES = 10;
const failedLogins = new FailureRateLimiter(20, RATE_LIMIT_WINDOW_MINUTES * 60 * 1000);

// Keep in sync with the client-side check in +page.svelte.
const TICKET_CODE_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;
const SURROUNDING_BLANKS = /^[\s\u200B-\u200D\uFEFF]+|[\s\u200B-\u200D\uFEFF]+$/g;

/** Copy-pasted codes often carry spaces, line breaks or zero-width characters around them. */
function cleanTicketCode(raw: FormDataEntryValue | null): string {
	return (typeof raw === 'string' ? raw : '').replace(SURROUNDING_BLANKS, '');
}

export const load: PageServerLoad = async ({ locals, url }) => {
	// `orderNumber` is only set for a ticket the server just found (hooks.server.ts),
	// so a code that is no longer in the ticket list never gets "already signed in".
	// `signedOut` says why this visit lost its session, for the hint on the page.
	// `next`: the guest page that sent the visitor here (signInUrl), checked.
	return {
		hasTicket: !!locals.orderNumber,
		signedOut: locals.guestSignOut ?? null,
		next: safeReturnPath(url.searchParams.get('next'))
	};
};

export const actions: Actions = {
	login: async ({ request, cookies, locals, getClientAddress }) => {
		let client = 'unknown';
		try {
			client = getClientAddress();
		} catch {
			/* no address header (e.g. direct local request) */
		}

		const data = await request.formData();
		const code = cleanTicketCode(data.get('bookingCode'));

		if (failedLogins.isBlocked(client)) {
			return fail(429, {
				code,
				error: `Too many wrong ticket codes from your connection. Please wait up to ${RATE_LIMIT_WINDOW_MINUTES} minutes, then try again.`
			});
		}

		if (!code) {
			return fail(400, { code, error: 'Please enter your ticket code.' });
		}

		if (!TICKET_CODE_PATTERN.test(code)) {
			failedLogins.recordFailure(client);
			return fail(400, {
				code,
				error: 'Ticket codes only contain letters, digits, - and _. Check for spaces or typos.'
			});
		}

		// The code field shows everything in capitals and phone keyboards like to
		// capitalise, so a code that differs only in case is accepted as well.
		const candidates = [...new Set([code, code.toUpperCase(), code.toLowerCase()])];

		const bookingService = new BookingService(locals.adminPb);
		let matchedCode: string | null = null;
		try {
			for (const candidate of candidates) {
				if (await bookingService.getOrderByNumber(candidate)) {
					matchedCode = candidate;
					break;
				}
			}
		} catch (err) {
			console.error('[Login] Order lookup failed:', (err as Error)?.message);
			return fail(503, {
				code,
				error:
					'The booking system is not reachable right now. Your code was not checked. Please try again in a minute.'
			});
		}

		if (!matchedCode) {
			failedLogins.recordFailure(client);
			return fail(404, {
				code,
				error:
					'We could not find this ticket code. Check it for typos (0 vs. O, 1 vs. I) and try again. If it still fails, ask the crew.'
			});
		}

		// The code is the guest's session: one ticket code = one booking. The
		// booking round it was signed in for rides along, so a reset between
		// rounds ends the session (see $lib/server/guest-session).
		setGuestSession(cookies, matchedCode, (await readGuestRound(locals.pb)) ?? 0);

		throw redirect(303, safeReturnPath(data.get('next')) ?? '/map');
	},

	/**
	 * Forgets the ticket code on this device. The code is the guest's key to
	 * their booking (docs: Security & privacy), so a shared or borrowed phone
	 * needs a way to give it back.
	 */
	signOut: async ({ cookies }) => {
		clearGuestSession(cookies);
		throw redirect(303, '/?login=out');
	}
};
