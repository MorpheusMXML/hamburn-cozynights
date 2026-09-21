// src/routes/admin/check/+page.server.ts — check guests in with their booking
// pass at arrival (docs/admin/passes.md). Type a code, let a USB scanner type
// the QR link, or scan with the camera: a pass whose ticket holds a spot is
// checked in right away, a second check says when and by whom. A phone's own
// camera app works as well: it opens /pass/<code>, which shows signed-in
// admins the booking and a Check in button that posts here.
//
// Only admins and superusers check guests in, never a ticket code: the admin
// area refuses every other session before an action runs (src/hooks.server.ts),
// each action checks again, and the check-in is written with the admin's own
// PocketBase session, which PocketBase accepts from approved admins only.
import { fail, redirect, type RequestEvent } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { formatPassCode, normalizePassInput, type PassCheckResult } from '$lib/pass';
import { checkInOf, findPass, type PassLookup } from '$lib/server/pass';
import { BookingService, type CheckInOutcome } from '$lib/server/booking';
import { logAdminEvent } from '$lib/server/admin-events';
import { maskEmail } from '$lib/server/notifications';
import { displayTicketName } from '$lib/tickets';

export const load: PageServerLoad = async ({ locals }) => {
	// Runs in parallel with the layout load, so it guards itself too.
	if (!locals.admin) throw redirect(303, '/admin/login');
	return {};
};

/** "B1 · Blue Room #2 · Brahmsee-Villa" (audit log: the spot, never who sleeps there) */
function spotLabel(pass: PassLookup): string {
	const spot = pass.spot;
	return spot ? [spot.spot, spot.room, spot.house].filter(Boolean).join(' · ') : '';
}

function describe(
	code: string,
	pass: PassLookup,
	outcome: CheckInOutcome,
	checkedAt: string
): PassCheckResult {
	const spot = outcome.bed ? pass.spot : null;
	let warning = '';
	if (spot && !spot.enabled) warning = 'This spot is deactivated. The booking still stands.';
	else if (spot?.locked) warning = 'This spot is locked for guests. The booking still stands.';

	return {
		status: outcome.status,
		code: formatPassCode(code),
		checkedAt,
		ticketName: displayTicketName(pass.order),
		email: maskEmail(pass.order.email),
		spot: spot
			? { house: spot.house, room: spot.room, spot: spot.spot, roomId: spot.roomId }
			: null,
		burnerName: spot ? pass.burnerName : '',
		checkIn: outcome.bed ? checkInOf(outcome.bed) : null,
		warning
	};
}

/** Checks the posted pass in, or takes its check-in back. */
async function step(event: RequestEvent, kind: 'checkin' | 'undo') {
	const { request, locals } = event;
	if (!locals.admin) return fail(403, { error: 'Only admins can check guests in.' });

	const input = (await request.formData()).get('code');
	const code = normalizePassInput(input);
	if (!code) {
		return fail(400, {
			input: typeof input === 'string' ? input.slice(0, 200) : '',
			error: "That isn't a pass code. Codes look like 7F3K-9QXM-2CWD."
		});
	}

	const checkedAt = new Date().toISOString();
	let pass: PassLookup | null;
	let outcome: CheckInOutcome;
	try {
		pass = await findPass(locals.adminPb, code);
		if (!pass) {
			const unknown: PassCheckResult = { status: 'unknown', code: formatPassCode(code), checkedAt };
			return { result: unknown };
		}
		// The admin's own session writes: see the file header.
		const crew = new BookingService(locals.pb);
		outcome =
			kind === 'checkin'
				? await crew.checkIn(pass.order.id, locals.admin.email)
				: await crew.undoCheckIn(pass.order.id);
		// The guest moved or released the spot in between: show where it is now.
		if ((outcome.bed?.id ?? null) !== (pass.spot?.bedId ?? null)) {
			pass = (await findPass(locals.adminPb, code)) ?? pass;
		}
	} catch (err) {
		console.error(`[PassCheck] ${kind} failed:`, (err as Error)?.message);
		return fail(503, {
			error:
				kind === 'checkin'
					? 'The check-in could not be saved: the booking system is not reachable right now. Try again.'
					: 'The check-in could not be undone: the booking system is not reachable right now. Try again.'
		});
	}

	if (outcome.status === 'checkedin' || outcome.status === 'undone') {
		console.log(`[PassCheck] ${outcome.status} bed ${outcome.bed?.id} by ${locals.admin.email}`);
	}
	if (outcome.status === 'undone') {
		await logAdminEvent(locals.adminPb, locals.admin, 'check_in_undone', spotLabel(pass), {});
	}
	return { result: describe(code, pass, outcome, checkedAt) };
}

export const actions: Actions = {
	checkin: (event) => step(event, 'checkin'),
	undo: (event) => step(event, 'undo')
};
