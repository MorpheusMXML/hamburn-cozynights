/// <reference path="../pb_data/types.d.ts" />
//
// Layout lock guard (docs/guide/phases.md): houses, rooms and spots may only be
// created or deleted while booking is in phase `staging`. Once booking is live
// or closed, the camp layout is frozen — otherwise a bed could disappear under
// the guest who just booked it.
//
// The SvelteKit actions check this already (getBookingSettings → isLayoutLocked,
// e.g. src/routes/admin/house/new/+page.server.ts). This guard covers the same
// rule on the records API, which any admin token can reach directly — the same
// defense in depth as the phase guard in pb_hooks/cozy_phase.pb.js.
//
// Not guarded: *updates* of beds. Marking a spot 🔒 reserved or ♿ accessible,
// assigning it and releasing it all have to keep working while booking runs.

function cozyLayoutGuard(e) {
	// Only app admins (collection `admins`, any role) are guarded — that is the
	// token the app hands out and the one an admin could use against the API
	// directly. PocketBase superusers (the dashboard behind the SSH tunnel, the
	// app's own service account, cozy-admin) stay free: they are the way out if
	// the phase itself ever gets stuck, and the app checks the lock before it
	// uses them. Guests are refused by the collection rules long before this.
	const auth = e.auth;
	if (!auth || auth.collection().name !== 'admins') {
		e.next();
		return;
	}

	let phase = '';
	try {
		const helper = require(`${__hooks}/lib/phase.js`);
		const settings = $app.findRecordById('app_settings', 'appsettings0123');
		phase = helper.effectivePhase(helper.windowOf(settings), Date.now());
	} catch (err) {
		// Fail closed, exactly like the phase guard: if the phase cannot be read,
		// nothing that changes the layout goes through.
		console.error('[cozy-layout] guard: ' + err);
		throw new InternalServerError('The booking phase could not be checked. Nothing was changed.');
	}

	if (phase !== 'staging') {
		throw new ForbiddenError(
			'The camp layout is locked while booking is ' +
				phase +
				'. A superuser can switch back to Staging Mode in the Control Center.'
		);
	}

	e.next();
}

// Collections spelled out (no shared constant): a hook handler runs in its own
// isolated runtime and cannot see variables from this file's scope.
onRecordCreateRequest(cozyLayoutGuard, 'houses', 'rooms', 'beds');
onRecordDeleteRequest(cozyLayoutGuard, 'houses', 'rooms', 'beds');
