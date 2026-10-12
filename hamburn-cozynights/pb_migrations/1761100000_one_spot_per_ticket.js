/// <reference path="../pb_data/types.d.ts" />
//
// One spot per ticket, in the database itself (v1.32.3): a unique index on
// beds.order for every booked spot. The app has always booked that way (its
// own locks, and since this release one transaction per booking,
// pb_hooks/lib/book.js); the index is the last word for every other way a
// spot gets a ticket — the dashboard, the CLI, a second app instance.
//
// A ticket that holds two spots already can't be fixed by a rule: which one
// is theirs is a crew decision (Max, 2026-10-12). The migration then stops
// with the tickets and spots in the message, and PocketBase doesn't start.
// What happens next depends on the deploy script: the hardened one (from
// v1.32.3 on) rolls back to the previous image; the OLD one, which deploys
// v1.32.3 itself, does not — the site stays down until someone acts. So the
// read-only pre-check comes first, before every release (deploy/README.md,
// "Vor einem Release"). Free the spot that is wrong (camp map, or the
// dashboard over the tunnel) and deploy again.
//
// A rollback of the app image to v1.32.2 or older keeps this index (PocketBase
// never runs a down branch then), and that code claims the new spot before
// it releases the old one: moves and swaps would fail. After such a rollback,
// delete idx_beds_order_unique in the dashboard (deploy/README.md, Rollback).
//
// Swaps write in an order the index allows (pb_hooks/lib/swap.js). Down
// removes the index.

migrate(
	(app) => {
		const beds = app.findCollectionByNameOrId('beds');
		if ((beds.indexes || []).some((sql) => String(sql).indexOf('idx_beds_order_unique') >= 0)) {
			return;
		}

		const rows = arrayOf(new DynamicModel({ ticket: '', spots: '' }));
		app
			.db()
			.newQuery(
				"SELECT [[order]] AS ticket, GROUP_CONCAT(COALESCE(NULLIF([[label]], ''), [[id]]) || ' (' || [[id]] || ')', ', ') AS spots " +
					"FROM {{beds}} WHERE [[order]] != '' GROUP BY [[order]] HAVING COUNT(*) > 1"
			)
			.all(rows);
		if (rows.length > 0) {
			const list = rows.map((r) => 'ticket ' + r.ticket + ': ' + r.spots).join('; ');
			throw new Error(
				'one spot per ticket: ' +
					rows.length +
					' ticket(s) hold more than one spot — free the wrong spot first, then deploy again. ' +
					list
			);
		}

		beds.addIndex('idx_beds_order_unique', true, '`order`', "`order` != ''");
		app.save(beds);
	},
	(app) => {
		const beds = app.findCollectionByNameOrId('beds');
		beds.removeIndex('idx_beds_order_unique');
		app.save(beds);
	}
);
