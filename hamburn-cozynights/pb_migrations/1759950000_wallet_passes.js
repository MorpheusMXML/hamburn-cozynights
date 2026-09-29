/// <reference path="../pb_data/types.d.ts" />
//
// Wallet passes (docs/admin/passes.md, "Wallet passes"): the booking pass in
// Apple Wallet and Google Wallet, kept up to date by the app
// (src/lib/server/wallet). PocketBase only stores; the app signs, pushes and
// talks to Apple and Google, because the keys for that live in the app's
// environment only.
//
// - wallet_passes: one record per pass a guest added (or downloaded), per
//   platform. `serial` is the pass code the wallet pass was made for: after a
//   hand-over the ticket gets a new code, and the old wallet pass is voided.
//   `hash` is what the pass shows now, `pushed_hash` what the platform was
//   last told (Google's copy, or the push to Apple's devices); `changed_at`
//   is when the content last changed (Apple asks for passes changed since).
//   The ticket may be deleted meanwhile: the relation doesn't cascade, so the
//   record lives on long enough to void the pass.
// - wallet_devices: the iPhones and Watches that registered an Apple Wallet
//   pass for updates (device library id and push token, both issued by Apple
//   for this pass type only). They go with their pass, and with
//   `cozy-admin tickets forget-contacts` after the event.
// - app_settings.wallet_platforms: "apple", "google" or both, set by the app
//   when it starts. PocketBase reads it for the wallet buttons in messages.
//
// No API rules: superusers only (the app's service account). Idempotent like
// the earlier migrations.

migrate(
	(app) => {
		const find = (name) => {
			try {
				return app.findCollectionByNameOrId(name);
			} catch (_) {
				return null;
			}
		};

		const settings = app.findCollectionByNameOrId('app_settings');
		if (!settings.fields.getByName('wallet_platforms')) {
			settings.fields.add(new TextField({ name: 'wallet_platforms', max: 32 }));
		}
		app.save(settings);

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
					// the pass code (without dashes) this wallet pass was made for
					{ name: 'serial', type: 'text', required: true, max: 32 },
					// what the pass shows now, and what the platform was last told
					{ name: 'hash', type: 'text', max: 64 },
					{ name: 'pushed_hash', type: 'text', max: 64 },
					{ name: 'changed_at', type: 'date' },
					// failed pushes: how often, when to try again, why (no secrets)
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
						// Apple's deviceLibraryIdentifier and the push token for this pass type
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
	},
	(app) => {
		// Intentionally a no-op, like the earlier migrations: without these
		// records the passes already in guests' wallets could never be updated
		// or voided again.
	}
);
