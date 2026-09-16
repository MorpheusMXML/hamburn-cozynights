/// <reference path="../pb_data/types.d.ts" />
//
// 1. `cozy-admin` console command: the ONLY way to grant admin access.
//    There is intentionally no API or UI for inviting admins or signing up.
//    Use it through the host wrapper scripts/cozy-admin.sh, which also takes
//    care of the required --dir/--hooksDir flags and of reading passwords.
//
//      cozy-admin add <email>              invite an admin (Google login)
//      cozy-admin superuser <email>        PocketBase superuser (password from
//                                          $COZY_SU_PASSWORD) + app role superuser
//      cozy-admin remove <email>           revoke app access and PocketBase superuser
//      cozy-admin list                     show admins and PocketBase superusers
//      cozy-admin service-account <email>  create/rotate the app's service superuser
//                                          (password from $COZY_SU_PASSWORD)
//
// 2. On every start, sync the Google OAuth client of the `admins` collection
//    from PB_GOOGLE_CLIENT_ID / PB_GOOGLE_CLIENT_SECRET (so rotating the secret
//    is an .env change + restart, not a new migration).

const ADMIN_DOMAIN = 'mauersegler.art';
const MIN_SUPERUSER_PASSWORD = 12;

function cozyFail(cmd, message) {
	// cmd.printErrln is a silent no-op in the JSVM; println writes to stderr.
	cmd.println('error: ' + message);
	$os.exit(1);
}

function cozyNormalizeEmail(cmd, value, requireAdminDomain) {
	const email = String(value || '')
		.trim()
		.toLowerCase();
	if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
		cozyFail(cmd, 'invalid email address: ' + value);
	}
	if (requireAdminDomain && !email.endsWith('@' + ADMIN_DOMAIN)) {
		cozyFail(cmd, 'admins must use an @' + ADMIN_DOMAIN + ' address (Google Workspace login)');
	}
	return email;
}

function cozyAdminsCollection(cmd) {
	try {
		return $app.findCollectionByNameOrId('admins');
	} catch (_) {
		cozyFail(
			cmd,
			'collection "admins" not found — the migrations have not run yet (start the server once, or run `pocketbase migrate up --dir=/pb_data`)'
		);
	}
}

function cozyFind(collection, email) {
	try {
		return $app.findAuthRecordByEmail(collection, email);
	} catch (_) {
		return null;
	}
}

function cozyPasswordFromEnv(cmd) {
	const password = $os.getenv('COZY_SU_PASSWORD');
	if (!password) {
		cozyFail(cmd, 'password missing: pass it via the COZY_SU_PASSWORD environment variable');
	}
	if (password.length < MIN_SUPERUSER_PASSWORD) {
		cozyFail(cmd, 'password must be at least ' + MIN_SUPERUSER_PASSWORD + ' characters');
	}
	return password;
}

function cozyUpsertSuperuser(email, password) {
	let su = cozyFind('_superusers', email);
	const created = !su;
	if (created) {
		su = new Record($app.findCollectionByNameOrId('_superusers'));
		su.setEmail(email);
	}
	su.setPassword(password);
	$app.save(su);
	return created;
}

function cozyUpsertAdmin(collection, email, role) {
	let rec = cozyFind('admins', email);
	const created = !rec;
	if (created) {
		rec = new Record(collection);
		rec.setEmail(email);
		// Password login is disabled for this collection; auth records still
		// need a (never used) password.
		rec.setRandomPassword();
	}
	rec.set('role', role);
	$app.save(rec);
	return created;
}

const cozyAdmin = new Command({
	use: 'cozy-admin',
	short: 'Manage CozyNights admin access (admins collection + PocketBase superusers)'
});

cozyAdmin.addCommand(
	new Command({
		use: 'add <email>',
		short: 'Invite an admin (signs in with Google)',
		run: (cmd, args) => {
			if (args.length !== 1) cozyFail(cmd, 'usage: cozy-admin add <email>');
			const collection = cozyAdminsCollection(cmd);
			const email = cozyNormalizeEmail(cmd, args[0], true);

			const existing = cozyFind('admins', email);
			if (existing) {
				cmd.println(
					'unchanged: ' + email + ' already has access (role ' + existing.getString('role') + ')'
				);
				return;
			}
			cozyUpsertAdmin(collection, email, 'admin');
			cmd.println(
				'invited: ' + email + ' (role admin) — can now sign in at /admin/login with Google'
			);
		}
	})
);

cozyAdmin.addCommand(
	new Command({
		use: 'superuser <email>',
		short: 'Set a PocketBase superuser password and grant the app role superuser',
		run: (cmd, args) => {
			if (args.length !== 1)
				cozyFail(cmd, 'usage: COZY_SU_PASSWORD=... cozy-admin superuser <email>');
			const collection = cozyAdminsCollection(cmd);
			const email = cozyNormalizeEmail(cmd, args[0], true);
			const password = cozyPasswordFromEnv(cmd);

			$app.runInTransaction((txApp) => {
				// Both writes or none.
				let su;
				try {
					su = txApp.findAuthRecordByEmail('_superusers', email);
				} catch (_) {
					su = new Record(txApp.findCollectionByNameOrId('_superusers'));
					su.setEmail(email);
				}
				su.setPassword(password);
				txApp.save(su);

				let rec;
				try {
					rec = txApp.findAuthRecordByEmail('admins', email);
				} catch (_) {
					rec = new Record(collection);
					rec.setEmail(email);
					rec.setRandomPassword();
				}
				rec.set('role', 'superuser');
				txApp.save(rec);
			});

			cmd.println('superuser set: ' + email);
			cmd.println('  - PocketBase dashboard (/_/, via SSH tunnel): password login');
			cmd.println('  - app admin area: Google login, role superuser');
		}
	})
);

