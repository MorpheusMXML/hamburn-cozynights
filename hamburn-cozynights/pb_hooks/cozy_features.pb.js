/// <reference path="../pb_data/types.d.ts" />
//
// Features of houses, rooms and spots (docs/admin/camp-layout.md): two that
// say the opposite of each other — heated and no heating — can't both be set,
// and a room or spot can't switch a feature off (features_off) that it claims
// itself. The app's forms and the template import refuse both already; this
// is the same rule on the records API, which any admin token can reach
// directly. The logic lives in pb_hooks/lib/beds.js; handlers run in isolated
// VMs, so each one requires it itself.

function cozyFeatureGuard(e) {
	let problem = '';
	let forbidden = '';
	try {
		const beds = require(`${__hooks}/lib/beds.js`);
		const name = e.collection.name;
		const level = name === 'houses' ? 'house' : name === 'rooms' ? 'room' : 'spot';
		problem = beds.featureProblem(e.record, level);
		// features_off is a superuser's call (docs/admin/camp-layout.md): an
		// admin token that changes it on the records API is refused, the way
		// the app's own actions refuse it. A create starts from an empty list.
		const before = e.record.isNew() ? [] : e.record.original().get('features_off');
		forbidden = beds.overrideChangeProblem(e.auth, before, e.record.get('features_off'), level);
	} catch (err) {
		console.error('[cozy-features] guard: ' + err);
	}
	if (problem) throw new BadRequestError(problem);
	if (forbidden) throw new ForbiddenError(forbidden);
	e.next();
}

// Collections spelled out (no shared constant): a hook handler runs in its own
// isolated runtime and cannot see variables from this file's scope.
onRecordCreateRequest(cozyFeatureGuard, 'houses', 'rooms', 'beds');
onRecordUpdateRequest(cozyFeatureGuard, 'houses', 'rooms', 'beds');
