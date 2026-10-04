/// <reference path="../../pb_data/types.d.ts" />
//
// Request groups (pb_migrations/1760550000_request_groups.js): a group lives
// only as long as a request is in it. Whichever way the last request leaves —
// the guest leaves or withdraws, the crew takes it out, a hand-over or
// forget-contacts deletes it, its ticket is deleted — the group goes too, so
// no guest-chosen name and no join code is left behind.
//
// A CommonJS module for PocketBase's JSVM, required by cozy_groups.pb.js;
// tests/request-groups.test.ts drives it with a fake app.

/**
 * Deletes the group when no request is in it any more. Never throws.
 * Returns whether it deleted the group.
 */
function pruneGroup(app, groupId) {
	if (!groupId) return false;
	try {
		const rows = app.findRecordsByFilter('special_requests', 'request_group = {:g}', '', 1, 0, {
			g: groupId
		});
		if (rows.length > 0) return false;
		app.delete(app.findRecordById('request_groups', groupId));
		return true;
	} catch (_) {
		// gone already (deleted by another path), or the database said no:
		// forget-contacts deletes what is left after the event
		return false;
	}
}

module.exports = { pruneGroup };
