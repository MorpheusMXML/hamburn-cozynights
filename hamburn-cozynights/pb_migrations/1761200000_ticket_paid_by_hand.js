/// <reference path="../pb_data/types.d.ts" />
//
// A ticket marked paid by hand, v1.33.0 (docs/admin/tickets.md "Mark a ticket
// paid"): the Membership Team confirmed the payment in person while the ticket
// shop still lists the order as pending. An admin clears `orders.unpaid` on
// the Tickets page, and these two fields remember who did it:
//
// - orders.marked_paid_at: when the admin marked the ticket paid.
// - orders.marked_paid_by: the admin who did it (the e-mail of the admins record).
//
// A later ticket list that still says pending doesn't undo the mark unnoticed:
// the app's review offers that change unticked, the server import keeps the
// ticket paid (src/lib/tickets.ts diffRoster, pb_hooks/cozy_admin.pb.js). A
// list that says paid drops the mark. Only the app and the CLI write them
// (orders are superuser-only in PocketBase). Idempotent like the earlier
// migrations.

migrate(
	(app) => {
		const orders = app.findCollectionByNameOrId('orders');
		let changed = false;
		if (!orders.fields.getByName('marked_paid_at')) {
			orders.fields.add(new DateField({ name: 'marked_paid_at' }));
			changed = true;
		}
		if (!orders.fields.getByName('marked_paid_by')) {
			orders.fields.add(new TextField({ name: 'marked_paid_by', max: 320 }));
			changed = true;
		}
		if (changed) app.save(orders);
	},
	(app) => {
		const orders = app.findCollectionByNameOrId('orders');
		let changed = false;
		for (const name of ['marked_paid_at', 'marked_paid_by']) {
			const field = orders.fields.getByName(name);
			if (field) {
				orders.fields.removeById(field.id);
				changed = true;
			}
		}
		if (changed) app.save(orders);
	}
);
