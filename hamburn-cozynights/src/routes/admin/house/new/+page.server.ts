import { error, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { getBookingSettings } from '$lib/server/settings';
import { MAP_WIDTH, MAP_HEIGHT, parseMapCoordinate } from '$lib/map-geometry';
import { TEMPLATE_LIMITS } from '$lib/template';

export const load: PageServerLoad = async ({ locals, url }) => {
	// Runs in parallel with the layout load, so it guards itself too.
	if (!locals.admin) throw error(403, 'Unauthorized');

	const { isBookingActive } = await getBookingSettings(locals.pb);
	return {
		isBookingActive,
		// Without (valid) coordinates in the URL the house starts in the middle of the map.
		x: parseMapCoordinate(url.searchParams.get('x'), MAP_WIDTH) ?? MAP_WIDTH / 2,
		y: parseMapCoordinate(url.searchParams.get('y'), MAP_HEIGHT) ?? MAP_HEIGHT / 2
	};
};

export const actions: Actions = {
	// Also called by the Control Center's sidebar ("IGNITE HOUSE").
	create: async ({ request, locals }) => {
		if (!locals.admin) return fail(403, { error: 'Only admins can create houses.' });

		const { isBookingActive } = await getBookingSettings(locals.pb);
		if (isBookingActive) {
			console.warn('[Action] BLOCKED: cannot create a house during LIVE mode.');
			return fail(403, {
				error:
					'Houses cannot be added while Live Booking is active. Switch to Staging Mode in the Control Center first.'
			});
		}

		const data = await request.formData();
		const name = String(data.get('name') ?? '').trim();
		const x = parseMapCoordinate(data.get('x'), MAP_WIDTH);
		const y = parseMapCoordinate(data.get('y'), MAP_HEIGHT);
		const bedInput = String(data.get('bedCount') ?? '').trim();
		const bedCount = bedInput === '' ? 0 : /^\d{1,6}$/.test(bedInput) ? Number(bedInput) : null;

		// Same limits as the template import, so an exported layout can always be
		// imported again.
		if (!name) return fail(400, { error: 'Enter a name for the house.', field: 'name' });
		if (name.length > TEMPLATE_LIMITS.houseNameLength) {
			return fail(400, {
				error: `The house name is too long. Use at most ${TEMPLATE_LIMITS.houseNameLength} characters.`,
				field: 'name'
			});
		}
		if (x === null || y === null) {
			return fail(400, {
				error: `The map position must be whole numbers: X 0–${MAP_WIDTH}, Y 0–${MAP_HEIGHT}.`
			});
		}
		if (bedCount === null || bedCount > TEMPLATE_LIMITS.bedsPerRoom) {
			return fail(400, {
				error: `The initial capacity must be a whole number from 0 to ${TEMPLATE_LIMITS.bedsPerRoom}.`,
				field: 'bedCount'
			});
		}

		console.log(`[Action] Ignite House: "${name}" at (${x}, ${y}) with ${bedCount} initial spots.`);

		try {
			const houses = await locals.pb.collection('houses').getFullList({ fields: 'id,name' });
			if (houses.length >= TEMPLATE_LIMITS.houses) {
				return fail(400, {
					error: `The camp already has ${houses.length} houses, the limit is ${TEMPLATE_LIMITS.houses}.`
				});
			}
			if (houses.some((house) => String(house.name).trim().toLowerCase() === name.toLowerCase())) {
				return fail(400, {
					error: `There is already a house called "${name}". Pick another name.`,
					field: 'name'
				});
			}

			// 1. Create house
			const house = await locals.pb.collection('houses').create({
				name,
				x,
				y,
				occupied: false
			});

			// 2. Create initial room and beds if requested
			if (bedCount > 0) {
				const room = await locals.pb.collection('rooms').create({
					name: 'Main Module',
					room_number: 1,
					house: house.id,
					amount_beds: bedCount,
					occupied: false
				});

				for (let i = 1; i <= bedCount; i++) {
					await locals.pb.collection('beds').create({
						label: `B${i}`,
						room: room.id,
						occupied: false,
						// Initial spots are meant to be bookable right away; guests can
						// only book enabled beds.
						enabled: true
					});
				}
				console.log(`[Action] House ${house.id}: Initial module and ${bedCount} spots deployed.`);
			}

			return { success: true, houseId: house.id };
		} catch (err) {
			console.error('[Action] House ignition failed:', err);
			return fail(500, {
				error:
					'The server could not save the house. Reload the Control Center to see what was created, then try again.'
			});
		}
	}
};
