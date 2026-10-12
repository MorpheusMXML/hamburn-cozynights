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
import { LoginGuard, connectionKey, type LoginStep } from '$lib/server/login-guard';
import { requestCodeMail } from '$lib/server/code-mail';
import { getAdminPb } from '$lib/server/pocketbase';
import { logGuestEvent } from '$lib/server/admin-events';
import { isValidGuestEmail, normalizeEmail } from '$lib/tickets';
import { endHold } from '$lib/server/spot-holds';

// Ticket codes are bearer secrets: guessing them gets harder step by step
// ($lib/server/login-guard). Past 200 wrong codes overall the crew hears it.
const guard = new LoginGuard((failures) => {
	void getAdminPb().then((adminPb) =>
		logGuestEvent(adminPb, 'sign_in_guard', '', { failures, minutes: 10, lockMinutes: 30 })
	);
});
// "Send me my code" asks per connection: a few addresses, not a list of them.
const codeMailAsks = new FailureRateLimiter(5, 60 * 60 * 1000);

// Keep in sync with the client-side check in +page.svelte.
const TICKET_CODE_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;
const SURROUNDING_BLANKS = /^[\s\u200B-\u200D\uFEFF]+|[\s\u200B-\u200D\uFEFF]+$/g;

const UNPAID =
	"Your ticket is still unpaid, so it can't book a bed yet. Please contact the Membership Team and settle your due invoice. As soon as it's paid, your code works here.";

/** Copy-pasted codes often carry spaces, line breaks or zero-width characters around them. */
function cleanTicketCode(raw: FormDataEntryValue | null): string {
	return (typeof raw === 'string' ? raw : '').replace(SURROUNDING_BLANKS, '');
}

function clientOf(getClientAddress: () => string): string {
	try {
		return connectionKey(getClientAddress());
	} catch {
		return 'unknown'; // no address header (e.g. direct local request)
	}
}

/** What the form shows next: the e-mail field, the offer to mail the code. */
function nextStep(step: LoginStep) {
	return { needEmail: step.needEmail, offerMail: step.offerMail };
}

function waitText(ms: number): string {
	const minutes = Math.ceil(ms / 60000);
	if (minutes <= 1) return 'a minute';
	if (minutes < 90) return `${minutes} minutes`;
	return `${Math.ceil(minutes / 60)} hours`;
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
		const client = clientOf(getClientAddress);
		const data = await request.formData();
		const code = cleanTicketCode(data.get('bookingCode'));
		const email = normalizeEmail(data.get('email'));
		const step = guard.step(client);

		if (step.blockedFor > 0) {
			return fail(429, {
				code,
				...nextStep(step),
				error: `Too many wrong ticket codes from your connection. Please try again in ${waitText(step.blockedFor)}.`
			});
		}

		if (!code) {
			return fail(400, { code, ...nextStep(step), error: 'Please enter your ticket code.' });
		}

		// After several wrong codes (or while someone is guessing on a large
		// scale) the code alone isn't enough: asking for the address is no guess.
		if (step.needEmail && !email) {
			return fail(400, {
				code,
				...nextStep(step),
				error:
					'For your security, please enter your ticket code together with the e-mail address of your ticket.'
			});
		}
		if (email && !isValidGuestEmail(email)) {
			return fail(400, {
				code,
				email,
				...nextStep(step),
				error: "That doesn't look like an e-mail address. Please check it."
			});
		}

		const undo = guard.attempt(client);

		if (!TICKET_CODE_PATTERN.test(code)) {
			return fail(400, {
				code,
				email,
				...nextStep(guard.step(client)),
				error: 'Ticket codes only contain letters, digits, - and _. Check for spaces or typos.'
			});
		}

		// The code field shows everything in capitals and phone keyboards like to
		// capitalise, so a code that differs only in case is accepted as well.
		const candidates = [...new Set([code, code.toUpperCase(), code.toLowerCase()])];

		const bookingService = new BookingService(locals.adminPb);
		let matchedCode: string | null = null;
		let unpaid = false;
		try {
			for (const candidate of candidates) {
				const order = await bookingService.getOrderByNumber(candidate);
				// With an address, both have to belong to the same ticket.
				if (order && (!email || (order.email ?? '').toLowerCase() === email)) {
					matchedCode = candidate;
					unpaid = !!order.unpaid;
					break;
				}
			}
		} catch (err) {
			undo(); // nothing was checked
			console.error('[Login] Order lookup failed:', (err as Error)?.message);
			return fail(503, {
				code,
				email,
				...nextStep(guard.step(client)),
				error:
					'The booking system is not reachable right now. Your code was not checked. Please try again in a minute.'
			});
		}

		if (!matchedCode) {
			const after = guard.step(client);
			return fail(404, {
				code,
				email,
				...nextStep(after),
				error:
					after.blockedFor > 0
						? `Too many wrong ticket codes from your connection. Please try again in ${waitText(after.blockedFor)}.`
						: email
							? "This ticket code and e-mail address don't belong to the same ticket. Check both for typos (0 vs. O, 1 vs. I)."
							: 'We could not find this ticket code. Check it for typos (0 vs. O, 1 vs. I) and try again. If it still fails, ask the crew.'
			});
		}

		// A right code is no guess, whatever else stops the sign-in.
		undo();
		if (unpaid) return fail(403, { code, email, unpaid: true, error: UNPAID });

		// The code is the guest's session: one ticket code = one booking. The
		// booking round it was signed in for rides along, so a reset between
		// rounds ends the session (see $lib/server/guest-session).
		setGuestSession(cookies, matchedCode, (await readGuestRound(locals.pb)) ?? 0);

		throw redirect(303, safeReturnPath(data.get('next')) ?? '/map');
	},

	/**
	 * E-mails the ticket codes of an address (\$lib/server/code-mail). The
	 * answer is the same whether the address belongs to a ticket or not, and
	 * it comes before the lookup: nobody learns from it which addresses have
	 * tickets.
	 */
	sendCode: async ({ request, locals, getClientAddress }) => {
		const client = clientOf(getClientAddress);
		const email = normalizeEmail((await request.formData()).get('email'));

		if (!isValidGuestEmail(email)) {
			return fail(400, {
				mailEmail: email,
				mailError: 'Please enter the e-mail address of your ticket.'
			});
		}
		if (codeMailAsks.isBlocked(client)) {
			return fail(429, {
				mailEmail: email,
				mailError:
					'You asked for your code several times already. Please check your inbox and spam folder, or try again in an hour.'
			});
		}
		codeMailAsks.recordFailure(client);

		void requestCodeMail(locals.adminPb, email).catch((err) =>
			console.error('[Login] Code e-mail request failed:', (err as Error)?.message)
		);
		return { mailSent: true };
	},

	/**
	 * Forgets the ticket code on this device. The code is the guest's key to
	 * their booking (docs: Security & privacy), so a shared or borrowed phone
	 * needs a way to give it back.
	 */
	signOut: async ({ cookies, locals }) => {
		// A spot the guest was booking is free again ($lib/server/spot-holds).
		if (locals.order) endHold(locals.order.id);
		clearGuestSession(cookies);
		throw redirect(303, '/?login=out');
	}
};
