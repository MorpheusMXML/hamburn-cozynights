/// <reference path="../../pb_data/types.d.ts" />
//
// The booking phase as PocketBase sees it (docs/guide/phases.md). Mirrors
// effectivePhase and the one-day minimums of checkWindowEdit in
// src/lib/booking-phase.ts — change both together. Used by the phase guard
// (pb_hooks/cozy_phase.pb.js) and the crew alerts (pb_hooks/cozy_notify.pb.js,
// lib/notify.js).
//
// Stored in app_settings: the phase set by hand (is_booking_active = live,
// booking_closed = closed, neither = staging) and the booking window
// (booking_unlock_at, booking_close_at, booking_timer_paused). An armed timer
// whose opening or closing time has passed overrides the phase set by hand.

/** ms since the epoch, or null for '' and anything unparsable. */
function toMs(value) {
	const s = String(value || '').trim();
	if (!s) return null;
	const ms = Date.parse(s.replace(' ', 'T'));
	return isNaN(ms) ? null : ms;
}

/** The window of an app_settings record. */
function windowOf(record) {
	return {
		basePhase: record.getBool('is_booking_active')
			? 'live'
			: record.getBool('booking_closed')
				? 'closed'
				: 'staging',
		opensAt: record.getString('booking_unlock_at'),
		closesAt: record.getString('booking_close_at'),
		paused: record.getBool('booking_timer_paused')
	};
}

function effectivePhase(w, now) {
	if (!w.paused) {
		const closes = toMs(w.closesAt);
		if (closes !== null && now >= closes) return 'closed';
		const opens = toMs(w.opensAt);
		if (opens !== null && now >= opens) return 'live';
	}
	return w.basePhase;
}

/** Armed = not paused and at least one time set. */
function isArmed(w) {
	return !w.paused && (toMs(w.opensAt) !== null || toMs(w.closesAt) !== null);
}

const DAY_MS = 24 * 60 * 60 * 1000;
/** Admins (not superusers) open booking at least one day ahead … */
const MIN_LEAD_MS = DAY_MS;
/** … and keep it open for at least one day. */
const MIN_OPEN_MS = DAY_MS;

/** Same instant (or both empty)? The app and PocketBase write ISO strings differently. */
function sameInstant(a, b) {
	return toMs(a) === toMs(b);
}

/** Did this update touch the booking window at all? */
function windowChanged(before, after) {
	return (
		!sameInstant(after.opensAt, before.opensAt) ||
		!sameInstant(after.closesAt, before.closesAt) ||
		after.paused !== before.paused
	);
}

/**
 * The one-day minimums of checkWindowEdit in src/lib/booking-phase.ts, for an
 * admin's token on the records API: booking opens at least a day ahead and
 * stays open at least a day. Returns '' when the change is fine.
 *
 * Two differences to the app's version, both because this sees *every*
 * app_settings update and not only the window actions:
 * - an update that leaves the window alone (e.g. the special-needs switch) is
 *   never measured against these rules, whatever state the window is in;
 * - the phase change itself is the caller's check (cozy_phase.pb.js), which
 *   has the better message for it.
 * Superusers skip all of this, as they do in the app.
 */
function windowEditError(before, after, now) {
	if (!windowChanged(before, after)) return '';

	const opens = toMs(after.opensAt);
	const closes = toMs(after.closesAt);
	if (after.opensAt && opens === null) return 'The opening time is not a valid date.';
	if (after.closesAt && closes === null) return 'The closing time is not a valid date.';
	if (opens !== null && closes !== null && closes <= opens) {
		return 'Booking has to close after it opens. Pick a later closing time.';
	}
	// Nothing armed: no timer rules (arming checks them).
	if (after.paused || (opens === null && closes === null)) return '';

	// Times the armed timer already had don't need to be ahead any more, so
	// editing only the closing time works when the opening is already near.
	const wasArmed = !before.paused;
	const opensChanged = !wasArmed || !sameInstant(after.opensAt, before.opensAt);
	const closesChanged = !wasArmed || !sameInstant(after.closesAt, before.closesAt);
	const phaseAfter = effectivePhase(after, now);

	if (phaseAfter !== 'live') {
		if (opens === null) return 'Set when booking opens.';
		if (opensChanged && opens < now + MIN_LEAD_MS) {
			return 'Booking can open one day from now at the earliest. Only a superuser can open it sooner.';
		}
	}
	if (closes === null) return 'Set when booking closes.';
	if (closesChanged) {
		const from = phaseAfter === 'live' || opens === null ? now : Math.max(now, opens);
		if (closes < from + MIN_OPEN_MS) {
			return 'Booking has to stay open for at least one day. Only a superuser can close it sooner.';
		}
	}
	return '';
}

module.exports = {
	MIN_LEAD_MS: MIN_LEAD_MS,
	MIN_OPEN_MS: MIN_OPEN_MS,
	toMs: toMs,
	windowOf: windowOf,
	effectivePhase: effectivePhase,
	isArmed: isArmed,
	sameInstant: sameInstant,
	windowChanged: windowChanged,
	windowEditError: windowEditError
};
