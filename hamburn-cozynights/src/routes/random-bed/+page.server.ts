import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { getBookingSettings } from '$lib/server/settings';
import { bookingRefusal } from '$lib/booking-phase';
import {
	BookingService,
	BedUnavailableError,
	BookingClosedError,
	CheckedInError,
	SpotChangedError
} from '$lib/server/booking';
import { isSpotFixed, SPOT_FIXED_MESSAGE } from '$lib/server/special-requests';
import { holdGuestMessage } from '$lib/server/notifications';
import type { BedsResponse, RoomsResponse, HousesResponse } from '$lib/pocketbase-types';

const UNAVAILABLE = 'The booking system is not reachable right now. Please try again in a minute.';
const SIGNED_OUT =
	'You are not signed in anymore. Go to the start page and enter your ticket code again.';
const CODE_UNKNOWN = 'Your ticket code was not found. Go to the start page and enter it again.';

export const load: PageServerLoad = async ({ locals, cookies }) => {
	if (!locals.orderNumber) throw redirect(303, '/?login=required');

	// Orders contain PII and are never readable via the public `pb` connection
	// (see BookingService.getOrderByNumber, which uses the privileged adminPb).
	const bookingService = new BookingService(locals.adminPb);
	let order;
	try {
		order = await bookingService.getOrderByNumber(locals.orderNumber);
	} catch (err) {
		console.error('[RandomBed] Order lookup failed:', (err as Error)?.message);
		throw error(503, UNAVAILABLE);
	}
	if (!order) {
		cookies.delete('bookingCode', { path: '/' });
		throw redirect(303, '/?login=expired');
	}

	try {
		const { isBookingActive, phase } = await getBookingSettings(locals.pb);

		const userBed = await locals.adminPb
			.collection('beds')
			.getFirstListItem<BedsResponse<{ room: RoomsResponse<{ house: HousesResponse }> }>>(
				locals.adminPb.filter('order = {:orderId}', { orderId: order.id }),
				{ expand: 'room,room.house' }
			)
			.catch(() => null);

		// Only fetch the (possibly large) free-bed list when the user doesn't
		// already have a spot — they can't roll again without nuking it first,
		// and the page reloads this list right after the nuke.
		// Deactivated, locked and special-needs beds are never part of the roulette.
		const freeBeds = userBed
			? []
			: // beds are admin-only in PocketBase: the service account reads them
				(
					await locals.adminPb
						.collection('beds')
						.getFullList<BedsResponse<{ room: RoomsResponse<{ house: HousesResponse }> }>>({
							filter:
								'occupied = false && enabled = true && is_locked = false && is_special = false',
							expand: 'room,room.house',
							sort: 'label'
						})
				).map((bed) => ({
					id: bed.id,
					label: bed.label,
					room: bed.room,
					expand: {
						room: {
							name: bed.expand?.room?.name,
							expand: { house: { name: bed.expand?.room?.expand?.house?.name } }
						}
					}
				}));

		const spotFixed = userBed
			? await isSpotFixed(locals.adminPb, order.id, userBed.id).catch((err) => {
					console.error(
						'[RandomBed] Special-needs request lookup failed:',
						(err as Error)?.message
					);
					return false;
				})
			: false;

		return {
			freeBeds,
			isBookingActive,
			spotFixed,
			// The crew checked the guest in at arrival: only the crew changes the spot now.
			checkedIn: !!userBed?.checked_in_at,
			phase,
			userBed: userBed
				? {
						id: userBed.id,
						label: userBed.label,
						roomId: userBed.room,
						roomName: userBed.expand?.room?.name,
						houseName: userBed.expand?.room?.expand?.house?.name
					}
				: null
		};
	} catch (err) {
		console.error('[RandomBed] Load failed:', (err as Error)?.message);
		throw error(503, UNAVAILABLE);
	}
};

