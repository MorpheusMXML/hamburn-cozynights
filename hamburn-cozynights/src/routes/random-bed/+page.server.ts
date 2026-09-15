import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { APP_SETTINGS_ID } from '$lib/server/constants';
import { BookingService, BedUnavailableError } from '$lib/server/booking';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.orderNumber) throw redirect(303, '/');

	try {
		const settings = await locals.pb
			.collection('app_settings')
			.getOne(APP_SETTINGS_ID)
			.catch(() => ({ is_booking_active: false }));

		// Fetch all available beds with room and house info
		const freeBeds = await locals.pb.collection('beds').getFullList({
			filter: 'occupied = false',
			expand: 'room,room.house',
			sort: 'label'
		});

		// Orders contain PII and are never readable via the public `pb` connection
		// (see BookingService.getOrderByNumber, which uses the privileged adminPb).
		const bookingService = new BookingService(locals.adminPb);
		const order = await bookingService.getOrderByNumber(locals.orderNumber);
		if (!order) throw error(404, 'Booking code not found.');

		const userBed = await bookingService.getBedForOrder(order.id);

		return {
			freeBeds,
			userBedId: userBed?.id || null,
			isBookingActive: settings.is_booking_active
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

		const settings = await locals.pb
			.collection('app_settings')
			.getOne(APP_SETTINGS_ID)
			.catch(() => ({ is_booking_active: false }));
		if (!settings.is_booking_active) return fail(403, { error: 'The gates are closed.' });

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

		try {
			const bed = await locals.adminPb.collection('beds').getOne(bedId);
			if ((bed as any).is_locked && !locals.user?.verified) {
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
	}
};