cozyAdmin.addCommand(
	new Command({
		use: 'remove <email>',
		short: 'Revoke app admin access and the PocketBase superuser account of this email',
		run: (cmd, args) => {
			if (args.length !== 1) cozyFail(cmd, 'usage: cozy-admin remove <email>');
			cozyAdminsCollection(cmd);
			const email = cozyNormalizeEmail(cmd, args[0], false);

			const rec = cozyFind('admins', email);
			const su = cozyFind('_superusers', email);
			if (!rec && !su) cozyFail(cmd, 'no admin or superuser with email ' + email);
			if (su && $app.countRecords('_superusers') <= 1) {
				cozyFail(cmd, 'refusing to remove the last PocketBase superuser (' + email + ')');
			}

			if (rec) {
				// Deleting the record also deletes its Google link and invalidates
				// its tokens: the app drops the session on the next request.
				$app.delete(rec);
				cmd.println('removed app admin access: ' + email);
			}
			if (su) {
				$app.delete(su);
				cmd.println('removed PocketBase superuser: ' + email);
			}
		}
	})
);

cozyAdmin.addCommand(
	new Command({
		use: 'list',
		short: 'List admins and PocketBase superusers',
		run: (cmd, args) => {
			cozyAdminsCollection(cmd);
			const admins = $app.findAllRecords('admins');
			const superusers = $app.findAllRecords('_superusers');
			const superuserEmails = superusers.map((s) => s.email());

			cmd.println('APP ADMINS (Google login at /admin/login)');
			if (admins.length === 0) cmd.println('  (none)');
			for (const a of admins) {
				const linked = $app.findAllExternalAuthsByRecord(a).length > 0;
				cmd.println(
					'  ' +
						a.email() +
						'  role=' +
						a.getString('role') +
						'  google=' +
						(linked ? 'linked' : 'not signed in yet') +
						'  pb-superuser=' +
						(superuserEmails.indexOf(a.email()) >= 0 ? 'yes' : 'no')
				);
			}

			const adminEmails = admins.map((a) => a.email());
			const others = superusers.filter((s) => adminEmails.indexOf(s.email()) < 0);
			cmd.println('OTHER POCKETBASE SUPERUSERS (no app access, e.g. the app service account)');
			if (others.length === 0) cmd.println('  (none)');
			for (const s of others) cmd.println('  ' + s.email());
		}
	})
);

cozyAdmin.addCommand(
	new Command({
		use: 'service-account <email>',
		short: "Create or rotate the app's service superuser (PB_ADMIN_EMAIL)",
		run: (cmd, args) => {
			if (args.length !== 1)
				cozyFail(cmd, 'usage: COZY_SU_PASSWORD=... cozy-admin service-account <email>');
			cozyAdminsCollection(cmd);
			const email = cozyNormalizeEmail(cmd, args[0], false);
			if (cozyFind('admins', email)) {
				cozyFail(cmd, email + ' is a personal admin account — use a dedicated service email');
			}
			const created = cozyUpsertSuperuser(email, cozyPasswordFromEnv(cmd));
			cmd.println((created ? 'created' : 'rotated') + ' service superuser: ' + email);
		}
	})
);

$app.rootCmd.addCommand(cozyAdmin);

onBootstrap((e) => {
	e.next();

	const clientId = $os.getenv('PB_GOOGLE_CLIENT_ID');
	const clientSecret = $os.getenv('PB_GOOGLE_CLIENT_SECRET');

	let collection;
	try {
		collection = e.app.findCollectionByNameOrId('admins');
	} catch (_) {
		// Fresh database: migrations run after bootstrap; the admin-auth
		// migration configures the provider itself.
		return;
	}

	if (!clientId || !clientSecret) {
		if (collection.oauth2.enabled) {
			console.warn(
				'[cozy-admin] PB_GOOGLE_CLIENT_ID/SECRET not set — keeping the stored Google client'
			);
		} else {
			console.warn(
				'[cozy-admin] PB_GOOGLE_CLIENT_ID/SECRET not set — Google admin login is disabled'
			);
		}
		return;
	}

	let current = null;
	const providers = collection.oauth2.providers;
	for (let i = 0; i < providers.length; i++) {
		if (providers[i].name === 'google') current = providers[i];
	}
	if (
		collection.oauth2.enabled &&
		current &&
		current.clientId === clientId &&
		current.clientSecret === clientSecret
	) {
		return;
	}

	// unmarshal merges providers by name, so other provider settings are kept.
	unmarshal(
		{ oauth2: { enabled: true, providers: [{ name: 'google', clientId, clientSecret }] } },
		collection
	);
	e.app.save(collection);
	console.log('[cozy-admin] Google OAuth client for admins updated from environment');
});