export const actions: Actions = {
	bookRandom: async ({ request, locals }) => {
		if (!locals.adminPb.authStore.isValid) {
			console.error('[Security] bookRandom: Master Key (Admin Auth) is invalid.');
			return fail(500, {
				error:
					'The booking system has a technical problem. Nothing was booked. Please tell the crew.'
			});
		}

		const { isBookingActive, phase } = await getBookingSettings(locals.pb);
		if (!isBookingActive) return fail(403, { error: bookingRefusal(phase) });

		const formData = await request.formData();
		const bedId = formData.get('bedId') as string;
		const guestName = ((formData.get('guestName') as string) || '').replace(/\s+/g, ' ').trim();

		if (!locals.orderNumber) return fail(401, { error: SIGNED_OUT });
		if (!bedId || !guestName) {
			return fail(400, {
				error: 'The roll was incomplete, so nothing was booked. Please roll the dice again.'
			});
		}

		const bookingService = new BookingService(locals.adminPb);

		try {
			const order = await bookingService.getOrderByNumber(locals.orderNumber);
			if (!order) {
				return fail(404, { error: CODE_UNKNOWN });
			}

			// Roulette is only for claiming a first spot — a guest who has one
			// nukes it first (releaseBed, behind the hold-to-launch warning) and
			// re-rolls deliberately, never by silently rebooking.
			const existingBed = await bookingService.getBedForOrder(order.id);
			if (existingBed) {
				return fail(409, {
					error: 'You already have a spot. Release it first, then you can roll again.'
				});
			}

			// bookBed re-checks availability under per-order and per-bed locks, so
			// two guests hitting "random bed" at the same moment can't both win the
			// same bed, and one ticket can't end up with two beds.
			await bookingService.bookBed(order, bedId, guestName.slice(0, 80), {
				allowLocked: !!locals.admin,
				requireLivePhase: true
			});
			return { success: true, bedId };
		} catch (err: any) {
			if (err instanceof BookingClosedError) return fail(403, { error: err.message });
			if (err instanceof BedUnavailableError || err?.status === 404) {
				return fail(409, {
					error: 'Someone was faster: this spot was just taken. Roll the dice again.'
				});
			}
			console.error('[RandomBed] bookRandom failed:', err?.message);
			return fail(500, {
				error: 'The booking did not go through. Please reload the page and roll again.'
			});
		}
	},

	/**
	 * The ☢ nuke before a respin: deletes the guest's booking right away, then
	 * the page rolls a new spot. `bedId` is the spot the warning showed; if the
	 * ticket holds another one by now, nothing is deleted.
	 */
	releaseBed: async ({ request, locals }) => {
		if (!locals.adminPb.authStore.isValid) {
			return fail(500, {
				error:
					'The booking system has a technical problem. Your spot was not released. Please tell the crew.'
			});
		}

		const { isBookingActive } = await getBookingSettings(locals.pb);
		if (!isBookingActive) {
			return fail(403, {
				error:
					'Booking is closed right now, so your spot cannot be released. It stays reserved for you.'
			});
		}

		if (!locals.orderNumber) return fail(401, { error: SIGNED_OUT });

		const formData = await request.formData();
		const confirmedBedId = (formData.get('bedId') as string) || undefined;
		const bookingService = new BookingService(locals.adminPb);

		try {
			const order = await bookingService.getOrderByNumber(locals.orderNumber);
			if (!order) return fail(404, { error: CODE_UNKNOWN });
			if (await isSpotFixed(locals.adminPb, order.id)) {
				return fail(409, { error: SPOT_FIXED_MESSAGE });
			}

			const released = await bookingService.unbookOrder(order.id, { onlyBed: confirmedBedId });
			// The respin follows in a moment, so the release itself is no news:
			// hold the guest's message back until the new spot is booked, and
			// they hear about the move once (docs/admin/notifications.md).
			if (released > 0) await holdGuestMessage(locals.adminPb, order.id);
			return { success: true, released: released > 0 };
		} catch (err: any) {
			if (err instanceof CheckedInError) return fail(409, { error: err.message });
			if (err instanceof SpotChangedError) return fail(409, { error: err.message });
			console.error('[RandomBed] releaseBed failed:', err?.message);
			return fail(500, {
				error: 'Your spot could not be released. It is still reserved for you. Please try again.'
			});
		}
	}
};
