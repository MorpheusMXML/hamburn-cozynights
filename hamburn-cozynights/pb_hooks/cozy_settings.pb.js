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
//   PB_ENCRYPTION_KEY the 32-character key behind --encryptionEnv (compose
//                     files): PocketBase then stores the settings row
//                     (SMTP password, S3 keys, ...) AES-256-GCM encrypted.
//                     The second handler below turns existing plain-text
//                     settings into encrypted ones and refuses a wrong key.

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

// Settings encryption (--encryptionEnv=PB_ENCRYPTION_KEY in every compose file).
// PocketBase only encrypts the settings row when it is saved, so a database
// created before the key existed keeps its plain-text settings until the
// first save: this handler does that save once. It also refuses to start
// with a key of the wrong length — AES would silently accept 16 or 24
// characters (a weaker cipher) and fail every save with any other length,
// which shows up only as "An error occurred while saving the new settings"
// in the dashboard and as .env values that never reach the settings.
// Verified against PocketBase 0.40.4 (docs/develop/deployment.md).
onBootstrap((e) => {
	// Before e.next() nothing has been loaded or saved yet, so a wrong key
	// stops PocketBase before any other hook could save with it (the
	// bootstrap handlers run in no fixed order).
	const envName = e.app.encryptionEnv();
	const key = envName ? $os.getenv(envName) || '' : '';
	if (key && !/^[\x21-\x7e]{32}$/.test(key)) {
		// Deliberately not caught: a deploy's health check then rolls back.
		throw new Error(
			'[cozy-settings] ' +
				envName +
				' must be exactly 32 printable characters without spaces (openssl rand -hex 16), it has ' +
				key.length +
				' — fix .env and recreate the container'
		);
	}

	e.next();

	if (!envName) {
		if ($os.getenv('PB_ENCRYPTION_KEY')) {
			console.warn(
				'[cozy-settings] PB_ENCRYPTION_KEY is set but PocketBase runs without --encryptionEnv=PB_ENCRYPTION_KEY: the settings stay in plain text'
			);
		}
		return;
	}
	if (!key) {
		console.warn('[cozy-settings] ' + envName + ' is empty: the settings are stored in plain text');
		return;
	}
	try {
		const row = new DynamicModel({ value: '' });
		e.app
			.db()
			.newQuery("SELECT CAST(value AS TEXT) AS value FROM _params WHERE id = 'settings'")
			.one(row);
		if (String(row.value).charAt(0) !== '{') return; // already encrypted
		e.app.save(e.app.settings());
		console.log(
			'[cozy-settings] settings were stored in plain text and are now encrypted with ' + envName
		);
	} catch (err) {
		console.error('[cozy-settings] could not encrypt the stored settings: ' + err);
	}
});
