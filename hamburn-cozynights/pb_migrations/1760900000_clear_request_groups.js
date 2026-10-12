/// <reference path="../pb_data/types.d.ts" />
//
// No request groups from before v1.32.2 (Max, 2026-10-12): a group has at
// most 5 people now (GROUP_MAX in src/lib/special-needs.ts, 12 before), and
// every group made so far was test data. This deletes them all, once:
//
// - special_requests.request_group is emptied first: the relation doesn't
//   cascade (1760550000_request_groups.js), and a request must never point
//   at a group that is gone. The requests themselves were test data too:
//   1760910000_clear_special_requests.js deletes them right after.
// - then every request_groups row goes, with its code and the tickets the
//   crew took out (`removed`).
//
// Raw SQL like 1760200000_no_power_socket.js: no hook runs on the way, so no
// guest or crew message goes out and nothing is re-validated. Idempotent: a
// second run finds nothing to change. The down branch can't bring the groups
// back.

migrate(
	(app) => {
		const find = (name) => {
			try {
				return app.findCollectionByNameOrId(name);
			} catch (_) {
				return null;
			}
		};

		if (!find('request_groups')) return;
		const requests = find('special_requests');
		if (requests && requests.fields.getByName('request_group')) {
			app
				.db()
				.newQuery(
					"UPDATE {{special_requests}} SET [[request_group]] = '' WHERE [[request_group]] != ''"
				)
				.execute();
		}
		app.db().newQuery('DELETE FROM {{request_groups}}').execute();
	},
	() => {
		// The groups are gone for good.
	}
);
