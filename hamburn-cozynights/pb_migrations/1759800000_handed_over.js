/// <reference path="../pb_data/types.d.ts" />
//
// A ticket passed on to somebody else (docs/admin/tickets.md): when the crew
// changes a ticket's address and marks it as a hand-over, the new address gets
// its own e-mail ("this ticket was passed on to you"), not the ordinary
// booking confirmation.
//
// - orders.handed_over_at: when the ticket was passed on. Whoever hands a
//   ticket over writes it (the app in src/lib/server/tickets.ts, the server
//   CLI in pb_hooks/cozy_admin.pb.js); the delivery run uses it once for the
//   first message to the new address and clears it (pb_hooks/lib/notify.js).
//
// The field says nothing about the old holder: it is a timestamp, and the
// hand-over itself removes what was theirs (pass, burner name, Telegram link,
// special-needs request). Idempotent like the earlier migrations.

migrate(
	(app) => {
		const orders = app.findCollectionByNameOrId('orders');
		if (orders.fields.getByName('handed_over_at')) return;
		orders.fields.add(new DateField({ name: 'handed_over_at' }));
		app.save(orders);
	},
	(app) => {
		// Intentionally a no-op, like the other migrations.
	}
);
