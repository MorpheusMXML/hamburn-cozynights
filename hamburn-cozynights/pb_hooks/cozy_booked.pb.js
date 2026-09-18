/// <reference path="../pb_data/types.d.ts" />
//
// beds.booked_at: when the spot got its ticket. The logic lives in
// pb_hooks/lib/booked.js; handlers run in isolated VMs, so each one requires
// it itself. The stamp is set before e.next(), i.e. inside the same write;
// nothing in here may throw into the booking it watches.

onRecordCreate((e) => {
	try {
		require(`${__hooks}/lib/booked.js`).stamp(e);
	} catch (err) {
		console.error('[cozy-booked] create: ' + err);
	}
	e.next();
}, 'beds');

onRecordUpdate((e) => {
	try {
		require(`${__hooks}/lib/booked.js`).stamp(e);
	} catch (err) {
		console.error('[cozy-booked] update: ' + err);
	}
	e.next();
}, 'beds');
