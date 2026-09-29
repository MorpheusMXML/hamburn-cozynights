/// <reference path="../pb_data/types.d.ts" />
//
// Bunk beds (docs/admin/camp-layout.md, "Bunk beds"): `beds.bunk_partner`
// points both ways and stays inside one room. The logic lives in
// pb_hooks/lib/bunks.js; handlers run in isolated VMs, so each one requires
// it itself. The after-hooks only touch the OTHER spot of the pair and only
// when it disagrees, so they come to rest after one round.

onRecordUpdateRequest((e) => {
	let problem = '';
	try {
		problem = require(`${__hooks}/lib/bunks.js`).requestProblem(e.app, e.record);
	} catch (err) {
		console.error('[cozy-bunks] request: ' + err);
	}
	if (problem) throw new BadRequestError(problem);
	e.next();
}, 'beds');

onRecordAfterUpdateSuccess((e) => {
	try {
		require(`${__hooks}/lib/bunks.js`).afterWrite(e.app, e.record);
	} catch (err) {
		console.error('[cozy-bunks] after update: ' + err);
	}
	e.next();
}, 'beds');

onRecordAfterDeleteSuccess((e) => {
	try {
		require(`${__hooks}/lib/bunks.js`).afterDelete(e.app, e.record);
	} catch (err) {
		console.error('[cozy-bunks] after delete: ' + err);
	}
	e.next();
}, 'beds');
