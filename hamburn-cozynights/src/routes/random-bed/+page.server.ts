import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { getBookingSettings } from '$lib/server/settings';
import { BookingService, BedUnavailableError } from '$lib/server/booking';
import type { BedsResponse, RoomsResponse, HousesResponse } from '$lib/pocketbase-types';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.orderNumber) throw redirect(303, '/');

	try {
		const { isBookingActive } = await getBookingSettings(locals.pb);

		// Orders contain PII and are never readable via the public `pb` connection
		// (see BookingService.getOrderByNumber, which uses the privileged adminPb).
		const bookingService = new BookingService(locals.adminPb);
		const order = await bookingService.getOrderByNumber(locals.orderNumber);
		if (!order) throw error(404, 'Booking code not found.');

		const userBed = await locals.adminPb
			.collection('beds')
			.getFirstListItem<BedsResponse<{ room: RoomsResponse<{ house: HousesResponse }> }>>(
				locals.adminPb.filter('order = {:orderId}', { orderId: order.id }),
				{ expand: 'room,room.house' }
			)
			.catch(() => null);

		// Only fetch the (possibly large) free-bed list when the user doesn't
		// already have a spot — they can't roll again without releasing first.
		const freeBeds = userBed
			? []
			: await locals.pb.collection('beds').getFullList({
					filter: 'occupied = false',
					expand: 'room,room.house',
					sort: 'label'
				});

		return {
			freeBeds,
			isBookingActive,
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
		console.error(err);
		throw error(500, 'Failed to fetch the playa magic.');
	}
};

export const actions: Actions = {
	bookRandom: async ({ request, locals }) => {
		if (!locals.adminPb.authStore.isValid) {
			console.error('[Security] bookRandom: Master Key (Admin Auth) is invalid.');
			return fail(500, { error: 'System authentication failed. Please contact admin.' });
		}

		const { isBookingActive } = await getBookingSettings(locals.pb);
		if (!isBookingActive) return fail(403, { error: 'The gates are closed.' });

		const formData = await request.formData();
		const bedId = formData.get('bedId') as string;
		const guestName = formData.get('guestName') as string;

		if (!locals.orderNumber || !bedId || !guestName) {
			return fail(400, { error: 'Missing magic ingredients.' });
		}

		const bookingService = new BookingService(locals.adminPb);
		const order = await bookingService.getOrderByNumber(locals.orderNumber);
		if (!order) {
			return fail(404, { error: 'Your booking code was not found.' });
		}

		// Roulette is only for claiming a first spot — once you have one, use
		// "release spot" and re-roll deliberately rather than silently rebooking.
		const existingBed = await bookingService.getBedForOrder(order.id);
		if (existingBed) {
			return fail(409, { error: 'You already have a spot. Release it first to roll again.' });
		}

		try {
			const bed = await locals.adminPb.collection('beds').getOne<BedsResponse>(bedId);
			if (bed.is_locked && !locals.user?.verified) {
				return fail(403, { error: 'This bed is currently locked by an admin.' });
			}

			// bookBed re-checks availability under a per-bed lock, so two guests
			// hitting "random bed" at the same moment can't both win the same bed.
			await bookingService.bookBed(order, bedId, guestName);
			return { success: true, bedId };
		} catch (err) {
			if (err instanceof BedUnavailableError) {
				return fail(400, { error: err.message });
			}
			console.error(err);
			return fail(500, { error: 'The playa swallowed your request.' });
		}
	},

	releaseBed: async ({ locals }) => {
		if (!locals.adminPb.authStore.isValid) {
			return fail(500, { error: 'System authentication failed.' });
		}

		const { isBookingActive } = await getBookingSettings(locals.pb);
		if (!isBookingActive) return fail(403, { error: 'Bookings are locked.' });

		if (!locals.orderNumber) return fail(401);

		const bookingService = new BookingService(locals.adminPb);
		const order = await bookingService.getOrderByNumber(locals.orderNumber);
		if (!order) return fail(404, { error: 'Order not found.' });

		try {
			await bookingService.unbookOrder(order.id);
			return { success: true };
		} catch (err) {
			console.error('[Security] random-bed releaseBed failed:', err);
			const message = err instanceof Error ? err.message : String(err);
			return fail(500, { error: `Spot release failed: ${message}` });
		}
	}
};
