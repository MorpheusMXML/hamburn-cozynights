import { error, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import type { RoomsResponse, BedsResponse, HousesResponse } from '$lib/pocketbase-types';
import { getBookingSettings } from '$lib/server/settings';
import { readBookings } from '$lib/server/bookings';
import { TEMPLATE_LIMITS, compareNatural } from '$lib/template';
import { parseDetailsForm, parseSpotForm, type BedType } from '$lib/accommodation';
import {
	BUNK_LEVEL_TYPE,
	bunkOf,
	stackProblem,
	stackWrites,
	unstackWrite,
	type BunkSpot
} from '$lib/bunks';

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
		// PocketBase sorts "B1, B10, B2"; the crew reads B1, B2, … B10. The bunk
		// pairing and the SPOT TYPES patterns use the same order.
		beds.sort((a, b) => compareNatural(a.label ?? '', b.label ?? ''));

		const [{ isLayoutLocked, phase }, bookings] = await Promise.all([
			getBookingSettings(locals.pb),
			// Who holds each booked spot (masked like at the check-in desk).
			readBookings(locals.adminPb, { roomId }).catch((err) => {
				console.error('[Room] Bookings could not be read:', (err as Error)?.message);
				return null;
			})
		]);

		// The room comes with its house (expand), so the page can show what the
		// room inherits; the beds carry features_off (no field list narrows them).
		// Only a superuser gets the "off here" boxes (DetailsPanel, SpotDetails).
		return {
			room,
			beds,
			bookings,
			isLayoutLocked,
			phase,
			isSuperuser: !!locals.admin?.isSuperuser
		};
	} catch (err) {
		console.error('Error fetching house spots:', err);
		throw error(404, 'House room lost in the dust.');
	}
};

const LOCKED_MESSAGE =
	"Spots are locked while booking is live or closed: the layout holds the guests' bookings. Only locking 🔒 and the ♿ special-needs mark still work. A superuser can switch back to Staging Mode in the Control Center.";
const SERVER_ERROR = 'The server could not save the change. Reload the page and try again.';

