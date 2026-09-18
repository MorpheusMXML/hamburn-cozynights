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
//      cozy-admin tickets add <code> [<code> ...] [--name <label>] [--email <address>]
//                                                 create ticket codes (--email: one code only)
//      cozy-admin tickets import <file.csv|->     create/update tickets with e-mail addresses
//                                                 from a CSV roster (code, email, name)
//      cozy-admin tickets generate <count> [--prefix TEST] [--name <label>]
//                                                 create random codes like TEST-7F3K9Q
//      cozy-admin tickets list                    ticket codes, sign-ins, booked beds, contacts
//      cozy-admin tickets remove <code> [<code> ...]  delete tickets that hold no bed
//      cozy-admin tickets forget-contacts --yes   after the event: delete all guest e-mail
//                                                 addresses, Telegram links and
//                                                 special-needs requests
//
//    Notifications (pb_hooks/cozy_notify.pb.js):
//
//      cozy-admin notify status                   what is configured, what is queued
//      cozy-admin notify test [--email <address>] crew chat test message (+ test e-mail)
//
// 2. On every start, sync the Google OAuth client of the `admins` collection
//    from PB_GOOGLE_CLIENT_ID / PB_GOOGLE_CLIENT_SECRET (so rotating the secret
//    is an .env change + restart, not a new migration).
//
// Notifications about access requests and admin changes: pb_hooks/cozy_notify.pb.js.

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
// Close to what PocketBase's email field accepts (orders.email).
const GUEST_EMAIL_PATTERN =
	/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;
const MAX_IMPORT_PROBLEMS_SHOWN = 20;

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
	// Read by pb_hooks/cozy_notify.pb.js in this process: admin changes made
	// here are reported as done by "cozy-admin".
	$app.store().set('cozy_cli', true);
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
	// An invite, not an access request (pb_hooks/cozy_notify.pb.js).
	$app.store().set('cozy_cli_created', email);
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

function cozyNewTicket(app, collection, code, label, email) {
	const rec = new Record(collection);
	rec.set('order_number', code);
	rec.set('customer_name', label || 'Ticket ' + code);
	if (email) rec.set('email', email);
	app.save(rec);
}

function cozyValidGuestEmail(email) {
	return email.length <= 254 && GUEST_EMAIL_PATTERN.test(email);
}

/** --email of `tickets add`: lower case, checked; '' when not given. */
function cozyTicketEmail(cmd) {
	const email = String(cmd.flags().getString('email') || '')
		.trim()
		.toLowerCase();
	if (email && !cozyValidGuestEmail(email)) cozyFail(cmd, 'invalid e-mail address: ' + email);
	return email;
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
	short: 'Manage ticket codes (collection orders): add, import, generate, list, remove',
	run: (cmd, args) => {
		cozyFail(cmd, 'usage: cozy-admin tickets add|import|generate|list|remove|forget-contacts ...');
	}
});

