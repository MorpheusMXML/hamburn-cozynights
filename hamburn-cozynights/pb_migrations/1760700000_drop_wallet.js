/// <reference path="../pb_data/types.d.ts" />
//
// No more wallet passes (Max's decision of 2026-10-05): Apple Wallet and
// Google Wallet are not offered any more, guests get their booking pass by
// e-mail, as a link, as a code and on Telegram (docs/admin/passes.md). This
// takes back what 1759950000_wallet_passes.js added:
//
// - wallet_devices (Apple device ids and push tokens) first, then
//   wallet_passes: wallet_devices.pass points at wallet_passes, and
//   PocketBase refuses to delete a collection another one still refers to.
//   No other collection points into either of them.
// - app_settings.wallet_platforms.
// - a changed text for the old e-mail line "mail.wallet" (message_texts):
//   pb_hooks/lib/texts.js no longer has the key, so nothing would ever read
//   it again, /admin/messages could not remove it, and a later text of the
//   same name must not inherit it.
//
// A drop by decision, like 1760200000 before it (docs/develop/integration.md:
// drop only what no deployed code still needs). No deployed code needs these
// any more: the code from before this release tolerates their absence (the
// guest list, notify.js and `cozy-admin tickets forget-contacts` all read
// them as "none"), so either order of deploy is safe. And no server ever held
// wallet data: no wallet was ever configured, so not one pass was issued.
//
// Idempotent like the earlier migrations: whatever is gone already is
// skipped. The down branch puts the empty collections and the field back
// exactly as 1759950000 made them; the records and a changed "mail.wallet"
// text are gone for good.

migrate(
	(app) => {
		const find = (name) => {
			try {
				return app.findCollectionByNameOrId(name);
			} catch (_) {
				return null;
			}
		};

		const devices = find('wallet_devices');
		if (devices) app.delete(devices);
		const passes = find('wallet_passes');
		if (passes) app.delete(passes);

		const settings = app.findCollectionByNameOrId('app_settings');
		if (settings.fields.getByName('wallet_platforms')) {
			settings.fields.removeByName('wallet_platforms');
			app.save(settings);
		}

		if (find('message_texts')) {
			for (const row of app.findRecordsByFilter('message_texts', "key = 'mail.wallet'", '', 0, 0)) {
				app.delete(row);
			}
		}
	},
	(app) => {
		const find = (name) => {
			try {
				return app.findCollectionByNameOrId(name);
			} catch (_) {
				return null;
			}
		};

		// A copy of 1759950000_wallet_passes.js: the same fields and indexes, empty.
		const settings = app.findCollectionByNameOrId('app_settings');
		if (!settings.fields.getByName('wallet_platforms')) {
			settings.fields.add(new TextField({ name: 'wallet_platforms', max: 32 }));
			app.save(settings);
		}

		const orders = app.findCollectionByNameOrId('orders');
		const autodates = [
			{ name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
			{ name: 'updated', type: 'autodate', onCreate: true, onUpdate: true }
		];

		let passes = find('wallet_passes');
		if (!passes) {
			passes = new Collection({
				name: 'wallet_passes',
				type: 'base',
				fields: [
					{
						name: 'order',
						type: 'relation',
						collectionId: orders.id,
						maxSelect: 1,
						cascadeDelete: false
					},
					{
						name: 'platform',
						type: 'select',
						required: true,
						maxSelect: 1,
						values: ['apple', 'google']
					},
					{ name: 'serial', type: 'text', required: true, max: 32 },
					{ name: 'hash', type: 'text', max: 64 },
					{ name: 'pushed_hash', type: 'text', max: 64 },
					{ name: 'changed_at', type: 'date' },
					{ name: 'attempts', type: 'number', onlyInt: true, min: 0 },
					{ name: 'next_try', type: 'date' },
					{ name: 'last_error', type: 'text', max: 500 }
				].concat(autodates),
				indexes: [
					'CREATE UNIQUE INDEX `idx_wallet_passes_serial` ON `wallet_passes` (`platform`, `serial`)',
					'CREATE INDEX `idx_wallet_passes_order` ON `wallet_passes` (`order`)'
				]
			});
			app.save(passes);
		}

		if (!find('wallet_devices')) {
			app.save(
				new Collection({
					name: 'wallet_devices',
					type: 'base',
					fields: [
						{
							name: 'pass',
							type: 'relation',
							required: true,
							collectionId: passes.id,
							maxSelect: 1,
							cascadeDelete: true
						},
						{ name: 'device', type: 'text', required: true, max: 128 },
						{ name: 'push_token', type: 'text', required: true, max: 256 }
					].concat(autodates),
					indexes: [
						'CREATE UNIQUE INDEX `idx_wallet_devices_pass` ON `wallet_devices` (`device`, `pass`)',
						'CREATE INDEX `idx_wallet_devices_by_pass` ON `wallet_devices` (`pass`)'
					]
				})
			);
		}
	}
);
