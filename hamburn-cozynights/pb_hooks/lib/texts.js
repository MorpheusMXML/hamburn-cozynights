/// <reference path="../../pb_data/types.d.ts" />
//
// Every sentence CozyNights sends to guests (docs/admin/notifications.md,
// "Message texts"): e-mails, Telegram updates and the bot's replies. Admins
// change them on /admin/messages; a changed text is stored in the collection
// message_texts and wins over the default here. The crew-chat alerts are not
// in here: they are log lines with names and counts (notify.js, eventText).
//
// Each entry: key (stable, referenced by notify.js), group (a heading on the
// admin page), label (what the line is), hint (when it is used), placeholders
// (the {names} this text may use; notify.js fills them in) and text (the
// default). Line breaks in a text stay in the message. Which lines a message
// has in which case is decided in notify.js, not here.
//
// A CommonJS module for PocketBase's JSVM, like notify.js; the admin page
// gets this catalogue through GET /api/cozy/texts (pb_hooks/cozy_notify.pb.js).

const PLACEHOLDERS = [
	{ name: 'name', meaning: "the guest's name from the ticket list" },
	{ name: 'spot', meaning: 'the spot with its room and house, like "B1 · Dorm #2 · Villa"' },
	{ name: 'before', meaning: 'the spot the ticket held before' },
	{ name: 'roomUrl', meaning: "the link to the guest's room (to the map while they have no spot)" },
	{ name: 'mapUrl', meaning: 'the link to the map' },
	{ name: 'requestUrl', meaning: 'the link to the special-needs request page' },
	{ name: 'passCode', meaning: 'the code of the booking pass' },
	{ name: 'passUrl', meaning: 'the link to the booking pass' },
	{ name: 'appUrl', meaning: 'the address of the booking page' },
	{ name: 'status', meaning: 'the status of the special-needs request, in words' }
];

const GROUPS = [
	{ id: 'mail.common', channel: 'mail', title: 'E-mail · in every message' },
	{ id: 'mail.booked', channel: 'mail', title: 'E-mail · spot booked' },
	{ id: 'mail.handed_over', channel: 'mail', title: 'E-mail · ticket passed on' },
	{ id: 'mail.changed', channel: 'mail', title: 'E-mail · spot changed' },
	{ id: 'mail.released', channel: 'mail', title: 'E-mail · spot released' },
	{ id: 'mail.request', channel: 'mail', title: 'E-mail · special-needs request' },
	{ id: 'tg.common', channel: 'telegram', title: 'Telegram · in several messages' },
	{ id: 'tg.connected', channel: 'telegram', title: 'Telegram · chat connected' },
	{ id: 'tg.booked', channel: 'telegram', title: 'Telegram · spot booked' },
	{ id: 'tg.changed', channel: 'telegram', title: 'Telegram · spot changed' },
	{ id: 'tg.released', channel: 'telegram', title: 'Telegram · spot released' },
	{ id: 'tg.request', channel: 'telegram', title: 'Telegram · special-needs request' },
	{ id: 'bot', channel: 'bot', title: 'Telegram · replies of the bot' }
];

