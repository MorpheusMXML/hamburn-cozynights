/// <reference path="../pb_data/types.d.ts" />
//
// Signing in with a ticket code, v1.32.4 (docs/guide/index.md "Sign in",
// docs/reference/security.md "Guessing ticket codes"):
//
// - orders.unpaid: the ticket shop's order isn't paid yet. The ticket list
//   brings such tickets in too (src/lib/server/tickets.ts, cozy-admin tickets
//   import); their code can't sign in — the start page asks to settle the
//   invoice with the Membership Team — and a session of a ticket that turns
//   unpaid ends. Loading the list again after the payment clears the flag.
//   Unset = paid, like every ticket from before this field.
// - code_mails: "send me my code". A guest who mistyped their code gives an
//   e-mail address; the app adds a row only when the address belongs to a
//   paid ticket, and never says whether it did. The notification run
//   (pb_hooks/lib/notify.js, deliverCodeMails) sends the codes of that
//   address and stamps `sent`; rows go after two days. The app allows one
//   mail per address in 30 minutes and three a day, counted here.
//
// No API rules on the new collection (superusers only), like every other
// collection with guest data. Idempotent like the earlier migrations.

migrate(
	(app) => {
		const orders = app.findCollectionByNameOrId('orders');
		if (!orders.fields.getByName('unpaid')) {
			orders.fields.add(new BoolField({ name: 'unpaid' }));
			app.save(orders);
		}

		let exists = true;
		try {
			app.findCollectionByNameOrId('code_mails');
		} catch (_) {
			exists = false;
		}
		if (!exists) {
			app.save(
				new Collection({
					name: 'code_mails',
					type: 'base',
					fields: [
						{ name: 'email', type: 'text', required: true, max: 254 },
						{ name: 'due', type: 'date' },
						{ name: 'attempts', type: 'number', onlyInt: true, min: 0 },
						{ name: 'last_error', type: 'text', max: 1000 },
						{ name: 'sent', type: 'date' },
						{ name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
						{ name: 'updated', type: 'autodate', onCreate: true, onUpdate: true }
					],
					indexes: [
						'CREATE INDEX idx_code_mails_email ON code_mails (email)',
						'CREATE INDEX idx_code_mails_due ON code_mails (due)'
					]
				})
			);
		}
	},
	(app) => {
		try {
			app.delete(app.findCollectionByNameOrId('code_mails'));
		} catch (_) {
			// never created
		}
		const orders = app.findCollectionByNameOrId('orders');
		const field = orders.fields.getByName('unpaid');
		if (field) {
			orders.fields.removeById(field.id);
			app.save(orders);
		}
	}
);