/** The spots of the room in the order the page shows, with what a bunk bed needs. */
async function readRoomBeds(pb: App.Locals['pb'], roomId: string) {
	const beds = await pb.collection('beds').getFullList<BedsResponse>({
		filter: pb.filter('room = {:id}', { id: roomId }),
		fields: 'id,label,bed_type,bunk_partner'
	});
	beds.sort((a, b) => compareNatural(a.label ?? '', b.label ?? ''));
	return beds as (BedsResponse & BunkSpot)[];
}

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

	/**
	 * Special-needs spot (♿): guests can't book it, admins assign it to approved
	 * requests (/admin/requests). Allowed during Live Booking too, like locking.
	 */
	toggleSpecial: async ({ request, locals }) => {
		if (!locals.admin) return fail(403, { message: 'Only admins can change spots.' });

		const data = await request.formData();
		const id = data.get('id') as string;
		const isSpecial = data.get('is_special') === 'true';
		if (!id) return fail(400, { message: 'No spot was selected. Reload the page and try again.' });

		try {
			await locals.pb.collection('beds').update(id, { is_special: !isSpecial });
			return { success: true };
		} catch (err) {
			console.error('[Action:toggleSpecial] FAILED:', err);
			return fail(500, { message: SERVER_ERROR });
		}
	},

	/**
	 * What the room is like: kind, features and description. Allowed in every
	 * phase — details describe the place, they don't move a booking. The name is
	 * part of the layout, so the form only sends it in Staging Mode. What the
	 * room switches off of its house's features (features_off) is a superuser's
	 * call: only their form is read for it, so an admin's save never changes it.
	 */
	saveRoom: async ({ request, params, locals }) => {
		if (!locals.admin) return fail(403, { message: 'Only admins can change rooms.' });

		const data = await request.formData();
		const canOverride = !!locals.admin.isSuperuser;
		const details = parseDetailsForm(data, 'room', { canOverride });
		if (!details.ok) return fail(400, { message: details.error });

		// features_off is part of the value only when a superuser posted
		// (parseDetailsForm); an empty list then resets the room to its house.
		const patch: Record<string, unknown> = { ...details.value };
		if (details.value.features_off) {
			console.log(
				`[Action:saveRoom] Superuser: ${locals.admin.email}, Room: ${params.id}, off: ${
					details.value.features_off.join(', ') || '(reset, inherits everything)'
				}`
			);
		}
		const { isLayoutLocked } = await getBookingSettings(locals.pb);
		if (data.has('name') && !isLayoutLocked) {
			const name = String(data.get('name') ?? '').trim();
			if (!name) return fail(400, { message: 'Enter a name for the room.' });
			if (name.length > TEMPLATE_LIMITS.roomNameLength) {
				return fail(400, {
					message: `The name is too long. Use at most ${TEMPLATE_LIMITS.roomNameLength} characters.`
				});
			}
			patch.name = name;
		}

		try {
			await locals.pb.collection('rooms').update(params.id, patch);
			return { success: true };
		} catch (err) {
			console.error('[Action:saveRoom] FAILED:', err);
			return fail(500, { message: SERVER_ERROR });
		}
	},

	/**
	 * What one spot is like: its bed type, a socket at the bed, and its label in
	 * Staging Mode. What it switches off of what it inherits (features_off) is a
	 * superuser's call, read from their form only, like on the room.
	 */
	saveSpot: async ({ request, params, locals }) => {
		if (!locals.admin) return fail(403, { message: 'Only admins can change spots.' });

		const data = await request.formData();
		const id = String(data.get('id') ?? '');
		if (!id) return fail(400, { message: 'No spot was selected. Reload the page and try again.' });

		const canOverride = !!locals.admin.isSuperuser;
		const spot = parseSpotForm(data, { canOverride });
		if (!spot.ok) return fail(400, { message: spot.error });

		// features_off is part of the value only when a superuser posted
		// (parseSpotForm); an empty list then resets the spot to its room.
		const patch: Record<string, unknown> = { ...spot.value };
		if (spot.value.features_off) {
			console.log(
				`[Action:saveSpot] Superuser: ${locals.admin.email}, Spot: ${id}, off: ${
					spot.value.features_off.join(', ') || '(reset, inherits everything)'
				}`
			);
		}

		// The level of a stacked spot comes from the stacking, not from the form.
		// Features and the label may still change.
		try {
			const stored = await locals.pb.collection('beds').getOne<BedsResponse>(id, {
				fields: 'id,bed_type,bunk_partner'
			});
			if (stored.bunk_partner && (stored.bed_type ?? '') !== spot.value.bed_type) {
				return fail(400, {
					message:
						'This spot is part of a bunk bed, so its level comes from the stacking. Unstack it to change the bed.'
				});
			}
		} catch (err) {
			console.error('[Action:saveSpot] The spot could not be read:', err);
			return fail(400, { message: 'The spot was not found. Reload the page and try again.' });
		}

		const { isLayoutLocked } = await getBookingSettings(locals.pb);
		if (data.has('label') && !isLayoutLocked) {
			const label = String(data.get('label') ?? '').trim();
			if (!label) {
				return fail(400, {
					message: 'Enter a label for the spot, for example "B1" or "Top Bunk".'
				});
			}
			if (label.length > TEMPLATE_LIMITS.bedLabelLength) {
				return fail(400, {
					message: `The label is too long. Use at most ${TEMPLATE_LIMITS.bedLabelLength} characters.`
				});
			}
			// The room of the page, not one the form claims: a label is unique per room.
			const siblings = await locals.pb.collection('beds').getFullList<BedsResponse>({
				filter: locals.pb.filter('room = {:id} && id != {:bed}', { id: params.id, bed: id }),
				fields: 'id,label'
			});
			if (siblings.some((bed) => bed.label.trim().toLowerCase() === label.toLowerCase())) {
				return fail(400, {
					message: `This room already has a spot called "${label}". Pick another label.`
				});
			}
			patch.label = label;
		}

		try {
			await locals.pb.collection('beds').update(id, patch);
			return { success: true };
		} catch (err) {
			console.error('[Action:saveSpot] FAILED:', err);
			return fail(500, { message: SERVER_ERROR });
		}
	},

	/**
	 * The bed type of every spot of the room at once — a room of bunk beds is
	 * entered in one click instead of eight. Spots keep their labels; the order
	 * is the one the page shows (natural label order: B1, B2, … B10). "Bunk
	 * beds" also stacks the spots in pairs — B1 + B2, B3 + B4, … — so each pair
	 * shows as one bed; a trailing odd spot stands alone with no bed type. The
	 * other patterns take every bunk bed apart again.
	 */
	setBedTypes: async ({ request, params, locals }) => {
		if (!locals.admin) return fail(403, { message: 'Only admins can change spots.' });

		const pattern = String((await request.formData()).get('pattern') ?? '');
		const patterns: Record<string, (index: number, count: number) => BedType | ''> = {
			bunks: (index, count) => {
				// The last spot of an odd room has nobody to stack with.
				if (index % 2 === 0 && index === count - 1) return '';
				return index % 2 === 0 ? BUNK_LEVEL_TYPE.lower : BUNK_LEVEL_TYPE.upper;
			},
			single: () => 'single',
			clear: () => ''
		};
		const bedType = patterns[pattern];
		if (!bedType) return fail(400, { message: 'Pick what the spots of this room are.' });

		try {
			const beds = await readRoomBeds(locals.pb, params.id);
			for (const [index, bed] of beds.entries()) {
				const bed_type = bedType(index, beds.length);
				let bunk_partner = '';
				if (pattern === 'bunks' && bed_type) {
					// Even index: the lower bunk, its partner is the next spot; odd
					// index: the upper bunk above the spot before it.
					bunk_partner = index % 2 === 0 ? beds[index + 1].id : beds[index - 1].id;
				}
				await locals.pb.collection('beds').update(bed.id, { bed_type, bunk_partner });
			}
			return { success: true };
		} catch (err) {
			console.error('[Action:setBedTypes] FAILED:', err);
			return fail(500, { message: SERVER_ERROR });
		}
	},

	/**
	 * Two spots become one bunk bed: `lower` gets `upper` stacked on top.
	 * Allowed in every phase, like 🔒 and ♿: a detail of the spots, not a
	 * change of the layout — a booked spot keeps its guest and gets a level.
	 * Both sides are written here; pb_hooks/cozy_bunks.pb.js only heals.
	 */
	stackBunk: async ({ request, params, locals }) => {
		if (!locals.admin) return fail(403, { message: 'Only admins can change spots.' });

		const data = await request.formData();
		const lower = String(data.get('lower') ?? '');
		const upper = String(data.get('upper') ?? '');
		if (!lower || !upper) {
			return fail(400, { message: 'Pick the two spots to stack. Reload the page and try again.' });
		}

		try {
			const beds = await readRoomBeds(locals.pb, params.id);
			const problem = stackProblem(beds, lower, upper);
			if (problem) return fail(400, { message: problem });

			const writes = stackWrites(lower, upper);
			await locals.pb.collection('beds').update(writes.lower.id, {
				bunk_partner: writes.lower.bunk_partner,
				bed_type: writes.lower.bed_type
			});
			await locals.pb.collection('beds').update(writes.upper.id, {
				bunk_partner: writes.upper.bunk_partner,
				bed_type: writes.upper.bed_type
			});
			console.log(`[Action:stackBunk] Admin: ${locals.admin.email}, ${upper} above ${lower}`);
			return { success: true };
		} catch (err) {
			console.error('[Action:stackBunk] FAILED:', err);
			return fail(500, { message: SERVER_ERROR });
		}
	},

	/** A bunk bed is taken apart: both spots stand alone again, with no level. */
	unstackBunk: async ({ request, params, locals }) => {
		if (!locals.admin) return fail(403, { message: 'Only admins can change spots.' });

		const id = String((await request.formData()).get('id') ?? '');
		if (!id) return fail(400, { message: 'No spot was selected. Reload the page and try again.' });

		try {
			const beds = await readRoomBeds(locals.pb, params.id);
			const bunk = bunkOf(beds, id);
			if (!bunk) {
				return fail(400, { message: 'This spot is not part of a bunk bed. Reload the page.' });
			}
			for (const spot of [bunk.lower, bunk.upper]) {
				const { id: spotId, ...patch } = unstackWrite(spot);
				await locals.pb.collection('beds').update(spotId, patch);
			}
			console.log(`[Action:unstackBunk] Admin: ${locals.admin.email}, ${bunk.lower.id}`);
			return { success: true };
		} catch (err) {
			console.error('[Action:unstackBunk] FAILED:', err);
			return fail(500, { message: SERVER_ERROR });
		}
	},

	/** The two levels of a bunk bed change places; the pairing stays. */
	swapBunk: async ({ request, params, locals }) => {
		if (!locals.admin) return fail(403, { message: 'Only admins can change spots.' });

		const id = String((await request.formData()).get('id') ?? '');
		if (!id) return fail(400, { message: 'No spot was selected. Reload the page and try again.' });

		try {
			const beds = await readRoomBeds(locals.pb, params.id);
			const bunk = bunkOf(beds, id);
			if (!bunk) {
				return fail(400, { message: 'This spot is not part of a bunk bed. Reload the page.' });
			}
			await locals.pb.collection('beds').update(bunk.lower.id, { bed_type: BUNK_LEVEL_TYPE.upper });
			await locals.pb.collection('beds').update(bunk.upper.id, { bed_type: BUNK_LEVEL_TYPE.lower });
			return { success: true };
		} catch (err) {
			console.error('[Action:swapBunk] FAILED:', err);
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
