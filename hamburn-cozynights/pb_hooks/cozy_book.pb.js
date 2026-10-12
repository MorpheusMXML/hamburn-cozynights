/// <reference path="../pb_data/types.d.ts" />
//
// Bookings in one transaction (docs/reference/data-model.md). The logic lives
// in pb_hooks/lib/book.js; handlers run in isolated VMs, so each one requires
// it itself.
//
// POST /api/cozy/book (superusers only, i.e. the app's service account)
// Body: { order, bed, name, requireLive, allowLocked, allowSpecial,
// allowCheckedIn } — `name` is the burner name as the app stores it
// (encrypted). Releases the ticket's other spot, claims this one and writes
// the name, all or nothing. 200 { ok: true } or 409 { ok: false, reason,
// phase? } (lib/book.js REFUSALS). The app calls it while it holds its own
// locks on the ticket and the spot (src/lib/server/booking.ts, bookBed).

routerAdd(
	'POST',
	'/api/cozy/book',
	(e) => {
		const body = e.requestInfo().body || {};
		const order = String(body.order || '');
		const bed = String(body.bed || '');
		if (!order || !bed) return e.json(400, { ok: false, reason: 'gone' });
		const outcome = require(`${__hooks}/lib/book.js`).book(e.app, order, bed, body.name, {
			requireLive: body.requireLive === true,
			allowLocked: body.allowLocked === true,
			allowSpecial: body.allowSpecial === true,
			allowCheckedIn: body.allowCheckedIn === true
		});
		return e.json(outcome.ok ? 200 : 409, outcome);
	},
	$apis.requireSuperuserAuth()
);
