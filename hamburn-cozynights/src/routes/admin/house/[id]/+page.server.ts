import { error, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import type { HousesResponse, RoomsResponse, BedsResponse } from '$lib/pocketbase-types';
import { getBookingSettings } from '$lib/server/settings';

export const load: PageServerLoad = async ({ params, locals }) => {
	// Security check 🛡️ (runs in parallel with the layout load)
	if (!locals.admin) throw error(403, 'Unauthorized');

	const houseId = params.id;

	try {
		// 1. Fetch house data 🏠
		const house = await locals.pb.collection('houses').getOne<HousesResponse>(houseId);

		// 2. Fetch rooms in this house 🚪
		const rooms = await locals.pb.collection('rooms').getFullList<RoomsResponse>({
			filter: locals.pb.filter('house = {:id}', { id: houseId }),
			sort: 'room_number'
		});

		// 3. Fetch all beds for these rooms 🛌
		const beds = await locals.pb.collection('beds').getFullList<BedsResponse>({
			filter: locals.pb.filter('room.house = {:id}', { id: houseId })
		});

		// 4. Fetch app settings for booking status
		const settings = await getBookingSettings(locals.pb);

		// 5. Map statistics 📊
		const roomsWithStats = rooms.map((room) => {
			const roomBeds = beds.filter((b) => b.room === room.id && b.enabled !== false);
			const occupied = roomBeds.filter((b) => b.occupied).length;

			return {
				...room,
				stats: {
					total: roomBeds.length,
					occupied: occupied,
					free: roomBeds.length - occupied
				}
			};
		});

		return { house, rooms: roomsWithStats, isBookingActive: settings.isBookingActive };
	} catch (err) {
		console.error(err);
		throw error(404, 'House not found.');
	}
};

export const actions: Actions = {
	createRoom: async ({ request, locals, params }) => {
		if (!locals.admin) return fail(403, { message: 'Only admins can create rooms.' });

		const { isBookingActive } = await getBookingSettings(locals.pb);
		if (isBookingActive) return fail(403, { message: 'Management locked during live booking.' });

		console.log(`[Action:createRoom] Admin: ${locals.admin.email}, House: ${params.id}`);

		const data = await request.formData();
		const houseId = params.id;
		const amountBeds = parseInt((data.get('amount_beds') as string) || '0');

		try {
			const room = await locals.pb.collection('rooms').create({
				name: data.get('name'),
				room_number: parseInt(data.get('room_number') as string),
				amount_beds: amountBeds,
				house: houseId
			});

			// Automatically create bed templates
			if (amountBeds > 0) {
				for (let i = 1; i <= amountBeds; i++) {
					await locals.pb.collection('beds').create({
						label: `Spot ${i}`,
						room: room.id,
						enabled: false,
						occupied: false
					});
				}
			}

			console.log('[Action:createRoom] SUCCESS.');
		} catch (err) {
			console.error('[Action:createRoom] FAILED:', err);
			return fail(500, { message: 'Something went wrong. Please try again.' });
		}
	},

	deleteRoom: async ({ request, locals }) => {
		if (!locals.admin) return fail(403, { message: 'Only admins can delete rooms.' });

		const { isBookingActive } = await getBookingSettings(locals.pb);
		if (isBookingActive) return fail(403, { message: 'Management locked during live booking.' });

		console.log(`[Action:deleteRoom] Admin: ${locals.admin.email}`);

		const data = await request.formData();
		const id = data.get('id') as string;

		try {
			if (id) await locals.pb.collection('rooms').delete(id);
			console.log(`[Action:deleteRoom] SUCCESS for ${id}`);
		} catch (err) {
			console.error(`[Action:deleteRoom] FAILED for ${id}:`, err);
			return fail(500, { message: 'Something went wrong. Please try again.' });
		}
	}
};
