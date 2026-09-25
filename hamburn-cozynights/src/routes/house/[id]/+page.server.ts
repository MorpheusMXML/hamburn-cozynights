// src/routes/house/[id]/+page.server.ts
import { error, fail, redirect } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import type { HousesResponse, RoomsResponse, BedsResponse } from '$lib/pocketbase-types';
import { BookingService, CheckedInError, isBedBookable } from '$lib/server/booking';
import { clearGuestSession, signInUrl } from '$lib/server/guest-session';
import { getBookingSettings } from '$lib/server/settings';
import { isSpotFixed, SPOT_FIXED_MESSAGE } from '$lib/server/special-requests';
import { passSummary } from '$lib/server/pass';
import {
	bedTypeMix,
	effectiveFeatures,
	readFeatures,
	readFilters,
	spotFacts,
	spotMatchesFilters
} from '$lib/accommodation';
import type { PassSummary } from '$lib/pass';

const UNAVAILABLE = 'The booking system is not reachable right now. Please try again in a minute.';

export const load: PageServerLoad = async ({ params, locals, cookies, url }) => {
	if (!locals.orderNumber) throw redirect(303, signInUrl(locals, `/house/${params.id}`));

	const bookingService = new BookingService(locals.adminPb);
	// hooks.server.ts read the ticket for this request already; it only looks it
	// up here when PocketBase couldn't answer there.
	let order = locals.order ?? null;
	try {
		if (!order) order = await bookingService.getOrderByNumber(locals.orderNumber);
	} catch (err) {
		console.error('[House] Order lookup failed:', (err as Error)?.message);
		throw error(503, UNAVAILABLE);
	}

	if (!order) {
		console.warn('[Security] House load: unknown ticket code in cookie.');
		clearGuestSession(cookies);
		throw redirect(303, '/?login=expired');
	}

	try {
		const [house, rooms, beds, settings, userBed] = await Promise.all([
			locals.pb.collection('houses').getOne<HousesResponse>(params.id),
			locals.pb.collection('rooms').getFullList<RoomsResponse>({
				filter: locals.pb.filter('house = {:id}', { id: params.id }),
				sort: 'room_number'
			}),
			// beds are admin-only in PocketBase (order, is_special, booked_at):
			// the service account reads them, the page keeps only what it shows
			locals.adminPb.collection('beds').getFullList<BedsResponse>({
				filter: locals.adminPb.filter('room.house = {:id}', { id: params.id })
			}),
			getBookingSettings(locals.pb),
			bookingService.getBedForOrder(order.id)
		]);

		// Calculate occupancy 👥 (deactivated beds don't exist for guests,
		// locked ones count as taken)
		const allowLocked = !!locals.admin;
		// Wishes the guest picked on the map, carried over in the link.
		const wishes = readFilters(url.searchParams.get('w'));
		const houseFeatures = house.features;
		const roomsWithStats = rooms.map((room) => {
			const roomBeds = beds.filter((b) => b.room === room.id && b.enabled !== false);
			const free = roomBeds.filter((b) => !b.occupied && isBedBookable(b, { allowLocked }));
			// What the room or the spot switched off (a superuser's call) is gone
			// from the sum, so a wish never counts a heating the spot gave up.
			const facts = (bed: (typeof roomBeds)[number]) =>
				spotFacts({
					bedType: bed.bed_type,
					house: houseFeatures,
					room: room.features,
					spot: bed.features,
					roomOff: room.features_off,
					spotOff: bed.features_off
				});
			return {
				...room,
				freeCount: free.length,
				totalCount: roomBeds.length,
				kind: room.kind ?? '',
				features: effectiveFeatures({
					house: houseFeatures,
					room: room.features,
					roomOff: room.features_off
				}),
				description: room.description ?? '',
				bedMix: bedTypeMix(roomBeds.map((bed) => bed.bed_type)),
				// Only counted when the guest brought wishes along from the map.
				fittingFree:
					wishes.length > 0
						? free.filter((bed) => spotMatchesFilters(wishes, facts(bed))).length
						: null
			};
		});

		// Whether the crew picked the guest's spot, and their booking pass.
		// Optional: the page works without them.
		const [spotFixed, pass]: [boolean, PassSummary | null] = userBed
			? await Promise.all([
					isSpotFixed(locals.adminPb, order.id, userBed.id).catch((err) => {
						console.error('[House] Special-needs request lookup failed:', (err as Error)?.message);
						return false;
					}),
					passSummary(locals.adminPb, order, userBed).catch((err) => {
						console.error('[House] Booking pass failed:', (err as Error)?.message);
						return null;
					})
				])
			: [false, null];

		return {
			house: {
				...house,
				kind: house.kind ?? '',
				features: readFeatures(house.features, 'house'),
				description: house.description ?? ''
			},
			wishes,
			rooms: roomsWithStats,
			userBedId: userBed?.id || null,
			spotFixed,
			// The crew checked the guest in at arrival: only the crew changes the spot now.
			checkedIn: !!userBed?.checked_in_at,
			pass,
			isBookingActive: settings.isBookingActive,
			phase: settings.phase,
			// what the banners say; what is allowed still follows `phase`
			guestPhase: settings.guestPhase,
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
			if (await isSpotFixed(locals.adminPb, order.id)) {
				return fail(409, { error: SPOT_FIXED_MESSAGE });
			}

			await bookingService.unbookOrder(order.id);
			return { success: true };
		} catch (err: any) {
			if (err instanceof CheckedInError) return fail(409, { error: err.message });
			console.error('[Security] House unbookBed failed:', err?.message);
			return fail(500, {
				error: 'Your spot could not be released. It is still reserved for you. Please try again.'
			});
		}
	}
};
