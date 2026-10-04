/// <reference path="../pb_data/types.d.ts" />
//
// Request groups (docs/admin/special-needs.md, "Groups"): a group is deleted
// as soon as its last request leaves it (pb_hooks/lib/groups.js). These are
// model hooks, so they also run for the app's writes through the API, for
// requests deleted with their ticket (cascade) and inside transactions
// (forget-contacts, the hand-over in pb_hooks/lib/handover.js), where e.app
// is the transaction. Handlers run in isolated VMs, so each one requires its
// helpers itself, and none may throw into the write it watches.
//
// Never delete a request_groups record that still has members: PocketBase
// would unset the relation on each of them, and that update runs these hooks
// again inside the running delete.

// Left (or taken out of) a group: the request now points elsewhere or nowhere.
onRecordUpdate((e) => {
	let before = '';
	try {
		before = require(`${__hooks}/lib/notify.js`).storedValue(e.app, e.record, 'request_group');
	} catch (_) {
		// unknown before: nothing to tidy up
	}
	e.next();
	if (!before || before === e.record.getString('request_group')) return;
	try {
		require(`${__hooks}/lib/groups.js`).pruneGroup(e.app, before);
	} catch (err) {
		console.error('[cozy-groups] ' + e.record.id + ': ' + err);
	}
}, 'special_requests');

// Withdrawn, handed over, forgotten, or gone with its ticket.
onRecordDelete((e) => {
	const group = e.record.getString('request_group');
	e.next();
	if (!group) return;
	try {
		require(`${__hooks}/lib/groups.js`).pruneGroup(e.app, group);
	} catch (err) {
		console.error('[cozy-groups] ' + e.record.id + ': ' + err);
	}
}, 'special_requests');
