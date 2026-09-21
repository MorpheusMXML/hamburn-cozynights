// pb_hooks/lib/booked.js — beds.booked_at and the check-in (docs/reference/data-model.md).
//
// Stamped here, in PocketBase, so every way a spot gets a ticket counts the
// same: a guest booking, the roulette, a move, the crew's special-needs
// assignment, the CLI. Cleared when the spot is released. Called from
// pb_hooks/cozy_booked.pb.js BEFORE e.next(), so the stamp is part of the
// same write. Never throws into the write it decorates.
//
// A spot's states: free → booked (order, booked_at) → checked in
// (checked_in_at, checked_in_by: the crew checked the pass at arrival). A
// check-in belongs to the booking it was made for: when the spot loses its
// ticket or gets another one, it is gone, unless that same write brings a
// check-in along (the crew moving a guest who already arrived).

/** Sets or clears booked_at (and the check-in) on the bed record of a create/update event. */
function stamp(e) {
	try {
		const order = e.record.getString('order');
		let before = '';
		let checkedInBefore = '';
		try {
			// empty for a record created in this same process (the CLI)
			const original = e.record.original();
			before = original.getString('order');
			checkedInBefore = original.getString('checked_in_at');
		} catch (_) {
			before = '';
			checkedInBefore = '';
		}
		if (order && order !== before) {
			e.record.set('booked_at', new Date().toISOString());
		} else if (!order && e.record.getString('booked_at')) {
			e.record.set('booked_at', '');
		}
		// A ticket that is deleted takes its `order` reference with it (PocketBase
		// unsets it), but not `occupied`: the spot would stay "taken" forever.
		// Only when the order goes in THIS write: the crew's "mark as taken" has
		// no order at all and must stay.
		if (before && !order && e.record.getBool('occupied')) {
			e.record.set('occupied', false);
		}

		// Checked in only while booked, and only for the booking it was made for.
		const checkedIn = e.record.getString('checked_in_at');
		if (checkedIn && (!order || (order !== before && checkedIn === checkedInBefore))) {
			e.record.set('checked_in_at', '');
		}
		if (!e.record.getString('checked_in_at') && e.record.getString('checked_in_by')) {
			e.record.set('checked_in_by', '');
		}
	} catch (err) {
		console.error('[cozy-booked] bed ' + (e.record ? e.record.id : '?') + ': ' + err);
	}
}

module.exports = { stamp };
