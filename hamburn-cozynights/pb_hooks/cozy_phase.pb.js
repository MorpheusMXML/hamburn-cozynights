/// <reference path="../pb_data/types.d.ts" />
//
// Booking phase guard (docs/guide/phases.md): switching the phase *right now*
// (Staging ↔ Live ↔ Closed) is a superuser's override. Approved admins may
// plan the booking window, arm and pause the timer, but an update of theirs
// must leave the phase as it is at this moment — and keep the one-day
// minimums: booking opens at least a day ahead and stays open at least a day.
// The app checks the same in src/lib/booking-phase.ts (checkWindowEdit); this
// guard covers the records API, which an admin's token can reach directly.
//
// PocketBase superusers (dashboard, the app's service account) and admins
// with role superuser pass. The crew alert for a phase change is in
// pb_hooks/cozy_notify.pb.js.

onRecordUpdateRequest((e) => {
	const auth = e.auth;
	if (auth && auth.collection().name === 'admins' && auth.getString('role') !== 'superuser') {
		let before = '';
		let after = '';
		let timing = '';
		try {
			const phase = require(`${__hooks}/lib/phase.js`);
			const now = Date.now();
			const wasWindow = phase.windowOf(e.record.original());
			const isWindow = phase.windowOf(e.record);
			before = phase.effectivePhase(wasWindow, now);
			after = phase.effectivePhase(isWindow, now);
			// Only worth computing when the phase itself stays put: a switch
			// right now has its own, clearer message below.
			if (before === after) timing = phase.windowEditError(wasWindow, isWindow, now);
		} catch (err) {
			console.error('[cozy-phase] guard: ' + err);
			throw new InternalServerError('The booking phase could not be checked. Nothing was changed.');
		}
		if (before !== after) {
			throw new ForbiddenError(
				'Only a superuser can switch the booking phase right now (' + before + ' → ' + after + ').'
			);
		}
		if (timing) throw new ForbiddenError(timing + ' Nothing was changed.');
	}
	e.next();
}, 'app_settings');
