import { error, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import type { RoomsResponse, BedsResponse, HousesResponse } from '$lib/pocketbase-types';
import { getBookingSettings } from '$lib/server/settings';
import { TEMPLATE_LIMITS } from '$lib/template';

// 1. Define the type including "expand" for related records 🔗
type RoomWithHouse = RoomsResponse<{ house: HousesResponse }>;

export const load: PageServerLoad = async ({ params, locals }) => {
	// Runs in parallel with the layout load, so it guards itself too.
	if (!locals.admin) throw error(403, 'Unauthorized');

	const roomId = params.id;

	try {
		// 2. Fetch room with its parent house expanded 🏠
		const room = await locals.pb.collection('rooms').getOne<RoomWithHouse>(roomId, {
			expand: 'house'
		});

		// 3. Fetch all beds in this house room 🛌
		const beds = await locals.pb.collection('beds').getFullList<BedsResponse>({
			filter: locals.pb.filter('room = {:roomId}', { roomId: roomId }),
			sort: 'label'
		});

		const { isLayoutLocked, phase } = await getBookingSettings(locals.pb);

		return { room, beds, isLayoutLocked, phase };
	} catch (err) {
		console.error('Error fetching house spots:', err);
		throw error(404, 'House room lost in the dust.');
	}
};

const LOCKED_MESSAGE =
	"Spots are locked while booking is live or closed: the layout holds the guests' bookings. Only locking 🔒 still works. A superuser can switch back to Staging Mode in the Control Center.";
const SERVER_ERROR = 'The server could not save the change. Reload the page and try again.';

export const actions: Actions = {
	createBed: async ({ request, params, locals }) => {
		if (!locals.admin) return fail(403, { message: 'Only admins can add spots.' });

		const { isLayoutLocked } = await getBookingSettings(locals.pb);
		if (isLayoutLocked) return fail(403, { message: LOCKED_MESSAGE });

		console.log(`[Action:createBed] Admin: ${locals.admin.email}, Room: ${params.id}`);

		const data = await request.formData();
		const label = String(data.get('label') ?? '').trim();

		// Same rules as the template import, so an exported layout can always be
		// imported again.
		if (!label) {
			return fail(400, { message: 'Enter a label for the spot, for example "B1" or "Top Bunk".' });
		}
		if (label.length > TEMPLATE_LIMITS.bedLabelLength) {
			return fail(400, {
				message: `The label is too long. Use at most ${TEMPLATE_LIMITS.bedLabelLength} characters.`
			});
		}

		try {
			const siblings = await locals.pb.collection('beds').getFullList<BedsResponse>({
				filter: locals.pb.filter('room = {:id}', { id: params.id }),
				fields: 'id,label'
			});
			if (siblings.length >= TEMPLATE_LIMITS.bedsPerRoom) {
				return fail(400, {
					message: `This room already has ${siblings.length} spots, the limit is ${TEMPLATE_LIMITS.bedsPerRoom}. Add the spot to another room.`
				});
			}
			if (siblings.some((bed) => bed.label.trim().toLowerCase() === label.toLowerCase())) {
				return fail(400, {
					message: `This room already has a spot called "${label}". Pick another label.`
				});
			}

			await locals.pb.collection('beds').create({
				label,
				room: params.id,
				// New spots are active (bookable once booking opens), like a new
				// room's or house's spots.
				enabled: true,
				occupied: false
			});
			console.log('[Action:createBed] SUCCESS.');
			return { success: true };
		} catch (err) {
			console.error('[Action:createBed] FAILED:', err);
			return fail(500, { message: SERVER_ERROR });
		}
	},

	deleteBed: async ({ request, locals }) => {
		if (!locals.admin) return fail(403, { message: 'Only admins can delete spots.' });

		const { isLayoutLocked } = await getBookingSettings(locals.pb);
		if (isLayoutLocked) return fail(403, { message: LOCKED_MESSAGE });

		console.log(`[Action:deleteBed] Admin: ${locals.admin.email}`);

		const data = await request.formData();
		const id = data.get('id') as string;
		if (!id) return fail(400, { message: 'No spot was selected. Reload the page and try again.' });

		try {
			await locals.pb.collection('beds').delete(id);
			console.log(`[Action:deleteBed] SUCCESS for ${id}`);
			return { success: true };
		} catch (err) {
			console.error(`[Action:deleteBed] FAILED for ${id}:`, err);
			return fail(500, { message: SERVER_ERROR });
		}
	},

	toggleOccupied: async ({ request, locals }) => {
		if (!locals.admin) return fail(403, { message: 'Only admins can change spots.' });

		const { isLayoutLocked } = await getBookingSettings(locals.pb);
		if (isLayoutLocked) return fail(403, { message: LOCKED_MESSAGE });

		const data = await request.formData();
		const id = data.get('id') as string;
		const occupied = data.get('occupied') === 'true';

		console.log(
			`[Action:toggleOccupied] Admin: ${locals.admin.email}, ID: ${id}, Target: ${!occupied}`
		);

		try {
			// Freeing a spot also detaches the ticket that booked it. Otherwise the
			// guest would keep "their" spot while everybody else sees it as free.
			await locals.pb
				.collection('beds')
				.update(id, occupied ? { occupied: false, order: null } : { occupied: true });
			console.log('[Action:toggleOccupied] SUCCESS.');
			return { success: true };
		} catch (err) {
			console.error('[Action:toggleOccupied] FAILED:', err);
			return fail(500, { message: SERVER_ERROR });
		}
	},

	toggleEnabled: async ({ request, locals }) => {
		if (!locals.admin) return fail(403, { message: 'Only admins can change spots.' });

		const { isLayoutLocked } = await getBookingSettings(locals.pb);
		if (isLayoutLocked) return fail(403, { message: LOCKED_MESSAGE });

		const data = await request.formData();
		const id = data.get('id') as string;
		const enabled = data.get('enabled') === 'true';

		try {
			await locals.pb.collection('beds').update(id, { enabled: !enabled });
			return { success: true };
		} catch (err) {
			console.error('[Action:toggleEnabled] FAILED:', err);
			return fail(500, { message: SERVER_ERROR });
		}
	},

	toggleLocked: async ({ request, locals }) => {
		const data = await request.formData();
		const id = data.get('id') as string;
		const isLocked = data.get('is_locked') === 'true';

		if (!locals.admin) return fail(403, { message: 'Only admins can lock spots.' });

		try {
			await locals.pb.collection('beds').update(id, { is_locked: !isLocked });
			return { success: true };
		} catch (err) {
			console.error('[Action:toggleLocked] FAILED:', err);
			return fail(500, { message: SERVER_ERROR });
		}
	}
};
