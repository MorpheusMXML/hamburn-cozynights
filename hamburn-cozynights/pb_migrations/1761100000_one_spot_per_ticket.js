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
// with the tickets and spots in the message — PocketBase doesn't start, the
// deploy rolls back, nothing changes. Free the spot that is wrong (dashboard
// over the tunnel, or the camp map) and deploy again. The deploy runbook
// checks this before the deploy (deploy/README.md, "Vor einem Release").
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
