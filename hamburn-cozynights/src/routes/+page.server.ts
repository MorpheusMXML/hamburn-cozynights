// src/routes/+page.server.ts
import { fail, redirect } from '@sveltejs/kit';
import { dev } from '$app/environment';
import type { Actions } from './$types';
import { BookingService } from '$lib/server/booking';
import { FailureRateLimiter } from '$lib/server/rate-limit';

// Ticket codes are bearer secrets: slow down guessing them.
const failedLogins = new FailureRateLimiter(20, 10 * 60 * 1000);

export const actions: Actions = {
	login: async ({ request, cookies, locals, getClientAddress }) => {
		let client = 'unknown';
		try {
			client = getClientAddress();
		} catch {
			/* no address header (e.g. direct local request) */
		}

		if (failedLogins.isBlocked(client)) {
			return fail(429, { error: 'Too many invalid codes. Please wait a few minutes.' });
		}

		const data = await request.formData();
		const bookingCode = data.get('bookingCode')?.toString().trim();

		if (!bookingCode) {
			return fail(400, { error: 'Please enter a booking code.' });
		}

		// Basic alphanumeric validation
		if (!/^[a-zA-Z0-9_-]{1,64}$/.test(bookingCode)) {
			failedLogins.recordFailure(client);
			return fail(400, { error: 'Invalid booking code format.' });
		}

		const bookingService = new BookingService(locals.adminPb);
		let order;
		try {
			order = await bookingService.getOrderByNumber(bookingCode);
		} catch (err) {
			console.error('[Login] Order lookup failed:', (err as Error)?.message);
			return fail(503, {
				error: 'The booking system is temporarily unavailable. Please try again.'
			});
		}

		if (!order) {
			failedLogins.recordFailure(client);
			return fail(404, { error: 'This booking code was not found.' });
		}

		// The code is the guest's session: one ticket code = one booking.
		cookies.set('bookingCode', bookingCode, {
			path: '/',
			httpOnly: true,
			secure: !dev,
			sameSite: 'lax',
			maxAge: 60 * 60 * 24 * 30
		});

		throw redirect(303, '/map');
	}
};
