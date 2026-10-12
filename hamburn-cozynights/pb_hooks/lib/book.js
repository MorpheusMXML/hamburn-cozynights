/// <reference path="../../pb_data/types.d.ts" />
//
// A booking, PocketBase's side: the ticket's other spot is released, the new
// one claimed and the burner name written in ONE transaction, so a crash or a
// failed write never leaves a ticket with two spots, none, or a spot without
// its name. The app asks for it with POST /api/cozy/book
// (pb_hooks/cozy_book.pb.js) while it holds its own locks on the ticket and
// the spot (src/lib/server/booking.ts, bookBed), and checked the same rules
// before, for a friendlier answer; these checks are the last word.
//
// The release comes first: beds.order is unique (one spot per ticket,
// pb_migrations/1761100000_one_spot_per_ticket.js). The bed hooks run inside
// the transaction (lib/booked.js stamps booked_at, notify.js marks the ticket
// for its message), like a swap's.
//
// A CommonJS module for PocketBase's JSVM, like swap.js.

const PHASE = require(__hooks + '/lib/phase.js');

const APP_SETTINGS_ID = 'appsettings0123';

/**
 * Why a booking didn't happen, for the app's answer:
 * - gone: the spot or the ticket doesn't exist
 * - taken: another ticket (or the crew's "taken") holds the spot
 * - unavailable: switched off, 🔒 locked or ♿ — and the booking may not
 * - closed: a guest's booking while booking isn't open (`phase` says which)
 * - checked_in: the ticket's current spot is checked in and may not move
 */
const REFUSALS = ['gone', 'taken', 'unavailable', 'closed', 'checked_in'];

function phaseNow(app) {
	try {
		const settings = app.findRecordById('app_settings', APP_SETTINGS_ID);
		return PHASE.effectivePhase(PHASE.windowOf(settings), Date.now());
	} catch (_) {
		return 'staging'; // no settings record: nothing is open yet
	}
}

/**
 * Books `bedId` for `orderId` with the burner name `name` (already encrypted
 * by the app). A new name for the spot the ticket holds is no claim: it works
 * in every phase and never frees that spot.
 * @param opts { requireLive, allowLocked, allowSpecial, allowCheckedIn }
 * @returns { ok: true } or { ok: false, reason, phase? } (see REFUSALS)
 */
function book(app, orderId, bedId, name, opts) {
	const o = opts || {};
	let outcome = { ok: false, reason: 'gone' };
	app.runInTransaction((tx) => {
		let bed;
		try {
			bed = tx.findRecordById('beds', bedId);
			tx.findRecordById('orders', orderId); // the ticket exists
		} catch (_) {
			outcome = { ok: false, reason: 'gone' };
			return;
		}

		const renaming = bed.getString('order') === orderId;
		if (!renaming) {
			if (bed.getString('order') || bed.getBool('occupied')) {
				outcome = { ok: false, reason: 'taken' };
				return;
			}
			if (
				!bed.getBool('enabled') ||
				(bed.getBool('is_locked') && !o.allowLocked) ||
				(bed.getBool('is_special') && !o.allowSpecial)
			) {
				outcome = { ok: false, reason: 'unavailable' };
				return;
			}
			if (o.requireLive) {
				const phase = phaseNow(tx);
				if (phase !== 'live') {
					outcome = { ok: false, reason: 'closed', phase: phase };
					return;
				}
			}
		}

		const previous = tx.findRecordsByFilter('beds', 'order = {:order} && id != {:bed}', '', 0, 0, {
			order: orderId,
			bed: bedId
		});
		// A guest who has arrived keeps their spot: only the crew moves them,
		// and then the check-in comes along (lib/booked.js drops a check-in
		// whose booking changes, unless the same write brings one).
		let arrived = null;
		for (const prev of previous) {
			if (prev.getString('checked_in_at')) {
				arrived = { at: prev.getString('checked_in_at'), by: prev.getString('checked_in_by') };
			}
		}
		if (arrived && !o.allowCheckedIn) {
			outcome = { ok: false, reason: 'checked_in' };
			return;
		}

		for (const prev of previous) {
			prev.set('order', '');
			prev.set('occupied', false);
			tx.save(prev);
		}
		if (!renaming) {
			bed.set('order', orderId);
			bed.set('occupied', true);
			if (arrived) {
				bed.set('checked_in_at', arrived.at);
				bed.set('checked_in_by', arrived.by);
			}
			tx.save(bed);
		}
		// Read the ticket again: the bed hooks above may have written it in this
		// transaction (lib/pass.js gives it its booking pass), and saving the copy
		// from the start would undo that.
		const fresh = tx.findRecordById('orders', orderId);
		fresh.set('burner_name', String(name || ''));
		tx.save(fresh);
		outcome = { ok: true };
	});
	return outcome;
}

module.exports = {
	REFUSALS: REFUSALS,
	book: book
};
