/// <reference path="../pb_data/types.d.ts" />
//
// No more 🔌 power socket (docs/admin/camp-layout.md). The crew doesn't know
// where the sockets are, so on 2026-09-28 the catalogue in
// src/lib/accommodation.ts dropped `power` (RETIRED_FEATURES), and this
// migration takes it out of the database:
//
// - rooms.features: every stored `power` goes, then the value itself.
// - beds.features_off: the same (a spot could switch off its room's socket).
// - beds.features: `power` was the only feature a spot could have of its own,
//   and a select needs at least one value, so the whole field goes. A spot
//   now inherits everything from its room and house (1760100000 lets it
//   switch some of it off).
//
// What was ticked is gone with it on purpose: the starter layout set it as a
// guess, and nobody has the real answer. Raw SQL for the records, so no hook
// runs and nothing else is re-validated on the way; the select values change
// only after no record holds `power` any more, so every room and spot can be
// saved again right away. Idempotent like the earlier migrations. The down
// branch puts the value and the field back, but not what was stored.

// In catalogue order, as in 1759900000_accommodation.js and
// 1760100000_feature_overrides.js, without `power`.
const ROOM_FEATURES = ['wheelchair', 'ground_floor', 'own_bathroom', 'heated', 'unheated', 'quiet'];
const ABOVE_A_SPOT = [
	'wheelchair',
	'ground_floor',
	'toilets_inside',
	'own_bathroom',
	'heated',
	'unheated',
	'quiet'
];

/** Replaces a select field in place (same id, so the column and its data stay). */
function setValues(collection, name, values) {
	const field = collection.fields.getByName(name);
	if (!field) return false;
	collection.fields.add(
		new SelectField({ id: field.id, name: name, maxSelect: values.length, values: values })
	);
	return true;
}

migrate(
	(app) => {
		// Multi-value selects are stored as JSON lists: keep every entry but `power`.
		const strip = (table, column) => {
			app
				.db()
				.newQuery(
					`UPDATE {{${table}}} SET [[${column}]] = (` +
						`SELECT json_group_array(value) FROM json_each({{${table}}}.[[${column}]]) ` +
						`WHERE value != 'power'` +
						`) WHERE json_valid([[${column}]]) AND [[${column}]] LIKE '%"power"%'`
				)
				.execute();
		};

		const rooms = app.findCollectionByNameOrId('rooms');
		if (rooms.fields.getByName('features')) strip('rooms', 'features');
		if (setValues(rooms, 'features', ROOM_FEATURES)) app.save(rooms);

		const beds = app.findCollectionByNameOrId('beds');
		if (beds.fields.getByName('features_off')) strip('beds', 'features_off');
		let changed = setValues(beds, 'features_off', ABOVE_A_SPOT);
		if (beds.fields.getByName('features')) {
			beds.fields.removeByName('features');
			changed = true;
		}
		if (changed) app.save(beds);
	},
	(app) => {
		const rooms = app.findCollectionByNameOrId('rooms');
		if (setValues(rooms, 'features', ROOM_FEATURES.concat(['power']))) app.save(rooms);

		const beds = app.findCollectionByNameOrId('beds');
		setValues(beds, 'features_off', ABOVE_A_SPOT.concat(['power']));
		if (!beds.fields.getByName('features')) {
			// As 1759900000_accommodation.js made it: one value, so maxSelect 1.
			beds.fields.add(new SelectField({ name: 'features', maxSelect: 1, values: ['power'] }));
		}
		app.save(beds);
	}
);
