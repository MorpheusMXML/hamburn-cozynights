import { error, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import type { RoomsResponse, BedsResponse, HousesResponse } from '$lib/pocketbase-types';
import { getBookingSettings } from '$lib/server/settings';

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

		const { isBookingActive } = await getBookingSettings(locals.pb);

		return { room, beds, isBookingActive };
	} catch (err) {
		console.error('Error fetching house spots:', err);
		throw error(404, 'House room lost in the dust.');
	}
};

export const actions: Actions = {
	createBed: async ({ request, params, locals }) => {
		if (!locals.admin) return fail(403, { message: 'Only admins can add spots.' });

		const { isBookingActive } = await getBookingSettings(locals.pb);
		if (isBookingActive) return fail(403, { message: 'Management locked during live booking.' });

		console.log(`[Action:createBed] Admin: ${locals.admin.email}, Room: ${params.id}`);

		const data = await request.formData();

		try {
			await locals.pb.collection('beds').create({
				label: data.get('label'),
				room: params.id,
				// New spots are active (bookable once booking opens), like a new
				// room's or house's spots.
				enabled: true,
				occupied: false
			});
			console.log('[Action:createBed] SUCCESS.');
		} catch (err) {
			console.error('[Action:createBed] FAILED:', err);
			return fail(500, { message: 'Something went wrong. Please try again.' });
		}
	},

	deleteBed: async ({ request, locals }) => {
		if (!locals.admin) return fail(403, { message: 'Only admins can delete spots.' });

		const { isBookingActive } = await getBookingSettings(locals.pb);
		if (isBookingActive) return fail(403, { message: 'Management locked during live booking.' });

		console.log(`[Action:deleteBed] Admin: ${locals.admin.email}`);

		const data = await request.formData();
		const id = data.get('id') as string;

		try {
			if (id) await locals.pb.collection('beds').delete(id);
			console.log(`[Action:deleteBed] SUCCESS for ${id}`);
		} catch (err) {
			console.error(`[Action:deleteBed] FAILED for ${id}:`, err);
			return fail(500, { message: 'Something went wrong. Please try again.' });
		}
	},

	toggleOccupied: async ({ request, locals }) => {
		if (!locals.admin) return fail(403, { message: 'Only admins can change spots.' });

		const { isBookingActive } = await getBookingSettings(locals.pb);
		if (isBookingActive) return fail(403, { message: 'Management locked during live booking.' });

		const data = await request.formData();
		const id = data.get('id') as string;
		const occupied = data.get('occupied') === 'true';

		console.log(
			`[Action:toggleOccupied] Admin: ${locals.admin.email}, ID: ${id}, Target: ${!occupied}`
		);

		try {
			await locals.pb.collection('beds').update(id, { occupied: !occupied });
			console.log('[Action:toggleOccupied] SUCCESS.');
		} catch (err) {
			console.error('[Action:toggleOccupied] FAILED:', err);
			return fail(500, { message: 'Something went wrong. Please try again.' });
		}
	},

	toggleEnabled: async ({ request, locals }) => {
		if (!locals.admin) return fail(403, { message: 'Only admins can change spots.' });

		const { isBookingActive } = await getBookingSettings(locals.pb);
		if (isBookingActive) return fail(403, { message: 'Management locked during live booking.' });

		const data = await request.formData();
		const id = data.get('id') as string;
		const enabled = data.get('enabled') === 'true';

		try {
			await locals.pb.collection('beds').update(id, { enabled: !enabled });
		} catch (err) {
			return fail(500, { message: 'Something went wrong. Please try again.' });
		}
	},

	toggleLocked: async ({ request, locals }) => {
		const data = await request.formData();
		const id = data.get('id') as string;
		const isLocked = data.get('is_locked') === 'true';

		if (!locals.admin) return fail(403, { message: 'Only admins can lock spots.' });

		try {
			await locals.pb.collection('beds').update(id, { is_locked: !isLocked });
		} catch (err) {
			console.error('[Action:toggleLocked] FAILED:', err);
			return fail(500, { message: 'Something went wrong. Please try again.' });
		}
	}
};
