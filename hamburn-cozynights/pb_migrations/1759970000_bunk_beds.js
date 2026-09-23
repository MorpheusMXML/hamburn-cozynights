/// <reference path="../pb_data/types.d.ts" />
//
// Bunk beds (docs/admin/camp-layout.md, "Bunk beds"): two spots of a room
// stacked into one bed. `beds.bunk_partner` points at the other spot and is
// set on both of them; their bed types (`bunk_lower` / `bunk_upper`, from
// 1759900000_accommodation.js) say which is the lower and which the upper
// level. The app writes both sides together, pb_hooks/cozy_bunks.pb.js keeps
// them in step when one side changes or a spot is deleted. No cascade: a
// deleted spot leaves its partner standing, as a single spot again.
//
// Idempotent like the earlier migrations; the down branch removes the field
// (it carries no booking data, so that is safe).

migrate(
	(app) => {
		const beds = app.findCollectionByNameOrId('beds');
		if (beds.fields.getByName('bunk_partner')) return;
		beds.fields.add(
			new RelationField({
				name: 'bunk_partner',
				collectionId: beds.id,
				maxSelect: 1,
				cascadeDelete: false
			})
		);
		app.save(beds);
	},
	(app) => {
		const beds = app.findCollectionByNameOrId('beds');
		if (!beds.fields.getByName('bunk_partner')) return;
		beds.fields.removeByName('bunk_partner');
		app.save(beds);
	}
);
