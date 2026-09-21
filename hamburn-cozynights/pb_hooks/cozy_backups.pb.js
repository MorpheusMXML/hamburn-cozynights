/// <reference path="../pb_data/types.d.ts" />
//
// Local PocketBase auto-backups, synced from the environment on every start
// (config as code, like the Google client in cozy_admin.pb.js):
//
//   PB_BACKUP_CRON  cron expression in UTC, default "5 * * * *" (hourly);
//                   "off" disables the auto-backups
//   PB_BACKUP_KEEP  number of auto-backups kept in pb_data/backups, default 72
//
// These ZIP archives are the quick undo (dashboard → Settings → Backups →
// Restore). They live on the same disk as the database, so they are no
// protection against losing the server: the off-site copy is made by
// deploy/backup/server-backup.sh (see deploy/backup/README.md).

onBootstrap((e) => {
	e.next();

	// Handlers run in an isolated context: everything they use must be
	// declared in here, not at file level.
	try {
		const rawCron = ($os.getenv('PB_BACKUP_CRON') || '5 * * * *').trim();
		const cron = rawCron === 'off' ? '' : rawCron;
		const rawKeep = $os.getenv('PB_BACKUP_KEEP');
		const keep = rawKeep ? parseInt(rawKeep, 10) : 72;

		if (!(keep >= 1)) {
			console.error('[cozy-backups] PB_BACKUP_KEEP must be a number >= 1, got: ' + rawKeep);
			return;
		}

		const settings = e.app.settings();
		if (settings.backups.cron === cron && settings.backups.cronMaxKeep === keep) return;

		settings.backups.cron = cron;
		settings.backups.cronMaxKeep = keep;
		e.app.save(settings);
		console.log(
			cron
				? '[cozy-backups] auto-backups "' + cron + '" (UTC), keeping ' + keep
				: '[cozy-backups] auto-backups disabled (PB_BACKUP_CRON=off)'
		);
	} catch (err) {
		// A bad value must never keep PocketBase from starting.
		console.error('[cozy-backups] backup settings not applied: ' + err);
	}
});
