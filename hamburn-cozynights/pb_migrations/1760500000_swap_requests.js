/// <reference path="../pb_data/types.d.ts" />
//
// Swap requests (docs/guide/booking.md "Swap spots", docs/admin/swaps.md):
// during Live Booking a guest who holds a spot asks the holder of another,
// taken spot to trade. Nothing moves until the other guest says yes; then
// both spots change hands in one transaction (POST /api/cozy/swap,
// pb_hooks/cozy_swap.pb.js).
//
// - swap_requests: who asks (from_order, from_bed = the spot they offer) whom
//   (to_order, to_bed = the spot they would like). `status` pending →
//   accepted | declined | withdrawn | expired | void (it can't happen any
//   more; `ended` says why: a spot changed hands, another swap went
//   through). `note` is the asker's own words: the app ENCRYPTS it
//   (AES-256-GCM with ENCRYPTION_KEY, like orders.burner_name) — a note may
//   say why ("my knees…"), so the dashboard and backups only hold
//   ciphertext, and it never goes into an e-mail or a Telegram message.
//   `quiet`: the request is never shown to the other guest nor sent to them
//   (the spot can't be swapped, or its guest paused swap requests); it runs
//   out like an unanswered one, so nobody learns why. The asker is told the
//   same "no answer" either way.
//   The delivery run (pb_hooks/lib/notify.js, deliverSwaps) tells the other
//   guest about a new request and the asker about a "no": `notify_due` is set
//   by the app, `ask_mail`/`ask_tg`/`answer_mail`/`answer_tg` remember what
//   went out on which channel.
// - app_settings.swaps_off: the crew's switch in the Control Center (off =
//   no new requests, no answers). Unset = swaps are on during Live Booking.
// - orders.no_swap_requests: the guest paused swap requests to them. Goes
//   with the holder when the ticket is handed over (pb_hooks/lib/handover.js).
//
// No API rules on the new collection (superusers only): guests and admins
// reach it only through the app. A request goes with either ticket or either
// spot (cascade). Idempotent like the earlier migrations.

migrate(
	(app) => {
		const find = (name) => {
			try {
				return app.findCollectionByNameOrId(name);
			} catch (_) {
				return null;
			}
		};
		const addField = (collection, field) => {
			if (!collection.fields.getByName(field.name)) collection.fields.add(field);
		};

		const settings = app.findCollectionByNameOrId('app_settings');
		addField(settings, new BoolField({ name: 'swaps_off' }));
		app.save(settings);

		const orders = app.findCollectionByNameOrId('orders');
		addField(orders, new BoolField({ name: 'no_swap_requests' }));
		app.save(orders);

		if (!find('swap_requests')) {
			const beds = app.findCollectionByNameOrId('beds');
			const relation = (name, collectionId) => ({
				name,
				type: 'relation',
				required: true,
				collectionId,
				maxSelect: 1,
				cascadeDelete: true
			});
			app.save(
				new Collection({
					name: 'swap_requests',
					type: 'base',
					fields: [
						relation('from_order', orders.id),
						relation('from_bed', beds.id),
						relation('to_order', orders.id),
						relation('to_bed', beds.id),
						{
							name: 'status',
							type: 'select',
							required: true,
							maxSelect: 1,
							values: ['pending', 'accepted', 'declined', 'withdrawn', 'expired', 'void']
						},
						// a key of SWAP_VIBES (src/lib/swaps.ts), '' for none
						{ name: 'vibe', type: 'text', max: 24 },
						// ciphertext of at most 140 characters
						{ name: 'note', type: 'text', max: 2000 },
						{ name: 'quiet', type: 'bool' },
						{ name: 'expires_at', type: 'date', required: true },
						{ name: 'answered_at', type: 'date' },
						// why it ended without a yes or no (status void): src/lib/swaps.ts SwapEnd
						{ name: 'ended', type: 'text', max: 24 },
						// the delivery run's outbox (pb_hooks/lib/notify.js)
						{ name: 'notify_due', type: 'date' },
						{ name: 'notify_attempts', type: 'number', min: 0, onlyInt: true },
						{ name: 'notify_error', type: 'text', max: 1000 },
						{ name: 'ask_mail', type: 'date' },
						{ name: 'ask_tg', type: 'date' },
						{ name: 'answer_mail', type: 'date' },
						{ name: 'answer_tg', type: 'date' },
						{ name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
						{ name: 'updated', type: 'autodate', onCreate: true, onUpdate: true }
					],
					indexes: [
						'CREATE INDEX `idx_swap_requests_from` ON `swap_requests` (`from_order`, `status`)',
						'CREATE INDEX `idx_swap_requests_to` ON `swap_requests` (`to_order`, `status`)',
						'CREATE INDEX `idx_swap_requests_due` ON `swap_requests` (`notify_due`)'
					]
				})
			);
		}
	},
	(app) => {
		// Intentionally a no-op, like the other migrations: requests may be
		// waiting for an answer, and `migrate down` must not throw them away.
	}
);
