/// <reference path="../../pb_data/types.d.ts" />
//
// How a ticket is named, for PocketBase's side of the house. The app has the
// same rules in src/lib/tickets.ts; tests/tickets.test.ts runs both over the
// same cases, so a change here needs the same change there.
//
// Why the rules exist: a ticket without a name is labelled "Ticket <code>"
// (the CLI, pb_hooks/cozy_admin.pb.js), and that code signs its guest in. So
// the label may never leave the guest's own message: not to the crew chat
// (Telegram, a third country), not onto a phone at the gate.
//
// A CommonJS module for PocketBase's JSVM, like notify.js and texts.js.

/** The label tickets without a name get; guests with such a label are greeted without one. */
function defaultTicketName(code) {
	return 'Ticket ' + String(code || '');
}

/**
 * A code shortened for logs and the crew chat: enough to tell tickets apart,
 * never enough to guess one. At most a third of the code shows; short codes
 * (pretix order codes have five characters) keep only their first one.
 * "HB-1001" → "H•••".
 */
function maskTicketCode(code) {
	const value = String(code || '');
	if (!value) return '';
	if (value.length >= 15) return value.slice(0, 3) + '•••' + value.slice(-2);
	if (value.length >= 9) return value.slice(0, 2) + '•••' + value.slice(-1);
	return value.charAt(0) + '•••';
}

/**
 * The holder's name from the ticket list, or '' when the ticket has none: a
 * name that carries the ticket code is not a name (see the file header).
 */
function holderName(name, code) {
	const value = String(name || '').trim();
	const ticket = String(code || '').trim();
	if (!value) return '';
	if (ticket && value.indexOf(ticket) >= 0) return '';
	return value;
}

/** How the crew chat and the audit log name a ticket: "Ticket H•••", never a person. */
function maskedTicketLabel(code) {
	const masked = maskTicketCode(code);
	return masked ? 'Ticket ' + masked : '';
}

/** What an admin sees: the holder's name, else the masked label. Never a full code. */
function displayTicketName(name, code) {
	return holderName(name, code) || maskedTicketLabel(code);
}

module.exports = {
	defaultTicketName: defaultTicketName,
	maskTicketCode: maskTicketCode,
	holderName: holderName,
	maskedTicketLabel: maskedTicketLabel,
	displayTicketName: displayTicketName
};
