/// <reference path="../pb_data/types.d.ts" />
//
// Notifications — the hooks (docs/admin/notifications.md). The logic lives in
// pb_hooks/lib/notify.js; handlers run in isolated VMs, so each one requires
// it itself. Nothing in here may throw into the operation it watches: a
// notification problem must never break a booking, a sign-in or an admin
// action.
//
// 1. SMTP settings from the environment (SMTP_*, MAIL_FROM_*), like the
//    Google client: config as code, applied on every start.
// 2. Guests: every change of a bed's ticket (booking, move, release, admin
//    changes, deleted rooms/houses, template import) marks the ticket as due.
//    So does a new e-mail address on a ticket.
// 3. Crew: admin access changes, admin sign-ins and booking phase changes
//    become admin_events; their Telegram alerts go out with the next run.
//    (last_sign_in for the weekly re-sign-in: pb_hooks/admins_oauth_guard.pb.js)
// 4. A cron job delivers: e-mail, Telegram messages, crew alerts, and reads
//    the bot's incoming messages (guests linking their chat).
// 5. POST /api/cozy/notify/flush (superusers only): one run right now, for
//    the tests.

// --- 1. SMTP ------------------------------------------------------------------

onBootstrap((e) => {
	e.next();
	try {
		const notify = require(`${__hooks}/lib/notify.js`);
		const applied = notify.applyMailSettings(e.app);
		if (applied) console.log('[cozy-notify] SMTP settings applied: ' + applied);
		// Tell the guest pages right away whether e-mail is on (no network here;
		// the bot's name follows with the first delivery run, and on a fresh
		// database the migrations only run after this).
		notify.refreshCapabilities(e.app, notify.config(e.app), true);
	} catch (err) {
		// A bad value must never keep PocketBase from starting.
		console.error('[cozy-notify] SMTP settings not applied: ' + err);
	}
});

// --- 2. guests: what changed ----------------------------------------------------

onRecordCreate((e) => {
	e.next();
	const order = e.record.getString('order');
	if (!order) return;
	try {
		require(`${__hooks}/lib/notify.js`).markDue(e.app, order);
	} catch (err) {
		console.error('[cozy-notify] new bed ' + e.record.id + ': ' + err);
	}
}, 'beds');

onRecordUpdate((e) => {
	let before = null;
	try {
		before = require(`${__hooks}/lib/notify.js`).storedValue(e.app, e.record, 'order');
	} catch (err) {
		console.error('[cozy-notify] bed ' + e.record.id + ': ' + err);
	}
	e.next();
	if (before === null) return;
	const after = e.record.getString('order');
	if (before === after) return;
	try {
		const notify = require(`${__hooks}/lib/notify.js`);
		notify.markDue(e.app, before);
		notify.markDue(e.app, after);
	} catch (err) {
		console.error('[cozy-notify] bed ' + e.record.id + ': ' + err);
	}
}, 'beds');

// Also runs for beds that go with a deleted room or house (cascade).
onRecordDelete((e) => {
	const order = e.record.getString('order');
	e.next();
	if (!order) return;
	try {
		require(`${__hooks}/lib/notify.js`).markDue(e.app, order);
	} catch (err) {
		console.error('[cozy-notify] deleted bed ' + e.record.id + ': ' + err);
	}
}, 'beds');

// A (re-)imported address gets told about the ticket's current spot.
onRecordUpdate((e) => {
	let before = null;
	try {
		before = require(`${__hooks}/lib/notify.js`).storedValue(e.app, e.record, 'email');
	} catch (err) {
		console.error('[cozy-notify] ticket ' + e.record.id + ': ' + err);
	}
	e.next();
	if (before === null) return;
	const after = e.record.getString('email');
	if (before === after || !after) return;
	try {
		require(`${__hooks}/lib/notify.js`).markDue(e.app, e.record.id, { now: true });
	} catch (err) {
		console.error('[cozy-notify] ticket ' + e.record.id + ': ' + err);
	}
}, 'orders');

// --- 3. crew: admin accounts -----------------------------------------------------
//
// The cozy-admin CLI runs in its own process and leaves markers in that
// process's store: `cozy_cli` (actor "cozy-admin") and `cozy_cli_created`
// (the email it just created — an invite, not an access request).

onRecordCreate((e) => {
	e.next();
	if (e.record.getString('role') !== 'pending') return;
	const email = e.record.email();
	if (e.app.store().get('cozy_cli_created') === email) return; // invite: see the update
	try {
		require(`${__hooks}/lib/notify.js`).logEvent(e.app, 'access_request', {
			actor: email,
			subject: email,
			details: { name: e.record.getString('name') }
		});
	} catch (err) {
		console.error('[cozy-notify] access request ' + email + ': ' + err);
	}
}, 'admins');

