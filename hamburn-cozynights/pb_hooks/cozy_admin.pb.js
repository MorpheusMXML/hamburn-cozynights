/// <reference path="../pb_data/types.d.ts" />
//
// 1. `cozy-admin` console command to grant and revoke admin access on the
//    server. Access is granted either up front (`add`) or by approving an
//    access request that a @mauersegler.art Google sign-in created (`approve`;
//    alternatively change the record's role in the PocketBase dashboard).
//    There is intentionally no invite/approval UI in the app.
//    Use it through the host wrapper scripts/cozy-admin.sh, which also takes
//    care of the required --dir/--hooksDir flags and of reading passwords.
//
//      cozy-admin add <email>                     invite (or approve) an admin
//      cozy-admin approve <email> [admin|superuser]  approve an access request
//      cozy-admin superuser <email>               PocketBase superuser (password from
//                                                 $COZY_SU_PASSWORD) + app role superuser
//      cozy-admin remove <email>                  revoke/reject: app access + PocketBase superuser
//      cozy-admin list                            show pending requests, admins, superusers
//      cozy-admin service-account <email>         create/rotate the app's service superuser
//                                                 (password from $COZY_SU_PASSWORD)
//
// 2. On every start, sync the Google OAuth client of the `admins` collection
//    from PB_GOOGLE_CLIENT_ID / PB_GOOGLE_CLIENT_SECRET (so rotating the secret
//    is an .env change + restart, not a new migration).
//
// 3. When a sign-in creates an access request, post a notification to
//    COZY_ADMIN_WEBHOOK_URL (optional; Telegram, Slack, Google Chat, Discord).

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

// New admin records always start as `pending` (enforced below), so creating
// with a role is a create + an update.
function cozyNewPendingAdmin(app, collection, email) {
	const rec = new Record(collection);
	rec.setEmail(email);
	// Password login is disabled for this collection; auth records still
	// need a (never used) password.
	rec.setRandomPassword();
	rec.set('role', 'pending');
	app.save(rec);
	return rec;
}

function cozyUpsertAdmin(collection, email, role) {
	let rec = cozyFind('admins', email);
	const created = !rec;
	if (created) rec = cozyNewPendingAdmin($app, collection, email);
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
		short: 'Invite an admin (signs in with Google); approves a pending request',
		run: (cmd, args) => {
			if (args.length !== 1) cozyFail(cmd, 'usage: cozy-admin add <email>');
			const collection = cozyAdminsCollection(cmd);
			const email = cozyNormalizeEmail(cmd, args[0], true);

			const existing = cozyFind('admins', email);
			if (existing && existing.getString('role') !== 'pending') {
				cmd.println(
					'unchanged: ' + email + ' already has access (role ' + existing.getString('role') + ')'
				);
				return;
			}
			cozyUpsertAdmin(collection, email, 'admin');
			cmd.println(
				(existing ? 'approved: ' : 'invited: ') +
					email +
					' (role admin) — can sign in at /admin/login with Google'
			);
		}
	})
);

