/// <reference path="../pb_data/types.d.ts" />
//
// Booking phase guard (docs/guide/phases.md): switching the phase *right now*
// (Staging ↔ Live ↔ Closed) is a superuser's override. Approved admins may
// plan the booking window, arm and pause the timer, but an update of theirs
// must leave the phase as it is at this moment. The app checks the same (and
// more: the one-day minimums) in src/lib/booking-phase.ts; this guard covers
// the records API, which an admin's token can reach directly.
//
// PocketBase superusers (dashboard, the app's service account) and admins
// with role superuser pass. The crew alert for a phase change is in
// pb_hooks/cozy_notify.pb.js.

onRecordUpdateRequest((e) => {
	const auth = e.auth;
	if (auth && auth.collection().name === 'admins' && auth.getString('role') !== 'superuser') {
		let before = '';
		let after = '';
		try {
			const phase = require(`${__hooks}/lib/phase.js`);
			const now = Date.now();
			before = phase.effectivePhase(phase.windowOf(e.record.original()), now);
			after = phase.effectivePhase(phase.windowOf(e.record), now);
		} catch (err) {
			console.error('[cozy-phase] guard: ' + err);
			throw new InternalServerError('The booking phase could not be checked. Nothing was changed.');
		}
		if (before !== after) {
			throw new ForbiddenError(
				'Only a superuser can switch the booking phase right now (' + before + ' → ' + after + ').'
			);
		}
	}
	e.next();
}, 'app_settings');
