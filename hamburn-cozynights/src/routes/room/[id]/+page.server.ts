// src/routes/room/[id]/+page.server.ts
import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import type { RoomsResponse, BedsResponse, OrdersResponse } from '$lib/pocketbase-types';
import { decrypt } from '$lib/server/crypto';
import { BookingService } from '$lib/server/booking';

const burnerNames = [
	'Dusty Nomad',
	'Neon Shaman',
	'Sparkle Pony',
	'Fire Weaver',
	'LED Lizard',
	'Gifting Goblin',
	'Moop Master',
	'Temple Guardian',
	'Solar Sprite',
	'Disco Druid',
	'Radical Robot',
	'Dust Bunny',
	'Prism Pilot',
	'Bass Beast',
	'Infinite Improviser'
];

function getRandomName(): string {
	const randomIndex = Math.floor(Math.random() * burnerNames.length);
	const randomSuffix = Math.floor(100 + Math.random() * 900);
	return `${burnerNames[randomIndex]} #${randomSuffix}`;
}

export const load: PageServerLoad = async ({ params, locals }) => {
	if (!locals.orderNumber) throw redirect(303, '/');

	// Always use the adminPb instance for backend operations
	const bookingService = new BookingService(locals.adminPb);
	const order = await bookingService.getOrderByNumber(locals.orderNumber);

	if (!order) {
		console.error('[Security] Room load: Order not found for code:', locals.orderNumber);
		throw error(404, 'Buchungscode ungültig oder nicht gefunden.');
	}

	try {
		const [settings, userBed, room, beds] = await Promise.all([
			locals.pb
				.collection('app_settings')
				.getOne('abcsettings123')
				.catch(() => ({ is_booking_active: false, booking_unlock_at: '' })),
			bookingService.getBedForOrder(order.id),
			locals.pb.collection('rooms').getOne<RoomsResponse>(params.id),
			locals.adminPb.collection('beds').getFullList<BedsResponse<{ order?: OrdersResponse }>>({
				filter: locals.adminPb.filter('room = {:roomId}', { roomId: params.id }),
				sort: 'label',
				expand: 'order'
			})
		]);

		// Decrypt burner names for display
		const decryptedBeds = beds.map((bed) => {
			if (bed.expand?.order?.burner_name) {
				try {
					bed.expand.order.burner_name = decrypt(bed.expand.order.burner_name);
				} catch {
					/* skip if not encrypted */
				}
			}
			return bed;
		});

		return {
			room,
			beds: decryptedBeds,
			userBedId: userBed?.id || null,
			currentOrderNumber: locals.orderNumber,
			isBookingActive: settings.is_booking_active,
			bookingUnlockAt: settings.booking_unlock_at || ''
		};
	} catch (err: any) {
		console.error('[Security] Room load failed:', err);
		throw error(404, 'Raum nicht gefunden.');
	}
};

export const actions: Actions = {
	bookBed: async ({ request, locals }) => {
		// PRIO 1: Security & Auth Checks
		if (!locals.adminPb.authStore.isValid) {
			console.error('[Security] bookBed: Master Key (Admin Auth) is invalid.');
			return fail(500, { error: 'System authentication failed. Please contact admin.' });
		}

		const settings = await locals.pb
			.collection('app_settings')
			.getOne('abcsettings123')
			.catch(() => ({ is_booking_active: false }));
		if (!settings.is_booking_active) return fail(403, { error: 'Bookings are not open yet.' });

		const formData = await request.formData();
		const bedId = formData.get('bedId') as string;
		let guestName = formData.get('guestName') as string;

		if (!locals.orderNumber) return fail(401, { error: 'Sitzung abgelaufen' });
		if (!guestName || guestName.trim() === '') guestName = getRandomName();

		const bookingService = new BookingService(locals.adminPb);
		const order = await bookingService.getOrderByNumber(locals.orderNumber);

		if (!order) {
			console.error('[Security] bookBed: Order not found for code:', locals.orderNumber);
			return fail(404, { error: 'Your booking code was not found.' });
		}

		try {
			const bed = await locals.adminPb.collection('beds').getOne<BedsResponse>(bedId);

			// SECURITY: Check if bed is locked by admin
			if ((bed as any).is_locked && !locals.user?.verified) {
				return fail(403, { error: 'This bed is currently locked by an admin.' });
			}

			if (bed.occupied && bed.order !== order.id) {
				return fail(400, { error: 'This spot is already claimed.' });
			}

			await bookingService.bookBed(order, bedId, guestName);
			return { success: true };
		} catch (err: any) {
			console.error('[Security] bookBed critical failure:', err);
			return fail(500, { error: `Database error: ${err.message}` });
		}
	},

	unbookBed: async ({ locals }) => {
		if (!locals.adminPb.authStore.isValid) {
			console.error('[Security] unbookBed: Master Key (Admin Auth) is invalid.');
			return fail(500, { error: 'System authentication failed.' });
		}

		const settings = await locals.pb
			.collection('app_settings')
			.getOne('abcsettings123')
			.catch(() => ({ is_booking_active: false }));
		if (!settings.is_booking_active) return fail(403, { error: 'Bookings are locked.' });

		if (!locals.orderNumber) return fail(401);

		const bookingService = new BookingService(locals.adminPb);
		const order = await bookingService.getOrderByNumber(locals.orderNumber);

		if (!order) return fail(404, { error: 'Order not found.' });

		try {
			await bookingService.unbookOrder(order.id);
			return { success: true };
		} catch (err: any) {
			console.error('[Security] unbookBed failed:', err);
			return fail(500, { error: `Spot release failed: ${err.message}` });
		}
	}
};
