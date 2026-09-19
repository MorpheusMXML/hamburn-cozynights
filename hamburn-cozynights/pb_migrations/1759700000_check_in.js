/// <reference path="../pb_data/types.d.ts" />
//
// Check-in at arrival (docs/admin/passes.md): when the crew checks a guest's
// booking pass, the spot goes from booked to checked in.
//
// - beds.checked_in_at: when the crew checked the guest in.
// - beds.checked_in_by: the admin who did it (the e-mail of the admins record).
//
// Only admins write them (the app, for a signed-in admin or superuser; beds are
// admin-only in PocketBase since 1759500000_beds_admin_read.js). PocketBase
// keeps them in step with the booking in pb_hooks/cozy_booked.pb.js: a spot
// that loses its ticket, or gets another one, is no longer checked in.
// Idempotent like the earlier migrations.

migrate(
	(app) => {
		const beds = app.findCollectionByNameOrId('beds');
		let changed = false;
		if (!beds.fields.getByName('checked_in_at')) {
			beds.fields.add(new DateField({ name: 'checked_in_at' }));
			changed = true;
		}
		if (!beds.fields.getByName('checked_in_by')) {
			beds.fields.add(new TextField({ name: 'checked_in_by', max: 320 }));
			changed = true;
		}
		if (changed) app.save(beds);
	},
	(app) => {
		// Intentionally a no-op, like the other migrations.
	}
);
