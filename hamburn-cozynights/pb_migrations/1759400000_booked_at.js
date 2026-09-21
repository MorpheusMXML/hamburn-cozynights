/// <reference path="../pb_data/types.d.ts" />
//
// beds.booked_at: when the spot got its ticket (docs/reference/data-model.md).
// PocketBase stamps it in pb_hooks/cozy_booked.pb.js whenever a bed's `order`
// is set, and clears it when the bed is released, so the Control Center's
// "New Bookings · Last 7 Days" counts booked spots instead of imported ticket
// codes. Existing bookings get their bed's last change as a best guess.
// Idempotent like the earlier migrations.

migrate(
	(app) => {
		const beds = app.findCollectionByNameOrId('beds');
		if (!beds.fields.getByName('booked_at')) {
			beds.fields.add(new DateField({ name: 'booked_at' }));
			app.save(beds);
		}
		// Raw SQL: no hooks run, so no guest gets a message about it.
		try {
			app
				.db()
				.newQuery(
					"UPDATE {{beds}} SET [[booked_at]] = [[updated]] WHERE [[order]] != '' AND ([[booked_at]] = '' OR [[booked_at]] IS NULL)"
				)
				.execute();
		} catch (err) {
			console.log('[migration] booked_at backfill skipped: ' + err);
		}
	},
	(app) => {
		// Intentionally a no-op, like the other migrations.
	}
);
