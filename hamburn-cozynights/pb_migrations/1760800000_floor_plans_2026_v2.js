/// <reference path="../pb_data/types.d.ts" />
//
// The current floor plans of the youth hostel (Max, 2026-10-06), for the
// servers that already imported the Hamburn 2026 layout of v0.30.0. The
// pictures ship in static/floorplans/ under new names (a new picture gets a
// new name, docs/develop/index.md), the old ones are gone, so a house that
// still names them would show a broken picture. This puts the new list on:
//
// - every house whose floor_plans name one of the five v0.30.0 pictures:
//   Brahmsee-Villa (now both floors), Haus am See and Wälderhaus;
// - the house called "Waldhütten" while it has no plans: it gets its first
//   three (the huts, the washrooms, the Waldlounge).
//
// The new Wälderhaus plans carry door numbers, and they match the rooms of
// the layout except on the lower floor: door 001 is the five-bed room
// (room 2 in v0.30.0) and door 002 the single room (room 1). So in the house
// that had the old Wälderhaus plans the two rooms trade their numbers, but
// only while room 1 still has exactly 1 spot and room 2 exactly 5, as the
// layout made them. Only the number changes: spots, bookings and names stay.
// Nothing stores a room number elsewhere, mails and passes read it live.
//
// The Villa description of the layout said its rooms "carry the names from
// the floor plan"; the new plan has no names, so that sentence is replaced
// where it is still there word for word.
//
// Idempotent: a second run finds no old picture, a Waldhütten with plans,
// and room 1 with 5 spots. The down branch does nothing: the old pictures
// are not shipped any more.

migrate(
	(app) => {
		const OLD = {
			'/floorplans/brahmsee-villa-upper-floor-2026.webp': 'villa',
			'/floorplans/haus-am-see-ground-floor-2026.webp': 'see',
			'/floorplans/haus-am-see-upper-floor-2026.webp': 'see',
			'/floorplans/waelderhaus-lower-floor-2026.webp': 'waelder',
			'/floorplans/waelderhaus-upper-floor-2026.webp': 'waelder'
		};
		// The same lists as static/templates/hamburn-2026.json.
		const PLANS = {
			villa: [
				{
					image: '/floorplans/brahmsee-villa-ground-floor-2026.webp',
					caption: 'Ground floor: rooms 1 and 2 are doors 001 and 002'
				},
				{
					image: '/floorplans/brahmsee-villa-upper-floor-2026-v2.webp',
					caption: 'Upper floor: rooms 101–106, from Kastanienblick to Bienenkorb'
				}
			],
			see: [
				{
					image: '/floorplans/haus-am-see-ground-floor-2026-v2.webp',
					caption: 'Ground floor: rooms 1–4 are doors 001–004'
				},
				{
					image: '/floorplans/haus-am-see-upper-floor-2026-v2.webp',
					caption: 'Upper floor: rooms 101–105'
				}
			],
			waelder: [
				{
					image: '/floorplans/waelderhaus-lower-floor-2026-v2.webp',
					caption: 'Lower floor: rooms 1–7 are doors 001–007'
				},
				{
					image: '/floorplans/waelderhaus-upper-floor-2026-v2.webp',
					caption: 'Upper floor: rooms 102–110'
				}
			],
			huts: [
				{
					image: '/floorplans/waldhuetten-huts-2026.webp',
					caption: 'Huts 1–6 with 7 beds; hut 7 left and right are the single huts 101 and 102'
				},
				{
					image: '/floorplans/waldhuetten-washrooms-2026.webp',
					caption: 'Washrooms and showers, about 100 m from the huts'
				},
				{ image: '/floorplans/waldhuetten-lounge-2026.webp', caption: 'The Waldlounge' }
			]
		};
		const VILLA_OLD = 'Rooms 101 to 106 are upstairs and carry the names from the floor plan.';
		const VILLA_NEW = 'Rooms 101 to 106 are upstairs, each with a name of its own.';

		const plansOf = (house) => {
			try {
				const plans = JSON.parse(house.getString('floor_plans') || 'null');
				return Array.isArray(plans) ? plans : [];
			} catch (_) {
				return [];
			}
		};
		const spots = (room) => app.countRecords('beds', $dbx.hashExp({ room: room.id }));

		for (const house of app.findAllRecords('houses')) {
			const plans = plansOf(house);
			let which = '';
			for (const plan of plans) {
				if (plan && OLD[plan.image]) which = OLD[plan.image];
			}
			if (!which && house.getString('name') === 'Waldhütten' && plans.length === 0) which = 'huts';
			if (!which) continue;

			house.set('floor_plans', PLANS[which]);
			if (which === 'villa') {
				const text = house.getString('description');
				if (text.indexOf(VILLA_OLD) >= 0)
					house.set('description', text.replace(VILLA_OLD, VILLA_NEW));
			}
			app.save(house);

			if (which !== 'waelder') continue;
			const rooms = app.findRecordsByFilter(
				'rooms',
				'house = {:house} && (room_number = 1 || room_number = 2)',
				'',
				0,
				0,
				{ house: house.id }
			);
			const one = [];
			const two = [];
			for (const room of rooms) (room.getInt('room_number') === 1 ? one : two).push(room);
			if (one.length !== 1 || two.length !== 1) continue;
			if (spots(one[0]) !== 1 || spots(two[0]) !== 5) continue;
			one[0].set('room_number', 2);
			two[0].set('room_number', 1);
			app.save(one[0]);
			app.save(two[0]);
		}
	},
	() => {}
);
