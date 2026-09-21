/// <reference path="../pb_data/types.d.ts" />
//
// What a place to sleep is like (docs/admin/camp-layout.md): the kind of a
// house or room, the kind of bed and the features around it. Guests see them
// when they pick a spot, the crew matches ♿ special-needs requests with them,
// and layout templates carry them (format 2.1).
//
// - houses.kind / rooms.kind: a house is a house, a hut group, a tent area or
//   something else; a room is a room, a hut, a tent or something else. A hut
//   group keeps ONE pin on the map and its huts are its rooms.
// - houses.features / rooms.features / beds.features: what is true there. The
//   values differ per level on purpose ("toilets + showers inside" describes a
//   building, "own bathroom" a room, "power socket" a room or a single spot);
//   a spot inherits its room's and its house's features.
// - beds.bed_type: single bed, lower or upper bunk, one half of a double bed,
//   sofa, mattress or camp bed. Only the upper bunk needs a ladder, which is
//   what the need "a lower bunk or a bed without a ladder" rules out.
// - houses.description / rooms.description: free text for everything that is
//   true for this venue only ("showers in the wash house, 50 m").
//
// The catalogue lives in src/lib/accommodation.ts; these values must stay in
// step with it. Nothing is required and nothing has a default: a field nobody
// filled in means "not specified", never "no". Idempotent like the earlier
// migrations, and the down branch removes the fields again (they carry no
// booking data, so that is safe).

const HOUSE_KINDS = ['house', 'hut_group', 'tent_area', 'other'];
const ROOM_KINDS = ['room', 'hut', 'tent', 'other'];
const BED_TYPES = ['single', 'bunk_lower', 'bunk_upper', 'double', 'sofa', 'mattress', 'camp_bed'];
const HOUSE_FEATURES = [
	'wheelchair',
	'ground_floor',
	'toilets_inside',
	'heated',
	'unheated',
	'quiet'
];
const ROOM_FEATURES = [
	'wheelchair',
	'ground_floor',
	'own_bathroom',
	'heated',
	'unheated',
	'quiet',
	'power'
];
const BED_FEATURES = ['power'];

const DESCRIPTION_MAX = 500;

migrate(
	(app) => {
		const addField = (collection, field) => {
			if (!collection.fields.getByName(field.name)) {
				collection.fields.add(field);
				return true;
			}
			return false;
		};
		const save = (collection, changed) => {
			if (changed) app.save(collection);
		};

		const houses = app.findCollectionByNameOrId('houses');
		save(
			houses,
			[
				addField(houses, new SelectField({ name: 'kind', maxSelect: 1, values: HOUSE_KINDS })),
				addField(
					houses,
					new SelectField({
						name: 'features',
						maxSelect: HOUSE_FEATURES.length,
						values: HOUSE_FEATURES
					})
				),
				addField(houses, new TextField({ name: 'description', max: DESCRIPTION_MAX }))
			].some(Boolean)
		);

		const rooms = app.findCollectionByNameOrId('rooms');
		save(
			rooms,
			[
				addField(rooms, new SelectField({ name: 'kind', maxSelect: 1, values: ROOM_KINDS })),
				addField(
					rooms,
					new SelectField({
						name: 'features',
						maxSelect: ROOM_FEATURES.length,
						values: ROOM_FEATURES
					})
				),
				addField(rooms, new TextField({ name: 'description', max: DESCRIPTION_MAX }))
			].some(Boolean)
		);

		const beds = app.findCollectionByNameOrId('beds');
		save(
			beds,
			[
				addField(beds, new SelectField({ name: 'bed_type', maxSelect: 1, values: BED_TYPES })),
				addField(
					beds,
					new SelectField({ name: 'features', maxSelect: BED_FEATURES.length, values: BED_FEATURES })
				)
			].some(Boolean)
		);
	},
	(app) => {
		const drop = (name, fields) => {
			const collection = app.findCollectionByNameOrId(name);
			let changed = false;
			for (const field of fields) {
				if (collection.fields.getByName(field)) {
					collection.fields.removeByName(field);
					changed = true;
				}
			}
			if (changed) app.save(collection);
		};

		drop('houses', ['kind', 'features', 'description']);
		drop('rooms', ['kind', 'features', 'description']);
		drop('beds', ['bed_type', 'features']);
	}
);
