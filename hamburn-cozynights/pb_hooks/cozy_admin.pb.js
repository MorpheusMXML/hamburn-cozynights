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
//    The same command manages the ticket roster (collection `orders`), because
//    the app has no import for it. A ticket needs only its code in
//    `order_number`: the app stores the keyed lookup hash on the first sign-in
//    (BookingService.getOrderByNumber). The hash needs the app's
//    ENCRYPTION_KEY, which this container never sees.
//
//      cozy-admin tickets add <code> [<code> ...] [--name <label>]   create ticket codes
//      cozy-admin tickets generate <count> [--prefix TEST] [--name <label>]
//                                                 create random codes like TEST-7F3K9Q
//      cozy-admin tickets list                    ticket codes, sign-ins, booked beds
//      cozy-admin tickets remove <code> [<code> ...]  delete tickets that hold no bed
//
// 2. On every start, sync the Google OAuth client of the `admins` collection
//    from PB_GOOGLE_CLIENT_ID / PB_GOOGLE_CLIENT_SECRET (so rotating the secret
//    is an .env change + restart, not a new migration).
//
// 3. When a sign-in creates an access request, post a notification to
//    COZY_ADMIN_WEBHOOK_URL (optional; Telegram, Slack, Google Chat, Discord).

const ADMIN_DOMAIN = 'mauersegler.art';
const MIN_SUPERUSER_PASSWORD = 12;
// Must match the guest login form (src/routes/+page.server.ts), otherwise a
// stored code could never be typed in.
const TICKET_CODE_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;
// Generated codes get typed on phones and read out loud: no 0/O, 1/I/L.
const TICKET_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const TICKET_RANDOM_LENGTH = 6;
const MAX_GENERATED_TICKETS = 500;
const MAX_TICKET_LABEL = 100;

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

function cozyCollection(cmd, name) {
	try {
		return $app.findCollectionByNameOrId(name);
	} catch (_) {
		cozyFail(
			cmd,
			'collection "' +
				name +
				'" not found — the migrations have not run yet (start the server once, or run `pocketbase migrate up --dir=/pb_data`)'
		);
	}
}

