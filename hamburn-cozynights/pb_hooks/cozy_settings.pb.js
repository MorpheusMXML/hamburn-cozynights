/// <reference path="../pb_data/types.d.ts" />
//
// PocketBase settings synced from the environment on every start (config as
// code, like the backups in cozy_backups.pb.js and the Google client in
// cozy_admin.pb.js):
//
//   PB_HIDE_CONTROLS  "on" (default) hides the dashboard's collection and
//                     schema editors: on a server the schema only ever comes
//                     from pb_migrations/ (a dashboard edit would be lost on
//                     the next restore). "off" for local development, where
//                     the dashboard is the place to draft a migration.
//   PB_LOGS_DAYS      how many days PocketBase keeps its request log, default 2.
//                     Request URLs can carry a ticket code on a first sign-in
//                     and pass codes, so the log stays short; IPs are not
//                     logged at all.

onBootstrap((e) => {
	e.next();

	// Handlers run in an isolated context: everything they use must be
	// declared in here, not at file level.
	try {
		const hide = ($os.getenv('PB_HIDE_CONTROLS') || 'on').trim() !== 'off';
		const rawDays = $os.getenv('PB_LOGS_DAYS');
		const days = rawDays ? parseInt(rawDays, 10) : 2;
		if (!(days >= 0)) {
			console.error('[cozy-settings] PB_LOGS_DAYS must be a number >= 0, got: ' + rawDays);
			return;
		}

		const settings = e.app.settings();
		const changed =
			settings.meta.hideControls !== hide ||
			settings.logs.maxDays !== days ||
			settings.logs.logIP !== false;
		if (!changed) return;

		settings.meta.hideControls = hide;
		settings.logs.maxDays = days;
		settings.logs.logIP = false;
		e.app.save(settings);
		console.log(
			'[cozy-settings] dashboard schema controls ' +
				(hide ? 'hidden' : 'shown') +
				', request log kept ' +
				days +
				' day(s) without IPs'
		);
	} catch (err) {
		// A bad value must never keep PocketBase from starting.
		console.error('[cozy-settings] settings not applied: ' + err);
	}
});
