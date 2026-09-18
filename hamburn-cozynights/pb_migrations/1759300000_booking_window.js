/// <reference path="../pb_data/types.d.ts" />
//
// Booking window (docs/guide/phases.md): booking opens AND closes on a timer,
// and after the closing time the camp is in a third phase, "closed".
//
// - app_settings.booking_close_at: when booking closes (the opening time
//   stays in booking_unlock_at).
// - app_settings.booking_timer_paused: a paused timer keeps its times but
//   switches nothing. Old records have no such field, i.e. an existing
//   go-live timer stays armed.
// - app_settings.booking_closed: the phase "closed" set by hand (or reached by
//   the timer and written down by the app); is_booking_active stays the
//   phase "live". Neither set = staging.
//
// The rules (who may switch what) live in src/lib/booking-phase.ts and
// pb_hooks/lib/phase.js. Idempotent like the earlier migrations.

migrate(
	(app) => {
		const settings = app.findCollectionByNameOrId('app_settings');
		const addField = (field) => {
			if (!settings.fields.getByName(field.name)) settings.fields.add(field);
		};
		addField(new DateField({ name: 'booking_close_at' }));
		addField(new BoolField({ name: 'booking_timer_paused' }));
		addField(new BoolField({ name: 'booking_closed' }));
		app.save(settings);
	},
	(app) => {
		// Intentionally a no-op: removing the fields would silently reopen a
		// closed booking or re-arm a paused timer.
	}
);
