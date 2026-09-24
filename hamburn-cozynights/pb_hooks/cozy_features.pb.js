/// <reference path="../pb_data/types.d.ts" />
//
// Features of houses and rooms (docs/admin/camp-layout.md): two that say the
// opposite of each other — heated and no heating — can't both be set. The
// app's forms and the template import refuse such a pair already; this is
// the same rule on the records API, which any admin token can reach directly.
// The logic lives in pb_hooks/lib/beds.js; handlers run in isolated VMs, so
// each one requires it itself.

function cozyFeatureGuard(e) {
	let problem = '';
	try {
		const level = e.collection.name === 'houses' ? 'house' : 'room';
		problem = require(`${__hooks}/lib/beds.js`).featureProblem(e.record, level);
	} catch (err) {
		console.error('[cozy-features] guard: ' + err);
	}
	if (problem) throw new BadRequestError(problem);
	e.next();
}

// Collections spelled out (no shared constant): a hook handler runs in its own
// isolated runtime and cannot see variables from this file's scope.
onRecordCreateRequest(cozyFeatureGuard, 'houses', 'rooms');
onRecordUpdateRequest(cozyFeatureGuard, 'houses', 'rooms');
