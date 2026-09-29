import { error, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { getBookingSettings } from '$lib/server/settings';
import { lockedDuring } from '$lib/booking-phase';
import { MAP_WIDTH, MAP_HEIGHT, parseMapCoordinate } from '$lib/map-geometry';
import { TEMPLATE_LIMITS } from '$lib/template';
import { isHouseKind, roomWord } from '$lib/accommodation';
import { formatSizes, planProblem, readPlanForm } from '$lib/house-plan';
import { GeneratorError, generateRooms } from '$lib/server/house-generator';
import { rollHouseName } from '$lib/place-names';

export const load: PageServerLoad = async ({ locals, url }) => {
	// Runs in parallel with the layout load, so it guards itself too.
	if (!locals.admin) throw error(403, 'Unauthorized');

	const [{ isLayoutLocked, phase }, houses] = await Promise.all([
		getBookingSettings(locals.pb),
		// The names in use, so the rolled name is a free one.
		locals.pb
			.collection('houses')
			.getFullList({ fields: 'name', requestKey: null })
			.catch(() => [])
	]);
	const houseNames = houses.map((house) => String(house.name ?? ''));
	return {
		isLayoutLocked,
		phase,
		houseNames,
		// Rolled here, so the page and its hydration start with the same name.
		rolledName: rollHouseName('', houseNames),
		// Without (valid) coordinates in the URL the house starts in the middle of the map.
		x: parseMapCoordinate(url.searchParams.get('x'), MAP_WIDTH) ?? MAP_WIDTH / 2,
		y: parseMapCoordinate(url.searchParams.get('y'), MAP_HEIGHT) ?? MAP_HEIGHT / 2
	};
};

export const actions: Actions = {
	/**
	 * The house generator: a house with its rooms and spots in one go. Also
	 * called by the Control Center's map sidebar ("IGNITE HOUSE"). Fields:
	 * name, x, y, kind (optional) and the size rows ($lib/house-plan:
	 * sizes, floors, first_number). No sizes: a house without rooms.
	 */
	create: async ({ request, locals }) => {
		if (!locals.admin) return fail(403, { error: 'Only admins can create houses.' });

		const { isLayoutLocked, phase } = await getBookingSettings(locals.pb);
		if (isLayoutLocked) {
			console.warn(`[Action] BLOCKED: cannot create a house (${phase}).`);
			return fail(403, {
				error: `Houses cannot be added ${lockedDuring(phase)}. A superuser can switch back to Staging Mode in the Control Center.`
			});
		}

		const data = await request.formData();
		const name = String(data.get('name') ?? '').trim();
		const x = parseMapCoordinate(data.get('x'), MAP_WIDTH);
		const y = parseMapCoordinate(data.get('y'), MAP_HEIGHT);
		const kindInput = String(data.get('kind') ?? '').trim();
		const kind = isHouseKind(kindInput) ? kindInput : '';

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
		if (kindInput && !kind) {
			return fail(400, { error: 'Pick a kind from the list, or leave it open.', field: 'kind' });
		}
		const form = readPlanForm(data);
		if (!form.ok) return fail(400, { error: form.error, field: 'sizes' });
		const { plan } = form;
		const problem = planProblem(plan, {
			allowEmpty: true,
			word: roomWord(kind),
			plural: roomWord(kind, true)
		});
		if (problem) {
			return fail(400, {
				error: problem.message,
				field: problem.field === 'firstNumber' ? 'firstNumber' : 'sizes',
				row: problem.row ?? null
			});
		}

		console.log(
			`[Action] Ignite House: "${name}" at (${x}, ${y}), kind ${kind || '-'}, sizes ${formatSizes(plan.sizes) || 'none'}${plan.floors ? ', floor blocks' : ''}.`
		);

		let houseId = '';
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

			const house = await locals.pb.collection('houses').create({
				name,
				x,
				y,
				occupied: false,
				...(kind ? { kind } : {})
			});
			houseId = house.id;

			// The rooms and their spots; a failure removes what it created, the
			// house goes below.
			const built = await generateRooms(locals.pb, { id: house.id, kind }, plan, {
				allowEmpty: true
			});
			console.log(
				`[Action] House ${house.id}: ${built.rooms} rooms, ${built.spots} spots, ${built.bunkBeds} bunk beds.`
			);
			return { success: true, houseId: house.id, rooms: built.rooms, spots: built.spots };
		} catch (err) {
			console.error('[Action] House ignition failed:', err);
			// Nothing half-made stays behind: the house goes, its rooms and spots with it.
			let removed = true;
			if (houseId) {
				removed = await locals.pb
					.collection('houses')
					.delete(houseId)
					.then(() => true)
					.catch((cleanup) => {
						console.error('[Action] Could not remove the house again:', cleanup);
						return false;
					});
			}
			if (err instanceof GeneratorError) {
				return fail(err.status, {
					error: removed
						? `${err.message} The house was not created.`
						: `${err.message} The half-made house "${name}" could not be removed: delete it on the map.`
				});
			}
			return fail(500, {
				error:
					'The server could not save the house. Reload the Control Center to see what was created, then try again.'
			});
		}
	}
};
