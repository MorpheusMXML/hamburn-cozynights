/// <reference path="../pb_data/types.d.ts" />
//
// Swap requests (docs/admin/swaps.md). The logic lives in pb_hooks/lib/swap.js;
// handlers run in isolated VMs, so each one requires it itself.
//
// POST /api/cozy/swap (superusers only, i.e. the app's service account)
// Body: { request, order } — the request to accept and the ticket that says
// yes (the one it is addressed to). Swaps the two spots, marks the request
// accepted and ends every other open request about either spot or ticket, in
// one transaction. 200 { ok: true, voided } or 409 { ok: false, reason }
// (lib/swap.js REFUSALS). The app calls it while it holds its own locks on
// both tickets (src/lib/server/booking.ts, swapSpots).

routerAdd(
	'POST',
	'/api/cozy/swap',
	(e) => {
		const body = e.requestInfo().body || {};
		const request = String(body.request || '');
		const order = String(body.order || '');
		if (!request || !order) return e.json(400, { ok: false, reason: 'mismatch' });
		const outcome = require(`${__hooks}/lib/swap.js`).acceptSwap(e.app, request, order);
		return e.json(outcome.ok ? 200 : 409, outcome);
	},
	$apis.requireSuperuserAuth()
);
