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
// Messages that show the spot carry the booking pass: its link and code, and
// its QR code as a picture (docs/admin/passes.md). E-mails carry the picture
// inside the mail, drawn here by lib/passqr.js, so it shows with remote images
// blocked; Telegram gets it as a photo with a button for the pass.
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
// How long a record is held while it is being delivered. Has to be well over
// LOCK_SECONDS: it is what stops a send that outlives the lock from being
// delivered a second time by the run that takes over (deliverOne).
const LEASE_SECONDS = 300;
// Longest the crew can mute guest messages in one go (setQuiet).
const QUIET_MAX_SECONDS = 600;
// guest_notify.mail_label / tg_label
const LABEL_MAX = 400;
// Telegram caps a photo's caption; a longer message goes out as text.
const TG_CAPTION_MAX = 1024;
// /pass in the same chat answers at most this often.
const TG_PASS_COOLDOWN_SECONDS = 10;
// The guest commands in the bot's menu (private chats only; the crew group
// takes no commands). Fixed here: they are the bot's interface, not texts.
const TG_COMMANDS = [
	{ command: 'pass', description: 'Show my booking pass' },
	{ command: 'stop', description: 'Stop the updates' },
	{ command: 'help', description: 'How this bot works' }
];

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
 *
 * A basic group that became a supergroup (turning on "chat history for new
 * members" or topics does that) gets a new id, and every call to the old one
 * fails with `migrate_to_chat_id`. That id is kept as `migrateTo` and named in
 * `description`, so the log and admin_events.alert_error say what to set.
 * TELEGRAM_CHAT_ID itself is never rewritten here: it comes from .env.
 * @returns {{ok: boolean, status: number, result: any, description: string, retryAfter: number, migrateTo: string}}
 */
function telegramCall(cfg, method, payload, timeoutSeconds) {
	if (!cfg.telegram.token) {
		return {
			ok: false,
			status: 0,
			result: null,
			description: 'no bot token',
			retryAfter: 0,
			migrateTo: ''
		};
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
		const params = json.parameters || {};
		const migrateTo = params.migrate_to_chat_id ? String(params.migrate_to_chat_id) : '';
		let description = safeError(json.description || 'HTTP ' + res.statusCode);
		if (migrateTo) {
			// a chat id, not a secret; only the crew chat's comes from .env
			description +=
				payload && String(payload.chat_id) === cfg.telegram.chatId
					? ' — the group is now a supergroup, set TELEGRAM_CHAT_ID=' + migrateTo
					: ' — the group is now a supergroup with the id ' + migrateTo;
		}
		return {
			ok: res.statusCode === 200 && json.ok === true,
			status: res.statusCode,
			result: json.result,
			description: description,
			retryAfter: params.retry_after || 0,
			migrateTo: migrateTo
		};
	} catch (err) {
		return {
			ok: false,
			status: 0,
			result: null,
			description: safeError(err),
			retryAfter: 0,
			migrateTo: ''
		};
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

/** The Bot API target of the crew chat: the group, and its topic if set. */
function crewTarget(cfg) {
	const target = { chat_id: cfg.telegram.chatId };
	const thread = parseInt(cfg.telegram.threadId, 10);
	if (thread > 0) target.message_thread_id = thread;
	return target;
}

/**
 * Posts one message to the crew chat. Never throws. `migrateTo`: the group's
 * new id when it became a supergroup (see telegramCall), else ''.
 */
function crewSend(cfg, text) {
	const full = prefixed(cfg, text);
	if (cfg.telegram.token && cfg.telegram.chatId) {
		const payload = crewTarget(cfg);
		payload.text = full;
		payload.disable_web_page_preview = true;
		const r = telegramCall(cfg, 'sendMessage', payload, 10);
		return r.ok
			? { ok: true, error: '', migrateTo: '' }
			: { ok: false, error: r.status + ' ' + r.description, migrateTo: r.migrateTo };
	}
	if (cfg.legacyWebhook) return legacyWebhookSend(cfg.legacyWebhook, full);
	return { ok: false, error: 'no crew chat configured' };
}

/**
 * Whether the bot can post in the crew chat, without posting (notify status).
 * sendChatAction needs the same rights as sendMessage, so it fails the same
 * way the alerts would: upgraded group, bot not a member, wrong topic. The
 * group sees "typing…" for a few seconds.
 * @returns {{ok: boolean, error: string, migrateTo: string}}
 */
function crewCheck(cfg) {
	if (!cfg.telegram.token || !cfg.telegram.chatId) {
		return { ok: false, error: 'no crew chat configured', migrateTo: '' };
	}
	const payload = crewTarget(cfg);
	payload.action = 'typing';
	const r = telegramCall(cfg, 'sendChatAction', payload, 10);
	return r.ok
		? { ok: true, error: '', migrateTo: '' }
		: { ok: false, error: r.status + ' ' + r.description, migrateTo: r.migrateTo };
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
		// Request groups the same: never a name, a group's name, its code, a
		// room or what a request is about — counts and record ids only.
		case 'special_request_new':
			return (
				'🧡 New special-needs request' +
				(d.group === 'started'
					? ' (started a group)'
					: d.group === 'joined'
						? ' (joined a group)'
						: '') +
				(d.open ? ' — ' + d.open + ' waiting for a decision' : '') +
				(requestsUrl ? '\n' + requestsUrl : '')
			);
		case 'special_request_withdrawn':
			return (
				'🧡 A guest withdrew their special-needs request' +
				requestStatusNote(d.status) +
				(d.group ? ' and left their group' : '')
			);
		case 'special_request_approved':
			return '✅ Special-needs request approved' + by;
		case 'special_request_declined':
			return '✋ Special-needs request declined' + by;
		case 'special_spot_assigned':
			return '♿ Special-needs spot booked for a guest' + by;
		case 'special_spot_released':
			return '♿ Special-needs spot released' + by;
		case 'request_group_approved':
			return '✅ Request group approved' + by + ': ' + (d.changed || 0) + ' request(s)';
		case 'request_group_declined':
			return (
				'✋ Request group declined' +
				by +
				': ' +
				(d.changed || 0) +
				' request(s)' +
				(d.skipped ? '; ' + d.skipped + ' kept: spot booked by the crew' : '')
			);
		case 'request_group_booked':
			return (
				'👥 Spots booked for a request group' +
				by +
				': ' +
				(d.booked || 0) +
				(d.approved ? ' (' + d.approved + ' request(s) approved on the way)' : '') +
				(d.failed ? ', ' + d.failed + ' not booked' : '')
			);
		case 'request_group_member_removed':
			return '👥 A request was taken out of its group' + by;
		case 'requests_opened':
			return '🧡 Special-needs requests OPENED' + by + ' — guests see a link on the map';
		case 'requests_closed':
			return '🧡 Special-needs requests closed' + by;
		case 'swaps_off':
			return (
				'🔁 Swap requests turned OFF' + by + " — guests can't ask or answer until they are on again"
			);
		case 'swaps_on':
			return '🔁 Swap requests turned on again' + by;
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
				(d.removed ? ', ' + d.removed + ' cancelled ticket(s) deleted' : '') +
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
	return beds.length === 0 ? null : describeBed(app, beds[0]);
}

/** A spot by its record id, described like currentSpot; null when it is gone. */
function spotOfBed(app, bedId) {
	let bed;
	try {
		bed = app.findRecordById('beds', bedId);
	} catch (_) {
		return null;
	}
	return describeBed(app, bed);
}

/** A bed record as the messages show it: label, room, house, bed and features. */
function describeBed(app, bed) {
	const kinds = require(`${__hooks}/lib/beds.js`);
	const spot = { bedId: bed.id, roomId: bed.getString('room'), spot: bed.getString('label') };
	spot.room = '';
	spot.house = '';
	let roomFeatures = [];
	let houseFeatures = [];
	// What the room switched off of the house's features (a superuser's call).
	let roomOff = [];
	try {
		const room = app.findRecordById('rooms', spot.roomId);
		const number = room.getInt('room_number');
		spot.room = (room.getString('name') || 'Room') + (number ? ' #' + number : '');
		roomFeatures = room.get('features');
		roomOff = room.get('features_off');
		const house = app.findRecordById('houses', room.getString('house'));
		spot.house = house.getString('name');
		houseFeatures = house.get('features');
	} catch (_) {
		// a dangling relation: the spot label has to do, and the features of
		// the missing level are just empty
	}
	// What kind of bed it is (for a bunk bed: where the other level is) and
	// what is at it, when the crew wrote it down (src/lib/accommodation.ts).
	const bedType = bed.getString('bed_type');
	const partnerId = bed.getString('bunk_partner');
	let partnerLabel = '';
	if (partnerId) {
		try {
			partnerLabel = app.findRecordById('beds', partnerId).getString('label');
		} catch (_) {
			// the other level is gone: just the kind of bed
		}
	}
	spot.bed = kinds.bedRow(bedType, partnerLabel);
	// The same sum the app shows: what the room or the spot switched off
	// (features_off) is gone, so the message never promises it.
	spot.features = kinds.featureText(
		kinds.effectiveFeatures(houseFeatures, roomFeatures, bedType, roomOff, bed.get('features_off'))
	);
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

// --- muted releases ------------------------------------------------------------
//
// Going back to Staging releases every guest booking. After the event that
// would tell every guest "your spot was released", so the Control Center can
// mute guest messages for the moment of that release (POST
// /api/cozy/notify/quiet; docs/admin/event-checklist.md). Crew alerts are
// admin_events and never pass through markDue: they go out either way.

/** Are guest messages muted right now? */
function isQuiet(app) {
	return Date.now() < (app.store().get('cozy_notify_quiet') || 0);
}

/**
 * Mutes guest messages for `seconds` (capped at QUIET_MAX_SECONDS; 0 or less
 * ends it). Lives in the process's store, so it ends by itself even if the
 * app never comes back to end it.
 * @returns ms since the epoch when it ends (0: not muted)
 */
function setQuiet(app, seconds) {
	const wanted = Math.min(Number(seconds) || 0, QUIET_MAX_SECONDS);
	const until = wanted > 0 ? Date.now() + wanted * 1000 : 0;
	app.store().set('cozy_notify_quiet', until);
	return until;
}

/**
 * Marks a ticket for a delivery run. Called from the bed and order hooks,
 * inside the same transaction as the change itself.
 *
 * While guest messages are muted (setQuiet) nothing is queued. Instead the
 * ticket's channels take its state as it is now as already told: a later
 * booking is then news ("booked") instead of a change from a spot that was
 * released in silence — and nothing about the muted change goes out later.
 */
function markDue(app, orderId, options) {
	if (!orderId) return;
	const opts = options || {};
	if (isQuiet(app)) {
		acceptSilently(app, orderId);
		return;
	}
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

/** The muted counterpart of markDue: the current spot counts as told, nothing is queued. */
function acceptSilently(app, orderId) {
	app.runInTransaction((tx) => {
		const rec = findOne(tx, 'guest_notify', 'order = {:order}', { order: orderId });
		if (!rec) return; // never told anything, so nothing to bring up to date
		const spot = currentSpot(tx, orderId);
		const key = spot ? spot.bedId : '';
		const label = spot ? spot.label : '';
		// Both channels, whichever is in use: deliverOne only reads the one
		// that belongs to a known address or a linked chat.
		rec.set('mail_spot', key);
		rec.set('mail_label', label);
		rec.set('tg_spot', key);
		rec.set('tg_label', label);
		// A message that was waiting to settle is about the old state: dropped.
		rec.set('due', '');
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
 * How the crew chat may name this ticket: "Ticket H•••", or a short record id
 * when the ticket has no code. Never the holder, never a full code — an alert
 * about a ticket must not name the person another alert just wrote about.
 */
function ticketLabel(order) {
	return TICKETS.maskedTicketLabel(order.getString('order_number')) || '#' + order.id.slice(0, 5);
}

/**
 * The rows of an e-mail that shows the spot: House, Room, Spot and, when the
 * crew wrote them down, Bed ("Upper bunk · above B1") and Features
 * ("🔥 Heated · 🤫 Quiet zone"). Empty rows are left out.
 */
function spotLines(spot) {
	return [
		['House', spot.house],
		['Room', spot.room],
		['Spot', spot.spot],
		['Bed', spot.bed],
		['Features', spot.features]
	].filter((row) => !!row[1]);
}

/**
 * The bed and what is at it in one line, "Lower bunk · below B2 · 🔥 Heated",
 * or '' when the crew wrote nothing down (or there is no spot).
 */
function bedText(spot) {
	return spot ? [spot.bed, spot.features].filter((s) => !!s).join(' · ') : '';
}

/** The 🛏 line under the spot of a Telegram message, line break included; '' without a bed. */
function bedLine(cfg, spot) {
	const bed = bedText(spot);
	return bed ? '\n' + t(cfg, 'tg.bed', { bed: bed }) : '';
}

/**
 * Subject, plain text and HTML of a guest e-mail. kind: booked | changed |
 * swapped (changed by a swap the guest agreed to) | released | handed_over
 * (the ticket was passed on, and this address hears about its spot for the
 * first time), or '' when only the special-needs request changed. pass: { code,
 * url } of the ticket's booking pass, or null. request (optional): { kind:
 * received | approved | declined | '' (what to tell about the request),
 * status: its current status, fixed: the ticket's spot is the one the crew
 * booked for the request, so only the crew changes it }. Every combination
 * tells both: a message is sent once per state, news left out is lost.
 * offers (optional): { telegram: the guest can still connect Telegram — a
 * line under a message that shows the spot; qr: the sender attaches the
 * pass's QR code as a picture (passQrImage), shown under the spot's rows }.
 * The result says whether its HTML shows the picture (usesQr) and under which
 * Content-ID (qrCid).
 */
function guestMail(cfg, kind, spot, previousLabel, name, pass, request, offers) {
	const req = request || { kind: '', status: '', fixed: false };
	const offer = offers || { telegram: false, qr: false };
	const mapUrl = cfg.appUrl + '/map';
	const requestUrl = cfg.appUrl + '/special-needs';
	const roomUrl = spot ? cfg.appUrl + '/room/' + spot.roomId : mapUrl;
	const telegramUrl = cfg.appUrl + '/telegram';
	const vars = {
		name: name || '',
		spot: spot ? spot.label : '',
		before: previousLabel || '',
		roomUrl: roomUrl,
		mapUrl: mapUrl,
		requestUrl: requestUrl,
		passCode: pass ? pass.code : '',
		passUrl: pass ? pass.url : '',
		telegramUrl: telegramUrl
	};
	const T = (key) => t(cfg, key, vars);
	const hello = name ? T('mail.greeting') : T('mail.greeting_anonymous');
	const crewBooked = req.kind === 'approved' && req.fixed && !!spot;
	// the spot's details: whenever it is booked or changed, or the crew just booked it
	const showSpot = !!spot && ((!!kind && kind !== 'released') || crewBooked);
	const passUrl = pass && showSpot ? pass.url : '';
	const passLine = passUrl ? T('mail.pass') : '';
	const telegramLine = showSpot && offer.telegram ? T('mail.telegram') : '';
	const fixedLine = T('mail.fixed');
	// News about a request that arrives while a spot message is still due rides
	// along with it: one message per settled state, so a line left out is lost.
	const alsoRequest =
		req.kind === 'received'
			? T('mail.also.received')
			: req.kind === 'approved'
				? T('mail.also.approved')
				: req.kind === 'declined'
					? T('mail.also.declined')
					: '';
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
		// not a booking they made. The pass line is its own — the new holder is
		// the one person who may still have the old link, from the seller.
		subject = T('mail.handed_over.subject');
		intro = T('mail.handed_over.intro');
		if (alsoRequest) after.push(alsoRequest);
		if (passUrl) after.push(T('mail.handed_over.pass'));
		after.push(req.fixed ? fixedLine : T('mail.booked.change'));
	} else if (kind === 'swapped') {
		// A swap both guests agreed to: their own doing, so no "maybe the crew
		// moved you" — and the old spot is the other guest's now.
		subject = T('mail.swapped.subject');
		intro = T('mail.swapped.intro');
		if (alsoRequest) after.push(alsoRequest);
		if (previousLabel) after.push(T('mail.swapped.before'));
		if (passLine) after.push(passLine);
		after.push(req.fixed ? fixedLine : T('mail.booked.change'));
	} else {
		subject = kind === 'changed' ? T('mail.changed.subject') : T('mail.booked.subject');
		intro = kind === 'changed' ? T('mail.changed.intro') : T('mail.booked.intro');
		if (alsoRequest) after.push(alsoRequest);
		if (kind === 'changed' && previousLabel) after.push(T('mail.changed.before'));
		if (kind === 'changed') {
			after.push(req.fixed ? T('mail.changed.by_crew') : T('mail.changed.maybe_crew'));
		}
		if (passLine) after.push(passLine);
		after.push(req.fixed ? fixedLine : T('mail.booked.change'));
	}
	if (telegramLine) after.push(telegramLine);
	return composeMail(cfg, vars, {
		subject: subject,
		hello: hello,
		intro: intro,
		rows: showSpot ? spotLines(spot) : [],
		after: after,
		urls: [passUrl, roomUrl, mapUrl, requestUrl, telegramLine ? telegramUrl : ''],
		// only with the pass: a released spot or request news alone has none to show
		qr:
			passUrl && offer.qr
				? { cid: passQrCid(pass), alt: 'QR code of your booking pass ' + pass.code }
				: null
	});
}

/**
 * The e-mail itself, as text and HTML: greeting, first line, the rows of a
 * table (House, Room, …), the lines after it, signature and small print. The
 * first of `urls` in a line becomes a link in the HTML. Every guest e-mail
 * looks like this, the spot messages and the swap requests alike.
 * parts.qr (optional): { cid, alt } of the pass's QR code, shown in the HTML
 * right under the table — a fixed place that no changed text can move or
 * drop. The text part has no picture; the pass line there has link and code.
 */
function composeMail(cfg, vars, parts) {
	const T = (key) => t(cfg, key, vars);
	const hello = parts.hello;
	const intro = parts.intro;
	const rows = parts.rows;
	const after = parts.after;
	const qr = parts.qr || null;
	const signature = T('mail.signature');
	const footer = T('mail.footer');

	const text = [hello, '', intro]
		.concat(rows.length ? [''].concat(rows.map((r) => '  ' + (r[0] + ':').padEnd(10) + r[1])) : [])
		.concat([''])
		.concat(after)
		.concat(['', signature, '', footer])
		.join('\n');

	const link = (url) => '<a href="' + esc(url) + '" style="color:#7a3cff">' + esc(url) + '</a>';
	// Each line holds at most one link; link its first URL once.
	const urls = parts.urls.filter((u) => !!u);
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
		(qr ? passQrHtml(qr) : '') +
		after.map((line) => '<p style="margin:0 0 12px">' + para(line) + '</p>').join('') +
		'<p style="margin:16px 0 0">' +
		para(signature) +
		'</p>' +
		'<p style="margin:16px 0 0;font-size:12px;color:#6b6478">' +
		para(footer) +
		'</p></div></body></html>';

	return {
		subject: prefixed(cfg, parts.subject),
		text: text,
		html: html,
		qrCid: qr ? qr.cid : '',
		// what the sender has to attach: a picture the HTML doesn't show would
		// only turn up as a stray attachment
		usesQr: !!qr && html.indexOf('cid:' + qr.cid) >= 0
	};
}

/**
 * The Content-ID of a pass's QR code in an e-mail. It doubles as the file name
 * of the picture, the same as the pass's qr.png download in the app.
 */
function passQrCid(pass) {
	return 'cozynights-pass-' + pass.code + '.png';
}

/**
 * The picture in the HTML, at 205 px: half the 410 px of a pass link's PNG,
 * sharp on a retina screen. The alt text names the code for a mail app that
 * can't show it.
 */
function passQrHtml(qr) {
	return (
		'<p style="margin:0 0 16px"><img src="cid:' +
		esc(qr.cid) +
		'" width="205" height="205" alt="' +
		esc(qr.alt) +
		'" style="display:block;width:205px;height:205px;border:0;outline:none"></p>'
	);
}

/**
 * The pass's QR code as PNG bytes (lib/passqr.js), or null: the picture is a
 * bonus, a mail without it still has the pass's link and code. Never throws.
 */
function passQrImage(pass) {
	if (!pass || !pass.url) return null;
	try {
		return require(`${__hooks}/lib/passqr.js`).passQrPng(pass.url);
	} catch (err) {
		console.error('[cozy-notify] pass QR picture: ' + safeError(err));
		return null;
	}
}

const REQUEST_STATUS_KEY = {
	pending: 'tg.status.pending',
	approved: 'tg.status.approved',
	declined: 'tg.status.declined'
};

/**
 * kind: connected | booked | changed | swapped | released, or '' when only
 * the special-needs request changed; pass: { code, url } or null; request
 * (optional): { kind, status, fixed } like guestMail.
 */
function guestTelegram(cfg, kind, spot, previousLabel, pass, request) {
	const req = request || { kind: '', status: '', fixed: false };
	const mapUrl = cfg.appUrl + '/map';
	const requestUrl = cfg.appUrl + '/special-needs';
	const roomUrl = spot ? cfg.appUrl + '/room/' + spot.roomId : mapUrl;
	const vars = {
		spot: spot ? spot.label : '',
		bed: bedText(spot),
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
	// The 🛏 line right under the spot, when the crew wrote the bed down.
	const bed = bedLine(cfg, spot);
	const crewBooked = req.kind === 'approved' && req.fixed && !!spot;
	let text;
	if (kind === 'connected') {
		const statusKey = REQUEST_STATUS_KEY[req.status];
		vars.status = statusKey ? T(statusKey) : '';
		text =
			T('tg.connected.intro') +
			'\n\n' +
			(spot ? T('tg.connected.spot') + bed + passLine : T('tg.connected.no_spot')) +
			(vars.status ? '\n\n' + T('tg.connected.request') : '') +
			'\n\n' +
			T('tg.connected.stop');
	} else if (crewBooked) {
		text =
			T('tg.crew_booked.intro') +
			bed +
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
				bed +
				(previousLabel ? '\n' + T('tg.before') : '') +
				'\n\n' +
				(req.fixed ? T('tg.changed.by_crew') : T('tg.changed.maybe_crew')) +
				passLine;
		} else if (kind === 'swapped') {
			// a swap both guests agreed to: no "maybe the crew moved you"
			text =
				news +
				T('tg.swapped.intro') +
				bed +
				(previousLabel ? '\n' + T('tg.swapped.before') : '') +
				'\n\n' +
				(req.fixed ? T('tg.booked.by_crew') : T('tg.booked.change')) +
				passLine;
		} else {
			text =
				news +
				T('tg.booked.intro') +
				bed +
				'\n\n' +
				(req.fixed ? T('tg.booked.by_crew') : T('tg.booked.change')) +
				passLine;
		}
	}
	return prefixed(cfg, text);
}

/**
 * What a Telegram message that shows the spot carries besides its text: the
 * pass's QR code as a picture (Telegram's servers fetch the PNG from the app,
 * like a phone opens the pass link that is in the text anyway) and a button
 * for the pass. null without a pass.
 */
function passAttachments(cfg, pass) {
	if (!pass || !pass.url) return null;
	return {
		photo: pass.url + '/qr.png',
		markup: { inline_keyboard: [[{ text: '🎫 Show booking pass', url: pass.url }]] }
	};
}

/**
 * Sends a guest message: with the QR code and buttons when `extras` has them,
 * else as text. The picture and the buttons are extras: when Telegram refuses
 * them (it can't fetch the picture, a button's link isn't public), the message
 * goes out as plain text instead of being lost. Returns telegramCall's result
 * of the last try, so the caller can tell a gone chat from a failure.
 */
function sendGuestTelegram(cfg, chatId, text, extras) {
	const plain = { chat_id: chatId, text: text, disable_web_page_preview: true };
	const refusedExtras = (r) => !r.ok && r.status === 400 && !telegramChatGone(r);
	if (extras) {
		// a message with buttons but without a picture (a swap request) skips the photo
		if (extras.photo && text.length <= TG_CAPTION_MAX) {
			const photo = telegramCall(
				cfg,
				'sendPhoto',
				{ chat_id: chatId, photo: extras.photo, caption: text, reply_markup: extras.markup },
				15
			);
			if (!refusedExtras(photo)) return photo;
		}
		const withButtons = telegramCall(
			cfg,
			'sendMessage',
			Object.assign({}, plain, { reply_markup: extras.markup }),
			10
		);
		if (!refusedExtras(withButtons)) return withButtons;
	}
	return telegramCall(cfg, 'sendMessage', plain, 10);
}

/** The booking pass of the sample guest: the admin preview and `cozy-admin notify test`. */
function samplePass(cfg) {
	return { code: 'AAAA-BBBB-CCCC', url: cfg.appUrl + '/pass/AAAA-BBBB-CCCC' };
}

/**
 * Sample messages for the admin page (/admin/messages), rendered with cfg.texts
 * like the real ones: every text is in at least one of them (tests/notify-
 * messages.test.ts checks). The sample guest is Ada with a booking pass.
 * The e-mails reference the pass's QR code as cid: like the real ones, which
 * the page's frame can't resolve: qrPreview has the picture once, as a data:
 * URI to put in its place (null when it could not be drawn, and then the
 * e-mails go without it, like a real one would).
 */
function previewMessages(cfg) {
	const spot = {
		bedId: 'sample',
		roomId: 'sample',
		spot: 'B1',
		room: 'Dorm #2',
		house: 'Villa',
		label: 'B1 · Dorm #2 · Villa',
		bed: 'Lower bunk · below B2',
		features: '🔥 Heated · 🤫 Quiet zone'
	};
	const before = 'B7 · Loft #1 · Hut';
	const pass = samplePass(cfg);
	const qrPng = passQrImage(pass);
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
		},
		{
			id: 'swapped',
			title: 'Swap done: both guests get this after a yes',
			kind: 'swapped',
			spot: true,
			before: before,
			req: none
		}
	];
	const name = (c) => (c.name === undefined ? 'Ada' : c.name);
	// Ada hasn't connected Telegram yet: the offer lines show where this
	// server would send them.
	const offers = { telegram: !!(cfg.telegram && cfg.telegram.guests), qr: !!qrPng };
	const mail = cases.map((c) => {
		const m = guestMail(
			cfg,
			c.kind || '',
			c.spot ? spot : null,
			c.before || '',
			name(c),
			pass,
			c.req,
			offers
		);
		return { id: c.id, title: c.title, subject: m.subject, text: m.text, html: m.html };
	});
	// Swap requests: someone offers Ada the upper bunk B7 for her B1, or Ada
	// asked for B7 and heard a no. The asker's own words never go out.
	const offered = {
		bedId: 'sample2',
		roomId: 'sample2',
		spot: 'B7',
		room: 'Loft #1',
		house: 'Hut',
		label: before,
		bed: 'Upper bunk · above B6',
		features: ''
	};
	const until = 'Thu 1 Oct 18:00 (Berlin)';
	const swapCases = [
		{ id: 'swap_ask', title: 'Swap request: someone would like to swap', kind: 'ask' },
		{ id: 'swap_no', title: 'Swap request: the other guest said no', kind: 'no' }
	];
	for (const c of swapCases) {
		const m = swapMail(cfg, c.kind, spot, offered, 'Ada', until);
		mail.push({ id: c.id, title: c.title, subject: m.subject, text: m.text, html: m.html });
	}
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
	for (const c of swapCases) {
		telegram.push({
			id: c.id,
			title: c.title,
			text: swapTelegram(cfg, c.kind, spot, offered, until)
		});
	}
	const bot = [
		{ id: 'help', title: 'Any other message to the bot', text: helpText(cfg) },
		{
			id: 'link_expired',
			title: 'The connect link has expired',
			text: prefixed(cfg, t(cfg, 'bot.link_expired', { appUrl: cfg.appUrl || 'the booking page' }))
		},
		{ id: 'stopped', title: '/stop', text: prefixed(cfg, t(cfg, 'bot.stopped')) },
		{
			id: 'not_connected',
			title: '/stop or /pass in a chat that is not connected',
			text: prefixed(cfg, t(cfg, 'bot.not_connected'))
		},
		{
			id: 'pass',
			title: '/pass (the QR code comes along as a picture)',
			text: prefixed(
				cfg,
				t(cfg, 'bot.pass', { spot: spot.label, passCode: pass.code, passUrl: pass.url }) +
					bedLine(cfg, spot)
			)
		},
		{
			id: 'pass_no_spot',
			title: '/pass while the ticket holds no spot',
			text: prefixed(cfg, t(cfg, 'bot.pass_no_spot', { mapUrl: cfg.appUrl + '/map' }))
		}
	];
	const qrPreview = qrPng
		? { cid: passQrCid(pass), src: require(`${__hooks}/lib/passqr.js`).dataUri(qrPng) }
		: null;
	return { mail: mail, telegram: telegram, bot: bot, qrPreview: qrPreview };
}

/**
 * Hands one message to PocketBase's mail client. This blocks for as long as
 * the SMTP server takes: PocketBase 0.40 has no timeout for it, in the
 * settings or anywhere else the JSVM can reach (unlike telegramCall, which
 * passes one to $http.send). A hanging send is therefore survived rather than
 * cut short — deliverOne leases the record before it gets here.
 *
 * msg.inline (optional): { <cid>: bytes } — pictures inside the mail, which
 * the HTML shows as <img src="cid:<cid>">. PocketBase's mailer uses the key as
 * Content-ID and file name, and reads the type from the bytes.
 */
function sendMail(app, cfg, to, msg) {
	const meta = app.settings().meta;
	const headers = { 'Auto-Submitted': 'auto-generated' };
	if (cfg.mail.replyTo) headers['Reply-To'] = cfg.mail.replyTo;
	const fields = {
		from: { address: meta.senderAddress, name: meta.senderName },
		to: [{ address: to }],
		subject: msg.subject,
		html: msg.html,
		text: msg.text,
		headers: headers
	};
	const readers = [];
	try {
		if (msg.inline) {
			fields.inlineAttachments = {};
			for (const cid of Object.keys(msg.inline)) {
				const reader = $filesystem.fileFromBytes(msg.inline[cid], cid).reader.open();
				readers.push(reader);
				fields.inlineAttachments[cid] = reader;
			}
		}
		app.newMailClient().send(new MailerMessage(fields));
	} finally {
		for (const reader of readers) {
			try {
				reader.close();
			} catch (_) {
				// in-memory bytes: nothing to clean up that could fail the send
			}
		}
	}
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
 * Whether the ticket's move from spot `before` to spot `now` was a swap it
 * agreed to or asked for (an accepted swap request with exactly these two
 * spots): the message then says so instead of "maybe the crew moved you".
 */
function swappedFrom(app, orderId, before, now) {
	if (!before || !now) return false;
	try {
		const rows = app.findRecordsByFilter(
			'swap_requests',
			"status = 'accepted' && (" +
				'(from_order = {:order} && from_bed = {:before} && to_bed = {:now}) || ' +
				'(to_order = {:order} && to_bed = {:before} && from_bed = {:now}))',
			'',
			1,
			0,
			{ order: orderId, before: before, now: now }
		);
		return rows.length > 0;
	} catch (_) {
		return false; // a database from before swap requests
	}
}

/**
 * One delivery run for one guest_notify record. Decides from the record as
 * it was read, sends, then writes back only what it decided (updateNotify):
 * if the ticket was marked again meanwhile, that newer mark stays and the next
 * pass handles the newer state.
 *
 * Before the first send the record is leased (`due` pushed LEASE_SECONDS out),
 * so a send that takes longer than the loop's lock can't be delivered twice.
 * `keepAlive` renews that lock and is checked right before the lease.
 */
function deliverOne(app, cfg, rec, force, keepAlive) {
	const now = Date.now();
	let loadedDue = rec.getString('due');
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

	// Take the record out of reach before anything goes out. Without this a
	// send that hangs longer than LOCK_SECONDS lets the next cron run take the
	// lock, find the same record still due, and send everything a second time —
	// and the mail client has no timeout of its own (sendMail). The closing
	// write below replaces the lease with the real result; a run that dies
	// mid-send leaves it in place, so the record is retried in LEASE_SECONDS
	// instead of right away.
	if (keepAlive && !keepAlive()) return 'lock-lost';
	const lease = pbDate(now + LEASE_SECONDS * 1000);
	const leased = updateNotify(app, rec.id, (fresh) => {
		if (fresh.getString('due') !== loadedDue) return false; // another run has it
		fresh.set('due', lease);
	});
	if (!leased) return 'skipped';
	// What the closing write checks against from here on — and deliverDue's
	// error path, which compares with the record it handed in.
	loadedDue = lease;
	rec.set('due', lease);

	const spot = currentSpot(app, order.id);
	const key = spot ? spot.bedId : '';
	const label = spot ? spot.label : '';
	const pass = spot ? bookingPass(app, cfg, order) : null;
	// The special-needs request, remembered per channel as "<id>:<status>".
	const request = currentRequest(app, order.id);
	const handover = order.getString('handed_over_at');
	const reqKey = requestKey(request);
	const reqStatus = request ? request.status : '';
	// only the spot the crew booked for the approved request is theirs to change
	const fixed = !!request && request.status === 'approved' && !!request.bed && key === request.bed;
	const problems = [];
	const channels = [];
	let deferred = false;
	// what the address now knows: { to, key, label, req, sent, handover }
	let mailDone = null;
	let tgDone = ''; // 'sent' | 'gone'
	let tgReqOnly = false; // nothing to send, but the chat's request state is outdated

	// --- e-mail to the ticket's address
	const email = order.getString('email');
	if (email && cfg.mail.enabled) {
		const known = rec.getString('mail_to') === email;
		// The ticket was passed on and this address has not been told yet: the
		// spot is not a booking they made (docs/admin/tickets.md). Remembered
		// here like everything else an address knows, so the run never writes to
		// the ticket — handed_over_at stays as the date it changed hands.
		const handedOver = !known && !!handover && rec.getString('mail_handover') !== handover;
		let kind = kindOf(known ? rec.getString('mail_spot') : '', key);
		if (handedOver && kind === 'booked') kind = 'handed_over';
		if (kind === 'changed' && swappedFrom(app, order.id, rec.getString('mail_spot'), key)) {
			kind = 'swapped';
		}
		const lastReq = known ? rec.getString('mail_req') : '';
		const reqKind = requestKindOf(lastReq, request);
		if (!known && !key && !reqKind) {
			// a new address, no spot, no request news: nothing to confirm
			mailDone = { to: email, key: '', label: '', req: reqKey, sent: '', handover: handover };
		} else if (kind || reqKind) {
			if (!takeMailSlot(app, cfg)) {
				deferred = true;
			} else {
				try {
					const mailWith = (qr) =>
						guestMail(
							cfg,
							kind,
							spot,
							known ? rec.getString('mail_label') : '',
							greetingName(order),
							pass,
							{ kind: reqKind, status: reqStatus, fixed: fixed },
							{
								// only a guest who hasn't connected a chat yet is offered one
								telegram: cfg.telegram.guests && !rec.getString('tg_chat'),
								qr: qr
							}
						);
					// The QR code is drawn only for a mail that shows the pass. A
					// picture that can't be drawn is no failed delivery: the mail goes
					// without it, its pass link and code are in the text anyway.
					let message = mailWith(true);
					if (message.usesQr) {
						const png = passQrImage(pass);
						if (png) message.inline = { [message.qrCid]: png };
						else message = mailWith(false);
					}
					sendMail(app, cfg, email, message);
					mailDone = {
						to: email,
						key: key,
						label: label,
						req: reqKey,
						sent: pbDate(now),
						handover: handover
					};
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
				sent: '',
				handover: handover
			};
		}
	}

	// --- Telegram chat the guest linked
	const chat = rec.getString('tg_chat');
	if (chat && cfg.telegram.guests) {
		const isNew = rec.getBool('tg_new');
		let kind = isNew ? 'connected' : kindOf(rec.getString('tg_spot'), key);
		if (kind === 'changed' && swappedFrom(app, order.id, rec.getString('tg_spot'), key)) {
			kind = 'swapped';
		}
		// "connected" tells the request's status itself
		const reqKind = isNew ? '' : requestKindOf(rec.getString('tg_req'), request);
		if (kind || reqKind) {
			// The QR code rides along with every message that shows the spot
			// (connected, booked, changed, booked by the crew for a request): what
			// the guest shows at arrival is then right there in the chat.
			const showsSpot =
				!!spot &&
				(kind === 'connected' ||
					kind === 'booked' ||
					kind === 'changed' ||
					kind === 'swapped' ||
					(reqKind === 'approved' && fixed));
			const r = sendGuestTelegram(
				cfg,
				chat,
				guestTelegram(cfg, kind, spot, rec.getString('tg_label'), pass, {
					kind: reqKind,
					status: reqStatus,
					fixed: fixed
				}),
				showsSpot ? passAttachments(cfg, pass) : null
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
			fresh.set('mail_handover', mailDone.handover || '');
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
			result = deliverOne(app, cfg, rec, force, keepAlive);
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

// --- swap requests (docs/admin/swaps.md) -------------------------------------
//
// A request is news for two guests: the one it is addressed to hears that
// someone would like to swap (the "ask"), and the one who asked hears a "no".
// A "yes" swaps the spots, and both tickets get the usual message about their
// new spot, worded as a swap (deliverOne, kind 'swapped'). Nothing about an
// ended, withdrawn or quiet request goes out: the app shows those. The app
// sets swap_requests.notify_due when there is something to tell;
// ask_mail/ask_tg/answer_mail/answer_tg remember what went out where. What
// the asker wrote never leaves the app — the messages link to it.

// Retry after 1, 5, 15 minutes, 1 and 4 hours, then give up and alert the crew.
const SWAP_RETRY_MINUTES = [1, 5, 15, 60, 240];
// The button under a Telegram swap request (the bot's interface, not a text).
const SWAP_BUTTON = '🔁 Answer the swap request';

/**
 * Subject, text and HTML of a swap e-mail. kind 'ask': to the guest the
 * request is addressed to — `mine` is their spot, `other` the one offered.
 * kind 'no': to the guest who asked — `mine` is their spot, `other` the one
 * they asked for. until: when the request runs out, in words.
 */
function swapMail(cfg, kind, mine, other, name, until) {
	const vars = {
		name: name || '',
		spot: mine ? mine.label : '',
		other: other ? other.label : '',
		bed: bedText(other),
		until: until || '',
		swapUrl: cfg.appUrl + '/swaps',
		mapUrl: cfg.appUrl + '/map'
	};
	const T = (key) => t(cfg, key, vars);
	const hello = name ? T('mail.greeting') : T('mail.greeting_anonymous');
	if (kind === 'ask') {
		const after = [T('mail.swap_ask.offer')];
		if (vars.bed) after.push(T('mail.swap_ask.bed'));
		after.push(T('mail.swap_ask.yours'), T('mail.swap_ask.answer'), T('mail.swap_ask.nothing'));
		return composeMail(cfg, vars, {
			subject: T('mail.swap_ask.subject'),
			hello: hello,
			intro: T('mail.swap_ask.intro'),
			rows: [],
			after: after,
			urls: [vars.swapUrl]
		});
	}
	return composeMail(cfg, vars, {
		subject: T('mail.swap_no.subject'),
		hello: hello,
		intro: T('mail.swap_no.intro'),
		rows: [],
		after: [T('mail.swap_no.keep')],
		urls: [vars.mapUrl]
	});
}

/** A Telegram swap message, kind 'ask' or 'no' like swapMail. */
function swapTelegram(cfg, kind, mine, other, until) {
	const vars = {
		spot: mine ? mine.label : '',
		other: other ? other.label : '',
		until: until || '',
		swapUrl: cfg.appUrl + '/swaps'
	};
	const T = (key) => t(cfg, key, vars);
	if (kind === 'ask') {
		return prefixed(
			cfg,
			T('tg.swap_ask.intro') +
				bedLine(cfg, other) +
				'\n' +
				T('tg.swap_ask.yours') +
				'\n\n' +
				T('tg.swap_ask.answer')
		);
	}
	return prefixed(cfg, T('tg.swap_no'));
}

/** Like updateNotify, for a swap request: re-read in a transaction, save what `change` decided. */
function updateSwap(app, id, change) {
	let saved = false;
	app.runInTransaction((tx) => {
		let fresh;
		try {
			fresh = tx.findRecordById('swap_requests', id);
		} catch (_) {
			return; // deleted meanwhile (hand-over, forget-contacts, ticket removed)
		}
		if (change(fresh) === false) return;
		tx.save(fresh);
		saved = true;
	});
	return saved;
}

/**
 * One delivery for one swap request whose notify_due has come: the ask while
 * it is open (and can still happen), or the "no" after a decline. Leased like
 * deliverOne, so a slow send is never delivered twice; each channel is sent
 * once (ask_mail, ask_tg, …), a failed one is retried on its own.
 */
function deliverSwap(app, cfg, rec, keepAlive) {
	const now = Date.now();
	const loadedDue = rec.getString('notify_due');
	const status = rec.getString('status');
	const ask = status === 'pending';
	let tell = ask || status === 'declined';
	if (ask) {
		// A quiet request is never told; one that can't happen any more (a spot
		// moved on, booking closed, the other guest's spot can't be swapped)
		// isn't either — the app shows how it ended.
		const SWAP = require(`${__hooks}/lib/swap.js`);
		if (rec.getBool('quiet') || SWAP.requestProblem(app, rec, now)) tell = false;
	}
	if (!tell) {
		updateSwap(app, rec.id, (fresh) => {
			if (fresh.getString('notify_due') !== loadedDue) return false;
			fresh.set('notify_due', '');
		});
		return 'skipped';
	}

	if (keepAlive && !keepAlive()) return 'lock-lost';
	const lease = pbDate(now + LEASE_SECONDS * 1000);
	const leased = updateSwap(app, rec.id, (fresh) => {
		if (fresh.getString('notify_due') !== loadedDue) return false; // another run has it
		fresh.set('notify_due', lease);
	});
	if (!leased) return 'skipped';

	// the guest to tell: the one asked (ask), or the one who asked (no)
	const orderId = rec.getString(ask ? 'to_order' : 'from_order');
	let order;
	try {
		order = app.findRecordById('orders', orderId);
	} catch (_) {
		return 'gone'; // the ticket went, and took the request along (cascade)
	}
	const mine = spotOfBed(app, rec.getString(ask ? 'to_bed' : 'from_bed'));
	const other = spotOfBed(app, rec.getString(ask ? 'from_bed' : 'to_bed'));
	const until = berlinTime(rec.getString('expires_at'));
	const kind = ask ? 'ask' : 'no';
	const mailField = ask ? 'ask_mail' : 'answer_mail';
	const tgField = ask ? 'ask_tg' : 'answer_tg';
	const problems = [];
	const channels = [];
	let deferred = false;
	let mailDone = '';
	let tgDone = '';

	const email = order.getString('email');
	if (email && cfg.mail.enabled && !rec.getString(mailField)) {
		if (!takeMailSlot(app, cfg)) {
			deferred = true;
		} else {
			try {
				sendMail(app, cfg, email, swapMail(cfg, kind, mine, other, greetingName(order), until));
				mailDone = pbDate(now);
			} catch (err) {
				problems.push('mail: ' + safeError(err));
				channels.push('e-mail ' + maskEmail(email));
			}
		}
	}

	const notifyRec = findOne(app, 'guest_notify', 'order = {:order}', { order: orderId });
	const chat = notifyRec ? notifyRec.getString('tg_chat') : '';
	if (chat && cfg.telegram.guests && !rec.getString(tgField)) {
		const extras = ask
			? {
					photo: '',
					markup: { inline_keyboard: [[{ text: SWAP_BUTTON, url: cfg.appUrl + '/swaps' }]] }
				}
			: null;
		const r = sendGuestTelegram(cfg, chat, swapTelegram(cfg, kind, mine, other, until), extras);
		// A chat that is gone (blocked the bot, deleted) counts as done here; the
		// next spot message unlinks it (deliverOne).
		if (r.ok || telegramChatGone(r)) {
			tgDone = pbDate(now);
		} else {
			problems.push('telegram: ' + r.status + ' ' + r.description);
			channels.push('Telegram');
		}
	}

	const attempts = rec.getInt('notify_attempts') + 1;
	const error = problems.join(' | ').slice(0, 1000);
	let gaveUp = false;
	updateSwap(app, rec.id, (fresh) => {
		if (mailDone) fresh.set(mailField, mailDone);
		if (tgDone) fresh.set(tgField, tgDone);
		if (fresh.getString('notify_due') !== lease) return; // marked again meanwhile
		if (problems.length > 0) {
			gaveUp = attempts > SWAP_RETRY_MINUTES.length;
			fresh.set('notify_attempts', attempts);
			fresh.set('notify_error', error);
			fresh.set('notify_due', gaveUp ? '' : pbDate(now + SWAP_RETRY_MINUTES[attempts - 1] * 60000));
		} else if (deferred) {
			fresh.set('notify_due', pbDate(now + 30000));
		} else {
			fresh.set('notify_due', '');
			fresh.set('notify_attempts', 0);
			fresh.set('notify_error', '');
		}
	});

	if (gaveUp) {
		logEvent(app, 'guest_notice_failed', {
			actor: 'server',
			subject: ticketLabel(order),
			details: {
				channels: channels.join(', ') + (ask ? ' (swap request)' : ' (swap answer)'),
				attempts: attempts,
				error: maskEmailsIn(error)
			}
		});
	}
	if (problems.length > 0) return 'retry';
	return deferred ? 'deferred' : 'done';
}

/** Swap requests with news whose time has come. keepAlive() renews the loop's lock. */
function deliverSwaps(app, cfg, force, deadline, keepAlive) {
	const outcome = { done: 0, retry: 0, other: 0 };
	let rows;
	try {
		rows = app.findRecordsByFilter(
			'swap_requests',
			force ? "notify_due != ''" : "notify_due != '' && notify_due <= @now",
			'notify_due',
			50,
			0
		);
	} catch (_) {
		return outcome; // a database from before swap requests
	}
	for (const rec of rows) {
		if (deadline && Date.now() > deadline) break;
		if (keepAlive && !keepAlive()) break;
		let result;
		try {
			result = deliverSwap(app, cfg, rec, keepAlive);
		} catch (err) {
			console.error('[cozy-notify] swap request ' + rec.id + ' failed: ' + safeError(err));
			try {
				updateSwap(app, rec.id, (fresh) => {
					if (fresh.getString('notify_due') !== rec.getString('notify_due')) return false;
					fresh.set('notify_due', pbDate(Date.now() + 5 * 60000));
					fresh.set('notify_error', ('run: ' + safeError(err)).slice(0, 1000));
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
			reply(
				cfg,
				chatId,
				prefixed(cfg, t(cfg, 'bot.link_expired', { appUrl: cfg.appUrl || 'the booking page' }))
			);
			return;
		}
		return; // the delivery run right after this sends "connected" with the spot
	}

	if (/^\/pass(?:@\w+)?$/.test(text)) {
		replyWithPass(app, cfg, chatId);
		return;
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
 * /pass: the booking pass of every ticket this chat follows (one person may
 * have connected two tickets), with the QR code and the button, as the
 * booking message had them — for the guest who deleted that message, or
 * wants it at the top of the chat at arrival. What the pass page shows to
 * anyone with its link, nothing more: the request status stays out.
 */
function replyWithPass(app, cfg, chatId) {
	const store = app.store();
	const key = 'cozy_tg_pass_' + chatId;
	if (Date.now() - (store.get(key) || 0) < TG_PASS_COOLDOWN_SECONDS * 1000) return;
	store.set(key, Date.now());

	const linked = app.findRecordsByFilter('guest_notify', 'tg_chat = {:chat}', '', 10, 0, {
		chat: chatId
	});
	if (linked.length === 0) {
		reply(cfg, chatId, prefixed(cfg, t(cfg, 'bot.not_connected')));
		return;
	}
	for (const rec of linked) {
		let order;
		try {
			order = app.findRecordById('orders', rec.getString('order'));
		} catch (_) {
			continue; // the ticket is gone; its record goes with the next delivery run
		}
		const spot = currentSpot(app, order.id);
		const pass = spot ? bookingPass(app, cfg, order) : null;
		if (!spot || !pass) {
			reply(
				cfg,
				chatId,
				prefixed(cfg, t(cfg, 'bot.pass_no_spot', { mapUrl: cfg.appUrl + '/map' }))
			);
			continue;
		}
		const text = prefixed(
			cfg,
			t(cfg, 'bot.pass', { spot: spot.label, passCode: pass.code, passUrl: pass.url }) +
				bedLine(cfg, spot)
		);
		const r = sendGuestTelegram(cfg, chatId, text, passAttachments(cfg, pass));
		if (!r.ok)
			console.warn('[cozy-notify] Telegram /pass failed: ' + r.status + ' ' + r.description);
	}
}

/**
 * The guest commands in the bot's menu, for private chats only. Once per
 * process: PocketBase starts, the first delivery run sets them.
 */
function registerCommands(app, cfg) {
	if (!cfg.telegram.guests || app.store().get('cozy_tg_commands')) return;
	const r = telegramCall(
		cfg,
		'setMyCommands',
		{ commands: TG_COMMANDS, scope: { type: 'all_private_chats' } },
		10
	);
	if (r.ok) app.store().set('cozy_tg_commands', true);
	else
		warnOnce(
			app,
			'commands',
			'[cozy-notify] Telegram setMyCommands failed: ' + r.status + ' ' + r.description
		);
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
	if (!offline && bot) registerCommands(app, cfg);

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

/** One pass: bot updates, due guest messages, swap requests, crew alerts, timer. */
function runPass(app, cfg, pollSeconds, force, deadline, keepAlive) {
	const result = { updates: 0, guests: null, swaps: null, alerts: 0 };
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
	result.swaps = deliverSwaps(app, cfg, force, deadline, keepAlive);
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
	maskEmailsIn: maskEmailsIn,
	berlinTime: berlinTime,
	telegramCall: telegramCall,
	botUsername: botUsername,
	crewSend: crewSend,
	crewCheck: crewCheck,
	logEvent: logEvent,
	eventText: eventText,
	currentSpot: currentSpot,
	spotOfBed: spotOfBed,
	currentRequest: currentRequest,
	requestKindOf: requestKindOf,
	kindOf: kindOf,
	swappedFrom: swappedFrom,
	markDue: markDue,
	isQuiet: isQuiet,
	setQuiet: setQuiet,
	deliverOne: deliverOne,
	deliverDue: deliverDue,
	guestMail: guestMail,
	guestTelegram: guestTelegram,
	swapMail: swapMail,
	swapTelegram: swapTelegram,
	deliverSwap: deliverSwap,
	deliverSwaps: deliverSwaps,
	passAttachments: passAttachments,
	sendGuestTelegram: sendGuestTelegram,
	handleUpdate: handleUpdate,
	loadTexts: loadTexts,
	t: t,
	textCatalogue: textCatalogue,
	previewMessages: previewMessages,
	samplePass: samplePass,
	passQrCid: passQrCid,
	passQrHtml: passQrHtml,
	passQrImage: passQrImage,
	sendMail: sendMail,
	refreshCapabilities: refreshCapabilities,
	applyMailSettings: applyMailSettings,
	runLoop: runLoop,
	flush: flush
};
