/// <reference path="../pb_data/types.d.ts" />
//
// Floor plans of a house (docs/admin/templates.md): houses.floor_plans is a
// list like [{ "image": "/floorplans/villa-upper-floor-2026.webp",
// "caption": "Upper floor" }]. The pictures ship with the app in
// static/floorplans/; a layout template (format 2.3) sets the list, and
// guests open the plans from the house page and its room pages.
//
// The app reads the field through readFloorPlans (src/lib/floor-plans.ts),
// which shows only pictures under /floorplans/ — whatever else ends up in
// the field is never loaded. Nothing is required; empty means "no plan".
// Idempotent like the earlier migrations; the down branch removes the field
// (it carries no booking data).

migrate(
	(app) => {
		const houses = app.findCollectionByNameOrId('houses');
		if (houses.fields.getByName('floor_plans')) return;
		houses.fields.add(new JSONField({ name: 'floor_plans', maxSize: 4000 }));
		app.save(houses);
	},
	(app) => {
		const houses = app.findCollectionByNameOrId('houses');
		if (!houses.fields.getByName('floor_plans')) return;
		houses.fields.removeByName('floor_plans');
		app.save(houses);
	}
);
