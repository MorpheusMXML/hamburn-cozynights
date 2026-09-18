/// <reference path="../pb_data/types.d.ts" />
//
// Special-needs requests (docs/admin/special-needs.md): guests ask for a
// suitable spot with their ticket code, also while booking is closed; admins
// approve or decline the request and assign a spot.
//
// - special_requests: at most one per ticket (unique `order`). `needs` is what
//   the guest ticked, `reason` their own words. The app ENCRYPTS `reason` and
//   `burner_name` (AES-256-GCM with ENCRYPTION_KEY, like orders.burner_name):
//   a reason is often health data (Art. 9 GDPR), so the dashboard and backups
//   only hold ciphertext. `consent_at` is when the guest agreed to that.
//   Withdrawing a request deletes it; so does deleting its ticket (cascade)
//   and `cozy-admin tickets forget-contacts` after the event.
// - beds.is_special: a special-needs spot. Guests can't book it (like a locked
//   spot, and they never see why); admins assign it to an approved request.
// - app_settings.special_requests_open: whether guests can send requests,
//   independent of the booking phase.
// - guest_notify.mail_req / tg_req: the request last told by e-mail / Telegram
//   ("<request id>:<status>"), so a decision is one message, like a change of spot.
//
// The new collection has no API rules (superusers only): the app uses it
// through its service account. Idempotent like the earlier migrations.

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

		const beds = app.findCollectionByNameOrId('beds');
		addField(beds, new BoolField({ name: 'is_special' }));
		app.save(beds);

		const settings = app.findCollectionByNameOrId('app_settings');
		addField(settings, new BoolField({ name: 'special_requests_open' }));
		app.save(settings);

		const guestNotify = app.findCollectionByNameOrId('guest_notify');
		addField(guestNotify, new TextField({ name: 'mail_req', max: 40 }));
		addField(guestNotify, new TextField({ name: 'tg_req', max: 40 }));
		app.save(guestNotify);

		if (!find('special_requests')) {
			const orders = app.findCollectionByNameOrId('orders');
			app.save(
				new Collection({
					name: 'special_requests',
					type: 'base',
					fields: [
						{
							name: 'order',
							type: 'relation',
							required: true,
							collectionId: orders.id,
							maxSelect: 1,
							cascadeDelete: true
						},
						{
							name: 'status',
							type: 'select',
							required: true,
							maxSelect: 1,
							values: ['pending', 'approved', 'declined']
						},
						// Keep in sync with SPECIAL_NEEDS in src/lib/special-needs.ts.
						{
							name: 'needs',
							type: 'select',
							maxSelect: 6,
							values: ['lower_bunk', 'step_free', 'near_toilet', 'quiet', 'power', 'other']
						},
						// ciphertext of at most 500 characters
						{ name: 'reason', type: 'text', max: 5000 },
						// ciphertext of the burner name for the spot, optional
						{ name: 'burner_name', type: 'text', max: 1000 },
						{ name: 'consent_at', type: 'date', required: true },
						// the admin who approved or declined, and when
						{ name: 'decided_by', type: 'text', max: 320 },
						{ name: 'decided_at', type: 'date' },
						{ name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
						{ name: 'updated', type: 'autodate', onCreate: true, onUpdate: true }
					],
					indexes: [
						'CREATE UNIQUE INDEX `idx_special_requests_order` ON `special_requests` (`order`)',
						'CREATE INDEX `idx_special_requests_status` ON `special_requests` (`status`)'
					]
				})
			);
		}
	},
	(app) => {
		// Intentionally a no-op, like the other migrations: requests may be waiting
		// for a decision, and `migrate down` must not throw them away.
	}
);
