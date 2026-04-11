import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.pb.authStore.model?.verified) {
		throw error(403, 'Unauthorized');
	}

	try {
		const houses = await locals.pb.collection('houses').getFullList({
			sort: 'name'
		});

		const templateHouses = [];

		for (const house of houses) {
			const rooms = await locals.pb.collection('rooms').getFullList({
				filter: `house = "${house.id}"`,
				sort: 'room_number'
			});

			const templateRooms = [];

			for (const room of rooms) {
				const beds = await locals.pb.collection('beds').getFullList({
					filter: `room = "${room.id}"`,
					sort: 'label'
				});

				templateRooms.push({
					name: room.name,
					room_number: room.room_number,
					amount_beds: room.amount_beds,
					beds: beds.map((bed) => ({
						label: bed.label,
						enabled: bed.enabled,
						is_locked: bed.is_locked
					}))
				});
			}

			templateHouses.push({
				name: house.name,
				x: house.x,
				y: house.y,
				rooms: templateRooms
			});
		}

		const template = {
			name: 'Burn Location Template',
			exported_at: new Date().toISOString(),
			version: '1.0',
			houses: templateHouses
		};

		return new Response(JSON.stringify(template, null, 2), {
			headers: {
				'Content-Type': 'application/json',
				'Content-Disposition': `attachment; filename="burn-template-${new Date().toISOString().slice(0, 10)}.json"`
			}
		});
	} catch (err: any) {
		console.error('[Export API] Failed:', err);
		throw error(500, 'Export failed');
	}
};
