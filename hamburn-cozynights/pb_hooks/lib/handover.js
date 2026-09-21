/// <reference path="../../pb_data/types.d.ts" />
//
// Handing a ticket over to a new holder: the one description of what that
// means, for PocketBase's side of the house. The app does the same in
// src/lib/server/tickets.ts (NEW_HOLDER_FIELDS + newHolderFields,
// disconnectTelegram, forgetRequest, BookingService.resetCheckIn), and
// tests/integration/imports.test.ts proves that both ways leave the very same
// record behind.
//
// What goes with the old holder: their booking pass (PocketBase makes a new
// code on demand), their burner name, their Telegram chat, their special-needs
// request — that one holds health data — and their check-in. The spot stays
// with the ticket, and so does the ticket code. `handed_over_at` tells the
// delivery run to send the new address its own message instead of confirming a
// booking it never made (pb_hooks/lib/notify.js).
//
// A CommonJS module for PocketBase's JSVM, like notify.js and tickets.js.

/** The first record matching a filter, or null. */
function firstRecord(app, collection, filter, params) {
	const rows = app.findRecordsByFilter(collection, filter, '', 1, 0, params);
	return rows.length > 0 ? rows[0] : null;
}

/**
 * The fields the ticket itself gets. `at` is the moment of the hand-over, in
 * PocketBase's date format; the caller saves the record.
 */
function orderFields(at) {
	return { pass_code: '', burner_name: '', handed_over_at: at };
}

/**
 * What the ticket still carries from its current holder. A ticket with none of
 * it has nothing to lose: changing its address is an ordinary correction, not
 * a hand-over.
 */
function holderState(app, order) {
	const notify = firstRecord(app, 'guest_notify', 'order = {:order}', { order: order.id });
	const request = firstRecord(app, 'special_requests', 'order = {:order}', { order: order.id });
	const arrived = firstRecord(app, 'beds', 'order = {:order} && checked_in_at != ""', {
		order: order.id
	});
	const state = {
		pass: !!order.getString('pass_code'),
		burnerName: !!order.getString('burner_name'),
		telegram: !!(notify && notify.getString('tg_chat')),
		request: !!request,
		checkIn: !!arrived
	};
	state.any = state.pass || state.burnerName || state.telegram || state.request || state.checkIn;
	return state;
}

/** What a ticket carries, in words: "a booking pass, a Telegram chat". */
function describeState(state) {
	const parts = [];
	if (state.pass) parts.push('a booking pass');
	if (state.telegram) parts.push('a Telegram chat');
	if (state.request) parts.push('a special-needs request');
	if (state.burnerName) parts.push('a burner name');
	if (state.checkIn) parts.push('a check-in');
	return parts.join(', ');
}

/**
 * Removes what belonged to the old holder outside the ticket record: the
 * Telegram chat first (no update about the new holder may reach the old chat),
 * then the special-needs request, then the check-in. Returns what was there.
 */
function stripOldHolder(app, order) {
	const removed = { telegram: false, request: false, checkIn: false };

	const notify = firstRecord(app, 'guest_notify', 'order = {:order}', { order: order.id });
	if (notify && notify.getString('tg_chat')) {
		notify.set('tg_chat', '');
		notify.set('tg_new', false);
		notify.set('tg_spot', '');
		notify.set('tg_label', '');
		notify.set('tg_req', '');
		notify.set('tg_token_hash', '');
		notify.set('tg_token_exp', '');
		app.save(notify);
		removed.telegram = true;
	}

	const request = firstRecord(app, 'special_requests', 'order = {:order}', { order: order.id });
	if (request) {
		app.delete(request);
		removed.request = true;
	}

	const arrived = app.findRecordsByFilter(
		'beds',
		'order = {:order} && checked_in_at != ""',
		'',
		0,
		0,
		{ order: order.id }
	);
	for (const bed of arrived) {
		bed.set('checked_in_at', '');
		bed.set('checked_in_by', '');
		app.save(bed);
		removed.checkIn = true;
	}
	return removed;
}

/**
 * The whole hand-over for one ticket: strips the old holder and sets the
 * ticket's own fields. The caller saves the order record (the import does it
 * together with the new address and name, inside its transaction).
 */
function handOver(app, order, at) {
	const removed = stripOldHolder(app, order);
	const fields = orderFields(at);
	for (const name of Object.keys(fields)) order.set(name, fields[name]);
	return removed;
}

module.exports = {
	orderFields: orderFields,
	holderState: holderState,
	describeState: describeState,
	stripOldHolder: stripOldHolder,
	handOver: handOver
};
