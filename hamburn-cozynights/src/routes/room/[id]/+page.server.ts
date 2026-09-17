// src/routes/room/[id]/+page.server.ts
import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import type { RoomsResponse, BedsResponse, OrdersResponse } from '$lib/pocketbase-types';
import { decrypt } from '$lib/server/crypto';
import { BookingService, BedUnavailableError, isBedBookable } from '$lib/server/booking';
import { getBookingSettings } from '$lib/server/settings';

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
		console.warn('[Security] Room load: unknown booking code in cookie.');
		throw error(404, 'Buchungscode ungültig oder nicht gefunden.');
	}

	try {
		const [settings, userBed, room, beds] = await Promise.all([
			getBookingSettings(locals.pb),
			bookingService.getBedForOrder(order.id),
			locals.pb.collection('rooms').getOne<RoomsResponse>(params.id),
			locals.adminPb.collection('beds').getFullList<BedsResponse<{ order?: OrdersResponse }>>({
				filter: locals.adminPb.filter('room = {:roomId}', { roomId: params.id }),
				sort: 'label',
				expand: 'order'
			})
		]);

		// Only these fields reach the browser. The expanded orders carry other
		// guests' ticket codes and customer names and must never be serialized.
		const safeBeds = beds.map((bed) => {
			let burnerName = '';
			if (bed.occupied && bed.expand?.order?.burner_name) {
				try {
					burnerName = decrypt(bed.expand.order.burner_name);
				} catch {
					/* unreadable name: show the default */
				}
			}
			return {
				id: bed.id,
				label: bed.label,
				occupied: !!bed.occupied,
				bookable: isBedBookable(bed, { allowLocked: !!locals.admin }),
				burnerName
			};
		});

		return {
			room: { id: room.id, name: room.name, room_number: room.room_number, house: room.house },
			beds: safeBeds,
			userBedId: userBed?.id || null,
			isBookingActive: settings.isBookingActive,
			bookingUnlockAt: settings.bookingUnlockAt
		};
	} catch (err: any) {
		console.error('[Security] Room load failed:', (err as Error)?.message);
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

		const { isBookingActive } = await getBookingSettings(locals.pb);
		if (!isBookingActive) return fail(403, { error: 'Bookings are not open yet.' });

		const formData = await request.formData();
		const bedId = formData.get('bedId') as string;
		let guestName = formData.get('guestName') as string;

		if (!locals.orderNumber) return fail(401, { error: 'Sitzung abgelaufen' });
		if (!guestName || guestName.trim() === '') guestName = getRandomName();

		const bookingService = new BookingService(locals.adminPb);
		const order = await bookingService.getOrderByNumber(locals.orderNumber);

		if (!order) {
			console.warn('[Security] bookBed: unknown booking code in cookie.');
			return fail(404, { error: 'Your booking code was not found.' });
		}
		if (!bedId) return fail(400, { error: 'No spot selected.' });

		try {
			// Availability (free, enabled, not locked unless admin) is checked
			// authoritatively inside bookBed, under per-order and per-bed locks.
			await bookingService.bookBed(order, bedId, guestName.slice(0, 80), {
				allowLocked: !!locals.admin
			});
			return { success: true };
		} catch (err: any) {
			if (err instanceof BedUnavailableError) {
				return fail(400, { error: err.message });
			}
			if (err?.status === 404) return fail(404, { error: 'This spot does not exist.' });
			console.error('[Security] bookBed critical failure:', err?.message);
			return fail(500, { error: 'Booking failed. Please try again.' });
		}
	},

	unbookBed: async ({ locals }) => {
		if (!locals.adminPb.authStore.isValid) {
			console.error('[Security] unbookBed: Master Key (Admin Auth) is invalid.');
			return fail(500, { error: 'System authentication failed.' });
		}

		const { isBookingActive } = await getBookingSettings(locals.pb);
		if (!isBookingActive) return fail(403, { error: 'Bookings are locked.' });

		if (!locals.orderNumber) return fail(401);

		const bookingService = new BookingService(locals.adminPb);

		try {
			const order = await bookingService.getOrderByNumber(locals.orderNumber);
			if (!order) return fail(404, { error: 'Order not found.' });

			await bookingService.unbookOrder(order.id);
			return { success: true };
		} catch (err: any) {
			console.error('[Security] unbookBed failed:', err?.message);
			return fail(500, { error: 'Spot release failed. Please try again.' });
		}
	}
};
