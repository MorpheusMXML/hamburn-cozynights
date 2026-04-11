import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.orderNumber) throw redirect(303, '/');

	try {
		const settings = await locals.pb
			.collection('app_settings')
			.getOne('abcsettings123')
			.catch(() => ({ is_booking_active: false }));

		// Fetch all available beds with room and house info
		const freeBeds = await locals.pb.collection('beds').getFullList({
			filter: 'occupied = false',
			expand: 'room,room.house',
			sort: 'label'
		});

		const order = await locals.pb
			.collection('orders')
			.getFirstListItem(
				locals.pb.filter('order_number = {:orderNumber}', { orderNumber: locals.orderNumber })
			);
		const userBed = await locals.pb
			.collection('beds')
			.getFirstListItem(locals.pb.filter('order = {:orderId}', { orderId: order.id }))
			.catch(() => null);

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
		const settings = await locals.pb
			.collection('app_settings')
			.getOne('abcsettings123')
			.catch(() => ({ is_booking_active: false }));
		if (!settings.is_booking_active) return fail(403, { error: 'The gates are closed.' });

		const formData = await request.formData();
		const bedId = formData.get('bedId') as string;
		const guestName = formData.get('guestName') as string;

		if (!locals.orderNumber || !bedId || !guestName) {
			return fail(400, { error: 'Missing magic ingredients.' });
		}

		try {
			const order = await locals.pb
				.collection('orders')
				.getFirstListItem(
					locals.pb.filter('order_number = {:orderNumber}', { orderNumber: locals.orderNumber })
				);

			// 1. Release previous
			const previousBeds = await locals.pb.collection('beds').getFullList({
				filter: locals.pb.filter('order = {:orderId}', { orderId: order.id })
			});
			for (const prevBed of previousBeds) {
				await locals.pb.collection('beds').update(prevBed.id, { occupied: false, order: null });
			}

			// 2. Update Order
			await locals.pb.collection('orders').update(order.id, { burner_name: guestName });

			// 3. Claim new
			await locals.pb.collection('beds').update(bedId, {
				occupied: true,
				order: order.id
			});

			return { success: true, bedId };
		} catch (err) {
			console.error(err);
			return fail(500, { error: 'The playa swallowed your request.' });
		}
	}
};