onRecordUpdate((e) => {
	let before = null;
	try {
		before = require(`${__hooks}/lib/notify.js`).storedValue(e.app, e.record, 'role');
	} catch (err) {
		console.error('[cozy-notify] admin ' + e.record.id + ': ' + err);
	}
	e.next();
	if (before === null) return;
	const after = e.record.getString('role');
	if (before === after) return;
	const store = e.app.store();
	const email = e.record.email();
	const invited = store.get('cozy_cli_created') === email;
	if (invited) store.remove('cozy_cli_created');
	let action = 'role_changed';
	if (before === 'pending') action = invited ? 'access_invited' : 'access_approved';
	try {
		require(`${__hooks}/lib/notify.js`).logEvent(e.app, action, {
			actor: store.get('cozy_cli') ? 'cozy-admin' : 'dashboard',
			subject: email,
			details: { from: before, to: after, role: after }
		});
	} catch (err) {
		console.error('[cozy-notify] role change ' + email + ': ' + err);
	}
}, 'admins');

onRecordDelete((e) => {
	const email = e.record.email();
	const role = e.record.getString('role');
	e.next();
	try {
		require(`${__hooks}/lib/notify.js`).logEvent(e.app, 'access_removed', {
			actor: e.app.store().get('cozy_cli') ? 'cozy-admin' : 'dashboard',
			subject: email,
			details: { role: role }
		});
	} catch (err) {
		console.error('[cozy-notify] removal ' + email + ': ' + err);
	}
}, 'admins');

// Runs inside the guard of pb_hooks/admins_oauth_guard.pb.js (loaded first),
// which also records last_sign_in for the weekly re-sign-in.
onRecordAuthWithOAuth2Request((e) => {
	e.next();
	if (!e.record) return;
	const role = e.record.getString('role');
	if (role !== 'admin' && role !== 'superuser') return;
	try {
		require(`${__hooks}/lib/notify.js`).logEvent(e.app, 'admin_sign_in', {
			actor: e.record.email(),
			subject: e.record.email(),
			details: { name: e.record.getString('name'), role: role }
		});
	} catch (err) {
		console.error('[cozy-notify] sign-in of ' + e.record.email() + ': ' + err);
	}
}, 'admins');

// --- 3. crew: booking phase ------------------------------------------------------
//
// The admin area changes app_settings with the admin's own token, so the
// request knows who it was (e.auth). Compared on the *effective* state, like
// src/lib/server/settings.ts: an elapsed timer means live.

onRecordUpdateRequest((e) => {
	const old = e.record.original();
	const before = {
		active: old.getBool('is_booking_active'),
		timer: old.getString('booking_unlock_at')
	};
	e.next();
	try {
		const notify = require(`${__hooks}/lib/notify.js`);
		const now = Date.now();
		const live = (active, timer) => active || (!!timer && notify.toMs(timer) <= now);
		const after = {
			active: e.record.getBool('is_booking_active'),
			timer: e.record.getString('booking_unlock_at')
		};
		const actor = e.auth ? e.auth.email() : 'unknown';
		const wasLive = live(before.active, before.timer);
		const isLive = live(after.active, after.timer);
		if (wasLive !== isLive) {
			notify.logEvent(e.app, isLive ? 'booking_live' : 'booking_closed', { actor: actor });
		}
		if (before.timer !== after.timer) {
			if (after.timer && notify.toMs(after.timer) > now) {
				notify.logEvent(e.app, 'timer_set', { actor: actor, subject: after.timer });
			} else if (!after.timer && before.timer && notify.toMs(before.timer) > now) {
				notify.logEvent(e.app, 'timer_removed', { actor: actor, subject: before.timer });
			}
		}
	} catch (err) {
		console.error('[cozy-notify] booking phase alert: ' + err);
	}
}, 'app_settings');

// Everything that lands in the audit log goes to the crew chat, if there is one.
onRecordCreate((e) => {
	if (!e.record.getString('alert_status')) {
		let crew = false;
		try {
			const notify = require(`${__hooks}/lib/notify.js`);
			crew = notify.crewConfigured(notify.config(e.app));
		} catch (_) {
			// unknown: store it without an alert
		}
		e.record.set('alert_status', crew ? 'pending' : 'off');
	}
	e.next();
}, 'admin_events');

// --- 4. delivery -------------------------------------------------------------------

// Each run repeats short passes for up to COZY_NOTIFY_LOOP_SECONDS (default
// 50): new bookings are confirmed within seconds and the bot answers guests
// right away, without a public webhook endpoint.
cronAdd('cozy_notify', '* * * * *', () => {
	try {
		require(`${__hooks}/lib/notify.js`).runLoop($app);
	} catch (err) {
		console.error('[cozy-notify] ' + err);
	}
});

// --- 5. one run on demand ---------------------------------------------------------

routerAdd(
	'POST',
	'/api/cozy/notify/flush',
	(e) => {
		const notify = require(`${__hooks}/lib/notify.js`);
		// force=1: ignore the settle time and the per-ticket cooldown (tests)
		const force = e.request.url.query().get('force') === '1';
		return e.json(200, notify.flush(e.app, force));
	},
	$apis.requireSuperuserAuth()
);