const cozyTicketsAdd = new Command({
	use: 'add <code> [<code> ...]',
	short: 'Create tickets for the given codes (existing codes are left unchanged)',
	run: (cmd, args) => {
		if (args.length < 1) {
			cozyFail(
				cmd,
				'usage: cozy-admin tickets add <code> [<code> ...] [--name <label>] [--email <address>]'
			);
		}
		const collection = cozyCollection(cmd, 'orders');
		const label = cozyTicketLabel(cmd);
		const email = cozyTicketEmail(cmd);
		const codes = args.map((a) => String(a));
		if (email && codes.length !== 1) {
			cozyFail(
				cmd,
				'--email belongs to one ticket: give exactly one code (a roster: tickets import)'
			);
		}
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
						cozyNewTicket(txApp, collection, code, label, email);
						const mixedCase = code !== code.toUpperCase() && code !== code.toLowerCase();
						report.push(
							'created: ' +
								code +
								(email ? ' (e-mail ' + email + ')' : '') +
								(mixedCase
									? ' (note: mixes upper and lower case — guests have to type it exactly like this)'
									: '')
						);
					} else if (twins.filter((t) => t.getString('order_number') === code).length > 0) {
						report.push(
							'unchanged: ' +
								code +
								' already exists' +
								(email ? ' (to change its e-mail address: tickets import)' : '')
						);
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
cozyTicketsAdd
	.flags()
	.string('email', '', "the ticket holder's e-mail address for booking confirmations");
cozyTickets.addCommand(cozyTicketsAdd);

// --- tickets import: the roster with e-mail addresses -------------------------

/** A CSV file as rows of fields; the delimiter (, ; or tab) is taken from the header. */
function cozyParseCsv(text) {
	const src = String(text).replace(/^﻿/, '');
	const header = src.split(/\r?\n/, 1)[0] || '';
	const counts = { ',': 0, ';': 0, '\t': 0 };
	let quoted = false;
	for (let i = 0; i < header.length; i++) {
		const c = header.charAt(i);
		if (c === '"') quoted = !quoted;
		else if (!quoted && counts[c] !== undefined) counts[c]++;
	}
	let delimiter = ',';
	if (counts[';'] > counts[delimiter]) delimiter = ';';
	if (counts['\t'] > counts[delimiter]) delimiter = '\t';

	const rows = [];
	let row = [];
	let field = '';
	quoted = false;
	for (let i = 0; i < src.length; i++) {
		const c = src.charAt(i);
		if (quoted) {
			if (c === '"' && src.charAt(i + 1) === '"') {
				field += '"';
				i++;
			} else if (c === '"') {
				quoted = false;
			} else {
				field += c;
			}
		} else if (c === '"') {
			quoted = true;
		} else if (c === delimiter) {
			row.push(field);
			field = '';
		} else if (c === '\n') {
			row.push(field);
			rows.push(row);
			row = [];
			field = '';
		} else if (c !== '\r') {
			field += c;
		}
	}
	if (field !== '' || row.length > 0) {
		row.push(field);
		rows.push(row);
	}
	return rows.filter((r) => r.some((f) => String(f).trim() !== ''));
}

const CSV_COLUMNS = {
	code: [
		'code',
		'ticket',
		'ticket code',
		'ticketcode',
		'order',
		'order code',
		'order number',
		'secret'
	],
	email: ['email', 'e-mail', 'mail', 'email address', 'e-mail address', 'attendee email'],
	name: ['name', 'customer name', 'attendee', 'attendee name', 'full name']
};

function cozyCsvColumns(header) {
	const names = header.map((h) =>
		String(h)
			.trim()
			.toLowerCase()
			.replace(/[_\s]+/g, ' ')
	);
	const columns = {};
	for (const key of Object.keys(CSV_COLUMNS)) {
		columns[key] = names.findIndex((n) => CSV_COLUMNS[key].indexOf(n) >= 0);
	}
	return columns;
}

const cozyTicketsImport = new Command({
	use: 'import <file.csv|->',
	short: 'Create or update tickets from a CSV roster: columns code, email and optionally name',
	run: (cmd, args) => {
		if (args.length !== 1)
			cozyFail(cmd, 'usage: cozy-admin tickets import <file.csv|-> [--dry-run]');
		const collection = cozyCollection(cmd, 'orders');
		const fromStdin = String(args[0]) === '-';
		let text;
		try {
			text = toString($os.readFile(fromStdin ? '/dev/stdin' : String(args[0])));
		} catch (err) {
			cozyFail(cmd, 'cannot read ' + (fromStdin ? 'the standard input' : args[0]) + ': ' + err);
		}

		const rows = cozyParseCsv(text);
		if (rows.length < 2) cozyFail(cmd, 'the file needs a header row and at least one ticket');
		const cols = cozyCsvColumns(rows[0]);
		if (cols.code < 0 || cols.email < 0) {
			cozyFail(
				cmd,
				'the header needs a ticket code column ("code") and an e-mail column ("email"), found: ' +
					rows[0].join(' | ')
			);
		}

		// Check everything first: nothing is imported from a file with problems.
		const problems = [];
		const entries = [];
		const lineOfCode = {};
		for (let r = 1; r < rows.length; r++) {
			const line = r + 1;
			const cell = (idx) => (idx >= 0 && idx < rows[r].length ? String(rows[r][idx]).trim() : '');
			const code = cell(cols.code).replace(/[​-‍﻿]/g, '');
			const email = cell(cols.email).toLowerCase();
			const name = cell(cols.name);
			if (!TICKET_CODE_PATTERN.test(code)) {
				problems.push('line ' + line + ': invalid ticket code "' + code + '"');
			} else if (email && !cozyValidGuestEmail(email)) {
				problems.push('line ' + line + ': invalid e-mail address "' + email + '"');
			} else if (name.length > MAX_TICKET_LABEL) {
				problems.push('line ' + line + ': name longer than ' + MAX_TICKET_LABEL + ' characters');
			} else if (lineOfCode[code.toLowerCase()]) {
				problems.push(
					'line ' +
						line +
						': ticket code ' +
						code +
						' is also on line ' +
						lineOfCode[code.toLowerCase()]
				);
			} else {
				lineOfCode[code.toLowerCase()] = line;
				entries.push({ line: line, code: code, email: email, name: name });
			}
		}
		if (problems.length > 0) {
			for (const p of problems.slice(0, MAX_IMPORT_PROBLEMS_SHOWN)) cmd.println(p);
			if (problems.length > MAX_IMPORT_PROBLEMS_SHOWN) {
				cmd.println('… and ' + (problems.length - MAX_IMPORT_PROBLEMS_SHOWN) + ' more');
			}
			cozyFail(cmd, problems.length + ' problem(s) in the file — nothing was imported');
		}

		const dryRun = cmd.flags().getBool('dry-run');
		const counts = { created: 0, updated: 0, unchanged: 0, confirmations: 0, withoutEmail: 0 };
		let conflict = '';
		try {
			$app.runInTransaction((txApp) => {
				for (const entry of entries) {
					if (!entry.email) counts.withoutEmail++;
					const twins = cozyFindTicketsIgnoringCase(txApp, entry.code);
					const exact = twins.filter((t) => t.getString('order_number') === entry.code)[0];
					if (!exact && twins.length > 0) {
						conflict =
							'line ' +
							entry.line +
							': ' +
							entry.code +
							' differs only in upper/lower case from the existing ticket ' +
							twins[0].getString('order_number');
						throw new Error(conflict);
					}
					if (!exact) {
						cozyNewTicket(txApp, collection, entry.code, entry.name, entry.email);
						counts.created++;
						continue;
					}
					// Empty cells leave the stored value alone.
					let changed = false;
					if (entry.email && exact.getString('email') !== entry.email) {
						exact.set('email', entry.email);
						changed = true;
						if (cozyBedOfTicket(txApp, exact.id)) counts.confirmations++;
					}
					if (entry.name && exact.getString('customer_name') !== entry.name) {
						exact.set('customer_name', entry.name);
						changed = true;
					}
					if (changed) {
						txApp.save(exact);
						counts.updated++;
					} else {
						counts.unchanged++;
					}
				}
				if (dryRun) throw new Error('cozy-dry-run');
			});
		} catch (err) {
			if (String(err).indexOf('cozy-dry-run') < 0) {
				cozyFail(cmd, 'nothing was imported: ' + (conflict || err));
			}
		}

		cmd.println(
			(dryRun ? 'DRY RUN, nothing changed — would have ' : '') +
				'created ' +
				counts.created +
				', updated ' +
				counts.updated +
				', unchanged ' +
				counts.unchanged +
				' ticket(s)'
		);
		if (counts.confirmations > 0) {
			cmd.println(
				'  ' +
					counts.confirmations +
					' of the updated tickets hold a spot: their new address gets a confirmation'
			);
		}
		if (counts.withoutEmail > 0) {
			cmd.println('  ' + counts.withoutEmail + ' line(s) without an e-mail address');
		}
		const codesByEmail = {};
		for (const entry of entries) {
			if (entry.email)
				(codesByEmail[entry.email] = codesByEmail[entry.email] || []).push(entry.code);
		}
		const shared = Object.keys(codesByEmail).filter((e) => codesByEmail[e].length > 1);
		if (shared.length > 0) {
			cmd.println(
				'  note: ' +
					shared.length +
					' address(es) belong to more than one ticket (each ticket gets its own messages), e.g. ' +
					shared[0] +
					': ' +
					codesByEmail[shared[0]].join(', ')
			);
		}
		const others =
			$app.countRecords('orders') - (dryRun ? counts.updated + counts.unchanged : entries.length);
		if (others > 0) {
			cmd.println(
				'  ' + others + ' ticket(s) in the database are not in this file (left unchanged)'
			);
		}
	}
});
cozyTicketsImport
	.flags()
	.bool('dry-run', false, 'check the file and show what would change, without changing anything');
cozyTickets.addCommand(cozyTicketsImport);

cozyTickets.addCommand(
	(() => {
		const forget = new Command({
			use: 'forget-contacts',
			short:
				'After the event: delete every e-mail address, Telegram link and special-needs request of the tickets',
			run: (cmd, args) => {
				if (args.length !== 0 || !cmd.flags().getBool('yes')) {
					cozyFail(
						cmd,
						'this deletes the e-mail address of every ticket, every Telegram link and every special-needs request (ticket codes and bookings stay) — run it with --yes'
					);
				}
				cozyCollection(cmd, 'guest_notify');
				cozyCollection(cmd, 'special_requests');
				let emails = 0;
				let links = 0;
				let requests = 0;
				$app.runInTransaction((txApp) => {
					for (const t of txApp.findRecordsByFilter('orders', "email != ''", '', 0, 0)) {
						t.set('email', '');
						txApp.save(t);
						emails++;
					}
					// What guests wrote about their needs (often health data) goes too.
					for (const r of txApp.findRecordsByFilter('special_requests', "id != ''", '', 0, 0)) {
						txApp.delete(r);
						requests++;
					}
					for (const n of txApp.findRecordsByFilter('guest_notify', "id != ''", '', 0, 0)) {
						if (n.getString('tg_chat')) links++;
						txApp.delete(n);
					}
				});
				cmd.println(
					'deleted ' +
						emails +
						' e-mail address(es), ' +
						links +
						' Telegram link(s) and ' +
						requests +
						' special-needs request(s); the ticket codes and bookings are kept'
				);
			}
		});
		forget.flags().bool('yes', false, 'really delete them');
		return forget;
	})()
);

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

			const telegram = {};
			try {
				for (const n of $app.findRecordsByFilter('guest_notify', "tg_chat != ''", '', 0, 0)) {
					telegram[n.getString('order')] = true;
				}
			} catch (_) {
				// before the notifications migration
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
					' used, ' +
					tickets.filter((t) => t.getString('email') !== '').length +
					' with e-mail, ' +
					Object.keys(telegram).length +
					' with Telegram'
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
						'  tg=' +
						(telegram[t.id] ? 'yes' : 'no ') +
						'  ' +
						t.getString('customer_name') +
						(t.getString('email') ? '  <' + t.getString('email') + '>' : '')
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

// --- notifications -------------------------------------------------------------

function cozyNotifyModule() {
	return require(`${__hooks}/lib/notify.js`);
}

function cozyCount(collection, filter) {
	try {
		return $app.findRecordsByFilter(collection, filter, '', 0, 0).length;
	} catch (_) {
		return 0; // before the notifications migration
	}
}

const cozyNotify = new Command({
	use: 'notify',
	short: 'Notifications (guest e-mail, Telegram): status and test messages',
	run: (cmd, args) => {
		cozyFail(cmd, 'usage: cozy-admin notify status|test');
	}
});

cozyNotify.addCommand(
	new Command({
		use: 'status',
		short: 'Show what is configured, what is queued and the latest admin events',
		run: (cmd, args) => {
			const notify = cozyNotifyModule();
			const cfg = notify.config($app);
			const settings = $app.settings();
			cmd.println(
				'E-MAIL TO GUESTS   ' +
					(cfg.mail.enabled
						? 'on: ' +
							settings.smtp.host +
							':' +
							settings.smtp.port +
							', from "' +
							settings.meta.senderName +
							'" <' +
							settings.meta.senderAddress +
							'>'
						: 'off (SMTP_HOST / MAIL_FROM_ADDRESS not set)')
			);
			let crew = 'off (TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID not set)';
			if (cfg.telegram.token && cfg.telegram.chatId) {
				crew =
					'Telegram chat ' +
					cfg.telegram.chatId +
					(cfg.telegram.threadId ? ' (topic ' + cfg.telegram.threadId + ')' : '');
			} else if (cfg.legacyWebhook) {
				crew = 'webhook COZY_ADMIN_WEBHOOK_URL';
			}
			cmd.println('CREW CHAT          ' + crew);
			if (cfg.telegram.token) {
				const me = notify.telegramCall(cfg, 'getMe', {}, 10);
				cmd.println(
					'TELEGRAM BOT       ' +
						(me.ok ? '@' + me.result.username : 'FAILED: ' + me.status + ' ' + me.description) +
						', guest updates ' +
						(cfg.telegram.guests ? 'on' : 'off (TELEGRAM_GUEST_UPDATES=off)')
				);
				const hook = notify.telegramCall(cfg, 'getWebhookInfo', {}, 10);
				if (hook.ok && hook.result && hook.result.url) {
					cmd.println(
						'  WARNING: this bot has a webhook, so the server cannot read guest messages — remove it (Bot API deleteWebhook)'
					);
				}
			}
			cmd.println('APP URL IN LINKS   ' + (cfg.appUrl || '(not set: set COZY_APP_URL)'));
			cmd.println(
				'GUESTS             ' +
					cozyCount('orders', "email != ''") +
					' ticket(s) with e-mail, ' +
					cozyCount('guest_notify', "tg_chat != ''") +
					' with Telegram; queued ' +
					cozyCount('guest_notify', "due != ''") +
					', retrying ' +
					cozyCount('guest_notify', "due != '' && attempts > 0")
			);
			cmd.println(
				'CREW ALERTS        ' +
					cozyCount('admin_events', "alert_status = 'pending'") +
					' queued, ' +
					cozyCount('admin_events', "alert_status = 'failed'") +
					' failed'
			);
			let events = [];
			try {
				events = $app.findRecordsByFilter('admin_events', "id != ''", '-created', 8, 0);
			} catch (_) {
				// before the notifications migration
			}
			cmd.println('LATEST ADMIN EVENTS');
			if (events.length === 0) cmd.println('  (none)');
			for (const ev of events) {
				cmd.println(
					'  ' +
						String(ev.getString('created')).slice(0, 16) +
						'  ' +
						ev.getString('action').padEnd(22) +
						' ' +
						(ev.getString('actor') || '-') +
						(ev.getString('subject') ? ' → ' + ev.getString('subject') : '') +
						'  [alert ' +
						ev.getString('alert_status') +
						']'
				);
			}
		}
	})
);

const cozyNotifyTest = new Command({
	use: 'test',
	short: 'Send a test message to the crew chat and, with --email, a test e-mail',
	run: (cmd, args) => {
		const notify = cozyNotifyModule();
		const cfg = notify.config($app);
		let failed = 0;

		if (notify.crewConfigured(cfg)) {
			const r = notify.crewSend(
				cfg,
				'🧪 Test message from cozy-admin notify test' + (cfg.appUrl ? ' (' + cfg.appUrl + ')' : '')
			);
			if (r.ok) {
				cmd.println('crew chat: sent');
			} else {
				failed++;
				cmd.println('crew chat: FAILED — ' + r.error);
				if (/^401\b/.test(r.error)) {
					cmd.println('  the bot token is wrong (TELEGRAM_BOT_TOKEN)');
				} else if (/chat not found|^403\b/.test(r.error)) {
					cmd.println('  the bot is not a member of that chat, or TELEGRAM_CHAT_ID is wrong');
				}
			}
		} else {
			cmd.println('crew chat: not configured (TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID)');
		}

		const to = String(cmd.flags().getString('email') || '')
			.trim()
			.toLowerCase();
		if (to) {
			if (!cfg.mail.enabled) {
				failed++;
				cmd.println('e-mail: not configured (SMTP_HOST, MAIL_FROM_ADDRESS)');
			} else {
				try {
					notify.sendMail($app, cfg, to, {
						subject: (cfg.label ? '[' + cfg.label + '] ' : '') + 'CozyNights test e-mail',
						text: 'This is a test e-mail from cozy-admin notify test. Guest confirmations look different.',
						html: '<p>This is a test e-mail from <code>cozy-admin notify test</code>. Guest confirmations look different.</p>'
					});
					cmd.println('e-mail: sent to ' + to);
				} catch (err) {
					failed++;
					cmd.println('e-mail: FAILED — ' + notify.safeError(err));
				}
			}
		}
		if (failed > 0) $os.exit(1);
	}
});
cozyNotifyTest.flags().string('email', '', 'also send a test e-mail to this address');
cozyNotify.addCommand(cozyNotifyTest);

cozyAdmin.addCommand(cozyNotify);

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
