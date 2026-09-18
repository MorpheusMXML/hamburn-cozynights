// pb_hooks/lib/booked.js — beds.booked_at (docs/reference/data-model.md).
//
// Stamped here, in PocketBase, so every way a spot gets a ticket counts the
// same: a guest booking, the roulette, a move, the crew's special-needs
// assignment, the CLI. Cleared when the spot is released. Called from
// pb_hooks/cozy_booked.pb.js BEFORE e.next(), so the stamp is part of the
// same write. Never throws into the write it decorates.

/** Sets or clears booked_at on the bed record of a create/update event. */
function stamp(e) {
	try {
		const order = e.record.getString('order');
		let before = '';
		try {
			// empty for a record created in this same process (the CLI)
			before = e.record.original().getString('order');
		} catch (_) {
			before = '';
		}
		if (order && order !== before) {
			e.record.set('booked_at', new Date().toISOString());
		} else if (!order && e.record.getString('booked_at')) {
			e.record.set('booked_at', '');
		}
	} catch (err) {
		console.error('[cozy-booked] bed ' + (e.record ? e.record.id : '?') + ': ' + err);
	}
}

module.exports = { stamp };
