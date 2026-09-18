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
// difference — a move is "changed", never "released" + "booked". Failures are
// retried with backoff; after the last attempt the crew gets an alert.
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
// Guest delivery: retry after 1, 5, 15, 60 minutes, then give up and alert.
const RETRY_MINUTES = [1, 5, 15, 60];
// Crew alerts: attempts and the wait before each retry.
const ALERT_RETRY_SECONDS = [0, 60, 300, 900, 3600];
const TG_LINK_MINUTES = 30;
const BOT_CACHE_SECONDS = 1800;

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
		loopSeconds: loop >= 0 && loop <= 55 ? loop : 50,
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
		console.warn('[cozy-notify] Telegram getMe failed: ' + r.description);
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

/** The crew chat text of an admin_events record. */
function eventText(ev) {
	const action = ev.getString('action');
	const actor = ev.getString('actor');
	const subject = ev.getString('subject');
	const d = eventDetails(ev);
	const by = actor ? ' by ' + actor : '';
	const who = (d.name ? d.name + ' ' : '') + '<' + subject + '>';

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
				' spot(s) released, tickets kept'
			);
		case 'template_imported':
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

		const r = crewSend(cfg, eventText(ev));
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
	spot.label = [spot.spot, spot.room, spot.house].filter((s) => !!s).join(' · ');
	return spot;
}

/**
 * Marks a ticket for a delivery run. Called from the bed and order hooks,
 * inside the same transaction as the change itself.
 */