cozyAdmin.addCommand(
	new Command({
		use: 'approve <email> [admin|superuser]',
		short: 'Approve an access request (default role admin)',
		run: (cmd, args) => {
			if (args.length < 1 || args.length > 2) {
				cozyFail(cmd, 'usage: cozy-admin approve <email> [admin|superuser]');
			}
			const collection = cozyAdminsCollection(cmd);
			const email = cozyNormalizeEmail(cmd, args[0], true);
			const role = args.length > 1 ? String(args[1]) : 'admin';
			if (role !== 'admin' && role !== 'superuser') {
				cozyFail(cmd, 'role must be admin or superuser');
			}
			if (!cozyFind('admins', email)) {
				cozyFail(cmd, 'no access request from ' + email + ' (use `add` to invite)');
			}
			cozyUpsertAdmin(collection, email, role);
			cmd.println('approved: ' + email + ' (role ' + role + ')');
			if (role === 'superuser' && !cozyFind('_superusers', email)) {
				cmd.println(
					'  note: no PocketBase dashboard login — use `superuser ' + email + '` to set a password'
				);
			}
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
					rec = cozyNewPendingAdmin(txApp, collection, email);
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
		short: 'List access requests, admins and PocketBase superusers',
		run: (cmd, args) => {
			cozyAdminsCollection(cmd);
			const admins = $app.findAllRecords('admins');
			const superusers = $app.findAllRecords('_superusers');
			const superuserEmails = superusers.map((s) => s.email());
			const describe = (a) =>
				'  ' +
				a.email() +
				(a.getString('name') ? ' (' + a.getString('name') + ')' : '') +
				'  role=' +
				a.getString('role') +
				'  google=' +
				($app.findAllExternalAuthsByRecord(a).length > 0 ? 'linked' : 'not signed in yet') +
				'  pb-superuser=' +
				(superuserEmails.indexOf(a.email()) >= 0 ? 'yes' : 'no') +
				'  since=' +
				String(a.getDateTime('created').string()).slice(0, 16);

			const pending = admins.filter((a) => a.getString('role') === 'pending');
			const approved = admins.filter((a) => a.getString('role') !== 'pending');

			cmd.println('PENDING ACCESS REQUESTS (approve: cozy-admin.sh approve <email>)');
			if (pending.length === 0) cmd.println('  (none)');
			for (const a of pending) cmd.println(describe(a));

			cmd.println('APP ADMINS (Google login at /admin/login)');
			if (approved.length === 0) cmd.println('  (none)');
			for (const a of approved) cmd.println(describe(a));

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
			if (email.endsWith('@' + ADMIN_DOMAIN) || cozyFind('admins', email)) {
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

onRecordAfterCreateSuccess((e) => {
	e.next();

	const url = $os.getenv('COZY_ADMIN_WEBHOOK_URL');
	if (!url || e.record.getString('role') !== 'pending') return;

	const email = e.record.email();
	const name = e.record.getString('name');
	const text =
		'🛎️ CozyNights: neue Admin-Zugangsanfrage von ' +
		(name ? name + ' <' + email + '>' : email) +
		'\nFreigeben: ./scripts/cozy-admin.sh approve ' +
		email +
		'\n(oder PocketBase-Dashboard → admins → role)';

	// Payload shape per service; Google Chat rejects unknown fields.
	let body = { text: text };
	if (url.indexOf('https://api.telegram.org/') === 0) {
		const match = /[?&]chat_id=([^&]+)/.exec(url);
		body = { chat_id: match ? decodeURIComponent(match[1]) : '', text: text };
	} else if (/^https:\/\/(discord|discordapp)\.com\//.test(url)) {
		body = { content: text };
	}

	try {
		const res = $http.send({
			url: url,
			method: 'POST',
			body: JSON.stringify(body),
			headers: { 'content-type': 'application/json' },
			timeout: 5
		});
		if (res.statusCode >= 300) {
			console.warn('[cozy-admin] access request webhook answered HTTP ' + res.statusCode);
		}
	} catch (err) {
		// A notification problem must never break the sign-in.
		console.warn('[cozy-admin] access request webhook failed: ' + err);
	}
}, 'admins');

// Second barrier, independent of pb_hooks/admins_oauth_guard.pb.js: however a
// record gets created (OAuth2 sign-in, dashboard, CLI), it must belong to the
// Workspace domain and start without rights. Approval is always a later update
// by a superuser (updateRule is null). If the guard file ever failed to load,
// this still keeps foreign or self-elevated accounts out.
onRecordCreate((e) => {
	const domain = 'mauersegler.art';
	const email = String(e.record.email() || '').toLowerCase();
	if (!email.endsWith('@' + domain)) {
		throw new BadRequestError('Admin accounts must use an @' + domain + ' address.');
	}
	if (e.record.getString('role') !== 'pending') {
		throw new BadRequestError('New admin accounts start as pending and are approved afterwards.');
	}
	e.next();
}, 'admins');
