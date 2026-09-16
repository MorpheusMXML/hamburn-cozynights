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
//  - a Google-verified email of the Workspace domain (email + `hd` claim),
//  - that matches an admin record provisioned with scripts/cozy-admin.sh.
// Never creates records: uninvited accounts are rejected here (createRule is
// null as a second barrier).
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

	// PocketBase links by exact (case-sensitive) email; invites are stored
	// lowercased, so retry the lookup with the normalized address.
	if (!e.record) {
		try {
			e.record = e.app.findAuthRecordByEmail('admins', email);
			e.isNewRecord = false;
		} catch (_) {
			/* not invited */
		}
	}
	if (!e.record || e.isNewRecord) {
		reject('not invited', 'This account has not been invited as an admin.');
	}
	// An already linked Google account (matched by its stable id) whose email
	// has changed since must not keep access to the old invite.
	if (String(e.record.email()).toLowerCase() !== email) {
		reject(
			'linked account email changed',
			'Google account email does not match the invited admin.'
		);
	}

	e.next();
}, 'admins');