function markDue(app, orderId, options) {
	if (!orderId) return;
	const opts = options || {};
	let rec = findOne(app, 'guest_notify', 'order = {:order}', { order: orderId });
	if (!rec) {
		let order;
		try {
			order = app.findRecordById('orders', orderId);
		} catch (_) {
			return;
		}
		// Nobody to tell. A Telegram link creates the record itself.
		if (!order.getString('email')) return;
		rec = new Record(app.findCollectionByNameOrId('guest_notify'));
		rec.set('order', orderId);
	}
	rec.set('due', pbDate(Date.now() + (opts.now ? 0 : SETTLE_SECONDS * 1000)));
	rec.set('attempts', 0);
	app.save(rec);
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

/** Subject, plain text and HTML of a guest e-mail. kind: booked | changed | released */
function guestMail(cfg, kind, spot, previousLabel, name) {
	const hello = name ? 'Hi ' + name + ',' : 'Hi,';
	const mapUrl = cfg.appUrl + '/map';
	const roomUrl = spot ? cfg.appUrl + '/room/' + spot.roomId : mapUrl;
	let subject;
	let intro;
	let after = [];
	if (kind === 'released') {
		subject = 'Your CozyNights spot was released';
		intro =
			'your ticket no longer holds a spot' +
			(previousLabel ? ' — ' + previousLabel + ' is free again.' : '.');
		after = [
			"If you didn't release it yourself, the crew had to change the camp layout.",
			'While booking is open you can pick a new spot: ' + mapUrl
		];
	} else {
		subject =
			(kind === 'changed' ? 'Your CozyNights spot changed: ' : 'Your CozyNights spot: ') +
			spot.label;
		intro = kind === 'changed' ? 'your ticket now holds a different spot:' : 'your spot is booked:';
		if (kind === 'changed' && previousLabel) after.push('Before: ' + previousLabel);
		if (kind === 'changed')
			after.push("If you didn't change it yourself, the crew had to move you.");
		after.push(
			'To change or release it, open ' +
				roomUrl +
				', sign in with your ticket code and tap your spot — as long as booking is open.'
		);
	}
	const rows = spot && kind !== 'released' ? spotLines(spot) : [];
	const footer = 'You get this e-mail because this address belongs to your Hamburn ticket.';

	const text = [hello, '', intro]
		.concat(rows.length ? [''].concat(rows.map((r) => '  ' + (r[0] + ':').padEnd(7) + r[1])) : [])
		.concat([''])
		.concat(after)
		.concat(['', '— The CozyNights crew', '', footer])
		.join('\n');

	const link = (url) => '<a href="' + esc(url) + '" style="color:#7a3cff">' + esc(url) + '</a>';
	const linkify = (line) =>
		esc(line).replace(esc(roomUrl), link(roomUrl)).replace(esc(mapUrl), link(mapUrl));
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

/** kind: connected | booked | changed | released */
function guestTelegram(cfg, kind, spot, previousLabel) {
	const mapUrl = cfg.appUrl + '/map';
	const roomUrl = spot ? cfg.appUrl + '/room/' + spot.roomId : mapUrl;
	let text;
	if (kind === 'connected') {
		text =
			"✅ Connected! You'll get news about your CozyNights spot here.\n\n" +
			(spot
				? 'Your spot: ' + spot.label + '\n' + roomUrl
				: "You don't have a spot yet — you'll get a message here when you book one.") +
			'\n\nSend /stop to disconnect.';
	} else if (kind === 'released') {
		text =
			'🫥 Your CozyNights spot was released' +
			(previousLabel ? ': ' + previousLabel + ' is free again.' : '.') +
			"\n\nIf you didn't do this yourself, the crew had to change the camp layout. Pick a new spot while booking is open: " +
			mapUrl;
	} else if (kind === 'changed') {
		text =
			'🔁 Your CozyNights spot changed\nNow: ' +
			spot.label +
			(previousLabel ? '\nBefore: ' + previousLabel : '') +
			"\n\nIf you didn't change it yourself, the crew had to move you.\n" +
			roomUrl;
	} else {
		text =
			'✨ Your CozyNights spot is booked\n' + spot.label + '\n\nChange or release it: ' + roomUrl;
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

function kindOf(lastKey, key) {
	if (!lastKey) return key ? 'booked' : '';
	if (!key) return 'released';
	return key === lastKey ? '' : 'changed';
}

/** One delivery run for one guest_notify record. */
function deliverOne(app, cfg, rec, force) {
	const now = Date.now();
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
			rec.set('due', pbDate(last + COOLDOWN_SECONDS * 1000));
			app.save(rec);
			return 'cooldown';
		}
	}

	const spot = currentSpot(app, order.id);
	const key = spot ? spot.bedId : '';
	const problems = [];
	const channels = [];
	let deferred = false;

	// --- e-mail to the ticket's address
	const email = order.getString('email');
	if (email && cfg.mail.enabled) {
		const known = rec.getString('mail_to') === email;
		const kind = kindOf(known ? rec.getString('mail_spot') : '', key);
		if (!known && !key) {
			// a new address and no spot: nothing to confirm
			rec.set('mail_to', email);
			rec.set('mail_spot', '');
			rec.set('mail_label', '');
		} else if (kind) {
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
							greetingName(order)
						)
					);
					rec.set('mail_to', email);
					rec.set('mail_spot', key);
					rec.set('mail_label', spot ? spot.label : '');
					rec.set('mail_sent', pbDate(now));
				} catch (err) {
					problems.push('mail: ' + safeError(err));
					channels.push('e-mail ' + maskEmail(email));
				}
			}
		}
	}

	// --- Telegram chat the guest linked
	const chat = rec.getString('tg_chat');
	if (chat && cfg.telegram.guests) {
		const isNew = rec.getBool('tg_new');
		const kind = isNew ? 'connected' : kindOf(rec.getString('tg_spot'), key);
		if (kind) {
			const r = telegramCall(
				cfg,
				'sendMessage',
				{
					chat_id: chat,
					text: guestTelegram(cfg, kind, spot, rec.getString('tg_label')),
					disable_web_page_preview: true
				},
				10
			);
			if (r.ok) {
				rec.set('tg_spot', key);
				rec.set('tg_label', spot ? spot.label : '');
				rec.set('tg_sent', pbDate(now));
				rec.set('tg_new', false);
			} else if (telegramChatGone(r)) {
				// blocked the bot or deleted the chat: stop writing there
				rec.set('tg_chat', '');
				rec.set('tg_new', false);
				rec.set('tg_spot', '');
				rec.set('tg_label', '');
			} else {
				problems.push('telegram: ' + r.status + ' ' + r.description);
				channels.push('Telegram');
			}
		}
	}

	if (problems.length > 0) {
		const attempts = rec.getInt('attempts') + 1;
		const error = problems.join(' | ').slice(0, 1000);
		rec.set('attempts', attempts);
		rec.set('last_error', error);
		if (attempts > RETRY_MINUTES.length) {
			rec.set('due', '');
			logEvent(app, 'guest_notice_failed', {
				actor: 'server',
				subject: order.getString('customer_name') || order.id,
				details: { channels: channels.join(', '), attempts: attempts, error: error }
			});
		} else {
			rec.set('due', pbDate(now + RETRY_MINUTES[attempts - 1] * 60000));
		}
		app.save(rec);
		return 'retry';
	}
	rec.set('due', deferred ? pbDate(now + 30000) : '');
	if (!deferred) {
		rec.set('attempts', 0);
		rec.set('last_error', '');
	}
	app.save(rec);
	return deferred ? 'deferred' : 'done';
}

