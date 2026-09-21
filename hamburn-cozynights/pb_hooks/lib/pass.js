/// <reference path="../../pb_data/types.d.ts" />
//
// Booking pass codes (docs/admin/passes.md), shared by pb_hooks/cozy_pass.pb.js
// and the notifications. The same format as src/lib/pass.ts: 12 characters
// without look-alikes (no 0/O, 1/I/L), stored without dashes, shown as
// XXXX-XXXX-XXXX. Only PocketBase creates codes (here), so two writers can
// never hand out different codes for the same ticket.

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const LENGTH = 12;

/** "7F3K9QXM2CWD" → "7F3K-9QXM-2CWD" */
function formatPassCode(code) {
	return String(code).replace(/(.{4})(?=.)/g, '$1-');
}

/** Where the guest's pass lives (also what its QR code holds). */
function passUrl(appUrl, code) {
	return appUrl + '/pass/' + formatPassCode(code);
}

/**
 * The ticket's pass code; creates one if the ticket has none yet. Returns ''
 * if the ticket doesn't exist. Runs in a transaction: read and write can't be
 * interleaved with another request for the same ticket.
 */
function ensurePassCode(app, orderId) {
	let code = '';
	app.runInTransaction((tx) => {
		let order;
		try {
			order = tx.findRecordById('orders', orderId);
		} catch (_) {
			return;
		}
		code = order.getString('pass_code');
		for (let attempt = 0; attempt < 5 && !code; attempt++) {
			const candidate = $security.randomStringWithAlphabet(LENGTH, ALPHABET);
			const taken = tx.findRecordsByFilter('orders', 'pass_code = {:code}', '', 1, 0, {
				code: candidate
			});
			if (taken.length > 0) continue;
			order.set('pass_code', candidate);
			tx.save(order);
			code = candidate;
		}
	});
	return code;
}

module.exports = {
	ALPHABET: ALPHABET,
	LENGTH: LENGTH,
	formatPassCode: formatPassCode,
	passUrl: passUrl,
	ensurePassCode: ensurePassCode
};
