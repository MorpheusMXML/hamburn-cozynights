/// <reference path="../../pb_data/types.d.ts" />
//
// Swap requests, PocketBase's side (docs/admin/swaps.md): whether a request
// can still happen, and the swap itself — two spots change tickets in ONE
// transaction, together with the request's "accepted" and the end of every
// other open request about either spot or either ticket. The app asks for it
// with POST /api/cozy/swap (pb_hooks/cozy_swap.pb.js) while it holds its own
// locks on both tickets (src/lib/server/booking.ts, swapSpots), so no booking
// of either guest can run in between. The checks here are the last word: the
// app checked the same before, for a friendlier answer.
//
// Only spots guests could book themselves change hands: enabled, not locked
// (🔒), not a special-needs spot (♿), not the spot the crew booked for a
// special-needs request, not checked in. Burner names are the tickets' own
// (orders.burner_name), so they travel with their guests.
//
// A CommonJS module for PocketBase's JSVM, like notify.js.

const PHASE = require(__hooks + '/lib/phase.js');

const APP_SETTINGS_ID = 'appsettings0123';

/**
 * Why a request can't go through, for the app's answer:
 * - answered: it is not open anymore (answered, withdrawn, ended)
 * - expired: it ran out
 * - closed: booking isn't open, or the crew turned swaps off
 * - moved: one of the spots changed hands since the request was made
 * - fixed: one of the spots can't be swapped (checked in, crew-picked, 🔒, ♿)
 * - mismatch: the request isn't addressed to this ticket
 */
const REFUSALS = ['answered', 'expired', 'closed', 'moved', 'fixed', 'mismatch'];

/** PocketBase's date format ("2006-01-02 15:04:05.000Z"). */
function pbDate(ms) {
	return new Date(ms).toISOString().replace('T', ' ');
}

function toMs(value) {
	const s = String(value || '').trim();
	if (!s) return 0;
	const ms = Date.parse(s.replace(' ', 'T'));
	return isNaN(ms) ? 0 : ms;
}

/** Booking is open and the crew hasn't turned swaps off. */
function swapsOpen(app, now) {
	let settings;
	try {
		settings = app.findRecordById('app_settings', APP_SETTINGS_ID);
	} catch (_) {
		return false;
	}
	if (settings.getBool('swaps_off')) return false;
	return PHASE.effectivePhase(PHASE.windowOf(settings), now) === 'live';
}

/** The spot the crew booked for this ticket's approved special-needs request, or ''. */
function crewPickedBed(app, orderId) {
	const rows = app.findRecordsByFilter(
		'special_requests',
		"order = {:order} && status = 'approved' && bed != ''",
		'',
		1,
		0,
		{ order: orderId }
	);
	return rows.length > 0 ? rows[0].getString('bed') : '';
}

/**
 * Whether this spot, held by this ticket, may change hands: '' when it may,
 * else 'moved' (another ticket holds it by now) or 'fixed'.
 */
function spotProblem(app, bed, orderId) {
	if (bed.getString('order') !== orderId) return 'moved';
	if (bed.getString('checked_in_at')) return 'fixed';
	if (!bed.getBool('enabled') || bed.getBool('is_locked') || bed.getBool('is_special')) {
		return 'fixed';
	}
	if (crewPickedBed(app, orderId) === bed.id) return 'fixed';
	return '';
}

/**
 * Whether an open request can still end in a swap: '' when it can, else a
 * word of REFUSALS. Reads the spots fresh, so it holds for this moment only.
 */
function requestProblem(app, request, now) {
	if (request.getString('status') !== 'pending') return 'answered';
	if (toMs(request.getString('expires_at')) <= now) return 'expired';
	if (!swapsOpen(app, now)) return 'closed';
	let fromBed;
	let toBed;
	try {
		fromBed = app.findRecordById('beds', request.getString('from_bed'));
		toBed = app.findRecordById('beds', request.getString('to_bed'));
	} catch (_) {
		return 'moved'; // a spot is gone (it would have taken the request along)
	}
	return (
		spotProblem(app, fromBed, request.getString('from_order')) ||
		spotProblem(app, toBed, request.getString('to_order'))
	);
}

/**
 * Ends every other open request about these spots or tickets: after the swap
 * none of them is what its guest asked for any more. Returns how many.
 */
function voidOthers(app, request, now) {
	const rows = app.findRecordsByFilter(
		'swap_requests',
		"status = 'pending' && id != {:id} && (" +
			'from_order = {:a} || from_order = {:b} || to_order = {:a} || to_order = {:b} || ' +
			'from_bed = {:x} || from_bed = {:y} || to_bed = {:x} || to_bed = {:y})',
		'',
		0,
		0,
		{
			id: request.id,
			a: request.getString('from_order'),
			b: request.getString('to_order'),
			x: request.getString('from_bed'),
			y: request.getString('to_bed')
		}
	);
	for (const other of rows) {
		other.set('status', 'void');
		other.set('ended', 'swapped');
		other.set('answered_at', pbDate(now));
		other.set('notify_due', '');
		app.save(other);
	}
	return rows.length;
}

/**
 * Accepts a request for the ticket it is addressed to and swaps the two
 * spots, all in one transaction. A request that turns out to be over is
 * closed for good on the way ('expired', or 'void' when a spot moved on).
 * @returns { ok: true, voided } or { ok: false, reason } (see REFUSALS)
 */
function acceptSwap(app, requestId, toOrderId) {
	let outcome = { ok: false, reason: 'answered' };
	app.runInTransaction((tx) => {
		const now = Date.now();
		let request;
		try {
			request = tx.findRecordById('swap_requests', requestId);
		} catch (_) {
			outcome = { ok: false, reason: 'answered' }; // deleted (hand-over)
			return;
		}
		if (request.getString('to_order') !== toOrderId || request.getBool('quiet')) {
			outcome = { ok: false, reason: 'mismatch' };
			return;
		}
		const problem = requestProblem(tx, request, now);
		if (problem) {
			if (problem === 'expired' || problem === 'moved') {
				request.set('status', problem === 'expired' ? 'expired' : 'void');
				if (problem === 'moved') request.set('ended', 'moved');
				request.set('answered_at', pbDate(now));
				request.set('notify_due', '');
				tx.save(request);
			}
			outcome = { ok: false, reason: problem };
			return;
		}

		const fromOrder = request.getString('from_order');
		const toOrder = request.getString('to_order');
		const fromBed = tx.findRecordById('beds', request.getString('from_bed'));
		const toBed = tx.findRecordById('beds', request.getString('to_bed'));
		// The asker's spot goes to the other guest, theirs to the asker. The bed
		// hooks run inside this transaction: booked_at is stamped anew and both
		// tickets are marked for a "changed" message (lib/booked.js, notify.js).
		fromBed.set('order', toOrder);
		fromBed.set('occupied', true);
		tx.save(fromBed);
		toBed.set('order', fromOrder);
		toBed.set('occupied', true);
		tx.save(toBed);

		request.set('status', 'accepted');
		request.set('answered_at', pbDate(now));
		request.set('notify_due', '');
		tx.save(request);
		outcome = { ok: true, voided: voidOthers(tx, request, now) };
	});
	return outcome;
}

module.exports = {
	REFUSALS: REFUSALS,
	swapsOpen: swapsOpen,
	spotProblem: spotProblem,
	requestProblem: requestProblem,
	voidOthers: voidOthers,
	acceptSwap: acceptSwap
};
