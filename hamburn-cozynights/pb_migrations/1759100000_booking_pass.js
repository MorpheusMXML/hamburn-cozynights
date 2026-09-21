/// <reference path="../pb_data/types.d.ts" />
//
// Booking pass (docs/admin/passes.md): every ticket that holds a spot gets a
// random pass code, shown to the guest as a QR code on /pass/<code> and in the
// confirmation messages, and checked by the crew in the admin area.
//
// - orders.pass_code: 12 characters from an alphabet without look-alikes
//   (no 0/O, 1/I/L), stored without dashes; unique among non-empty codes.
//   It is NOT the ticket code (that one can change bookings) and not
//   order_hash (that one is tied to the ticket code for good): a pass code
//   only shows a booking and can be replaced on its own.
// - Existing bookings get a code right away; new ones get it from
//   pb_hooks/cozy_pass.pb.js.

migrate(
	(app) => {
		const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
		const LENGTH = 12;

		const orders = app.findCollectionByNameOrId('orders');
		if (!orders.fields.getByName('pass_code')) {
			orders.fields.add(new TextField({ name: 'pass_code', max: 12, pattern: '^[A-Z0-9]*$' }));
		}
		orders.indexes = orders.indexes
			.filter((idx) => !/\bpass_code\b/.test(idx))
			.concat([
				"CREATE UNIQUE INDEX `idx_orders_pass_code` ON `orders` (`pass_code`) WHERE `pass_code` != ''"
			]);
		app.save(orders);

		// Tickets that already hold a spot.
		const booked = {};
		for (const bed of app.findRecordsByFilter('beds', "order != ''", '', 0, 0)) {
			booked[bed.getString('order')] = true;
		}
		for (const orderId of Object.keys(booked)) {
			let order;
			try {
				order = app.findRecordById('orders', orderId);
			} catch (_) {
				continue; // dangling relation
			}
			if (order.getString('pass_code')) continue;
			// A clash of two random codes is practically impossible, but a failed
			// migration would keep PocketBase from starting: try again, then skip
			// (pb_hooks/cozy_pass.pb.js creates the code on demand).
			for (let attempt = 0; attempt < 3; attempt++) {
				try {
					order.set('pass_code', $security.randomStringWithAlphabet(LENGTH, ALPHABET));
					app.save(order);
					break;
				} catch (err) {
					console.warn('[migration] pass code for ' + orderId + ' not saved: ' + err);
				}
			}
		}
	},
	(app) => {
		// Intentionally a no-op: pass codes may already be in guests' hands.
	}
);
