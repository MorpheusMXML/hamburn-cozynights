/// <reference path="../pb_data/types.d.ts" />
//
// Message texts (docs/admin/notifications.md, "Message texts"): admins change
// what guests get by e-mail, on Telegram and from the bot, on /admin/messages.
//
// - message_texts: one record per changed text, keyed like the catalogue in
//   pb_hooks/lib/texts.js (`key`); a text without a record uses the default
//   from there. `updated_by` is the admin who saved it. PocketBase reads the
//   records when it sends (pb_hooks/lib/notify.js, loadTexts).
//
// No API rules (superusers only): the app writes through its service account.
// Idempotent like the earlier migrations.

migrate(
	(app) => {
		const find = (name) => {
			try {
				return app.findCollectionByNameOrId(name);
			} catch (_) {
				return null;
			}
		};

		if (!find('message_texts')) {
			app.save(
				new Collection({
					name: 'message_texts',
					type: 'base',
					fields: [
						{ name: 'key', type: 'text', required: true, max: 80, pattern: '^[a-z0-9_.]+$' },
						{ name: 'text', type: 'text', required: true, max: 4000 },
						{ name: 'updated_by', type: 'text', max: 320 },
						{ name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
						{ name: 'updated', type: 'autodate', onCreate: true, onUpdate: true }
					],
					indexes: ['CREATE UNIQUE INDEX `idx_message_texts_key` ON `message_texts` (`key`)']
				})
			);
		}
	},
	(app) => {
		// Intentionally a no-op, like the other migrations: `migrate down` must
		// not throw away texts the crew wrote.
	}
);
