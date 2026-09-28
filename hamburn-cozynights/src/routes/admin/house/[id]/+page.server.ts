import { error, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import type { HousesResponse, RoomsResponse, BedsResponse } from '$lib/pocketbase-types';
import { getBookingSettings } from '$lib/server/settings';
import { bedTypeMix, parseDetailsForm } from '$lib/accommodation';
import { countSpots } from '$lib/occupancy';
import { readBookings } from '$lib/server/bookings';
import { NAMES_LOCKED, checkHouseName } from '$lib/server/names';
import { formatSizes, readPlanForm, suggestSize } from '$lib/house-plan';
import { GeneratorError, generateRooms } from '$lib/server/house-generator';

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

		// 4. Fetch app settings for booking status, and who holds which spot
		// (masked like at the check-in desk)
		const [settings, bookings] = await Promise.all([
			getBookingSettings(locals.pb),
			readBookings(locals.adminPb, { houseId }).catch((err) => {
				console.error('[House] Bookings could not be read:', (err as Error)?.message);
				return null;
			})
		]);

		// 5. Map statistics 📊 (deactivated spots don't count, locked ones aren't free)
		const roomsWithStats = rooms.map((room) => ({
			...room,
			stats: countSpots(beds.filter((b) => b.room === room.id)),
			// "4 × lower bunk · 4 × upper bunk" for the card
			bedMix: bedTypeMix(beds.filter((b) => b.room === room.id).map((b) => b.bed_type))
		}));

		return {
			house,
			rooms: roomsWithStats,
			// ADD ROOMS starts with one more room like the ones the house has most of.
			suggestedSize: suggestSize(
				rooms.map((room) => {
					const own = beds.filter((b) => b.room === room.id);
					return { spots: own.length, bunks: own.some((b) => !!b.bunk_partner) };
				})
			),
			bookings,
			isLayoutLocked: settings.isLayoutLocked,
			phase: settings.phase
		};
	} catch (err) {
		console.error(err);
		throw error(404, 'House not found.');
	}
};

const LOCKED_MESSAGE =
	"Rooms are locked while booking is live or closed: the layout holds the guests' bookings. A superuser can switch back to Staging Mode in the Control Center.";

export const actions: Actions = {
	/**
	 * A new name for the house, from a click on the page's title (InlineRename):
	 * only in Staging Mode, and once in the camp — the rules of creating one
	 * ($lib/server/names).
	 */
	renameHouse: async ({ request, params, locals }) => {
		if (!locals.admin) return fail(403, { message: 'Only admins can rename houses.' });

		const { isLayoutLocked } = await getBookingSettings(locals.pb);
		if (isLayoutLocked) return fail(403, { message: NAMES_LOCKED });

		const data = await request.formData();
		try {
			const name = await checkHouseName(locals.pb, params.id, data.get('name'));
			if (!name.ok) return fail(400, { message: name.message });
			await locals.pb.collection('houses').update(params.id, { name: name.value });
			console.log(`[Action:renameHouse] Admin: ${locals.admin.email}, House: ${params.id}`);
			return { success: true };
		} catch (err) {
			console.error('[Action:renameHouse] FAILED:', err);
			return fail(500, {
				message: 'The server could not rename the house. Reload the page and try again.'
			});
		}
	},

	/**
	 * What the house is like: kind, features and description (src/lib/accommodation.ts).
	 * Allowed in every phase, like the room details: they describe the place.
	 */
	saveHouse: async ({ request, params, locals }) => {
		if (!locals.admin) return fail(403, { message: 'Only admins can change houses.' });

		const details = parseDetailsForm(await request.formData(), 'house');
		if (!details.ok) return fail(400, { message: details.error });

		try {
			await locals.pb.collection('houses').update(params.id, details.value);
			return { success: true };
		} catch (err) {
			console.error('[Action:saveHouse] FAILED:', err);
			return fail(500, {
				message: 'The server could not save the details. Reload the page and try again.'
			});
		}
	},

	/**
	 * ADD ROOMS: the size rows of the house generator ($lib/house-plan) —
	 * "3 rooms × 4 beds", numbers after the house's last room, rolled names,
	 * spots B1 … Bn (stacked in pairs with 🪜). All or nothing.
	 */
	createRooms: async ({ request, locals, params }) => {
		if (!locals.admin) return fail(403, { message: 'Only admins can create rooms.' });

		const { isLayoutLocked } = await getBookingSettings(locals.pb);
		if (isLayoutLocked) return fail(403, { message: LOCKED_MESSAGE });

		const form = readPlanForm(await request.formData());
		if (!form.ok) return fail(400, { message: form.error });

		let house: HousesResponse;
		try {
			house = await locals.pb.collection('houses').getOne<HousesResponse>(params.id);
		} catch (err) {
			console.error('[Action:createRooms] House not found:', err);
			return fail(404, {
				message: 'This house is gone. Reload the Control Center to see the camp as it is.'
			});
		}

		console.log(
			`[Action:createRooms] Admin: ${locals.admin.email}, House: ${params.id}, sizes ${formatSizes(form.plan.sizes)}${form.plan.floors ? ', floor blocks' : ''}`
		);
		try {
			const built = await generateRooms(locals.pb, house, form.plan);
			console.log(`[Action:createRooms] SUCCESS: ${built.rooms} rooms, ${built.spots} spots.`);
			return { success: true, rooms: built.rooms, spots: built.spots, names: built.names };
		} catch (err) {
			if (err instanceof GeneratorError) return fail(err.status, { message: err.full });
			console.error('[Action:createRooms] FAILED:', err);
			return fail(500, {
				message:
					'The server could not save the rooms. Reload the page to see what was created, then try again.'
			});
		}
	},

	deleteRoom: async ({ request, locals }) => {
		if (!locals.admin) return fail(403, { message: 'Only admins can delete rooms.' });

		const { isLayoutLocked } = await getBookingSettings(locals.pb);
		if (isLayoutLocked) return fail(403, { message: LOCKED_MESSAGE });

		console.log(`[Action:deleteRoom] Admin: ${locals.admin.email}`);

		const data = await request.formData();
		const id = data.get('id') as string;
		if (!id) return fail(400, { message: 'No room was selected. Reload the page and try again.' });

		try {
			await locals.pb.collection('rooms').delete(id);
			console.log(`[Action:deleteRoom] SUCCESS for ${id}`);
			return { success: true };
		} catch (err) {
			console.error(`[Action:deleteRoom] FAILED for ${id}:`, err);
			return fail(500, {
				message: 'The server could not delete the room. Reload the page and try again.'
			});
		}
	}
};
