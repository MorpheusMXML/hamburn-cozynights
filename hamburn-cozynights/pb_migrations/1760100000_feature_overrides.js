/// <reference path="../pb_data/types.d.ts" />
//
// Switching an inherited feature off (docs/admin/camp-layout.md): a room in a
// heated house that stays cold, a spot without the socket its room has. A
// spot inherits its room's and its house's features, a room its house's
// (1759900000_accommodation.js); `features_off` names what this room or spot
// does NOT take over. Only superusers set it (the app's actions check; the
// records API refuses a list that also appears in the place's own features,
// pb_hooks/cozy_features.pb.js), and an empty list means "inherit everything".
//
// - rooms.features_off: any feature a house can have.
// - beds.features_off: any feature a house or a room can have.
//
// The catalogue lives in src/lib/accommodation.ts (offAllowed) and must stay
// in step with these values. Idempotent like the earlier migrations; the down
// branch removes the fields (they carry no booking data).

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
// In catalogue order, each feature once.
const ABOVE_A_SPOT = [
	'wheelchair',
	'ground_floor',
	'toilets_inside',
	'own_bathroom',
	'heated',
	'unheated',
	'quiet',
	'power'
];

const offField = (values) =>
	new SelectField({ name: 'features_off', maxSelect: values.length, values: values });

migrate(
	(app) => {
		const add = (name, field) => {
			const collection = app.findCollectionByNameOrId(name);
			if (collection.fields.getByName(field.name)) return;
			collection.fields.add(field);
			app.save(collection);
		};
		add('rooms', offField(HOUSE_FEATURES));
		add('beds', offField(ABOVE_A_SPOT));
	},
	(app) => {
		const drop = (name) => {
			const collection = app.findCollectionByNameOrId(name);
			if (!collection.fields.getByName('features_off')) return;
			collection.fields.removeByName('features_off');
			app.save(collection);
		};
		drop('rooms');
		drop('beds');
	}
);
