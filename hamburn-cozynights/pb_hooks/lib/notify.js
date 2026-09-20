/// <reference path="../../pb_data/types.d.ts" />
//
// Notifications, shared by pb_hooks/cozy_notify.pb.js and the cozy-admin CLI.
//
// PocketBase runs every hook handler in its own VM, so handlers `require()`
// this module inside the handler; nothing here may rely on file-level state
// of a *.pb.js file. Every function gets the app (or transaction) it works on.
//
// Channels
// - Guests: e-mail to the address imported with their ticket (orders.email),
//   and optionally a Telegram chat they linked themselves (guest_notify.tg_chat).
// - Crew: one Telegram chat (TELEGRAM_CHAT_ID) for admin_events. The older
//   COZY_ADMIN_WEBHOOK_URL (Telegram/Slack/Google Chat/Discord) still works.
//
// Guest messages are state based: a change of a ticket's spot only marks the
// ticket as due (markDue). A delivery run later compares the ticket's current
// spot with what each channel last confirmed and sends one message about the
// difference — a move is "changed", never "released" + "booked". The status of
// a special-needs request works the same way (received, approved, declined).
// Failures are retried with backoff; after the last attempt the crew gets an
// alert. What a guest wrote in a request is encrypted by the app and never
// read here: messages only say what the crew decided.
//
// Every sentence guests get comes from pb_hooks/lib/texts.js; admins change
// them on /admin/messages (collection message_texts). See "message texts".
//
// Secrets: the bot token is part of every Telegram API URL, and Go's HTTP
// errors quote the URL. Every error that could contain a URL goes through
// safeError() before it is logged or stored.

const APP_SETTINGS_ID = 'appsettings0123';

// A change is delivered once the ticket was quiet for this long (a move writes
// two beds; clear-all and imports write many).
const SETTLE_SECONDS = 10;
// Minimum gap between two messages about the same ticket (one message per
// settled state, but no flood when somebody keeps clicking).
const COOLDOWN_SECONDS = 120;
// Guest delivery: retry after 1, 5, 15 minutes, 1, 4, 12 and 24 hours (about two
// days in all, so a provider's daily limit on opening day only delays mail),
// then give up and alert the crew.
const RETRY_MINUTES = [1, 5, 15, 60, 240, 720, 1440];
// Crew alerts: attempts and the wait before each retry.
const ALERT_RETRY_SECONDS = [0, 60, 300, 900, 3600];
const TG_LINK_MINUTES = 30;
const BOT_CACHE_SECONDS = 1800;
// After a failed getUpdates (wrong token, a webhook, another server polling
// the same bot): pause polling instead of retrying every pass.
const TG_POLL_PAUSE_SECONDS = 60;
// The delivery lock: renewed on every pass and before every delivery.
const LOCK_SECONDS = 30;
// guest_notify.mail_label / tg_label
const LABEL_MAX = 400;

function env(name) {
	return String($os.getenv(name) || '').trim();
}

function isOn(value, fallback) {
	const v = String(value || '').toLowerCase();
	if (!v) return fallback;
	return v === '1' || v === 'true' || v === 'on' || v === 'yes';
}

function config(app) {
	const smtp = app.settings().smtp;
	const token = env('TELEGRAM_BOT_TOKEN');
	const loop = parseInt(env('COZY_NOTIFY_LOOP_SECONDS') || '50', 10);
	const perMinute = parseInt(env('COZY_MAILS_PER_MINUTE') || '20', 10);
	return {
		appUrl: (env('COZY_APP_URL') || app.settings().meta.appURL || '').replace(/\/+$/, ''),
		label: env('COZY_ENV_LABEL'),
		mail: { enabled: !!(smtp.enabled && smtp.host), replyTo: env('MAIL_REPLY_TO') },
		telegram: {
			token: token,
			chatId: env('TELEGRAM_CHAT_ID'),
			threadId: env('TELEGRAM_THREAD_ID'),
			apiBase: (env('TELEGRAM_API_BASE') || 'https://api.telegram.org').replace(/\/+$/, ''),
			guests: !!token && isOn(env('TELEGRAM_GUEST_UPDATES'), true)
		},
		legacyWebhook: env('COZY_ADMIN_WEBHOOK_URL'),
		loopSeconds: loop >= 0 && loop <= 50 ? loop : 50,
		mailsPerMinute: perMinute > 0 ? perMinute : 20,
		// the texts admins changed (key → text); the defaults are in texts.js
		texts: loadTexts(app)
	};
}

function crewConfigured(cfg) {
	return !!((cfg.telegram.token && cfg.telegram.chatId) || cfg.legacyWebhook);
}

// --- small helpers -----------------------------------------------------------

/** PocketBase's date format ("2006-01-02 15:04:05.000Z"). */
function pbDate(ms) {
	return new Date(ms).toISOString().replace('T', ' ');
}

function toMs(value) {
	const s = String(value || '').trim();
	if (!s) return 0;
	const ms = Date.parse(s.replace(' ', 'T'));
	return isNaN(ms) ? 0 : ms;
}

