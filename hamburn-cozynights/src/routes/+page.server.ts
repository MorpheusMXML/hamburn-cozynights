// src/routes/+page.server.ts
import { fail, redirect } from '@sveltejs/kit';
import { dev } from '$app/environment';
import type { Actions, PageServerLoad } from './$types';
import { BookingService } from '$lib/server/booking';
import { FailureRateLimiter } from '$lib/server/rate-limit';

// Ticket codes are bearer secrets: slow down guessing them.
const RATE_LIMIT_WINDOW_MINUTES = 10;
const failedLogins = new FailureRateLimiter(20, RATE_LIMIT_WINDOW_MINUTES * 60 * 1000);

// Keep in sync with the client-side check in +page.svelte.
const TICKET_CODE_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;

/** Copy-pasted codes often carry spaces, line breaks or zero-width characters around them. */
function cleanTicketCode(raw: FormDataEntryValue | null): string {
	return (typeof raw === 'string' ? raw : '').replace(/^[\s​-‍﻿]+|[\s​-‍﻿]+$/g, '');
}

export const load: PageServerLoad = async ({ locals }) => {
	return { hasTicket: !!locals.orderNumber };
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

		// The code is the guest's session: one ticket code = one booking.
		cookies.set('bookingCode', matchedCode, {
			path: '/',
			httpOnly: true,
			secure: !dev,
			sameSite: 'lax',
			maxAge: 60 * 60 * 24 * 30
		});

		throw redirect(303, '/map');
	}
};
