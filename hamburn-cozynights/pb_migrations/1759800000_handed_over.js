/// <reference path="../pb_data/types.d.ts" />
//
// A ticket passed on to somebody else (docs/admin/tickets.md): when the crew
// changes a ticket's address and marks it as a hand-over, the new address gets
// its own e-mail ("this ticket was passed on to you"), not the ordinary
// booking confirmation.
//
// - orders.handed_over_at: when the ticket was passed on. Whoever hands a
//   ticket over writes it (the app in src/lib/server/tickets.ts, the server
//   CLI in pb_hooks/cozy_admin.pb.js). It stays on the ticket afterwards, so
//   the crew can see when it changed hands.
// - guest_notify.mail_handover: the hand-over the ticket's address was told
//   about. The delivery run writes the stamp next to mail_to/mail_spot once
//   it has sent the message (pb_hooks/lib/notify.js), the same way it
//   remembers every other thing an address already knows — so the run never
//   writes to a guest's order record.
//
// Neither field says anything about the old holder: one is a timestamp, the
// other a copy of it, and the hand-over itself removes what was theirs (pass,
// burner name, Telegram link, special-needs request). Idempotent like the
// earlier migrations.

migrate(
	(app) => {
		const orders = app.findCollectionByNameOrId('orders');
		if (!orders.fields.getByName('handed_over_at')) {
			orders.fields.add(new DateField({ name: 'handed_over_at' }));
			app.save(orders);
		}
		const notify = app.findCollectionByNameOrId('guest_notify');
		if (!notify.fields.getByName('mail_handover')) {
			notify.fields.add(new TextField({ name: 'mail_handover', max: 40 }));
			app.save(notify);
		}
	},
	(app) => {
		// Intentionally a no-op, like the other migrations.
	}
);