/** Go errors quote request URLs, and those contain tokens: drop every URL. */
function safeError(err) {
	return String(err && err.message ? err.message : err)
		.replace(/https?:\/\/[^\s"']+/g, '<url>')
		.replace(/bot\d+:[A-Za-z0-9_-]+/g, 'bot<token>')
		.slice(0, 500);
}

function clip(text, max) {
	const s = String(text || '');
	return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

/** A warning at most every 15 minutes per key: a broken setup must not flood the log. */
function warnOnce(app, key, message) {
	const storeKey = 'cozy_warned_' + key;
	if (Date.now() - (app.store().get(storeKey) || 0) < 15 * 60000) return;
	app.store().set(storeKey, Date.now());
	console.warn(message);
}

function maskEmail(email) {
	const s = String(email || '');
	const at = s.lastIndexOf('@');
	if (at < 1) return s ? '•••' : '';
	return s.charAt(0) + '•••' + s.slice(at);
}

function esc(text) {
	return String(text)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

function pad2(n) {
	return (n < 10 ? '0' : '') + n;
}

// Europe/Berlin without a time zone database: CEST from the last Sunday of
// March to the last Sunday of October, 01:00 UTC each.
function lastSundayUtc(year, month) {
	const d = new Date(Date.UTC(year, month + 1, 0, 1, 0, 0));
	d.setUTCDate(d.getUTCDate() - d.getUTCDay());
	return d.getTime();
}

function berlinTime(value) {
	const ms = toMs(value);
	if (!ms) return String(value || '');
	const year = new Date(ms).getUTCFullYear();
	const summer = ms >= lastSundayUtc(year, 2) && ms < lastSundayUtc(year, 9);
	const local = new Date(ms + (summer ? 2 : 1) * 3600000);
	const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
	const months = [
		'Jan',
		'Feb',
		'Mar',
		'Apr',
		'May',
		'Jun',
		'Jul',
		'Aug',
		'Sep',
		'Oct',
		'Nov',
		'Dec'
	];
	return (
		days[local.getUTCDay()] +
		' ' +
		local.getUTCDate() +
		' ' +
		months[local.getUTCMonth()] +
		' ' +
		pad2(local.getUTCHours()) +
		':' +
		pad2(local.getUTCMinutes()) +
		' (Berlin)'
	);
}

function prefixed(cfg, text) {
	return (cfg.label ? '[' + cfg.label + '] ' : '') + text;
}

/**
 * A field's value as stored before the update that is running now. Asks the
 * database: `record.original()` is empty for a record object that was created
 * earlier in the same process (the CLI creates an admin, then approves it).
 */
function storedValue(app, record, field) {
	try {
		return app.findRecordById(record.collection().id, record.id).getString(field);
	} catch (_) {
		return record.original().getString(field);
	}
}

function findOne(app, collection, filter, params) {
	const rows = app.findRecordsByFilter(collection, filter, '', 1, 0, params || {});
	return rows.length > 0 ? rows[0] : null;
}

// --- Telegram ----------------------------------------------------------------

/**
 * Calls the Bot API. Never throws; `description` is safe to log.
 * @returns {{ok: boolean, status: number, result: any, description: string, retryAfter: number}}
 */
function telegramCall(cfg, method, payload, timeoutSeconds) {
	if (!cfg.telegram.token) {
		return { ok: false, status: 0, result: null, description: 'no bot token', retryAfter: 0 };
	}
	try {
		const res = $http.send({
			url: cfg.telegram.apiBase + '/bot' + cfg.telegram.token + '/' + method,
			method: 'POST',
			body: JSON.stringify(payload || {}),
			headers: { 'content-type': 'application/json' },
			timeout: timeoutSeconds || 10
		});
		const json = res.json || {};
		return {
			ok: res.statusCode === 200 && json.ok === true,
			status: res.statusCode,
			result: json.result,
			description: safeError(json.description || 'HTTP ' + res.statusCode),
			retryAfter: (json.parameters && json.parameters.retry_after) || 0
		};
	} catch (err) {
		return { ok: false, status: 0, result: null, description: safeError(err), retryAfter: 0 };
	}
}

/** The chat is gone for good: blocked bot, deleted account, unknown chat. */
function telegramChatGone(r) {
	return (
		r.status === 403 ||
		(r.status === 400 && /chat not found|user is deactivated|bot was blocked/i.test(r.description))
	);
}

/** The bot's @username (cached; the guest pages build the t.me link from it). */
function botUsername(app, cfg) {
	if (!cfg.telegram.token) return '';
	const cached = app.store().get('cozy_tg_bot');
	if (cached && cached.at > Date.now() - BOT_CACHE_SECONDS * 1000) return cached.name;
	const r = telegramCall(cfg, 'getMe', {}, 10);
	if (!r.ok || !r.result || !r.result.username) {
		warnOnce(
			app,
			'getme',
			'[cozy-notify] Telegram getMe failed: ' + r.status + ' ' + r.description
		);
		return cached ? cached.name : null;
	}
	app.store().set('cozy_tg_bot', { name: String(r.result.username), at: Date.now() });
	return String(r.result.username);
}

// --- crew chat ---------------------------------------------------------------

function legacyWebhookSend(url, text) {
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
			timeout: 10
		});
		return res.statusCode < 300
			? { ok: true, error: '' }
			: { ok: false, error: 'webhook answered HTTP ' + res.statusCode };
	} catch (err) {
		return { ok: false, error: safeError(err) };
	}
}

/** Posts one message to the crew chat. Never throws. */
function crewSend(cfg, text) {
	const full = prefixed(cfg, text);
	if (cfg.telegram.token && cfg.telegram.chatId) {
		const payload = { chat_id: cfg.telegram.chatId, text: full, disable_web_page_preview: true };
		const thread = parseInt(cfg.telegram.threadId, 10);
		if (thread > 0) payload.message_thread_id = thread;
		const r = telegramCall(cfg, 'sendMessage', payload, 10);
		return r.ok ? { ok: true, error: '' } : { ok: false, error: r.status + ' ' + r.description };
	}
	if (cfg.legacyWebhook) return legacyWebhookSend(cfg.legacyWebhook, full);
	return { ok: false, error: 'no crew chat configured' };
}

/**
 * Records an admin event (audit log). Its crew alert is sent by the next
 * delivery run, after the surrounding transaction committed.
 */
function logEvent(app, action, fields) {
	const f = fields || {};
	const rec = new Record(app.findCollectionByNameOrId('admin_events'));
	rec.set('action', action);
	rec.set('actor', String(f.actor || '').slice(0, 320));
	rec.set('subject', String(f.subject || '').slice(0, 320));
	rec.set('details', f.details || {});
	app.save(rec);
	return rec;
}

function eventDetails(ev) {
	try {
		const d = JSON.parse(ev.getString('details') || '{}');
		return d && typeof d === 'object' ? d : {};
	} catch (_) {
		return {};
	}
}

/** "opens Mon 21 Sep 18:00 · closes Sun 27 Sep 23:59" for window events. */
function windowText(d) {
	const parts = [];
	if (d.opens) parts.push('opens ' + berlinTime(d.opens));
	if (d.closes) parts.push('closes ' + berlinTime(d.closes));
	return parts.length ? parts.join(' · ') : 'no times';
}

/** The crew chat text of an admin_events record. cfg (optional) adds links. */
/**
 * What a special-needs request was when the guest withdrew it, in words. The
 * crew chat reads like a sentence; the stored word ('pending') is for code.
 */
function requestStatusNote(status) {
	switch (status) {
		case 'pending':
			return ' (was still waiting for a decision)';
		case 'approved':
			return ' (had been approved)';
		case 'declined':
			return ' (had been declined)';
		default:
			return '';
	}
}

function eventText(ev, cfg) {
	const action = ev.getString('action');
	const actor = ev.getString('actor');
	const subject = ev.getString('subject');
	const d = eventDetails(ev);
	const by = actor ? ' by ' + actor : '';
	const who = (d.name ? d.name + ' ' : '') + '<' + subject + '>';
	const requestsUrl = cfg && cfg.appUrl ? cfg.appUrl + '/admin/requests' : '';

	switch (action) {
		case 'access_request':
			return (
				'🛎️ Admin access request: ' +
				who +
				'\nApprove on the server: cozy-admin.sh approve ' +
				subject +
				'\n(or PocketBase dashboard → admins → role)'
			);
		case 'access_invited':
			return (
				'✉️ Admin invited: ' + subject + ' (role ' + d.role + ') — can sign in with Google now'
			);
		case 'access_approved':
			return '✅ Admin access approved: ' + subject + ' (role ' + d.role + ')';
		case 'role_changed':
			return '🔁 Admin role changed: ' + subject + ': ' + d.from + ' → ' + d.to;
		case 'access_removed':
			return '🚫 Admin access removed: ' + subject + (d.role ? ' (was ' + d.role + ')' : '');
		case 'admin_sign_in':
			return '🔐 Admin sign-in: ' + who + (d.role ? ' (' + d.role + ')' : '');
		case 'booking_live':
			return '🎪 LIVE BOOKING switched ON' + by + ' — guests can book now';
		case 'booking_staging':
			return '🛠 Back to STAGING MODE' + by + ' — booking is off, the layout can be edited again';
		case 'booking_frozen':
			return '🔒 Booking CLOSED' + by + ' — bookings are frozen, the layout stays locked';
		case 'booking_closed_by_timer':
			return (
				'🔒 Booking is CLOSED now — closing time ' + berlinTime(subject) + '. Bookings are frozen.'
			);
		case 'window_armed':
			return '⏰ Booking timer armed' + by + ': ' + windowText(d);
		case 'window_changed':
			return '⏰ Booking window changed' + by + ': ' + windowText(d);
		case 'window_paused':
			return '⏸️ Booking timer paused' + by + ' (times kept: ' + windowText(d) + ')';
		case 'window_removed':
			return '⏰ Booking timer removed' + by + ' (was ' + windowText(d) + ')';
		// Older events (before the booking window had a closing time).
		case 'booking_closed':
			return '🛠 Booking closed (STAGING MODE)' + by;
		case 'timer_set':
			return '⏰ Go-live timer set' + by + ': booking opens ' + berlinTime(subject);
		case 'timer_removed':
			return (
				'⏰ Go-live timer removed' + by + (subject ? ' (was ' + berlinTime(subject) + ')' : '')
			);
		case 'booking_opened_by_timer':
			return '🎪 Booking is LIVE now — go-live timer ' + berlinTime(subject);
		case 'bookings_cleared':
			return (
				'🧨 All bookings cleared' +
				by +
				': ' +
				(d.released || 0) +
				' spot(s) released, tickets kept' +
				(d.kept ? '; ' + d.kept + ' special-needs spot(s) kept' : '') +
				(d.reason === 'staging' ? ' (back to Staging Mode)' : '') +
				(d.stopped ? ' — STOPPED, ' + (d.stopped - (d.released || 0)) + ' still booked' : '')
			);
		// Special-needs requests: never the guest's name or what they wrote.
		case 'special_request_new':
			return (
				'🧡 New special-needs request' +
				(d.open ? ' — ' + d.open + ' waiting for a decision' : '') +
				(requestsUrl ? '\n' + requestsUrl : '')
			);
		case 'special_request_withdrawn':
			return '🧡 A guest withdrew their special-needs request' + requestStatusNote(d.status);
		case 'special_request_approved':
			return '✅ Special-needs request approved' + by;
		case 'special_request_declined':
			return '✋ Special-needs request declined' + by;
		case 'special_spot_assigned':
			return '♿ Special-needs spot booked for a guest' + by;
		case 'special_spot_released':
			return '♿ Special-needs spot released' + by;
		case 'requests_opened':
			return '🧡 Special-needs requests OPENED' + by + ' — guests see a link on the map';
		case 'requests_closed':
			return '🧡 Special-needs requests closed' + by;
		case 'template_imported': {
			if (!d.created && !d.updated && !d.removed) {
				// events from before the review import (the whole layout was replaced)
				return (
					'🗺️ Layout template "' +
					subject +
					'" imported' +
					by +
					': ' +
					(d.houses || 0) +
					' houses, ' +
					(d.rooms || 0) +
					' rooms, ' +
					(d.beds || 0) +
					' spots; ' +
					(d.releasedBookings || 0) +
					' booking(s) released; backup ' +
					(d.backup || 'skipped')
				);
			}
			const levels = (c) =>
				[
					c && c.houses ? c.houses + ' house(s)' : '',
					c && c.rooms ? c.rooms + ' room(s)' : '',
					c && c.spots ? c.spots + ' spot(s)' : ''
				]
					.filter((part) => !!part)
					.join(', ');
			const steps = [
				levels(d.created) ? 'new ' + levels(d.created) : '',
				levels(d.updated) ? 'changed ' + levels(d.updated) : '',
				levels(d.removed) ? 'removed ' + levels(d.removed) : ''
			].filter((part) => !!part);
			return (
				'🗺️ Layout template "' +
				subject +
				'" applied' +
				by +
				': ' +
				(steps.join('; ') || 'nothing changed') +
				'; ' +
				(d.releasedBookings || 0) +
				' booking(s) released' +
				(d.problems ? '; ' + d.problems + ' step(s) failed' : '') +
				'; backup ' +
				(d.backup || 'skipped')
			);
		}
		case 'ticket_updated': {
			const parts = [];
			// emailChanged: masked addresses can look the same (max@… → mia@…)
			const emailChanged =
				d.emailChanged === undefined ? d.emailFrom !== d.emailTo : !!d.emailChanged;
			if (emailChanged) {
				parts.push('e-mail ' + (d.emailFrom || '(none)') + ' → ' + (d.emailTo || '(none)'));
			}
			if (d.nameChanged) parts.push('name');
			if (d.newHolder) {
				parts.push(
					'passed on: Telegram disconnected, new booking pass' +
						(d.requestRemoved ? ', special-needs request removed' : '') +
						(d.checkInReset ? ', check-in reset' : '')
				);
			}
			return (
				'🎟️ Ticket ' + (d.ticket || subject) + ' changed' + by + ': ' + (parts.join('; ') || '-')
			);
		}
		case 'tickets_imported':
			return (
				'📥 Ticket list imported' +
				by +
				': ' +
				(d.created || 0) +
				' new, ' +
				(d.updated || 0) +
				' updated' +
				(d.newHolders ? ' (' + d.newHolders + ' passed on)' : '') +
				(d.requestsRemoved ? ', ' + d.requestsRemoved + ' special-needs request(s) removed' : '') +
				(d.failed ? ', ' + d.failed + ' failed' : '')
			);
		case 'house_deleted':
			return (
				'🏚️ House "' +
				subject +
				'" deleted' +
				by +
				': ' +
				(d.released || 0) +
				' booking(s) released'
			);
		case 'guest_notice_failed':
			return (
				'📭 Could not notify ticket "' +
				subject +
				'" (' +
				(d.channels || '?') +
				') after ' +
				d.attempts +
				' attempts: ' +
				d.error
			);
		case 'message_text_changed':
			return '✏️ Message text changed' + by + ': ' + subject;
		case 'message_text_reset':
			return '↩️ Message text reset to its default' + by + ': ' + subject;
		case 'check_in_undone':
			return '↩️ Check-in undone' + by + (subject ? ': spot ' + subject : '');
		case 'test':
			return '🧪 Test message from cozy-admin notify test' + by;
		default:
			return '📋 ' + action + by + (subject ? ': ' + subject : '');
	}
}

function sendPendingAlerts(app, cfg, force) {
	if (!crewConfigured(cfg)) return 0;
	const events = app.findRecordsByFilter(
		'admin_events',
		"alert_status = 'pending'",
		'created',
		20,
		0
	);
	let sent = 0;
	for (const ev of events) {
		const attempts = ev.getInt('alert_attempts');
		const wait = ALERT_RETRY_SECONDS[Math.min(attempts, ALERT_RETRY_SECONDS.length - 1)];
		if (!force && attempts > 0 && Date.now() - toMs(ev.getString('updated')) < wait * 1000)
			continue;

		const r = crewSend(cfg, eventText(ev, cfg));
		if (r.ok) {
			ev.set('alert_status', 'sent');
			ev.set('alert_error', '');
			sent++;
		} else {
			ev.set('alert_attempts', attempts + 1);
			ev.set('alert_error', r.error);
			if (attempts + 1 >= ALERT_RETRY_SECONDS.length) ev.set('alert_status', 'failed');
			console.warn('[cozy-notify] crew alert failed (' + (attempts + 1) + '): ' + r.error);
		}
		app.save(ev);
		if (!r.ok) break; // the channel is down: keep the order, try again later
	}
	return sent;
}

// --- guest spots -------------------------------------------------------------

/** Where a ticket sleeps right now, or null. */
function currentSpot(app, orderId) {
	const beds = app.findRecordsByFilter('beds', 'order = {:order}', '-updated', 1, 0, {
		order: orderId
	});
	if (beds.length === 0) return null;
	const bed = beds[0];
	const spot = { bedId: bed.id, roomId: bed.getString('room'), spot: bed.getString('label') };
	spot.room = '';
	spot.house = '';
	try {
		const room = app.findRecordById('rooms', spot.roomId);
		const number = room.getInt('room_number');
		spot.room = (room.getString('name') || 'Room') + (number ? ' #' + number : '');
		spot.house = app.findRecordById('houses', room.getString('house')).getString('name');
	} catch (_) {
		// a dangling relation: the spot label has to do
	}
	spot.label = clip([spot.spot, spot.room, spot.house].filter((s) => !!s).join(' · '), LABEL_MAX);
	return spot;
}

/** The ticket's special-needs request: { id, status, bed (the spot the crew booked) } or null. */
function currentRequest(app, orderId) {
	const rows = app.findRecordsByFilter('special_requests', 'order = {:order}', '', 1, 0, {
		order: orderId
	});
	return rows.length > 0
		? { id: rows[0].id, status: rows[0].getString('status'), bed: rows[0].getString('bed') }
		: null;
}

/** What a channel remembers about the request: "<id>:<status>", or "" for none. */
function requestKey(request) {
	return request ? request.id + ':' + request.status : '';
}

/**
 * What to tell about a request after `lastKey` was told: received | approved |
 * declined, or '' (nothing new; a withdrawn request needs no message). A new
 * request after a withdrawn one is "received" again.
 */
function requestKindOf(lastKey, request) {
	const key = requestKey(request);
	if (!key || key === lastKey) return '';
	if (request.status === 'pending') {
		return String(lastKey || '').split(':')[0] === request.id ? '' : 'received';
	}
	return request.status === 'approved' || request.status === 'declined' ? request.status : '';
}

/**
 * Changes a guest_notify record without losing concurrent writes (a new due
 * mark from a booking, a Telegram link or "Turn off" from the app): re-reads
 * it inside a transaction and lets `change(fresh)` set only what the caller
 * decided. `change` returns false to leave the record alone. Returns whether
 * it was saved.
 */
function updateNotify(app, id, change) {
	let saved = false;
	app.runInTransaction((tx) => {
		let fresh;
		try {
			fresh = tx.findRecordById('guest_notify', id);
		} catch (_) {
			return; // deleted meanwhile (forget-contacts, ticket removed)
		}
		if (change(fresh) === false) return;
		tx.save(fresh);
		saved = true;
	});
	return saved;
}

/**
 * Marks a ticket for a delivery run. Called from the bed and order hooks,
 * inside the same transaction as the change itself.
 */
function markDue(app, orderId, options) {
	if (!orderId) return;
	const opts = options || {};
	const due = pbDate(Date.now() + (opts.now ? 0 : SETTLE_SECONDS * 1000));
	app.runInTransaction((tx) => {
		let rec = findOne(tx, 'guest_notify', 'order = {:order}', { order: orderId });
		if (!rec) {
			let order;
			try {
				order = tx.findRecordById('orders', orderId);
			} catch (_) {
				return;
			}
			// Nobody to tell. A Telegram link creates the record itself.
			if (!order.getString('email')) return;
			rec = new Record(tx.findCollectionByNameOrId('guest_notify'));
			rec.set('order', orderId);
		}
		rec.set('due', due);
		rec.set('attempts', 0);
		tx.save(rec);
	});
}

// --- message texts -----------------------------------------------------------
//
// Every sentence guests get is in pb_hooks/lib/texts.js (docs/admin/
// notifications.md, "Message texts"). Admins change them on /admin/messages;
// a changed text is a record in message_texts and wins over the default. The
// stored texts are read once per run (config) and looked up with t(). Which
// lines a message has in which case is decided below, never by a text.

const CATALOGUE = require(__hooks + '/lib/texts.js');

const DEFAULT_TEXTS = {};
for (const entry of CATALOGUE.TEXTS) DEFAULT_TEXTS[entry.key] = entry.text;

const isKnownText = (key) => Object.prototype.hasOwnProperty.call(DEFAULT_TEXTS, key);

/**
 * The changed texts (key → text) from message_texts. {} when there are none
 * or the collection is missing (a database from before the migration): the
 * defaults are used then.
 */
function loadTexts(app) {
	const texts = {};
	try {
		const rows = app.findAllRecords('message_texts');
		for (const row of rows) {
			const key = row.getString('key');
			const text = row.getString('text');
			if (key && text && isKnownText(key)) texts[key] = text;
		}
	} catch (err) {
		warnOnce(
			app,
			'message_texts',
			'stored message texts not read, using the defaults: ' + safeError(err)
		);
	}
	return texts;
}

/**
 * The text for `key`: the stored one, else the default, with its
 * {placeholders} filled from vars. A placeholder the text may not use stays as
 * written, so a typo shows in the preview instead of vanishing.
 */
function t(cfg, key, vars) {
	if (!isKnownText(key)) throw new Error('unknown message text: ' + key);
	const stored = cfg && cfg.texts ? cfg.texts[key] : '';
	const text = stored || DEFAULT_TEXTS[key];
	if (!vars) return text;
	return text.replace(/\{([A-Za-z]+)\}/g, (match, name) =>
		Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : match
	);
}

/** The catalogue for the admin page: groups, placeholders and every text with its default. */
function textCatalogue() {
	return { groups: CATALOGUE.GROUPS, placeholders: CATALOGUE.PLACEHOLDERS, items: CATALOGUE.TEXTS };
}

// How a ticket is named: the same rules the app uses (src/lib/tickets.ts).
const TICKETS = require(__hooks + '/lib/tickets.js');

/** The name to greet the guest with, '' for a ticket without one. */
function greetingName(order) {
	return TICKETS.holderName(order.getString('customer_name'), order.getString('order_number'));
}

/**
 * Every address in a server's reply, shortened. A mail server echoes the
 * recipient back ("550 5.1.1 <ada@example.com> unknown"), and that reply is
 * quoted in the crew chat: the alert may say which ticket failed, never who.
 */
function maskEmailsIn(text) {
	return String(text || '').replace(/[^\s<>()[\],;:"']+@[^\s<>()[\],;:"']+/g, (match) =>
		maskEmail(match)
	);
}

/**
 * Forgets that the ticket was passed on: used up by the first message to the
 * new address, so a spot they book themselves later is an ordinary booking.
 * A ticket whose new address never gets a message (no address, mail off)
 * keeps the mark until the next hand-over overwrites it.
 */
function clearHandedOver(app, order) {
	try {
		order.set('handed_over_at', '');
		app.save(order);
	} catch (err) {
		console.error('[cozy-notify] hand-over mark of ' + order.id + ': ' + safeError(err));
	}
}

/**
 * How the crew chat may name this ticket: "Ticket H•••", or a short record id
 * when the ticket has no code. Never the holder, never a full code — an alert
 * about a ticket must not name the person another alert just wrote about.
 */
function ticketLabel(order) {
	return TICKETS.maskedTicketLabel(order.getString('order_number')) || '#' + order.id.slice(0, 5);
}

function spotLines(spot) {
	return [
		['House', spot.house],
		['Room', spot.room],
		['Spot', spot.spot]
	].filter((row) => !!row[1]);
}

/**
 * Subject, plain text and HTML of a guest e-mail. kind: booked | changed |
 * released, or '' when only the special-needs request changed. pass: { code,
 * url } of the ticket's booking pass, or null. request (optional): { kind:
 * received | approved | declined | '' (what to tell about the request),
 * status: its current status, fixed: the ticket's spot is the one the crew
 * booked for the request, so only the crew changes it }. Every combination
 * tells both: a message is sent once per state, news left out is lost.
 */
function guestMail(cfg, kind, spot, previousLabel, name, pass, request) {
	const req = request || { kind: '', status: '', fixed: false };
	const mapUrl = cfg.appUrl + '/map';
	const requestUrl = cfg.appUrl + '/special-needs';
	const roomUrl = spot ? cfg.appUrl + '/room/' + spot.roomId : mapUrl;
	const vars = {
		name: name || '',
		spot: spot ? spot.label : '',
		before: previousLabel || '',
		roomUrl: roomUrl,
		mapUrl: mapUrl,
		requestUrl: requestUrl,
		passCode: pass ? pass.code : '',
		passUrl: pass ? pass.url : ''
	};
	const T = (key) => t(cfg, key, vars);
	const hello = name ? T('mail.greeting') : T('mail.greeting_anonymous');
	const crewBooked = req.kind === 'approved' && req.fixed && !!spot;
	// the spot's details: whenever it is booked or changed, or the crew just booked it
	const showSpot = !!spot && ((!!kind && kind !== 'released') || crewBooked);
	const passUrl = pass && showSpot ? pass.url : '';
	const passLine = passUrl ? T('mail.pass') : '';
	const fixedLine = T('mail.fixed');
	let subject;
	let intro;
	let after = [];
	if (crewBooked) {
		subject = T('mail.crew_booked.subject');
		intro = T('mail.crew_booked.intro');
		if (kind === 'changed' && previousLabel) after.push(T('mail.changed.before'));
		if (passLine) after.push(passLine);
		after.push(fixedLine);
	} else if (!kind) {
		if (req.kind === 'received') {
			subject = T('mail.request_received.subject');
			intro = T('mail.request_received.intro');
			after = [T('mail.request_received.next'), T('mail.request_received.manage')];
		} else if (req.kind === 'approved') {
			subject = T('mail.request_approved.subject');
			intro = T('mail.request_approved.intro');
			after = [
				spot ? T('mail.request_approved.keep') : T('mail.request_approved.picking'),
				T('mail.request_approved.link')
			];
		} else {
			subject = T('mail.request_declined.subject');
			intro = T('mail.request_declined.intro');
			after = [
				spot ? T('mail.request_declined.keep') : T('mail.request_declined.book'),
				T('mail.request_declined.questions')
			];
		}
	} else if (kind === 'released') {
		subject = T('mail.released.subject');
		intro = previousLabel ? T('mail.released.intro') : T('mail.released.intro_unknown');
		if (req.status === 'approved') {
			after = [
				req.kind === 'approved'
					? T('mail.released.approved_now')
					: T('mail.released.still_approved')
			];
		} else {
			after = [T('mail.released.layout'), T('mail.released.rebook')];
		}
		if (req.kind === 'declined') after.unshift(T('mail.released.also_declined'));
		if (req.kind === 'received') after.unshift(T('mail.released.also_received'));
	} else if (kind === 'handed_over') {
		// The ticket changed hands: its spot is news to this address, but it is
		// not a booking they made. Pass and "how to change it" as in "spot booked".
		subject = T('mail.handed_over.subject');
		intro = T('mail.handed_over.intro');
		if (passLine) after.push(passLine);
		after.push(req.fixed ? fixedLine : T('mail.booked.change'));
	} else {
		subject = kind === 'changed' ? T('mail.changed.subject') : T('mail.booked.subject');
		intro = kind === 'changed' ? T('mail.changed.intro') : T('mail.booked.intro');
		if (req.kind === 'received') {
			after.push(T('mail.also.received'));
		} else if (req.kind === 'approved') {
			after.push(T('mail.also.approved'));
		} else if (req.kind === 'declined') {
			after.push(T('mail.also.declined'));
		}
		if (kind === 'changed' && previousLabel) after.push(T('mail.changed.before'));
		if (kind === 'changed') {
			after.push(req.fixed ? T('mail.changed.by_crew') : T('mail.changed.maybe_crew'));
		}
		if (passLine) after.push(passLine);
		after.push(req.fixed ? fixedLine : T('mail.booked.change'));
	}
	const rows = showSpot ? spotLines(spot) : [];
	const signature = T('mail.signature');
	const footer = T('mail.footer');

	const text = [hello, '', intro]
		.concat(rows.length ? [''].concat(rows.map((r) => '  ' + (r[0] + ':').padEnd(7) + r[1])) : [])
		.concat([''])
		.concat(after)
		.concat(['', signature, '', footer])
		.join('\n');

	const link = (url) => '<a href="' + esc(url) + '" style="color:#7a3cff">' + esc(url) + '</a>';
	// Each line holds at most one link; link its first URL once.
	const urls = [passUrl, roomUrl, mapUrl, requestUrl].filter((u) => !!u);
	const linkify = (line) => {
		let at = -1;
		let url = '';
		for (const u of urls) {
			const i = line.indexOf(u);
			if (i >= 0 && (at < 0 || i < at)) {
				at = i;
				url = u;
			}
		}
		if (!url) return esc(line);
		return esc(line.slice(0, at)) + link(url) + esc(line.slice(at + url.length));
	};
	// A changed text may have line breaks; they stay in the HTML as well.
	const para = (line) => line.split('\n').map(linkify).join('<br>');
	const html =
		'<!doctype html><html><body style="margin:0;padding:24px;background:#f6f3ee;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1d1a24">' +
		'<div style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;padding:24px">' +
		(cfg.label
			? '<p style="margin:0 0 12px;color:#b00020;font-weight:bold">' + esc(cfg.label) + '</p>'
			: '') +
		'<p style="margin:0 0 12px">' +
		para(hello) +
		'</p><p style="margin:0 0 12px">' +
		para(intro) +
		'</p>' +
		(rows.length
			? '<table style="border-collapse:collapse;margin:0 0 16px">' +
				rows
					.map(
						(r) =>
							'<tr><td style="padding:4px 16px 4px 0;color:#6b6478">' +
							esc(r[0]) +
							'</td><td style="padding:4px 0;font-weight:bold">' +
							esc(r[1]) +
							'</td></tr>'
					)
					.join('') +
				'</table>'
			: '') +
		after.map((line) => '<p style="margin:0 0 12px">' + para(line) + '</p>').join('') +
		'<p style="margin:16px 0 0">' +
		para(signature) +
		'</p>' +
		'<p style="margin:16px 0 0;font-size:12px;color:#6b6478">' +
		para(footer) +
		'</p></div></body></html>';

	return { subject: prefixed(cfg, subject), text: text, html: html };
}

const REQUEST_STATUS_KEY = {
	pending: 'tg.status.pending',
	approved: 'tg.status.approved',
	declined: 'tg.status.declined'
};

/**
 * kind: connected | booked | changed | released, or '' when only the
 * special-needs request changed; pass: { code, url } or null; request
 * (optional): { kind, status, fixed } like guestMail.
 */
function guestTelegram(cfg, kind, spot, previousLabel, pass, request) {
	const req = request || { kind: '', status: '', fixed: false };
	const mapUrl = cfg.appUrl + '/map';
	const requestUrl = cfg.appUrl + '/special-needs';
	const roomUrl = spot ? cfg.appUrl + '/room/' + spot.roomId : mapUrl;
	const vars = {
		spot: spot ? spot.label : '',
		before: previousLabel || '',
		roomUrl: roomUrl,
		mapUrl: mapUrl,
		requestUrl: requestUrl,
		passCode: pass ? pass.code : '',
		passUrl: pass ? pass.url : '',
		status: ''
	};
	const T = (key) => t(cfg, key, vars);
	const passLine = pass && spot ? '\n\n' + T('tg.pass') : '';
	const crewBooked = req.kind === 'approved' && req.fixed && !!spot;
	let text;
	if (kind === 'connected') {
		const statusKey = REQUEST_STATUS_KEY[req.status];
		vars.status = statusKey ? T(statusKey) : '';
		text =
			T('tg.connected.intro') +
			'\n\n' +
			(spot ? T('tg.connected.spot') + passLine : T('tg.connected.no_spot')) +
			(vars.status ? '\n\n' + T('tg.connected.request') : '') +
			'\n\n' +
			T('tg.connected.stop');
	} else if (crewBooked) {
		text =
			T('tg.crew_booked.intro') +
			(kind === 'changed' && previousLabel ? '\n' + T('tg.before') : '') +
			'\n\n' +
			roomUrl +
			passLine +
			'\n\n' +
			T('tg.contact_crew');
	} else if (!kind) {
		if (req.kind === 'received') {
			text = T('tg.request_received');
		} else if (req.kind === 'approved') {
			text = spot ? T('tg.request_approved.keep') : T('tg.request_approved.picking');
		} else {
			text = spot ? T('tg.request_declined.keep') : T('tg.request_declined.book');
		}
	} else {
		const news =
			req.kind === 'received'
				? T('tg.news.received') + '\n\n'
				: req.kind === 'declined'
					? T('tg.news.declined') + '\n\n'
					: req.kind === 'approved' && kind !== 'released'
						? T('tg.news.approved') + '\n\n'
						: '';
		if (kind === 'released') {
			text =
				news +
				(previousLabel ? T('tg.released.intro') : T('tg.released.intro_unknown')) +
				'\n\n' +
				(req.status === 'approved'
					? req.kind === 'approved'
						? T('tg.released.approved_now')
						: T('tg.released.still_approved')
					: T('tg.released.rebook'));
		} else if (kind === 'changed') {
			text =
				news +
				T('tg.changed.intro') +
				(previousLabel ? '\n' + T('tg.before') : '') +
				'\n\n' +
				(req.fixed ? T('tg.changed.by_crew') : T('tg.changed.maybe_crew')) +
				passLine;
		} else {
			text =
				news +
				T('tg.booked.intro') +
				'\n\n' +
				(req.fixed ? T('tg.booked.by_crew') : T('tg.booked.change')) +
				passLine;
		}
	}
	return prefixed(cfg, text);
}

/**
 * Sample messages for the admin page (/admin/messages), rendered with cfg.texts
 * like the real ones: every text is in at least one of them (tests/notify-
 * messages.test.ts checks). The sample guest is Ada with a booking pass.
 */
function previewMessages(cfg) {
	const spot = {
		bedId: 'sample',
		roomId: 'sample',
		spot: 'B1',
		room: 'Dorm #2',
		house: 'Villa',
		label: 'B1 · Dorm #2 · Villa'
	};
	const before = 'B7 · Loft #1 · Hut';
	const pass = { code: 'AAAA-BBBB-CCCC', url: cfg.appUrl + '/pass/AAAA-BBBB-CCCC' };
	const none = { kind: '', status: '', fixed: false };
	const req = (kind, status, fixed) => ({ kind: kind, status: status, fixed: !!fixed });
	// name: '' = a ticket without a name; before: '' = the old spot is unknown
	const cases = [
		{ id: 'booked', title: 'Spot booked', kind: 'booked', spot: true, req: none },
		{
			id: 'changed',
			title: 'Spot changed',
			kind: 'changed',
			spot: true,
			before: before,
			req: none
		},
		{
			id: 'handed_over',
			title: 'Ticket passed on: the new holder and the spot it holds',
			kind: 'handed_over',
			spot: true,
			req: none
		},
		{ id: 'released', title: 'Spot released', kind: 'released', before: before, req: none },
		{
			id: 'released_unknown',
			title: 'Spot released, old spot unknown, ticket without a name',
			kind: 'released',
			name: '',
			req: none
		},
		{
			id: 'request_received',
			title: 'Special-needs request received',
			req: req('received', 'pending')
		},
		{
			id: 'request_approved',
			title: 'Request approved, no spot yet',
			req: req('approved', 'approved')
		},
		{
			id: 'request_approved_keep',
			title: 'Request approved, the guest keeps their spot',
			spot: true,
			req: req('approved', 'approved')
		},
		{
			id: 'request_declined',
			title: 'Request declined, no spot',
			req: req('declined', 'declined')
		},
		{
			id: 'request_declined_keep',
			title: 'Request declined, the guest keeps their spot',
			spot: true,
			req: req('declined', 'declined')
		},
		{
			id: 'crew_booked',
			title: 'Request approved and the spot booked by the crew',
			kind: 'booked',
			spot: true,
			req: req('approved', 'approved', true)
		},
		{
			id: 'crew_moved',
			title: 'Moved by the crew to another special-needs spot',
			kind: 'changed',
			spot: true,
			before: before,
			req: req('', 'approved', true)
		},
		{
			id: 'crew_booked_again',
			title: 'Spot booked by the crew, the approval was told before',
			kind: 'booked',
			spot: true,
			req: req('', 'approved', true)
		},
		{
			id: 'booked_request_received',
			title: 'Spot booked while a request waits',
			kind: 'booked',
			spot: true,
			req: req('received', 'pending')
		},
		{
			id: 'booked_request_approved',
			title: 'Spot booked while the request is approved',
			kind: 'booked',
			spot: true,
			req: req('approved', 'approved')
		},
		{
			id: 'booked_request_declined',
			title: 'Spot booked while the request is declined',
			kind: 'booked',
			spot: true,
			req: req('declined', 'declined')
		},
		{
			id: 'released_request_received',
			title: 'Spot released while a request arrives',
			kind: 'released',
			before: before,
			req: req('received', 'pending')
		},
		{
			id: 'released_request_declined',
			title: 'Spot released while the request is declined',
			kind: 'released',
			before: before,
			req: req('declined', 'declined')
		},
		{
			id: 'released_approved_now',
			title: 'Spot released while the request is approved right now',
			kind: 'released',
			before: before,
			req: req('approved', 'approved')
		},
		{
			id: 'released_still_approved',
			title: 'Spot released, the request stays approved',
			kind: 'released',
			before: before,
			req: req('', 'approved')
		}
	];
	const name = (c) => (c.name === undefined ? 'Ada' : c.name);
	const mail = cases.map((c) => {
		const m = guestMail(
			cfg,
			c.kind || '',
			c.spot ? spot : null,
			c.before || '',
			name(c),
			pass,
			c.req
		);
		return { id: c.id, title: c.title, subject: m.subject, text: m.text, html: m.html };
	});
	const connected = [
		{
			id: 'connected',
			title: 'Chat connected, request waiting',
			kind: 'connected',
			spot: true,
			req: req('', 'pending')
		},
		{
			id: 'connected_approved',
			title: 'Chat connected, request approved',
			kind: 'connected',
			spot: true,
			req: req('', 'approved')
		},
		{
			id: 'connected_declined',
			title: 'Chat connected, request declined, no spot',
			kind: 'connected',
			req: req('', 'declined')
		}
	];
	// A hand-over cuts the Telegram link with everything else of the old
	// holder, so there is no such Telegram message to show.
	const tgCases = cases.filter((c) => c.kind !== 'handed_over');
	const telegram = connected.concat(tgCases).map((c) => ({
		id: c.id,
		title: c.title,
		text: guestTelegram(cfg, c.kind || '', c.spot ? spot : null, c.before || '', pass, c.req)
	}));
	const bot = [
		{ id: 'help', title: 'Any other message to the bot', text: helpText(cfg) },
		{
			id: 'link_expired',
			title: 'The connect link has expired',
			text: prefixed(cfg, t(cfg, 'bot.link_expired'))
		},
		{ id: 'stopped', title: '/stop', text: prefixed(cfg, t(cfg, 'bot.stopped')) },
		{
			id: 'not_connected',
			title: '/stop in a chat that is not connected',
			text: prefixed(cfg, t(cfg, 'bot.not_connected'))
		}
	];
	return { mail: mail, telegram: telegram, bot: bot };
}

function sendMail(app, cfg, to, msg) {
	const meta = app.settings().meta;
	const headers = { 'Auto-Submitted': 'auto-generated' };
	if (cfg.mail.replyTo) headers['Reply-To'] = cfg.mail.replyTo;
	app.newMailClient().send(
		new MailerMessage({
			from: { address: meta.senderAddress, name: meta.senderName },
			to: [{ address: to }],
			subject: msg.subject,
			html: msg.html,
			text: msg.text,
			headers: headers
		})
	);
}

/** Per-minute cap for guest e-mails (provider limits, runaway loops). */
function takeMailSlot(app, cfg) {
	const minute = Math.floor(Date.now() / 60000);
	let ok = false;
	app.store().setFunc('cozy_mail_window', (old) => {
		const w = old && old.minute === minute ? old : { minute: minute, count: 0 };
		if (w.count < cfg.mailsPerMinute) {
			ok = true;
			return { minute: minute, count: w.count + 1 };
		}
		return w;
	});
	return ok;
}

/** { code, url } of the ticket's booking pass (pb_hooks/lib/pass.js), or null. */
function bookingPass(app, cfg, order) {
	try {
		const passLib = require(`${__hooks}/lib/pass.js`);
		const code = order.getString('pass_code') || passLib.ensurePassCode(app, order.id);
		return code
			? { code: passLib.formatPassCode(code), url: passLib.passUrl(cfg.appUrl, code) }
			: null;
	} catch (err) {
		console.error('[cozy-notify] booking pass of ' + order.id + ': ' + safeError(err));
		return null;
	}
}

function kindOf(lastKey, key) {
	if (!lastKey) return key ? 'booked' : '';
	if (!key) return 'released';
	return key === lastKey ? '' : 'changed';
}

/**
 * One delivery run for one guest_notify record. Decides from the record as
 * it was read, sends, then writes back only what it decided (updateNotify):
 * if the ticket was marked again meanwhile, that newer mark stays and the next
 * pass handles the newer state.
 */
function deliverOne(app, cfg, rec, force) {
	const now = Date.now();
	const loadedDue = rec.getString('due');
	let order;
	try {
		order = app.findRecordById('orders', rec.getString('order'));
	} catch (_) {
		app.delete(rec);
		return 'gone';
	}

	if (!force && !rec.getBool('tg_new')) {
		const last = Math.max(toMs(rec.getString('mail_sent')), toMs(rec.getString('tg_sent')));
		if (last && now - last < COOLDOWN_SECONDS * 1000) {
			const later = pbDate(last + COOLDOWN_SECONDS * 1000);
			updateNotify(app, rec.id, (fresh) => {
				fresh.set('due', later);
			});
			return 'cooldown';
		}
	}

	const spot = currentSpot(app, order.id);
	const key = spot ? spot.bedId : '';
	const label = spot ? spot.label : '';
	const pass = spot ? bookingPass(app, cfg, order) : null;
	// The special-needs request, remembered per channel as "<id>:<status>".
	const request = currentRequest(app, order.id);
	const reqKey = requestKey(request);
	const reqStatus = request ? request.status : '';
	// only the spot the crew booked for the approved request is theirs to change
	const fixed = !!request && request.status === 'approved' && !!request.bed && key === request.bed;
	const problems = [];
	const channels = [];
	let deferred = false;
	let mailDone = null; // what the address now knows: { to, key, label, req, sent }
	let tgDone = ''; // 'sent' | 'gone'
	let tgReqOnly = false; // nothing to send, but the chat's request state is outdated

	// --- e-mail to the ticket's address
	const email = order.getString('email');
	if (email && cfg.mail.enabled) {
		const known = rec.getString('mail_to') === email;
		// The ticket was passed on and this address has heard nothing yet: the
		// spot is not a booking they made (docs/admin/tickets.md).
		const handedOver = !known && !!order.getString('handed_over_at');
		let kind = kindOf(known ? rec.getString('mail_spot') : '', key);
		if (handedOver && kind === 'booked') kind = 'handed_over';
		const lastReq = known ? rec.getString('mail_req') : '';
		const reqKind = requestKindOf(lastReq, request);
		if (!known && !key && !reqKind) {
			// a new address, no spot, no request news: nothing to confirm
			mailDone = { to: email, key: '', label: '', req: reqKey, sent: '' };
			if (handedOver) clearHandedOver(app, order);
		} else if (kind || reqKind) {
			if (!takeMailSlot(app, cfg)) {
				deferred = true;
			} else {
				try {
					sendMail(
						app,
						cfg,
						email,
						guestMail(
							cfg,
							kind,
							spot,
							known ? rec.getString('mail_label') : '',
							greetingName(order),
							pass,
							{ kind: reqKind, status: reqStatus, fixed: fixed }
						)
					);
					mailDone = { to: email, key: key, label: label, req: reqKey, sent: pbDate(now) };
					if (handedOver) clearHandedOver(app, order);
				} catch (err) {
					problems.push('mail: ' + safeError(err));
					channels.push('e-mail ' + maskEmail(email));
				}
			}
		} else if (lastReq !== reqKey) {
			// e.g. a withdrawn request: nothing to tell, but remember it
			mailDone = {
				to: email,
				key: rec.getString('mail_spot'),
				label: rec.getString('mail_label'),
				req: reqKey,
				sent: ''
			};
		}
	}

	// --- Telegram chat the guest linked
	const chat = rec.getString('tg_chat');
	if (chat && cfg.telegram.guests) {
		const isNew = rec.getBool('tg_new');
		const kind = isNew ? 'connected' : kindOf(rec.getString('tg_spot'), key);
		// "connected" tells the request's status itself
		const reqKind = isNew ? '' : requestKindOf(rec.getString('tg_req'), request);
		if (kind || reqKind) {
			const r = telegramCall(
				cfg,
				'sendMessage',
				{
					chat_id: chat,
					text: guestTelegram(cfg, kind, spot, rec.getString('tg_label'), pass, {
						kind: reqKind,
						status: reqStatus,
						fixed: fixed
					}),
					disable_web_page_preview: true
				},
				10
			);
			if (r.ok) {
				tgDone = 'sent';
			} else if (telegramChatGone(r)) {
				tgDone = 'gone'; // blocked the bot or deleted the chat: stop writing there
			} else {
				problems.push('telegram: ' + r.status + ' ' + r.description);
				channels.push('Telegram');
			}
		} else if (rec.getString('tg_req') !== reqKey) {
			tgReqOnly = true;
		}
	}

	const attempts = rec.getInt('attempts') + 1;
	const error = problems.join(' | ').slice(0, 1000);
	let gaveUp = false;
	updateNotify(app, rec.id, (fresh) => {
		if (mailDone) {
			fresh.set('mail_to', mailDone.to);
			fresh.set('mail_spot', mailDone.key);
			fresh.set('mail_label', mailDone.label);
			fresh.set('mail_req', mailDone.req);
			if (mailDone.sent) fresh.set('mail_sent', mailDone.sent);
		}
		// Only for the chat this run wrote to: the guest may have turned
		// updates off or linked another chat meanwhile.
		if (tgDone && fresh.getString('tg_chat') === chat) {
			const sent = tgDone === 'sent';
			fresh.set('tg_chat', sent ? chat : '');
			fresh.set('tg_new', false);
			fresh.set('tg_spot', sent ? key : '');
			fresh.set('tg_label', sent ? label : '');
			fresh.set('tg_req', sent ? reqKey : '');
			if (sent) fresh.set('tg_sent', pbDate(now));
		} else if (tgReqOnly && fresh.getString('tg_chat') === chat) {
			fresh.set('tg_req', reqKey);
		}
		if (fresh.getString('due') !== loadedDue) return; // marked again meanwhile
		if (problems.length > 0) {
			gaveUp = attempts > RETRY_MINUTES.length;
			fresh.set('attempts', attempts);
			fresh.set('last_error', error);
			fresh.set('due', gaveUp ? '' : pbDate(now + RETRY_MINUTES[attempts - 1] * 60000));
		} else if (deferred) {
			fresh.set('due', pbDate(now + 30000));
		} else {
			fresh.set('due', '');
			fresh.set('attempts', 0);
			fresh.set('last_error', '');
		}
	});

	if (gaveUp) {
		// after the save: a failing save must not repeat this alert every pass
		logEvent(app, 'guest_notice_failed', {
			actor: 'server',
			subject: ticketLabel(order),
			details: {
				channels: channels.join(', '),
				attempts: attempts,
				error: maskEmailsIn(error)
			}
		});
	}
	if (problems.length > 0) return 'retry';
	return deferred ? 'deferred' : 'done';
}

/** Due guest messages. keepAlive() renews the loop's lock; false = stop. */
function deliverDue(app, cfg, force, deadline, keepAlive) {
	const rows = app.findRecordsByFilter(
		'guest_notify',
		force ? "due != ''" : "due != '' && due <= @now",
		'due',
		50,
		0
	);
	const outcome = { done: 0, retry: 0, other: 0 };
	for (const rec of rows) {
		if (deadline && Date.now() > deadline) break;
		if (keepAlive && !keepAlive()) break;
		let result;
		try {
			result = deliverOne(app, cfg, rec, force);
		} catch (err) {
			console.error(
				'[cozy-notify] delivery for ' + rec.getString('order') + ' failed: ' + safeError(err)
			);
			// Not again on the next pass: the same error would repeat every few seconds.
			try {
				updateNotify(app, rec.id, (fresh) => {
					if (fresh.getString('due') !== rec.getString('due')) return false;
					fresh.set('due', pbDate(Date.now() + 5 * 60000));
					fresh.set('last_error', ('run: ' + safeError(err)).slice(0, 1000));
				});
			} catch (_) {
				// the database itself is in trouble; the next run tries again
			}
			result = 'other';
		}
		if (result === 'done') outcome.done++;
		else if (result === 'retry') outcome.retry++;
		else outcome.other++;
	}
	return outcome;
}

// --- Telegram: guests link their chat --------------------------------------

function helpText(cfg) {
	return prefixed(cfg, t(cfg, 'bot.help', { appUrl: cfg.appUrl || 'the booking page' }));
}

function reply(cfg, chatId, text) {
	const r = telegramCall(
		cfg,
		'sendMessage',
		{ chat_id: chatId, text: text, disable_web_page_preview: true },
		10
	);
	if (!r.ok) console.warn('[cozy-notify] Telegram reply failed: ' + r.status + ' ' + r.description);
}

function handleUpdate(app, cfg, update) {
	const msg = update && update.message;
	if (!msg || !msg.chat || msg.chat.type !== 'private' || (msg.from && msg.from.is_bot)) return;
	const chatId = String(msg.chat.id);
	const text = String(msg.text || '').trim();

	const start = /^\/start(?:@\w+)?(?:\s+(\S+))?$/.exec(text);
	if (start && start[1]) {
		const hash = $security.sha256(start[1]);
		const rec = findOne(app, 'guest_notify', 'tg_token_hash = {:hash} && tg_token_exp > @now', {
			hash: hash
		});
		const linked =
			!!rec &&
			updateNotify(app, rec.id, (fresh) => {
				if (fresh.getString('tg_token_hash') !== hash) return false; // replaced meanwhile
				fresh.set('tg_chat', chatId);
				fresh.set('tg_new', true);
				fresh.set('tg_spot', '');
				fresh.set('tg_label', '');
				fresh.set('tg_req', '');
				fresh.set('tg_token_hash', '');
				fresh.set('tg_token_exp', '');
				fresh.set('due', pbDate(Date.now()));
			});
		if (!linked) {
			reply(cfg, chatId, prefixed(cfg, t(cfg, 'bot.link_expired')));
			return;
		}
		return; // the delivery run right after this sends "connected" with the spot
	}

	if (/^\/stop(?:@\w+)?$/.test(text)) {
		const linked = app.findRecordsByFilter('guest_notify', 'tg_chat = {:chat}', '', 0, 0, {
			chat: chatId
		});
		for (const rec of linked) {
			updateNotify(app, rec.id, (fresh) => {
				if (fresh.getString('tg_chat') !== chatId) return false;
				fresh.set('tg_chat', '');
				fresh.set('tg_new', false);
				fresh.set('tg_spot', '');
				fresh.set('tg_label', '');
				fresh.set('tg_req', '');
			});
		}
		reply(
			cfg,
			chatId,
			prefixed(cfg, t(cfg, linked.length > 0 ? 'bot.stopped' : 'bot.not_connected'))
		);
		return;
	}

	reply(cfg, chatId, helpText(cfg));
}

/**
 * Reads new bot updates. timeoutSeconds > 0 long-polls (returns as soon as
 * something arrives). Processed updates are confirmed right away, so a
 * restart doesn't handle them twice.
 */
function pollTelegram(app, cfg, timeoutSeconds) {
	const store = app.store();
	const offset = store.get('cozy_tg_offset') || 0;
	const r = telegramCall(
		cfg,
		'getUpdates',
		{ offset: offset, timeout: timeoutSeconds, allowed_updates: ['message'] },
		timeoutSeconds + 10
	);
	if (!r.ok) {
		warnOnce(
			app,
			'poll' + r.status,
			r.status === 409
				? '[cozy-notify] Telegram getUpdates: 409 — a webhook is set or another server polls this bot (use one bot per environment)'
				: '[cozy-notify] Telegram getUpdates failed: ' + r.status + ' ' + r.description
		);
		return -1;
	}
	const updates = r.result || [];
	let next = offset;
	for (const update of updates) {
		next = Math.max(next, update.update_id + 1);
		try {
			handleUpdate(app, cfg, update);
		} catch (err) {
			console.error(
				'[cozy-notify] Telegram update ' + update.update_id + ' failed: ' + safeError(err)
			);
		}
	}
	if (next !== offset) {
		store.set('cozy_tg_offset', next);
		telegramCall(
			cfg,
			'getUpdates',
			{ offset: next, timeout: 0, limit: 1, allowed_updates: ['message'] },
			10
		);
	}
	return updates.length;
}

// --- app_settings flags for the guest pages ---------------------------------

/**
 * Publishes what the server can send (app_settings.notify_mail / telegram_bot).
 * offline: don't ask Telegram for the bot's name, keep the stored one (used
 * while the server starts, where a slow Telegram must not delay anything).
 */
function refreshCapabilities(app, cfg, offline) {
	// Ask Telegram first: nothing may wait on the network between reading and
	// saving app_settings, or an admin's phase switch meanwhile would be undone.
	let bot = null; // null: keep the stored name
	if (!cfg.telegram.guests) bot = '';
	else if (!offline) bot = botUsername(app, cfg);

	let published = null;
	app.runInTransaction((tx) => {
		let settings;
		try {
			settings = tx.findRecordById('app_settings', APP_SETTINGS_ID);
		} catch (_) {
			return; // fresh database: the migrations create it
		}
		if (!settings.collection().fields.getByName('notify_mail')) return;
		const name = bot === null ? settings.getString('telegram_bot') : bot;
		if (
			settings.getBool('notify_mail') === cfg.mail.enabled &&
			settings.getString('telegram_bot') === name
		) {
			return;
		}
		settings.set('notify_mail', cfg.mail.enabled);
		settings.set('telegram_bot', name);
		tx.save(settings);
		published = name;
	});
	if (published !== null) {
		console.log(
			'[cozy-notify] guest updates: e-mail ' +
				(cfg.mail.enabled ? 'on' : 'off') +
				', Telegram ' +
				(published ? '@' + published : 'off')
		);
	}
}

/**
 * Announces an opening or closing time the armed timer just reached (once per
 * time). Not when an admin already switched to that phase by hand after the
 * time (that has its own alert), and not for times older than 15 minutes.
 */
function announceTimer(app) {
	let settings;
	try {
		settings = app.findRecordById('app_settings', APP_SETTINGS_ID);
	} catch (_) {
		return;
	}
	const phase = require(`${__hooks}/lib/phase.js`);
	const w = phase.windowOf(settings);
	if (w.paused) return;
	const now = Date.now();
	const current = phase.effectivePhase(w, now);
	const just = (value) => {
		const ms = phase.toMs(value);
		return ms !== null && ms <= now && now - ms <= 15 * 60000;
	};
	const announce = (at, timerAction, handAction) => {
		const done = findOne(
			app,
			'admin_events',
			'(action = {:timer} && subject = {:at}) || (action = {:hand} && created >= {:at})',
			{ timer: timerAction, hand: handAction, at: at }
		);
		if (!done) logEvent(app, timerAction, { actor: 'timer', subject: at });
	};
	if (current === 'live' && just(w.opensAt)) {
		announce(w.opensAt, 'booking_opened_by_timer', 'booking_live');
	}
	if (current === 'closed' && just(w.closesAt)) {
		announce(w.closesAt, 'booking_closed_by_timer', 'booking_frozen');
	}
}

// --- SMTP settings from the environment --------------------------------------

/**
 * Applies SMTP_* / MAIL_FROM_* to PocketBase's mail settings (config as code,
 * like the Google client). Without SMTP_HOST the stored settings stay as they
 * are. Returns a short description for the log, or ''.
 */
function applyMailSettings(app) {
	const host = env('SMTP_HOST');
	if (!host) return '';
	const from = env('MAIL_FROM_ADDRESS');
	if (!from) {
		console.error('[cozy-notify] SMTP_HOST is set but MAIL_FROM_ADDRESS is not — e-mail stays off');
		return '';
	}
	const port = parseInt(env('SMTP_PORT') || '587', 10);
	const want = {
		enabled: true,
		host: host,
		port: port,
		username: env('SMTP_USERNAME'),
		password: env('SMTP_PASSWORD'),
		authMethod: (env('SMTP_AUTH') || 'PLAIN').toUpperCase(),
		tls: env('SMTP_TLS') ? isOn(env('SMTP_TLS'), false) : port === 465,
		localName: env('SMTP_LOCAL_NAME')
	};
	const settings = app.settings();
	let changed = false;
	for (const key of Object.keys(want)) {
		if (settings.smtp[key] !== want[key]) {
			settings.smtp[key] = want[key];
			changed = true;
		}
	}
	const meta = {
		senderAddress: from,
		senderName: env('MAIL_FROM_NAME') || 'CozyNights',
		appURL: env('COZY_APP_URL') || settings.meta.appURL
	};
	for (const key of Object.keys(meta)) {
		if (settings.meta[key] !== meta[key]) {
			settings.meta[key] = meta[key];
			changed = true;
		}
	}
	if (!changed) return '';
	app.save(settings);
	return host + ':' + port + (want.tls ? ' (TLS)' : ' (STARTTLS if offered)') + ', from ' + from;
}

// --- the delivery loop ------------------------------------------------------

// The lock has an owner: only its holder renews or releases it, so a run that
// outlived its lock can't cut short the next one.
function takeLock(app, seconds) {
	const owner = $security.randomString(16);
	let ok = false;
	app.store().setFunc('cozy_notify_lock', (lock) => {
		if (lock && lock.owner && lock.until > Date.now()) return lock;
		ok = true;
		return { owner: owner, until: Date.now() + seconds * 1000 };
	});
	return ok ? owner : '';
}

function renewLock(app, owner, seconds) {
	let ok = false;
	app.store().setFunc('cozy_notify_lock', (lock) => {
		if (!lock || lock.owner !== owner) return lock;
		ok = true;
		return { owner: owner, until: Date.now() + seconds * 1000 };
	});
	return ok;
}

function releaseLock(app, owner) {
	app
		.store()
		.setFunc('cozy_notify_lock', (lock) =>
			lock && lock.owner === owner ? { owner: '', until: 0 } : lock
		);
}

/** One pass: bot updates, due guest messages, crew alerts, timer. */
function runPass(app, cfg, pollSeconds, force, deadline, keepAlive) {
	const result = { updates: 0, guests: null, alerts: 0 };
	const store = app.store();
	const paused = !force && Date.now() < (store.get('cozy_tg_pause_until') || 0);
	if (cfg.telegram.guests && !paused) {
		result.updates = pollTelegram(app, cfg, pollSeconds);
		if (result.updates < 0) {
			// wrong token, a webhook, another server: don't hammer Telegram
			store.set('cozy_tg_pause_until', Date.now() + TG_POLL_PAUSE_SECONDS * 1000);
			if (pollSeconds > 0) sleep(pollSeconds * 1000);
		}
	} else if (pollSeconds > 0) {
		sleep(pollSeconds * 1000);
	}
	announceTimer(app);
	result.guests = deliverDue(app, cfg, force, deadline, keepAlive);
	result.alerts = sendPendingAlerts(app, cfg, force);
	return result;
}

/** The cron job: repeats short passes for up to COZY_NOTIFY_LOOP_SECONDS. */
function runLoop(app) {
	const cfg = config(app);
	const owner = takeLock(app, LOCK_SECONDS);
	if (!owner) return; // the previous run is still busy
	const keepAlive = () => renewLock(app, owner, LOCK_SECONDS);
	try {
		refreshCapabilities(app, cfg);
		const deadline = Date.now() + cfg.loopSeconds * 1000;
		do {
			if (!keepAlive()) break; // lost the lock (a very slow pass): the next run takes over
			const left = Math.floor((deadline - Date.now()) / 1000);
			try {
				runPass(app, cfg, Math.max(0, Math.min(5, left)), false, deadline, keepAlive);
			} catch (err) {
				console.error('[cozy-notify] run failed: ' + safeError(err));
				if (left > 5) sleep(5000);
			}
		} while (Date.now() < deadline - 1000);
	} finally {
		releaseLock(app, owner);
	}
}

/** One immediate pass (the tests); waits for a running loop to finish. */
function flush(app, force) {
	const cfg = config(app);
	const waitUntil = Date.now() + 15000;
	let owner = takeLock(app, LOCK_SECONDS);
	while (!owner) {
		if (Date.now() > waitUntil) throw new Error('the notification loop is busy, try again');
		sleep(200);
		owner = takeLock(app, LOCK_SECONDS);
	}
	try {
		refreshCapabilities(app, cfg);
		return runPass(app, cfg, 0, !!force, 0, () => renewLock(app, owner, LOCK_SECONDS));
	} finally {
		releaseLock(app, owner);
	}
}

module.exports = {
	TG_LINK_MINUTES: TG_LINK_MINUTES,
	config: config,
	crewConfigured: crewConfigured,
	pbDate: pbDate,
	toMs: toMs,
	safeError: safeError,
	storedValue: storedValue,
	maskEmail: maskEmail,
	berlinTime: berlinTime,
	telegramCall: telegramCall,
	botUsername: botUsername,
	crewSend: crewSend,
	logEvent: logEvent,
	eventText: eventText,
	currentSpot: currentSpot,
	currentRequest: currentRequest,
	requestKindOf: requestKindOf,
	markDue: markDue,
	guestMail: guestMail,
	guestTelegram: guestTelegram,
	loadTexts: loadTexts,
	t: t,
	textCatalogue: textCatalogue,
	previewMessages: previewMessages,
	sendMail: sendMail,
	refreshCapabilities: refreshCapabilities,
	applyMailSettings: applyMailSettings,
	runLoop: runLoop,
	flush: flush
};
