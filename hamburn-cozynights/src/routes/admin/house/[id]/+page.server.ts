import { error, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import type { HousesResponse, RoomsResponse, BedsResponse } from '$lib/pocketbase-types';
import { getBookingSettings } from '$lib/server/settings';
import { bedTypeMix, parseDetailsForm } from '$lib/accommodation';
import { countSpots } from '$lib/occupancy';
import { TEMPLATE_LIMITS } from '$lib/template';

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

/** "12" -> 12; anything that is not a plain whole number -> null. */
function parseWholeNumber(value: string): number | null {
	return /^\d{1,6}$/.test(value) ? Number(value) : null;
}

export const actions: Actions = {
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

	createRoom: async ({ request, locals, params }) => {
		if (!locals.admin) return fail(403, { message: 'Only admins can create rooms.' });

		const { isLayoutLocked } = await getBookingSettings(locals.pb);
		if (isLayoutLocked) return fail(403, { message: LOCKED_MESSAGE });

		console.log(`[Action:createRoom] Admin: ${locals.admin.email}, House: ${params.id}`);

		const data = await request.formData();
		const houseId = params.id;
		const name = String(data.get('name') ?? '').trim();
		const numberInput = String(data.get('room_number') ?? '').trim();
		const bedsInput = String(data.get('amount_beds') ?? '').trim();

		// Same limits as the template import, so an exported layout can always be
		// imported again.
		const errors: { name?: string; room_number?: string; amount_beds?: string } = {};
		if (!name) {
			errors.name = 'Enter a name for the room.';
		} else if (name.length > TEMPLATE_LIMITS.roomNameLength) {
			errors.name = `The name is too long. Use at most ${TEMPLATE_LIMITS.roomNameLength} characters.`;
		}

		const roomNumber = parseWholeNumber(numberInput);
		if (roomNumber === null || roomNumber < 1 || roomNumber > TEMPLATE_LIMITS.roomNumber) {
			errors.room_number = `Enter a whole number from 1 to ${TEMPLATE_LIMITS.roomNumber}.`;
		}

		const amountBeds = bedsInput === '' ? 0 : parseWholeNumber(bedsInput);
		if (amountBeds === null || amountBeds > TEMPLATE_LIMITS.bedsPerRoom) {
			errors.amount_beds = `Enter a whole number from 0 to ${TEMPLATE_LIMITS.bedsPerRoom}, or leave it empty.`;
		}

		if (Object.keys(errors).length > 0 || roomNumber === null || amountBeds === null) {
			return fail(400, { message: 'The room was not added. Check the marked fields.', errors });
		}

		try {
			const siblings = await locals.pb.collection('rooms').getFullList<RoomsResponse>({
				filter: locals.pb.filter('house = {:id}', { id: houseId })
			});
			if (siblings.length >= TEMPLATE_LIMITS.roomsPerHouse) {
				return fail(400, {
					message: `This house already has ${siblings.length} rooms, the limit is ${TEMPLATE_LIMITS.roomsPerHouse}. Add the room to another house.`
				});
			}
			const sameNumber = siblings.find((room) => room.room_number === roomNumber);
			if (sameNumber) {
				return fail(400, {
					message: 'The room was not added. Check the marked fields.',
					errors: {
						room_number: `Room number ${roomNumber} is already used by "${sameNumber.name}" in this house. Pick another number.`
					}
				});
			}

			const room = await locals.pb.collection('rooms').create({
				name,
				room_number: roomNumber,
				amount_beds: amountBeds,
				house: houseId
			});

			// Automatically create the room's spots. Like every new spot they are
			// active, i.e. bookable once booking opens.
			for (let i = 1; i <= amountBeds; i++) {
				await locals.pb.collection('beds').create({
					label: `Spot ${i}`,
					room: room.id,
					enabled: true,
					occupied: false
				});
			}

			console.log('[Action:createRoom] SUCCESS.');
			return { success: true };
		} catch (err) {
			console.error('[Action:createRoom] FAILED:', err);
			return fail(500, {
				message:
					'The server could not save the room. Reload the page to see what was created, then try again.'
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
