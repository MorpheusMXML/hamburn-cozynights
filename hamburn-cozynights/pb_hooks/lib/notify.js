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
		mailsPerMinute: perMinute > 0 ? perMinute : 20
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

/** The crew chat text of an admin_events record. cfg (optional) adds links. */
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
				(d.kept ? '; ' + d.kept + ' special-needs spot(s) kept' : '')
			);
		// Special-needs requests: never the guest's name or what they wrote.
		case 'special_request_new':
			return (
				'🧡 New special-needs request' +
				(d.open ? ' — ' + d.open + ' waiting for a decision' : '') +
				(requestsUrl ? '\n' + requestsUrl : '')
			);
		case 'special_request_withdrawn':
			return (
				'🧡 A guest withdrew their special-needs request' +
				(d.status ? ' (was ' + d.status + ')' : '')
			);
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
			if (d.newHolder) parts.push('passed on: Telegram disconnected, new booking pass');
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

function greetingName(order) {
	const name = order.getString('customer_name').trim();
	// the CLI's default label for tickets without a name
	if (!name || name === 'Ticket ' + order.getString('order_number')) return '';
	return name;
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
	const hello = name ? 'Hi ' + name + ',' : 'Hi,';
	const mapUrl = cfg.appUrl + '/map';
	const requestUrl = cfg.appUrl + '/special-needs';
	const roomUrl = spot ? cfg.appUrl + '/room/' + spot.roomId : mapUrl;
	const crewBooked = req.kind === 'approved' && req.fixed && !!spot;
	// the spot's details: whenever it is booked or changed, or the crew just booked it
	const showSpot = !!spot && ((!!kind && kind !== 'released') || crewBooked);
	const passUrl = pass && showSpot ? pass.url : '';
	const passLine = passUrl
		? 'Your booking pass (code ' +
			pass.code +
			'): ' +
			passUrl +
			' — show it when you arrive, if the crew asks.'
		: '';
	const fixedLine =
		'The crew picked this spot for you, so please contact the crew to change it. Your room: ' +
		roomUrl;
	let subject;
	let intro;
	let after = [];
	if (crewBooked) {
		subject = 'Your special-needs spot: ' + spot.label;
		intro = 'the crew approved your special-needs request and booked this spot for you:';
		if (kind === 'changed' && previousLabel) after.push('Before: ' + previousLabel);
		if (passLine) after.push(passLine);
		after.push(fixedLine);
	} else if (!kind) {
		if (req.kind === 'received') {
			subject = 'We got your special-needs request';
			intro = 'the crew got your request for a special-needs spot.';
			after = [
				'They look at it and you get an e-mail when they have decided.',
				'To see, change or withdraw your request, open ' +
					requestUrl +
					' and sign in with your ticket code.'
			];
		} else if (req.kind === 'approved') {
			subject = 'Your special-needs request was approved';
			intro = 'the crew approved your request for a special-needs spot.';
			after = [
				spot
					? 'You keep your current spot, ' +
						spot.label +
						', until the crew books a more fitting one for you. Then you get another e-mail.'
					: 'They are picking a fitting spot for you. You get another e-mail as soon as it is booked.',
				'Your request: ' + requestUrl
			];
		} else {
			subject = 'About your special-needs request';
			intro = 'the crew could not offer you a special-needs spot.';
			after = spot
				? [
						'You keep your current spot, ' + spot.label + '.',
						'If you have questions, please contact the crew.'
					]
				: [
						'You can book a spot like everyone else when booking opens: ' + mapUrl,
						'If you have questions, please contact the crew.'
					];
		}
	} else if (kind === 'released') {
		subject = 'Your CozyNights spot was released';
		intro =
			'your ticket no longer holds a spot' +
			(previousLabel ? ' — ' + previousLabel + ' is free again.' : '.');
		if (req.status === 'approved') {
			after = [
				(req.kind === 'approved'
					? 'The crew approved your special-needs request'
					: 'Your special-needs request is still approved') +
					': the crew picks a new spot for you, and you get an e-mail when it is booked.'
			];
		} else {
			after = [
				"If you didn't release it yourself, the crew had to change the camp layout.",
				'While booking is open you can pick a new spot: ' + mapUrl
			];
		}
		if (req.kind === 'declined')
			after.unshift('The crew could not offer you a special-needs spot.');
		if (req.kind === 'received') {
			after.unshift(
				'The crew got your special-needs request; you get an e-mail when they have decided.'
			);
		}
	} else {
		subject =
			(kind === 'changed' ? 'Your CozyNights spot changed: ' : 'Your CozyNights spot: ') +
			spot.label;
		intro = kind === 'changed' ? 'your ticket now holds a different spot:' : 'your spot is booked:';
		if (req.kind === 'received') {
			after.push(
				'The crew also got your special-needs request; you get an e-mail when they have decided.'
			);
		} else if (req.kind === 'approved') {
			after.push(
				'The crew approved your special-needs request. You keep this spot until they book a more fitting one for you; then you get another e-mail.'
			);
		} else if (req.kind === 'declined') {
			after.push('The crew could not offer you a special-needs spot; you keep this spot.');
		}
		if (kind === 'changed' && previousLabel) after.push('Before: ' + previousLabel);
		if (kind === 'changed') {
			after.push(
				req.fixed
					? 'The crew moved you to this spot.'
					: "If you didn't change it yourself, the crew had to move you."
			);
		}
		if (passLine) after.push(passLine);
		after.push(
			req.fixed
				? fixedLine
				: 'To change or release it, open ' +
						roomUrl +
						', sign in with your ticket code and tap your spot — as long as booking is open.'
		);
	}
	const rows = showSpot ? spotLines(spot) : [];
	const footer = 'You get this e-mail because this address belongs to your Hamburn ticket.';

	const text = [hello, '', intro]
		.concat(rows.length ? [''].concat(rows.map((r) => '  ' + (r[0] + ':').padEnd(7) + r[1])) : [])
		.concat([''])
		.concat(after)
		.concat(['', '— The CozyNights crew', '', footer])
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
	const html =
		'<!doctype html><html><body style="margin:0;padding:24px;background:#f6f3ee;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1d1a24">' +
		'<div style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;padding:24px">' +
		(cfg.label
			? '<p style="margin:0 0 12px;color:#b00020;font-weight:bold">' + esc(cfg.label) + '</p>'
			: '') +
		'<p style="margin:0 0 12px">' +
		esc(hello) +
		'</p><p style="margin:0 0 12px">' +
		esc(intro) +
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
		after.map((line) => '<p style="margin:0 0 12px">' + linkify(line) + '</p>').join('') +
		'<p style="margin:16px 0 0">— The CozyNights crew</p>' +
		'<p style="margin:16px 0 0;font-size:12px;color:#6b6478">' +
		esc(footer) +
		'</p></div></body></html>';

	return { subject: prefixed(cfg, subject), text: text, html: html };
}

