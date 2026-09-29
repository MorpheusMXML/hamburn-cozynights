// src/routes/admin/bookings/+page.server.ts — who booked which spot, who is
// checked in, who is still to arrive (docs/admin/bookings.md).
//
// Guests are shown the way the check-in desk shows them: names, masked e-mail
// and ticket code ($lib/server/bookings.ts). A guest who arrives without their
// pass can be checked in here; that is the same step as at the desk
// (/admin/check): admins only, written with the admin's own PocketBase
// session, and an undo is logged for the crew.
import { fail, redirect, type RequestEvent } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { readBookings } from '$lib/server/bookings';
import { BookingService } from '$lib/server/booking';
import { logAdminEvent } from '$lib/server/admin-events';
import { getBookingSettings } from '$lib/server/settings';
import { placeLabel, type BookingRow } from '$lib/bookings';

export const load: PageServerLoad = async ({ locals, depends }) => {
	// Runs in parallel with the layout load, so it guards itself too.
	if (!locals.admin) throw redirect(303, '/admin/login');
	depends('app:bookings');

	const [bookings, houses, { phase }] = await Promise.all([
		readBookings(locals.adminPb).catch((err) => {
			console.error('[Bookings] Read failed:', (err as Error)?.message);
			return null;
		}),
		locals.pb
			.collection('houses')
			.getFullList({ fields: 'id,name', sort: 'name', requestKey: null })
			.catch(() => []),
		getBookingSettings(locals.pb)
	]);
	return {
		bookings,
		houses: houses.map((house) => ({ id: house.id, name: house.name as string })),
		phase
	};
};

const ORDER_ID = /^[a-z0-9]{1,30}$/;

/** The spot the ticket holds now, for the answer and the crew log. */
function rowOf(rows: BookingRow[], orderId: string): BookingRow | null {
	return rows.find((row) => row.guest?.orderId === orderId) ?? null;
}

async function step(event: RequestEvent, kind: 'checkin' | 'undo') {
	const { request, locals } = event;
	// src/hooks.server.ts has already refused every other session for admin
	// actions; this check stays as the second line (and narrows the type).
	if (!locals.admin) return fail(403, { error: 'Only admins can check guests in.' });

	const orderId = String((await request.formData()).get('order') ?? '');
	if (!ORDER_ID.test(orderId)) {
		return fail(400, { error: 'No booking was chosen. Reload the page and try again.' });
	}

	try {
		// The admin's own session writes: see the file header.
		const crew = new BookingService(locals.pb);
		const outcome =
			kind === 'checkin'
				? await crew.checkIn(orderId, locals.admin.email)
				: await crew.undoCheckIn(orderId);
		if (outcome.status === 'nospot') {
			return fail(409, {
				error:
					'This ticket holds no spot any more (released or moved meanwhile). The list is up to date again.'
			});
		}
		const row = outcome.bed
			? rowOf(await readBookings(locals.adminPb, { roomId: outcome.bed.room }), orderId)
			: null;
		const where = row ? placeLabel(row) : '';
		if (outcome.status === 'checkedin' || outcome.status === 'undone') {
			console.log(
				`[Bookings] ${outcome.status} bed ${outcome.bed?.id} by ${locals.admin.email} (bookings list)`
			);
		}
		if (outcome.status === 'undone') {
			await logAdminEvent(locals.adminPb, locals.admin, 'check_in_undone', where, {});
		}
		return { step: { status: outcome.status, where, checkIn: row?.checkIn ?? null } };
	} catch (err) {
		console.error(`[Bookings] ${kind} failed:`, (err as Error)?.message);
		return fail(503, {
			error:
				kind === 'checkin'
					? 'The check-in could not be saved: the booking system is not reachable right now. Try again.'
					: 'The check-in could not be undone: the booking system is not reachable right now. Try again.'
		});
	}
}

export const actions: Actions = {
	checkin: (event) => step(event, 'checkin'),
	undo: (event) => step(event, 'undo')
};
