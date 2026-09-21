/// <reference path="../pb_data/types.d.ts" />
//
// The booking round guests are signed in for (src/lib/server/guest-session.ts).
//
// - app_settings.guest_round: counts up every time a superuser releases every
//   booking ("clear all bookings", or the switch back to Staging that offers
//   it). A device whose cookie carries an older round signs in with its ticket
//   code again on its next request, so a new round never starts with half the
//   camp still holding a session for a spot that is gone.
//
// Records from before this field have no round; the app reads that as 0, and
// so are the cookies of guests who signed in before the deploy: the field
// itself signs nobody out, only the first reset does. Idempotent like the
// earlier migrations.

migrate(
	(app) => {
		const settings = app.findCollectionByNameOrId('app_settings');
		if (!settings.fields.getByName('guest_round')) {
			settings.fields.add(new NumberField({ name: 'guest_round', min: 0, onlyInt: true }));
		}
		app.save(settings);
	},
	(app) => {
		// Intentionally a no-op: dropping the field would silently hand every
		// device back a session the last reset had ended.
	}
);
