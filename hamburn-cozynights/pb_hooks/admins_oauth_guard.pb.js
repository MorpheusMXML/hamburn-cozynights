/// <reference path="../pb_data/types.d.ts" />
//
// Admin sign-in guard for the `admins` auth collection.
//
// Kept in its own, deliberately tiny file: PocketBase logs and skips a hooks
// file that throws while loading, and still starts. Nothing else living in
// this file means nothing else can take the guard down with it. The app
// re-checks the same conditions after the code exchange (defense in depth,
// see src/lib/server/admin-auth.ts).
//
// Only allowed through:
//  - provider google,
//  - a Google-verified email of the Workspace domain (email + `hd` claim).
// Then either
//  - the account matches an existing admin record (invited with
//    scripts/cozy-admin.sh, or an earlier access request), or
//  - a new record is created as an ACCESS REQUEST with role `pending`, which
//    has no rights anywhere until a superuser approves it (PocketBase
//    dashboard, or `scripts/cozy-admin.sh approve`). Whatever the client sent
//    as `createData` is discarded, so nobody can request a role for themselves.
//
// Handlers run in isolated VMs, so everything they need is declared inside.

onRecordAuthWithOAuth2Request((e) => {
	const ALLOWED_DOMAIN = 'mauersegler.art';

	const user = e.oAuth2User;
	const email = String((user && user.email) || '')
		.trim()
		.toLowerCase();
	const raw = (user && user.rawUser) || {};
	const hd = String(raw.hd || '').toLowerCase();

	const reject = (reason, message) => {
		console.warn(
			'[admins-guard] rejected sign-in: ' +
				reason +
				' (email domain: ' +
				(email.split('@')[1] || '-') +
				')'
		);
		throw new ForbiddenError(message);
	};

	if (e.providerName !== 'google') {
		reject('provider ' + e.providerName, 'Only Google sign-in is allowed.');
	}
	// PocketBase's Google provider only fills `email` when Google reports it as
	// verified; raw.email_verified is checked explicitly anyway.
	if (!email.endsWith('@' + ALLOWED_DOMAIN) || raw.email_verified !== true) {
		reject(
			'email not a verified @' + ALLOWED_DOMAIN + ' address',
			'Only verified @' + ALLOWED_DOMAIN + ' Google accounts are allowed.'
		);
	}
	if (hd !== ALLOWED_DOMAIN) {
		reject(
			'hd claim "' + hd + '"',
			'Only @' + ALLOWED_DOMAIN + ' Google Workspace accounts are allowed.'
		);
	}

	// PocketBase links by exact (case-sensitive) email; records are stored
	// lowercased, so retry the lookup with the normalized address.
	if (!e.record) {
		try {
			e.record = e.app.findAuthRecordByEmail('admins', email);
			e.isNewRecord = false;
		} catch (_) {
			/* no record yet: access request */
		}
	}

	// When this account last signed in with Google: the app ends the session
	// once that is 7 days ago (src/lib/server/admin-auth.ts). Kept here, next
	// to the sign-in itself, so it doesn't depend on any other hooks file, and
	// written BEFORE the sign-in completes: once e.next() has answered, the
	// browser holds a token, and a sign-in that then failed to be recorded
	// would bounce between the admin area and the login page ("sign in again")
	// without ever saying why. So a failure fails the sign-in instead; the app
	// shows the reason on the login page (src/routes/auth/callback).
	const signedInAt = new Date().toISOString().replace('T', ' ');

	if (e.record && !e.isNewRecord) {
		// An already linked Google account (matched by its stable id) whose email
		// has changed since must not keep access to the old record.
		if (String(e.record.email()).toLowerCase() !== email) {
			reject(
				'linked account email changed',
				'Google account email does not match the admin account.'
			);
		}
		try {
			e.record.set('last_sign_in', signedInAt);
			e.app.save(e.record);
		} catch (err) {
			console.error('[admins-guard] last_sign_in not saved, sign-in refused: ' + err);
			throw new InternalServerError(
				'The sign-in could not be recorded (admins.last_sign_in), so no session was started.',
				{ code: 'sign_in_not_recorded' }
			);
		}
	} else {
		e.createData = {
			email: email,
			emailVisibility: false,
			role: 'pending',
			last_sign_in: signedInAt
		};
	}

	e.next();

	// Belt and braces: a record created by this request is never more than pending.
	if (e.isNewRecord && e.record && e.record.getString('role') !== 'pending') {
		e.record.set('role', 'pending');
		e.app.save(e.record);
	}
	// Should PocketBase have dropped last_sign_in from createData: a pending
	// record has no rights, so writing it late is harmless here (the login page
	// needs it to show "ACCESS REQUESTED").
	if (e.isNewRecord && e.record && !e.record.getString('last_sign_in')) {
		try {
			e.record.set('last_sign_in', signedInAt);
			e.app.save(e.record);
		} catch (err) {
			console.error('[admins-guard] last_sign_in not saved for a new access request: ' + err);
		}
	}
}, 'admins');