const REQUEST_STATUS_TEXT = {
	pending: 'waiting for the crew',
	approved: 'approved',
	declined: 'declined'
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
	const passLine = pass && spot ? '\n\n🎫 Booking pass ' + pass.code + ':\n' + pass.url : '';
	const crewBooked = req.kind === 'approved' && req.fixed && !!spot;
	let text;
	if (kind === 'connected') {
		text =
			"✅ Connected! You'll get news about your CozyNights spot here.\n\n" +
			(spot
				? 'Your spot: ' + spot.label + '\n' + roomUrl + passLine
				: "You don't have a spot yet — you'll get a message here when you book one.") +
			(REQUEST_STATUS_TEXT[req.status]
				? '\n\nYour special-needs request: ' + REQUEST_STATUS_TEXT[req.status]
				: '') +
			'\n\nSend /stop to disconnect.';
	} else if (crewBooked) {
		text =
			'✅ Your special-needs request was approved. The crew booked this spot for you:\n' +
			spot.label +
			(kind === 'changed' && previousLabel ? '\nBefore: ' + previousLabel : '') +
			'\n\n' +
			roomUrl +
			passLine +
			'\n\nTo change it, please contact the crew.';
	} else if (!kind) {
		if (req.kind === 'received') {
			text =
				"🧡 The crew got your special-needs request. You'll get a message here when they have decided.\n\nSee, change or withdraw it: " +
				requestUrl;
		} else if (req.kind === 'approved') {
			text = spot
				? '✅ Your special-needs request was approved. You keep your current spot, ' +
					spot.label +
					", until the crew books a more fitting one for you; you'll get a message here when they do."
				: "✅ Your special-needs request was approved. The crew is picking a fitting spot for you; you'll get a message here when it is booked.";
		} else {
			text = spot
				? '✋ The crew could not offer you a special-needs spot. You keep your current spot, ' +
					spot.label +
					'.'
				: '✋ The crew could not offer you a special-needs spot. You can book a spot like everyone else when booking opens: ' +
					mapUrl;
		}
	} else {
		const news =
			req.kind === 'received'
				? '🧡 The crew got your special-needs request.\n\n'
				: req.kind === 'declined'
					? '✋ The crew could not offer you a special-needs spot.\n\n'
					: req.kind === 'approved' && kind !== 'released'
						? "✅ Your special-needs request was approved. You keep this spot until the crew books a more fitting one; you'll get a message here when they do.\n\n"
						: '';
		if (kind === 'released') {
			text =
				news +
				'🫥 Your CozyNights spot was released' +
				(previousLabel ? ': ' + previousLabel + ' is free again.' : '.') +
				(req.status === 'approved'
					? '\n\n' +
						(req.kind === 'approved'
							? 'Your special-needs request was approved'
							: 'Your special-needs request is still approved') +
						": the crew picks a new spot for you, and you'll get a message here when it is booked."
					: "\n\nIf you didn't do this yourself, the crew had to change the camp layout. Pick a new spot while booking is open: " +
						mapUrl);
		} else if (kind === 'changed') {
			text =
				news +
				'🔁 Your CozyNights spot changed\nNow: ' +
				spot.label +
				(previousLabel ? '\nBefore: ' + previousLabel : '') +
				(req.fixed
					? '\n\nThe crew moved you to this spot. To change it, please contact the crew.\n'
					: "\n\nIf you didn't change it yourself, the crew had to move you.\n") +
				roomUrl +
				passLine;
		} else {
			text =
				news +
				'✨ Your CozyNights spot is booked\n' +
				spot.label +
				(req.fixed
					? '\n\nThe crew picked it for you. To change it, please contact the crew.\n'
					: '\n\nChange or release it: ') +
				roomUrl +
				passLine;
		}
	}
	return prefixed(cfg, text);
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
		const kind = kindOf(known ? rec.getString('mail_spot') : '', key);
		const lastReq = known ? rec.getString('mail_req') : '';
		const reqKind = requestKindOf(lastReq, request);
		if (!known && !key && !reqKind) {
			// a new address, no spot, no request news: nothing to confirm
			mailDone = { to: email, key: '', label: '', req: reqKey, sent: '' };
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
			subject: order.getString('customer_name') || order.id,
			details: { channels: channels.join(', '), attempts: attempts, error: error }
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
	return prefixed(
		cfg,
		'👋 This bot sends updates about your CozyNights spot.\n\nTo connect: open ' +
			(cfg.appUrl || 'the booking page') +
			', sign in with your ticket code, open your room or your special-needs request and tap “Get updates on Telegram”.'
	);
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
			reply(
				cfg,
				chatId,
				prefixed(
					cfg,
					'⌛ This link has expired or was already used. Open your room on the booking page and tap “Get updates on Telegram” again.'
				)
			);
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
			prefixed(
				cfg,
				linked.length > 0
					? "🔕 Disconnected. You won't get updates here anymore. You can connect again on the booking page."
					: 'This chat is not connected to a ticket.'
			)
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

/** Announces a go-live timer that just fired (once per timer value). */
function announceTimer(app) {
	let settings;
	try {
		settings = app.findRecordById('app_settings', APP_SETTINGS_ID);
	} catch (_) {
		return;
	}
	if (settings.getBool('is_booking_active')) return;
	const at = settings.getString('booking_unlock_at');
	const ms = toMs(at);
	if (!ms || ms > Date.now() || Date.now() - ms > 15 * 60000) return;
	if (
		findOne(app, 'admin_events', "action = 'booking_opened_by_timer' && subject = {:at}", {
			at: at
		})
	) {
		return;
	}
	logEvent(app, 'booking_opened_by_timer', { actor: 'timer', subject: at });
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
	sendMail: sendMail,
	refreshCapabilities: refreshCapabilities,
	applyMailSettings: applyMailSettings,
	runLoop: runLoop,
	flush: flush
};