// prettier-ignore
const TEXTS = [
	// --- e-mail: in every message ------------------------------------------------
	{ key: 'mail.greeting', group: 'mail.common', label: 'Greeting', hint: 'When the ticket list has the guest\'s name.', placeholders: ['name'],
		text: 'Hi {name},' },
	{ key: 'mail.greeting_anonymous', group: 'mail.common', label: 'Greeting without a name', hint: '', placeholders: [],
		text: 'Hi,' },
	{ key: 'mail.signature', group: 'mail.common', label: 'Signature', hint: 'The last line before the small print.', placeholders: [],
		text: '— The CozyNights crew' },
	{ key: 'mail.footer', group: 'mail.common', label: 'Small print', hint: 'Why the guest gets the e-mail.', placeholders: [],
		text: 'You get this e-mail because this address belongs to your Hamburn ticket. CozyNights never asks you for your ticket code by e-mail.' },
	{ key: 'mail.pass', group: 'mail.common', label: 'Booking pass', hint: 'In every message that shows the spot.', placeholders: ['passCode', 'passUrl'],
		text: 'Your booking pass (code {passCode}): {passUrl} — show it when you arrive, if the crew asks.' },
	{ key: 'mail.fixed', group: 'mail.common', label: 'A spot the crew booked: how to change it', hint: 'Instead of the usual "to change or release it" line, when the crew booked the spot for a special-needs request.', placeholders: ['roomUrl'],
		text: 'The crew picked this spot for you, so please contact the crew to change it. Your room: {roomUrl}' },

	// --- e-mail: spot booked ----------------------------------------------------------
	{ key: 'mail.booked.subject', group: 'mail.booked', label: 'Subject', hint: '', placeholders: ['spot'],
		text: 'Your CozyNights spot: {spot}' },
	{ key: 'mail.booked.intro', group: 'mail.booked', label: 'First line', hint: 'After the greeting; house, room and spot follow.', placeholders: [],
		text: 'your spot is booked:' },
	{ key: 'mail.booked.change', group: 'mail.booked', label: 'How to change or release it', hint: 'Also in "spot changed", when the guest may change the spot themselves.', placeholders: ['roomUrl'],
		text: 'To change or release it, open {roomUrl}, sign in with your ticket code and tap your spot — as long as booking is open.' },

	// --- e-mail: the ticket was passed on ---------------------------------------------
	{ key: 'mail.handed_over.subject', group: 'mail.handed_over', label: 'Subject', hint: '', placeholders: ['spot'],
		text: 'A CozyNights spot came with your ticket: {spot}' },
	{ key: 'mail.handed_over.intro', group: 'mail.handed_over', label: 'First line', hint: 'After the greeting; house, room and spot follow. The lines about changing the spot and the booking pass are the ones of "spot booked".', placeholders: [],
		text: 'this ticket was passed on to you, and it holds this spot:' },

	// --- e-mail: spot changed ---------------------------------------------------------
	{ key: 'mail.changed.subject', group: 'mail.changed', label: 'Subject', hint: '', placeholders: ['spot'],
		text: 'Your CozyNights spot changed: {spot}' },
	{ key: 'mail.changed.intro', group: 'mail.changed', label: 'First line', hint: 'After the greeting; house, room and spot follow.', placeholders: [],
		text: 'your ticket now holds a different spot:' },
	{ key: 'mail.changed.before', group: 'mail.changed', label: 'The old spot', hint: '', placeholders: ['before'],
		text: 'Before: {before}' },
	{ key: 'mail.changed.by_crew', group: 'mail.changed', label: 'Moved by the crew', hint: 'When the crew moved a spot they booked for a special-needs request.', placeholders: [],
		text: 'The crew moved you to this spot.' },
	{ key: 'mail.changed.maybe_crew', group: 'mail.changed', label: 'Moved, maybe by the crew', hint: 'Every other change of spot.', placeholders: [],
		text: 'If you didn\'t change it yourself, the crew had to move you.' },

	// --- e-mail: spot released --------------------------------------------------------
	{ key: 'mail.released.subject', group: 'mail.released', label: 'Subject', hint: '', placeholders: [],
		text: 'Your CozyNights spot was released' },
	{ key: 'mail.released.intro', group: 'mail.released', label: 'First line', hint: 'After the greeting.', placeholders: ['before'],
		text: 'your ticket no longer holds a spot — {before} is free again.' },
	{ key: 'mail.released.intro_unknown', group: 'mail.released', label: 'First line when the old spot is unknown', hint: '', placeholders: [],
		text: 'your ticket no longer holds a spot.' },
	{ key: 'mail.released.layout', group: 'mail.released', label: 'Why it may have happened', hint: '', placeholders: [],
		text: 'If you didn\'t release it yourself, the crew had to change the camp layout.' },
	{ key: 'mail.released.rebook', group: 'mail.released', label: 'How to book again', hint: '', placeholders: ['mapUrl'],
		text: 'While booking is open you can pick a new spot: {mapUrl}' },
	{ key: 'mail.released.approved_now', group: 'mail.released', label: 'Released while the request is approved right now', hint: 'Instead of the two lines above.', placeholders: [],
		text: 'The crew approved your special-needs request: the crew picks a new spot for you, and you get an e-mail when it is booked.' },
	{ key: 'mail.released.still_approved', group: 'mail.released', label: 'Released while the request stays approved', hint: 'Instead of the two lines above.', placeholders: [],
		text: 'Your special-needs request is still approved: the crew picks a new spot for you, and you get an e-mail when it is booked.' },
	{ key: 'mail.released.also_received', group: 'mail.released', label: 'Released while a request arrives', hint: 'Added before the other lines.', placeholders: [],
		text: 'The crew got your special-needs request; you get an e-mail when they have decided.' },
	{ key: 'mail.released.also_declined', group: 'mail.released', label: 'Released while the request is declined', hint: 'Added before the other lines.', placeholders: [],
		text: 'The crew could not offer you a special-needs spot.' },

	// --- e-mail: special-needs request ------------------------------------------------
	{ key: 'mail.request_received.subject', group: 'mail.request', label: 'Request received · subject', hint: '', placeholders: [],
		text: 'We got your special-needs request' },
	{ key: 'mail.request_received.intro', group: 'mail.request', label: 'Request received · first line', hint: 'After the greeting.', placeholders: [],
		text: 'the crew got your request for a special-needs spot.' },
	{ key: 'mail.request_received.next', group: 'mail.request', label: 'Request received · what happens next', hint: '', placeholders: [],
		text: 'They look at it and you get an e-mail when they have decided.' },
	{ key: 'mail.request_received.manage', group: 'mail.request', label: 'Request received · how to change it', hint: '', placeholders: ['requestUrl'],
		text: 'To see, change or withdraw your request, open {requestUrl} and sign in with your ticket code.' },
	{ key: 'mail.request_approved.subject', group: 'mail.request', label: 'Request approved · subject', hint: '', placeholders: [],
		text: 'Your special-needs request was approved' },
	{ key: 'mail.request_approved.intro', group: 'mail.request', label: 'Request approved · first line', hint: 'After the greeting.', placeholders: [],
		text: 'the crew approved your request for a special-needs spot.' },
	{ key: 'mail.request_approved.keep', group: 'mail.request', label: 'Request approved · the guest keeps their spot', hint: 'When the guest booked a spot themselves.', placeholders: ['spot'],
		text: 'You keep your current spot, {spot}, until the crew books a more fitting one for you. Then you get another e-mail.' },
	{ key: 'mail.request_approved.picking', group: 'mail.request', label: 'Request approved · the crew picks a spot', hint: 'When the guest has no spot yet.', placeholders: [],
		text: 'They are picking a fitting spot for you. You get another e-mail as soon as it is booked.' },
	{ key: 'mail.request_approved.link', group: 'mail.request', label: 'Request approved · link to the request', hint: '', placeholders: ['requestUrl'],
		text: 'Your request: {requestUrl}' },
	{ key: 'mail.request_declined.subject', group: 'mail.request', label: 'Request declined · subject', hint: '', placeholders: [],
		text: 'About your special-needs request' },
	{ key: 'mail.request_declined.intro', group: 'mail.request', label: 'Request declined · first line', hint: 'After the greeting.', placeholders: [],
		text: 'the crew could not offer you a special-needs spot.' },
	{ key: 'mail.request_declined.keep', group: 'mail.request', label: 'Request declined · the guest keeps their spot', hint: 'When the guest booked a spot themselves.', placeholders: ['spot'],
		text: 'You keep your current spot, {spot}.' },
	{ key: 'mail.request_declined.book', group: 'mail.request', label: 'Request declined · how to book', hint: 'When the guest has no spot.', placeholders: ['mapUrl'],
		text: 'You can book a spot like everyone else when booking opens: {mapUrl}' },
	{ key: 'mail.request_declined.questions', group: 'mail.request', label: 'Request declined · questions', hint: '', placeholders: [],
		text: 'If you have questions, please contact the crew.' },
	{ key: 'mail.crew_booked.subject', group: 'mail.request', label: 'Spot booked by the crew · subject', hint: 'The request is approved and the crew booked the spot: one e-mail.', placeholders: ['spot'],
		text: 'Your special-needs spot: {spot}' },
	{ key: 'mail.crew_booked.intro', group: 'mail.request', label: 'Spot booked by the crew · first line', hint: 'After the greeting; house, room and spot follow.', placeholders: [],
		text: 'the crew approved your special-needs request and booked this spot for you:' },
	{ key: 'mail.also.received', group: 'mail.request', label: 'Spot booked or changed while a request arrives', hint: 'Added to the "spot booked" or "spot changed" e-mail.', placeholders: [],
		text: 'The crew also got your special-needs request; you get an e-mail when they have decided.' },
	{ key: 'mail.also.approved', group: 'mail.request', label: 'Spot booked or changed while the request is approved', hint: 'Added to the "spot booked" or "spot changed" e-mail.', placeholders: [],
		text: 'The crew approved your special-needs request. You keep this spot until they book a more fitting one for you; then you get another e-mail.' },
	{ key: 'mail.also.declined', group: 'mail.request', label: 'Spot booked or changed while the request is declined', hint: 'Added to the "spot booked" or "spot changed" e-mail.', placeholders: [],
		text: 'The crew could not offer you a special-needs spot; you keep this spot.' },

	// --- Telegram: in several messages ------------------------------------------------
	{ key: 'tg.pass', group: 'tg.common', label: 'Booking pass', hint: 'Below every message that shows the spot.', placeholders: ['passCode', 'passUrl'],
		text: '🎫 Booking pass {passCode}:\n{passUrl}' },
	{ key: 'tg.before', group: 'tg.common', label: 'The old spot', hint: 'When the spot changed.', placeholders: ['before'],
		text: 'Before: {before}' },
	{ key: 'tg.contact_crew', group: 'tg.common', label: 'A spot the crew booked: how to change it', hint: 'When the crew booked the spot for a special-needs request.', placeholders: [],
		text: 'To change it, please contact the crew.' },

	// --- Telegram: chat connected -------------------------------------------------------
	{ key: 'tg.connected.intro', group: 'tg.connected', label: 'First line', hint: 'Right after the guest taps START.', placeholders: [],
		text: '✅ Connected! You\'ll get news about your CozyNights spot here.' },
	{ key: 'tg.connected.spot', group: 'tg.connected', label: 'The current spot', hint: '', placeholders: ['spot', 'roomUrl'],
		text: 'Your spot: {spot}\n{roomUrl}' },
	{ key: 'tg.connected.no_spot', group: 'tg.connected', label: 'No spot yet', hint: '', placeholders: [],
		text: 'You don\'t have a spot yet — you\'ll get a message here when you book one.' },
	{ key: 'tg.connected.request', group: 'tg.connected', label: 'The special-needs request', hint: 'Only when the ticket has one.', placeholders: ['status'],
		text: 'Your special-needs request: {status}' },
	{ key: 'tg.status.pending', group: 'tg.connected', label: 'Request status: waiting', hint: 'The words for {status}.', placeholders: [],
		text: 'waiting for the crew' },
	{ key: 'tg.status.approved', group: 'tg.connected', label: 'Request status: approved', hint: 'The words for {status}.', placeholders: [],
		text: 'approved' },
	{ key: 'tg.status.declined', group: 'tg.connected', label: 'Request status: declined', hint: 'The words for {status}.', placeholders: [],
		text: 'declined' },
	{ key: 'tg.connected.stop', group: 'tg.connected', label: 'How to disconnect', hint: '', placeholders: [],
		text: 'Send /stop to disconnect.' },

	// --- Telegram: spot booked ------------------------------------------------------------
	{ key: 'tg.booked.intro', group: 'tg.booked', label: 'The message', hint: '', placeholders: ['spot'],
		text: '✨ Your CozyNights spot is booked\n{spot}' },
	{ key: 'tg.booked.change', group: 'tg.booked', label: 'How to change or release it', hint: 'When the guest may change the spot themselves.', placeholders: ['roomUrl'],
		text: 'Change or release it: {roomUrl}' },
	{ key: 'tg.booked.by_crew', group: 'tg.booked', label: 'Booked by the crew', hint: 'When the crew booked the spot for a special-needs request.', placeholders: ['roomUrl'],
		text: 'The crew picked it for you. To change it, please contact the crew.\n{roomUrl}' },

	// --- Telegram: spot changed -----------------------------------------------------------
	{ key: 'tg.changed.intro', group: 'tg.changed', label: 'The message', hint: 'The old spot follows on the next line.', placeholders: ['spot'],
		text: '🔁 Your CozyNights spot changed\nNow: {spot}' },
	{ key: 'tg.changed.maybe_crew', group: 'tg.changed', label: 'Moved, maybe by the crew', hint: 'Every change the guest may undo themselves.', placeholders: ['roomUrl'],
		text: 'If you didn\'t change it yourself, the crew had to move you.\n{roomUrl}' },
	{ key: 'tg.changed.by_crew', group: 'tg.changed', label: 'Moved by the crew', hint: 'When the crew moved a spot they booked for a special-needs request.', placeholders: ['roomUrl'],
		text: 'The crew moved you to this spot. To change it, please contact the crew.\n{roomUrl}' },

	// --- Telegram: spot released ----------------------------------------------------------
	{ key: 'tg.released.intro', group: 'tg.released', label: 'The message', hint: '', placeholders: ['before'],
		text: '🫥 Your CozyNights spot was released: {before} is free again.' },
	{ key: 'tg.released.intro_unknown', group: 'tg.released', label: 'The message when the old spot is unknown', hint: '', placeholders: [],
		text: '🫥 Your CozyNights spot was released.' },
	{ key: 'tg.released.rebook', group: 'tg.released', label: 'Why, and how to book again', hint: '', placeholders: ['mapUrl'],
		text: 'If you didn\'t do this yourself, the crew had to change the camp layout. Pick a new spot while booking is open: {mapUrl}' },
	{ key: 'tg.released.approved_now', group: 'tg.released', label: 'Released while the request is approved right now', hint: 'Instead of the line above.', placeholders: [],
		text: 'Your special-needs request was approved: the crew picks a new spot for you, and you\'ll get a message here when it is booked.' },
	{ key: 'tg.released.still_approved', group: 'tg.released', label: 'Released while the request stays approved', hint: 'Instead of the line above.', placeholders: [],
		text: 'Your special-needs request is still approved: the crew picks a new spot for you, and you\'ll get a message here when it is booked.' },

	// --- Telegram: special-needs request ----------------------------------------------------
	{ key: 'tg.request_received', group: 'tg.request', label: 'Request received', hint: '', placeholders: ['requestUrl'],
		text: '🧡 The crew got your special-needs request. You\'ll get a message here when they have decided.\n\nSee, change or withdraw it: {requestUrl}' },
	{ key: 'tg.request_approved.picking', group: 'tg.request', label: 'Request approved · the crew picks a spot', hint: 'When the guest has no spot yet.', placeholders: [],
		text: '✅ Your special-needs request was approved. The crew is picking a fitting spot for you; you\'ll get a message here when it is booked.' },
	{ key: 'tg.request_approved.keep', group: 'tg.request', label: 'Request approved · the guest keeps their spot', hint: 'When the guest booked a spot themselves.', placeholders: ['spot'],
		text: '✅ Your special-needs request was approved. You keep your current spot, {spot}, until the crew books a more fitting one for you; you\'ll get a message here when they do.' },
	{ key: 'tg.request_declined.book', group: 'tg.request', label: 'Request declined · how to book', hint: 'When the guest has no spot.', placeholders: ['mapUrl'],
		text: '✋ The crew could not offer you a special-needs spot. You can book a spot like everyone else when booking opens: {mapUrl}' },
	{ key: 'tg.request_declined.keep', group: 'tg.request', label: 'Request declined · the guest keeps their spot', hint: 'When the guest booked a spot themselves.', placeholders: ['spot'],
		text: '✋ The crew could not offer you a special-needs spot. You keep your current spot, {spot}.' },
	{ key: 'tg.crew_booked.intro', group: 'tg.request', label: 'Spot booked by the crew', hint: 'The request is approved and the crew booked the spot: one message, with the link to the room and the pass.', placeholders: ['spot'],
		text: '✅ Your special-needs request was approved. The crew booked this spot for you:\n{spot}' },
	{ key: 'tg.news.received', group: 'tg.request', label: 'Spot booked, changed or released while a request arrives', hint: 'Added above the spot message.', placeholders: [],
		text: '🧡 The crew got your special-needs request.' },
	{ key: 'tg.news.approved', group: 'tg.request', label: 'Spot booked or changed while the request is approved', hint: 'Added above the spot message.', placeholders: [],
		text: '✅ Your special-needs request was approved. You keep this spot until the crew books a more fitting one; you\'ll get a message here when they do.' },
	{ key: 'tg.news.declined', group: 'tg.request', label: 'Spot booked, changed or released while the request is declined', hint: 'Added above the spot message.', placeholders: [],
		text: '✋ The crew could not offer you a special-needs spot.' },

	// --- Telegram: replies of the bot ---------------------------------------------------------
	{ key: 'bot.help', group: 'bot', label: 'Any other message to the bot', hint: 'Also the answer to /start without a connect link.', placeholders: ['appUrl'],
		text: '👋 This bot sends updates about your CozyNights spot.\n\nTo connect: open {appUrl}, sign in with your ticket code, open your room or your special-needs request and tap “Get updates on Telegram”.' },
	{ key: 'bot.link_expired', group: 'bot', label: 'The connect link has expired', hint: '', placeholders: [],
		text: '⌛ This link has expired or was already used. Open your room on the booking page and tap “Get updates on Telegram” again.' },
	{ key: 'bot.stopped', group: 'bot', label: '/stop', hint: '', placeholders: [],
		text: '🔕 Disconnected. You won\'t get updates here anymore. You can connect again on the booking page.' },
	{ key: 'bot.not_connected', group: 'bot', label: '/stop in a chat that is not connected', hint: '', placeholders: [],
		text: 'This chat is not connected to a ticket.' }
];

module.exports = { PLACEHOLDERS: PLACEHOLDERS, GROUPS: GROUPS, TEXTS: TEXTS };
