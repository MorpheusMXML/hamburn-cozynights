import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { clearGuestSession, signInUrl } from '$lib/server/guest-session';
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
import { burnerNameOf, passSummary, roomLabel } from '$lib/server/pass';
import type { PassSummary } from '$lib/pass';
import type { RouletteSpot } from '$lib/roulette';
import type { BedsResponse, RoomsResponse, HousesResponse } from '$lib/pocketbase-types';
import { readFilters, spotFacts, spotMatchesFilters } from '$lib/accommodation';

type BedWithHouse = BedsResponse<{ room: RoomsResponse<{ house: HousesResponse }> }>;

/** A spot as the slot machine's reels show it: house, room (as the pass names it), label. */
function rouletteSpot(bed: BedWithHouse): RouletteSpot {
	const room = bed.expand?.room;
	return {
		id: bed.id,
		label: bed.label,
		roomId: bed.room,
		roomName: room ? roomLabel(room) : '',
		houseName: room?.expand?.house?.name ?? ''
	};
}

const UNAVAILABLE = 'The booking system is not reachable right now. Please try again in a minute.';
const SIGNED_OUT =
	'You are not signed in anymore. Go to the start page and enter your ticket code again.';
const CODE_UNKNOWN = 'Your ticket code was not found. Go to the start page and enter it again.';

export const load: PageServerLoad = async ({ locals, cookies, url }) => {
	if (!locals.orderNumber) throw redirect(303, signInUrl(locals));

	// Orders contain PII and are never readable via the public `pb` connection
	// (see BookingService.getOrderByNumber, which uses the privileged adminPb).
	const bookingService = new BookingService(locals.adminPb);
	// hooks.server.ts read the ticket for this request already; it only looks it
	// up here when PocketBase couldn't answer there.
	let order = locals.order ?? null;
	try {
		if (!order) order = await bookingService.getOrderByNumber(locals.orderNumber);
	} catch (err) {
		console.error('[RandomBed] Order lookup failed:', (err as Error)?.message);
		throw error(503, UNAVAILABLE);
	}
	if (!order) {
		clearGuestSession(cookies);
		throw redirect(303, '/?login=expired');
	}

	try {
		const { isBookingActive, phase, guestPhase } = await getBookingSettings(locals.pb);

		const userBed = await locals.adminPb
			.collection('beds')
			.getFirstListItem<BedWithHouse>(
				locals.adminPb.filter('order = {:orderId}', { orderId: order.id }),
				{ expand: 'room,room.house' }
			)
			.catch(() => null);

		// What the guest wants the dice to respect. The wishes live in the URL, so
		// a roll can be repeated and the page works without JavaScript.
		const wishes = readFilters(url.searchParams.get('w'));

		// Only fetch the (possibly large) free-bed list when the user doesn't
		// already have a spot — they can't spin again without Leave No Trace
		// first, and the page reloads this list right after the sweep.
		// Deactivated, locked and special-needs beds are never part of the roulette.
		const allFree: BedWithHouse[] = userBed
			? []
			: // beds are admin-only in PocketBase: the service account reads them
				await locals.adminPb.collection('beds').getFullList<BedWithHouse>({
					filter: 'occupied = false && enabled = true && is_locked = false && is_special = false',
					expand: 'room,room.house',
					sort: 'label'
				});
		// The drum holds only the spots that fit the wishes (all of them without any).
		const freeBeds: RouletteSpot[] = allFree
			.filter(
				(bed) =>
					wishes.length === 0 ||
					spotMatchesFilters(
						wishes,
						spotFacts({
							bedType: bed.bed_type,
							house: bed.expand?.room?.expand?.house?.features,
							room: bed.expand?.room?.features,
							spot: bed.features
						})
					)
			)
			.map(rouletteSpot);

		// A guest with a spot sees it as the small booking pass, like on the
		// house, room and map pages; the Destiny Fulfilled card shows it too.
		const [spotFixed, pass]: [boolean, PassSummary | null] = userBed
			? await Promise.all([
					isSpotFixed(locals.adminPb, order.id, userBed.id).catch((err) => {
						console.error(
							'[RandomBed] Special-needs request lookup failed:',
							(err as Error)?.message
						);
						return false;
					}),
					passSummary(locals.adminPb, order, userBed).catch((err) => {
						console.error('[RandomBed] Booking pass failed:', (err as Error)?.message);
						return null;
					})
				])
			: [false, null];

		return {
			freeBeds,
			wishes,
			/** All free spots, so the page can say how many the wishes left out. */
			freeTotal: allFree.length,
			isBookingActive,
			spotFixed,
			// The crew checked the guest in at arrival: only the crew changes the spot now.
			checkedIn: !!userBed?.checked_in_at,
			phase,
			// The ticket's burner name: the name plate starts with it, so a guest
			// who spins again keeps their name unless they change it.
			burnerName: burnerNameOf(order),
			pass,
			// what the page says; what is allowed still follows `phase`
			guestPhase,
			userBed: userBed ? rouletteSpot(userBed) : null
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

		const { isBookingActive, guestPhase } = await getBookingSettings(locals.pb);
		if (!isBookingActive) return fail(403, { error: bookingRefusal(guestPhase) });

		const formData = await request.formData();
		const bedId = formData.get('bedId') as string;
		const guestName = ((formData.get('guestName') as string) || '').replace(/\s+/g, ' ').trim();

		if (!locals.orderNumber) return fail(401, { error: SIGNED_OUT });
		if (!bedId || !guestName) {
			return fail(400, {
				error: 'The spin was incomplete, so nothing was booked. Please spin again.'
			});
		}

		const bookingService = new BookingService(locals.adminPb);

		try {
			const order = await bookingService.getOrderByNumber(locals.orderNumber);
			if (!order) {
				return fail(404, { error: CODE_UNKNOWN });
			}

			// Roulette is only for claiming a first spot — a guest who has one
			// sweeps it away first (releaseBed, behind the Leave No Trace hold)
			// and spins again deliberately, never by silently rebooking.
			const existingBed = await bookingService.getBedForOrder(order.id);
			if (existingBed) {
				return fail(409, {
					error: 'You already have a spot. Release it first, then you can spin again.'
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
					error: 'Someone was faster: this spot was just taken. Spin again.'
				});
			}
			console.error('[RandomBed] bookRandom failed:', err?.message);
			return fail(500, {
				error: 'The booking did not go through. Please reload the page and spin again.'
			});
		}
	},

	/**
	 * ✨ Leave No Trace before a respin: deletes the guest's booking right away,
	 * then the page spins a new spot. `bedId` is the spot the dialog showed; if
	 * the ticket holds another one by now, nothing is deleted.
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
