// src/lib/server/spot-hold-actions.ts
/**
 * The form actions of spot holds ($lib/server/spot-holds), shared by the room
 * page (the booking window opens) and the roulette (the reels land): hold a
 * free spot for the signed-in guest, and let go of it again. The ticket always
 * comes from the guest's session, never from the form.
 */
import { fail } from '@sveltejs/kit';
import type { BedsResponse } from '$lib/pocketbase-types';
import { BookingService, isBedBookable, withLock } from '$lib/server/booking';
import { isCrewTicket } from '$lib/server/crew-ticket';
import { getBookingSettings, SETTINGS_UNREACHABLE } from '$lib/server/settings';
import { createLookupHash } from '$lib/server/crypto';
import { bookingRefusal } from '$lib/booking-phase';
import { recordId } from '$lib/server/record-id';
import { endHold, HELD_MESSAGE, placeHold } from '$lib/server/spot-holds';

const SIGNED_OUT =
	'You are not signed in anymore. Go to the start page and enter your ticket code again.';
const CODE_UNKNOWN = 'Your ticket code was not found. Go to the start page and enter it again.';

/**
 * Holds the spot `bedId` for the guest's ticket. Success says how long:
 * `{ hold: { bedId, left } }` (milliseconds), or `{ hold: null, spent: true }`
 * when the ticket's minutes on this spot are over (it can still book it).
 * A failure says why the spot can't be held: taken (`bedTaken`), held by
 * someone else (`held`, with `left`), or the ticket holds a spot already.
 * Asking for a spot that can't be held lets go of the ticket's earlier hold
 * all the same (one hold per ticket): a respin never leaves the last spot
 * held behind the guest's back.
 */
export async function holdSpotAction(locals: App.Locals, request: Request) {
	if (!locals.orderNumber) return fail(401, { error: SIGNED_OUT });
	const form = await request.formData();
	const bedId = recordId(form, 'bedId');
	if (!bedId) return fail(400, { error: 'No spot was selected.' });

	let orderId = '';
	try {
		const { isBookingActive, guestPhase, reachable } = await getBookingSettings(locals.pb);
		if (!reachable) return fail(503, { error: SETTINGS_UNREACHABLE });
		if (!isBookingActive) return fail(403, { error: bookingRefusal(guestPhase) });

		const service = new BookingService(locals.adminPb);
		const order = locals.order ?? (await service.getOrderByNumber(locals.orderNumber));
		if (!order) return fail(404, { error: CODE_UNKNOWN });
		orderId = order.id;
		const crewTicket = await isCrewTicket(locals.adminPb, order);
		const holder = { orderId: order.id, ticket: createLookupHash(locals.orderNumber) };

		// The booking locks, in bookBed's order: a hold and a booking can't cross.
		return await withLock(`order:${order.id}`, () =>
			withLock(`bed:${bedId}`, async () => {
				const current = await service.getBedForOrder(order.id);
				if (current) {
					return fail(409, {
						error: `Your ticket already holds ${current.label ? `spot ${current.label}` : 'a spot'}.`
					});
				}
				const bed = await locals.adminPb.collection('beds').getOne<BedsResponse>(bedId);
				if (bed.occupied) {
					endHold(order.id);
					return fail(409, {
						error: 'This spot is already claimed. Please pick another spot.',
						bedTaken: true
					});
				}
				if (!isBedBookable(bed, { allowLocked: crewTicket })) {
					endHold(order.id);
					return fail(409, { error: 'This spot is not available.', bedTaken: true });
				}
				// taken or spent lets go of an earlier hold too (placeHold)
				const outcome = placeHold(holder, bedId, bed.room);
				const now = Date.now();
				if (outcome.status === 'taken') {
					return fail(409, {
						error: `${HELD_MESSAGE} Please pick another spot.`,
						held: true,
						left: outcome.hold.until - now
					});
				}
				if (outcome.status === 'spent') return { hold: null, spent: true };
				return { hold: { bedId, left: outcome.hold.until - now } };
			})
		);
	} catch (err) {
		if (orderId) endHold(orderId);
		if ((err as { status?: number })?.status === 404) {
			return fail(404, {
				error: "This spot doesn't exist anymore. Please pick another one.",
				bedTaken: true
			});
		}
		console.error('[Holds] Holding a spot failed:', (err as Error)?.message);
		return fail(500, { error: 'The spot could not be held. You can still book it.' });
	}
}

/**
 * Lets go of the guest's hold: the booking window closed, or the page went
 * away. With a `bedId`, only a hold on that spot ends.
 */
export async function dropHoldAction(locals: App.Locals, request: Request) {
	if (!locals.orderNumber) return fail(401, { error: SIGNED_OUT });
	const form = await request.formData();
	const bedId = recordId(form, 'bedId') || undefined;
	try {
		const order =
			locals.order ??
			(await new BookingService(locals.adminPb).getOrderByNumber(locals.orderNumber));
		if (!order) return fail(404, { error: CODE_UNKNOWN });
		return { dropped: endHold(order.id, bedId) };
	} catch (err) {
		console.error('[Holds] Letting go of a hold failed:', (err as Error)?.message);
		return fail(500, { error: 'The spot could not be let go. It is free again in a few minutes.' });
	}
}