function deliverDue(app, cfg, force, deadline) {
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
		let result;
		try {
			result = deliverOne(app, cfg, rec, force);
		} catch (err) {
			console.error(
				'[cozy-notify] delivery for ' + rec.getString('order') + ' failed: ' + safeError(err)
			);
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
			', sign in with your ticket code, open your room and tap “Get updates on Telegram”.'
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
		const rec = findOne(app, 'guest_notify', 'tg_token_hash = {:hash} && tg_token_exp > @now', {
			hash: $security.sha256(start[1])
		});
		if (!rec) {
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
		rec.set('tg_chat', chatId);
		rec.set('tg_new', true);
		rec.set('tg_spot', '');
		rec.set('tg_label', '');
		rec.set('tg_token_hash', '');
		rec.set('tg_token_exp', '');
		rec.set('due', pbDate(Date.now()));
		app.save(rec);
		return; // the delivery run right after this sends "connected" with the spot
	}

	if (/^\/stop(?:@\w+)?$/.test(text)) {
		const linked = app.findRecordsByFilter('guest_notify', 'tg_chat = {:chat}', '', 0, 0, {
			chat: chatId
		});
		for (const rec of linked) {
			rec.set('tg_chat', '');
			rec.set('tg_new', false);
			rec.set('tg_spot', '');
			rec.set('tg_label', '');
			app.save(rec);
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
		if (r.status === 409) {
			console.warn(
				'[cozy-notify] Telegram getUpdates: 409 — a webhook is set or another server polls this bot (use one bot per environment)'
			);
		} else {
			console.warn('[cozy-notify] Telegram getUpdates failed: ' + r.status + ' ' + r.description);
		}
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
	let settings;
	try {
		settings = app.findRecordById('app_settings', APP_SETTINGS_ID);
	} catch (_) {
		return; // fresh database: the migrations create it
	}
	if (!settings.collection().fields.getByName('notify_mail')) return;
	let bot = '';
	if (cfg.telegram.guests) {
		const name = offline ? null : botUsername(app, cfg);
		bot = name === null ? settings.getString('telegram_bot') : name;
	}
	if (
		settings.getBool('notify_mail') !== cfg.mail.enabled ||
		settings.getString('telegram_bot') !== bot
	) {
		settings.set('notify_mail', cfg.mail.enabled);
		settings.set('telegram_bot', bot);
		app.save(settings);
		console.log(
			'[cozy-notify] guest updates: e-mail ' +
				(cfg.mail.enabled ? 'on' : 'off') +
				', Telegram ' +
				(bot ? '@' + bot : 'off')
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

function takeLock(app, seconds) {
	let ok = false;
	app.store().setFunc('cozy_notify_lock', (until) => {
		if (until && until > Date.now()) return until;
		ok = true;
		return Date.now() + seconds * 1000;
	});
	return ok;
}

function releaseLock(app) {
	app.store().remove('cozy_notify_lock');
}

/** One pass: bot updates, due guest messages, crew alerts, timer. */
function runPass(app, cfg, pollSeconds, force, deadline) {
	const result = { updates: 0, guests: null, alerts: 0 };
	if (cfg.telegram.guests) result.updates = pollTelegram(app, cfg, pollSeconds);
	else if (pollSeconds > 0) sleep(pollSeconds * 1000);
	announceTimer(app);
	result.guests = deliverDue(app, cfg, force, deadline);
	result.alerts = sendPendingAlerts(app, cfg, force);
	return result;
}

/** The cron job: repeats short passes for up to COZY_NOTIFY_LOOP_SECONDS. */
function runLoop(app) {
	const cfg = config(app);
	if (!takeLock(app, 58)) return;
	try {
		refreshCapabilities(app, cfg);
		const deadline = Date.now() + cfg.loopSeconds * 1000;
		do {
			const left = Math.floor((deadline - Date.now()) / 1000);
			try {
				runPass(app, cfg, Math.max(0, Math.min(5, left)), false, deadline + 5000);
			} catch (err) {
				console.error('[cozy-notify] run failed: ' + safeError(err));
				if (left > 5) sleep(5000);
			}
		} while (Date.now() < deadline - 1000);
	} finally {
		releaseLock(app);
	}
}

/** One immediate pass (tests, `cozy-admin notify flush`); waits for a running loop. */
function flush(app, force) {
	const cfg = config(app);
	const waitUntil = Date.now() + 15000;
	while (!takeLock(app, 30)) {
		if (Date.now() > waitUntil) throw new Error('the notification loop is busy, try again');
		sleep(200);
	}
	try {
		refreshCapabilities(app, cfg);
		return runPass(app, cfg, 0, !!force, 0);
	} finally {
		releaseLock(app);
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
	markDue: markDue,
	guestMail: guestMail,
	guestTelegram: guestTelegram,
	sendMail: sendMail,
	refreshCapabilities: refreshCapabilities,
	applyMailSettings: applyMailSettings,
	runLoop: runLoop,
	flush: flush
};
