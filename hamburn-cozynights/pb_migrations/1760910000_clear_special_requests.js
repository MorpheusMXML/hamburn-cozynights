/// <reference path="../pb_data/types.d.ts" />
//
// No special-needs requests from before v1.32.2 (Max, 2026-10-12): every
// request sent so far was test data, like the groups 1760900000 deleted. This
// deletes them all, once, before requests open for real:
//
// - Every request goes, with what was ticked and written (encrypted, often
//   about health): it stays neither in the database nor in the backups made
//   from now on.
// - A spot the crew booked for one stays booked, as an ordinary booking of
//   its ticket, like after a withdrawal: the guest can change it, and "clear
//   all bookings" frees it.
// - Nobody gets a message: raw SQL, so no hook runs, and the notification run
//   has nothing to tell about a request that is gone (requestKindOf in
//   pb_hooks/lib/notify.js); it only forgets it the next time it runs for the
//   ticket.
//
// Idempotent: a second run finds nothing to delete. The down branch can't
// bring the requests back.

migrate(
	(app) => {
		try {
			app.findCollectionByNameOrId('special_requests');
		} catch (_) {
			return;
		}
		app.db().newQuery('DELETE FROM {{special_requests}}').execute();
	},
	() => {
		// The requests are gone for good.
	}
);
