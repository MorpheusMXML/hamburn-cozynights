// src/routes/house/[id]/+page.server.ts
import { error, fail, redirect } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import type { HousesResponse, RoomsResponse, BedsResponse } from '$lib/pocketbase-types';
import { BookingService, isBedBookable } from '$lib/server/booking';
import { getBookingSettings } from '$lib/server/settings';

export const load: PageServerLoad = async ({ params, locals }) => {
	if (!locals.orderNumber) throw redirect(303, '/');

	const bookingService = new BookingService(locals.adminPb);
	const order = await bookingService.getOrderByNumber(locals.orderNumber);

	if (!order) {
		console.warn('[Security] House load: unknown booking code in cookie.');
		throw redirect(303, '/');
	}

	try {
		const [house, rooms, beds, settings, userBed] = await Promise.all([
			locals.pb.collection('houses').getOne<HousesResponse>(params.id),
			locals.pb.collection('rooms').getFullList<RoomsResponse>({
				filter: locals.pb.filter('house = {:id}', { id: params.id }),
				sort: 'room_number'
			}),
			locals.pb.collection('beds').getFullList<BedsResponse>({
				filter: locals.pb.filter('room.house = {:id}', { id: params.id })
			}),
			getBookingSettings(locals.pb),
			bookingService.getBedForOrder(order.id)
		]);

		// Calculate occupancy 👥 (deactivated beds don't exist for guests,
		// locked ones count as taken)
		const allowLocked = !!locals.admin;
		const roomsWithStats = rooms.map((room) => {
			const roomBeds = beds.filter((b) => b.room === room.id && b.enabled !== false);
			const freeCount = roomBeds.filter(
				(b) => !b.occupied && isBedBookable(b, { allowLocked })
			).length;
			return { ...room, freeCount, totalCount: roomBeds.length };
		});

		return {
			house,
			rooms: roomsWithStats,
			userBedId: userBed?.id || null,
			isBookingActive: settings.isBookingActive,
			bookingUnlockAt: settings.bookingUnlockAt
		};
	} catch (err) {
		console.error('[Security] House load failed:', (err as Error)?.message);
		throw error(404, 'House not found in the dust.');
	}
};

export const actions: Actions = {
	unbookBed: async ({ locals }) => {
		if (!locals.adminPb.authStore.isValid) {
			console.error('[Security] House unbookBed: Admin auth invalid.');
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
			console.error('[Security] House unbookBed failed:', err?.message);
			return fail(500, { error: 'Spot release failed. Please try again.' });
		}
	}
};
