/// <reference path="../pb_data/types.d.ts" />
//
// Booking passes (docs/admin/passes.md): every ticket that holds a spot has a
// pass code. The logic lives in pb_hooks/lib/pass.js; handlers run in
// isolated VMs, so each one requires it itself. Nothing in here may throw
// into the booking it watches.
//
// 1. A bed gets a ticket (booking, move, admin, dashboard) → the ticket gets
//    a pass code if it has none.
// 2. POST /api/cozy/pass/{order} (superusers only, i.e. the app's service
//    account): the ticket's code, created if missing — so the app never
//    writes codes itself.

onRecordCreate((e) => {
	e.next();
	const order = e.record.getString('order');
	if (!order) return;
	try {
		require(`${__hooks}/lib/pass.js`).ensurePassCode(e.app, order);
	} catch (err) {
		console.error('[cozy-pass] new bed ' + e.record.id + ': ' + err);
	}
}, 'beds');

onRecordUpdate((e) => {
	e.next();
	const order = e.record.getString('order');
	if (!order) return;
	try {
		require(`${__hooks}/lib/pass.js`).ensurePassCode(e.app, order);
	} catch (err) {
		console.error('[cozy-pass] bed ' + e.record.id + ': ' + err);
	}
}, 'beds');

routerAdd(
	'POST',
	'/api/cozy/pass/{order}',
	(e) => {
		const code = require(`${__hooks}/lib/pass.js`).ensurePassCode(
			e.app,
			e.request.pathValue('order')
		);
		if (!code) return e.json(404, { message: 'Unknown ticket.' });
		return e.json(200, { code: code });
	},
	$apis.requireSuperuserAuth()
);
