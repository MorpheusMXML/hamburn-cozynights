// src/routes/house/[id]/+page.server.ts
import { error, fail, redirect } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import type { HousesResponse, RoomsResponse, BedsResponse } from '$lib/pocketbase-types';
import { BookingService, isBedBookable } from '$lib/server/booking';
import { getBookingSettings } from '$lib/server/settings';

const UNAVAILABLE = 'The booking system is not reachable right now. Please try again in a minute.';

export const load: PageServerLoad = async ({ params, locals, cookies }) => {
	if (!locals.orderNumber) throw redirect(303, '/?login=required');

	const bookingService = new BookingService(locals.adminPb);
	let order;
	try {
		order = await bookingService.getOrderByNumber(locals.orderNumber);
	} catch (err) {
		console.error('[House] Order lookup failed:', (err as Error)?.message);
		throw error(503, UNAVAILABLE);
	}

	if (!order) {
		console.warn('[Security] House load: unknown ticket code in cookie.');
		cookies.delete('bookingCode', { path: '/' });
		throw redirect(303, '/?login=expired');
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
			phase: settings.phase,
			bookingUnlockAt: settings.bookingUnlockAt
		};
	} catch (err) {
		if ((err as { status?: number })?.status === 404) {
			throw error(404, "This house doesn't exist (anymore). Pick another one on the map.");
		}
		console.error('[House] Load failed:', (err as Error)?.message);
		throw error(503, UNAVAILABLE);
	}
};

export const actions: Actions = {
	unbookBed: async ({ locals }) => {
		if (!locals.adminPb.authStore.isValid) {
			console.error('[Security] House unbookBed: Admin auth invalid.');
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

		if (!locals.orderNumber) {
			return fail(401, {
				error:
					'You are not signed in anymore. Go to the start page and enter your ticket code again.'
			});
		}

		const bookingService = new BookingService(locals.adminPb);

		try {
			const order = await bookingService.getOrderByNumber(locals.orderNumber);
			if (!order) {
				return fail(404, {
					error: 'Your ticket code was not found. Go to the start page and enter it again.'
				});
			}

			await bookingService.unbookOrder(order.id);
			return { success: true };
		} catch (err: any) {
			console.error('[Security] House unbookBed failed:', err?.message);
			return fail(500, {
				error: 'Your spot could not be released. It is still reserved for you. Please try again.'
			});
		}
	}
};