function cozyAdminsCollection(cmd) {
	return cozyCollection(cmd, 'admins');
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
	short:
		'Manage CozyNights admin access (admins collection + PocketBase superusers) and ticket codes'
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

// --- ticket roster (collection `orders`) -------------------------------------

function cozyTicketLabel(cmd) {
	const label = String(cmd.flags().getString('name') || '').trim();
	if (label.length > MAX_TICKET_LABEL) {
		cozyFail(cmd, '--name must be at most ' + MAX_TICKET_LABEL + ' characters');
	}
	return label;
}

// The helpers take the app so that they also work on a transaction.
function cozyFindTicket(app, code) {
	try {
		return app.findFirstRecordByData('orders', 'order_number', code);
	} catch (_) {
		return null;
	}
}

// The sign-in field shows every code in capitals, and the login also tries the
// typed code in upper and lower case (src/routes/+page.server.ts): two codes
// that differ only in case would let one guest end up in the other's ticket.
function cozyFindTicketsIgnoringCase(app, code) {
	return app.findAllRecords(
		'orders',
		$dbx.exp('LOWER([[order_number]]) = {:code}', { code: code.toLowerCase() })
	);
}

function cozyNewTicket(app, collection, code, label) {
	const rec = new Record(collection);
	rec.set('order_number', code);
	rec.set('customer_name', label || 'Ticket ' + code);
	app.save(rec);
}

function cozyBedOfTicket(app, ticketId) {
	const beds = app.findRecordsByFilter('beds', 'order = {:order}', '', 1, 0, { order: ticketId });
	return beds.length > 0 ? beds[0] : null;
}

function cozyDescribeBed(app, bed) {
	let where = 'bed "' + bed.getString('label') + '"';
	try {
		const room = app.findRecordById('rooms', bed.getString('room'));
		where += ' in room "' + room.getString('name') + '"';
		const house = app.findRecordById('houses', room.getString('house'));
		where += ', house "' + house.getString('name') + '"';
	} catch (_) {
		// A dangling relation must not hide the refusal; the label has to do.
	}
	return where;
}

const cozyTickets = new Command({
	use: 'tickets',
	short: 'Manage ticket codes (collection orders): add, generate, list, remove',
	run: (cmd, args) => {
		cozyFail(cmd, 'usage: cozy-admin tickets add|generate|list|remove ...');
	}
});

const cozyTicketsAdd = new Command({
	use: 'add <code> [<code> ...]',
	short: 'Create tickets for the given codes (existing codes are left unchanged)',
	run: (cmd, args) => {
		if (args.length < 1) {
			cozyFail(cmd, 'usage: cozy-admin tickets add <code> [<code> ...] [--name <label>]');
		}
		const collection = cozyCollection(cmd, 'orders');
		const label = cozyTicketLabel(cmd);
		const codes = args.map((a) => String(a));
		const invalid = codes.filter((code) => !TICKET_CODE_PATTERN.test(code));
		if (invalid.length > 0) {
			cozyFail(
				cmd,
				'invalid ticket code: ' +
					invalid.join(', ') +
					' — allowed are letters, digits, "-" and "_", 1 to 64 characters (nothing was created)'
			);
		}

		// Reported only after the commit: a failed save rolls everything back.
		const report = [];
		let conflict = '';
		try {
			$app.runInTransaction((txApp) => {
				for (const code of codes) {
					// Also catches a code that is given twice.
					const twins = cozyFindTicketsIgnoringCase(txApp, code);
					if (twins.length === 0) {
						cozyNewTicket(txApp, collection, code, label);
						const mixedCase = code !== code.toUpperCase() && code !== code.toLowerCase();
						report.push(
							'created: ' +
								code +
								(mixedCase
									? ' (note: mixes upper and lower case — guests have to type it exactly like this)'
									: '')
						);
					} else if (twins.filter((t) => t.getString('order_number') === code).length > 0) {
						report.push('unchanged: ' + code + ' already exists');
					} else {
						conflict =
							code +
							' differs only in upper/lower case from the existing ticket ' +
							twins[0].getString('order_number') +
							' (the sign-in could mix them up)';
						throw new Error(conflict);
					}
				}
			});
		} catch (err) {
			cozyFail(cmd, 'nothing was created: ' + (conflict || err));
		}
		for (const line of report) cmd.println(line);
	}
});
cozyTicketsAdd
	.flags()
	.string('name', '', 'customer_name of the new tickets (default "Ticket <code>")');
cozyTickets.addCommand(cozyTicketsAdd);

const cozyTicketsGenerate = new Command({
	use: 'generate <count>',
	short: 'Create <count> tickets with random codes like TEST-7F3K9Q and print the codes',
	run: (cmd, args) => {
		if (args.length !== 1) {
			cozyFail(cmd, 'usage: cozy-admin tickets generate <count> [--prefix TEST] [--name <label>]');
		}
		const count = /^[0-9]{1,4}$/.test(String(args[0])) ? parseInt(args[0], 10) : 0;
		if (count < 1 || count > MAX_GENERATED_TICKETS) {
			cozyFail(cmd, '<count> must be a number from 1 to ' + MAX_GENERATED_TICKETS);
		}
		// All capitals, like the sign-in form shows them.
		const prefix = String(cmd.flags().getString('prefix')).toUpperCase();
		if (!/^[A-Z0-9][A-Z0-9_-]{0,19}$/.test(prefix)) {
			cozyFail(
				cmd,
				'--prefix must be 1 to 20 letters, digits, "-" or "_" and start with a letter or digit'
			);
		}
		const collection = cozyCollection(cmd, 'orders');
		const label = cozyTicketLabel(cmd);

		const codes = [];
		try {
			$app.runInTransaction((txApp) => {
				// Collisions are practically impossible (31^6 codes per prefix);
				// the cap only keeps a bug from looping forever.
				let attempts = 0;
				while (codes.length < count) {
					if (++attempts > count * 10) {
						throw new Error('could not find enough unused codes for prefix ' + prefix);
					}
					const code =
						prefix +
						'-' +
						$security.randomStringWithAlphabet(TICKET_RANDOM_LENGTH, TICKET_ALPHABET);
					if (cozyFindTicketsIgnoringCase(txApp, code).length > 0) continue;
					cozyNewTicket(txApp, collection, code, label);
					codes.push(code);
				}
			});
		} catch (err) {
			cozyFail(cmd, 'nothing was created: ' + err);
		}
		cmd.println(
			'created ' +
				codes.length +
				' ticket(s), customer_name ' +
				(label ? '"' + label + '"' : '"Ticket <code>"') +
				' — the code is all a guest needs to sign in:'
		);
		for (const code of codes) cmd.println(code);
	}
});
cozyTicketsGenerate.flags().string('prefix', 'TEST', 'first part of every code (in capitals)');
cozyTicketsGenerate
	.flags()
	.string('name', '', 'customer_name of the new tickets (default "Ticket <code>")');
cozyTickets.addCommand(cozyTicketsGenerate);

cozyTickets.addCommand(
	new Command({
		use: 'list',
		short: 'List ticket codes with sign-in and booking state (never burner names)',
		run: (cmd, args) => {
			if (args.length !== 0) cozyFail(cmd, 'usage: cozy-admin tickets list');
			cozyCollection(cmd, 'orders');
			const tickets = $app.findRecordsByFilter('orders', "id != ''", 'order_number', 0, 0);
			const booked = {};
			for (const bed of $app.findRecordsByFilter('beds', "order != ''", '', 0, 0)) {
				booked[bed.getString('order')] = true;
			}

			const readable = tickets.filter((t) => t.getString('order_number') !== '');
			// Capped, so that one very long code doesn't push all columns off screen.
			let width = 0;
			for (const t of readable) {
				width = Math.min(24, Math.max(width, t.getString('order_number').length));
			}

			cmd.println(
				'TICKETS: ' +
					tickets.length +
					' total, ' +
					tickets.filter((t) => booked[t.id]).length +
					' hold a bed, ' +
					tickets.filter((t) => t.getString('order_hash') !== '').length +
					' used'
			);
			cmd.println('CODES (used = signed in at least once, i.e. the lookup hash is stored)');
			if (readable.length === 0) cmd.println('  (none)');
			for (const t of readable) {
				cmd.println(
					'  ' +
						t.getString('order_number').padEnd(width) +
						'  used=' +
						(t.getString('order_hash') !== '' ? 'yes' : 'no ') +
						'  bed=' +
						(booked[t.id] ? 'yes' : 'no ') +
						'  ' +
						t.getString('customer_name')
				);
			}
			if (readable.length < tickets.length) {
				cmd.println(
					'  (+ ' +
						(tickets.length - readable.length) +
						' stored as hash only: their codes cannot be shown)'
				);
			}
		}
	})
);

cozyTickets.addCommand(
	new Command({
		use: 'remove <code> [<code> ...]',
		short: 'Delete tickets that hold no bed',
		run: (cmd, args) => {
			if (args.length < 1) cozyFail(cmd, 'usage: cozy-admin tickets remove <code> [<code> ...]');
			cozyCollection(cmd, 'orders');

			let kept = 0;
			for (const arg of args) {
				const code = String(arg);
				let outcome = '';
				try {
					// Check and delete together: a guest could book in between.
					$app.runInTransaction((txApp) => {
						const ticket = cozyFindTicket(txApp, code);
						if (!ticket) {
							outcome = 'not found: ' + code;
							return;
						}
						const bed = cozyBedOfTicket(txApp, ticket.id);
						if (bed) {
							outcome =
								'refused: ' +
								code +
								' holds ' +
								cozyDescribeBed(txApp, bed) +
								' — free it in the admin area first (room page, or "clear all bookings")';
							return;
						}
						txApp.delete(ticket);
					});
				} catch (err) {
					outcome = 'failed: ' + code + ' — ' + err;
				}
				if (outcome) kept++;
				cmd.println(outcome || 'removed: ' + code);
			}
			if (kept > 0) {
				cmd.println('error: ' + kept + ' of ' + args.length + ' ticket(s) were not removed');
				$os.exit(1);
			}
		}
	})
);

cozyAdmin.addCommand(cozyTickets);

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
