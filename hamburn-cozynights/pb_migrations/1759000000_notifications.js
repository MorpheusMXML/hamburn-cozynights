/// <reference path="../pb_data/types.d.ts" />
//
// Notifications: booking confirmations for guests (e-mail, optional Telegram),
// crew alerts to a Telegram chat, weekly admin re-sign-in.
// Sending happens in pb_hooks/cozy_notify.pb.js (docs/admin/notifications.md).
//
// - orders.email: the ticket holder's address, imported together with the
//   ticket code (scripts/cozy-admin.sh tickets import). Guests sign in with the
//   code only; confirmations go to this address.
// - guest_notify: one record per ticket somebody gets notified about. Holds
//   what was last confirmed by mail / Telegram (so a change of spot is one
//   message, not "released" + "booked"), when the next delivery is due,
//   retries, and the optional Telegram link (chat id, one-time link token hash).
// - admin_events: audit log of admin access and big admin actions. Every event
//   is posted to the crew Telegram chat; the alert_* fields are its outbox.
// - admins.last_sign_in: last Google sign-in. The app asks for a fresh one
//   after 7 days (src/lib/server/admin-auth.ts).
// - app_settings.notify_mail / telegram_bot: what the server can send, kept
//   up to date by pb_hooks/cozy_notify.pb.js and read by the guest pages.
//
// The new collections have no API rules (superuser-only): the app uses them
// through its service account only. Idempotent like the earlier migrations,
// so a restored older database gets the same shape.

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

		const orders = app.findCollectionByNameOrId('orders');
		addField(orders, new EmailField({ name: 'email' }));
		app.save(orders);

		const admins = app.findCollectionByNameOrId('admins');
		addField(admins, new DateField({ name: 'last_sign_in' }));
		app.save(admins);

		const settings = app.findCollectionByNameOrId('app_settings');
		addField(settings, new BoolField({ name: 'notify_mail' }));
		addField(settings, new TextField({ name: 'telegram_bot', max: 64 }));
		app.save(settings);

		const autodates = [
			{ name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
			{ name: 'updated', type: 'autodate', onCreate: true, onUpdate: true }
		];

		if (!find('guest_notify')) {
			app.save(
				new Collection({
					name: 'guest_notify',
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
						// next delivery run for this ticket; empty = nothing to do
						{ name: 'due', type: 'date' },
						{ name: 'attempts', type: 'number', onlyInt: true, min: 0 },
						{ name: 'last_error', type: 'text', max: 1000 },
						// last spot confirmed by mail: to which address, which bed, its name
						{ name: 'mail_to', type: 'text', max: 320 },
						{ name: 'mail_spot', type: 'text', max: 32 },
						{ name: 'mail_label', type: 'text', max: 400 },
						{ name: 'mail_sent', type: 'date' },
						// Telegram: linked private chat, and the same for the last message
						{ name: 'tg_chat', type: 'text', max: 32 },
						{ name: 'tg_new', type: 'bool' },
						{ name: 'tg_spot', type: 'text', max: 32 },
						{ name: 'tg_label', type: 'text', max: 400 },
						{ name: 'tg_sent', type: 'date' },
						// one-time "connect Telegram" link: SHA-256 of the token, expiry
						{ name: 'tg_token_hash', type: 'text', max: 64 },
						{ name: 'tg_token_exp', type: 'date' }
					].concat(autodates),
					indexes: [
						'CREATE UNIQUE INDEX `idx_guest_notify_order` ON `guest_notify` (`order`)',
						'CREATE INDEX `idx_guest_notify_due` ON `guest_notify` (`due`)',
						'CREATE INDEX `idx_guest_notify_tg_chat` ON `guest_notify` (`tg_chat`)',
						'CREATE INDEX `idx_guest_notify_tg_token` ON `guest_notify` (`tg_token_hash`)'
					]
				})
			);
		}

		if (!find('admin_events')) {
			app.save(
				new Collection({
					name: 'admin_events',
					type: 'base',
					fields: [
						{ name: 'action', type: 'text', required: true, max: 40 },
						// who did it: admin email, "server" (cozy-admin CLI), "timer", …
						{ name: 'actor', type: 'text', max: 320 },
						// what it is about: an admin's email, a template name, …
						{ name: 'subject', type: 'text', max: 320 },
						{ name: 'details', type: 'json', maxSize: 20000 },
						// crew chat outbox
						{
							name: 'alert_status',
							type: 'select',
							maxSelect: 1,
							values: ['pending', 'sent', 'failed', 'off']
						},
						{ name: 'alert_attempts', type: 'number', onlyInt: true, min: 0 },
						{ name: 'alert_error', type: 'text', max: 1000 }
					].concat(autodates),
					indexes: [
						'CREATE INDEX `idx_admin_events_created` ON `admin_events` (`created`)',
						'CREATE INDEX `idx_admin_events_alert` ON `admin_events` (`alert_status`)'
					]
				})
			);
		}
	},
	(app) => {
		// Intentionally a no-op, like the initial schema: orders.email holds
		// imported contact data and admin_events the audit trail — `migrate down`
		// must not throw them away.
	}
);
