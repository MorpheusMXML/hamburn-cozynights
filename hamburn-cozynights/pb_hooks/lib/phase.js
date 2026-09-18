/// <reference path="../../pb_data/types.d.ts" />
//
// The booking phase as PocketBase sees it (docs/guide/phases.md). Mirrors
// effectivePhase / nextTransition in src/lib/booking-phase.ts — change both
// together. Used by the phase guard (pb_hooks/cozy_phase.pb.js) and the crew
// alerts (pb_hooks/cozy_notify.pb.js, lib/notify.js).
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

module.exports = {
	toMs: toMs,
	windowOf: windowOf,
	effectivePhase: effectivePhase,
	isArmed: isArmed
};
