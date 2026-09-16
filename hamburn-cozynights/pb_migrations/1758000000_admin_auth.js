/// <reference path="../pb_data/types.d.ts" />
//
// Admin access model (see docs/SECURITY.md "Admin access"):
//
// - `admins` is a dedicated auth collection. Nobody can create records through
//   the API (createRule null => no self sign-up, including via OAuth2), and
//   password/OTP login is disabled. Records are provisioned only on the server
//   with `scripts/cozy-admin.sh` (the `cozy-admin` console command registered
//   in pb_hooks/cozy_admin.pb.js). Signing in is Google OAuth2 only; the guard
//   in pb_hooks/admins_oauth_guard.pb.js additionally enforces a verified
//   @mauersegler.art Google Workspace account that matches an invited record.
// - `role` distinguishes superusers (destructive actions) from regular admins.
// - Structural writes on houses/rooms/beds/app_settings are allowed for tokens
//   of the `admins` collection only — no longer for "any verified record of any
//   auth collection", which the default, publicly sign-up-able `users`
//   collection also satisfied.
//
// Every rule/field below is (re)applied unconditionally, so a database restored
// from an older backup gets normalized as well.

const ADMIN_RULE = '@request.auth.collectionName = "admins"';

migrate(
	(app) => {
		const find = (name) => {
			try {
				return app.findCollectionByNameOrId(name);
			} catch (_) {
				return null;
			}
		};

		// --- admins auth collection -------------------------------------------
		let admins = find('admins');
		if (!admins) {
			admins = new Collection({
				type: 'auth',
				name: 'admins',
				fields: [
					{ name: 'name', type: 'text', max: 200 },
					{
						name: 'role',
						type: 'select',
						required: true,
						maxSelect: 1,
						values: ['superuser', 'admin']
					}
				]
			});
		}
		admins.listRule = null;
		admins.viewRule = null;
		admins.createRule = null;
		admins.updateRule = null;
		admins.deleteRule = null;
		admins.passwordAuth.enabled = false;
		admins.otp.enabled = false;
		admins.mfa.enabled = false;
		admins.authToken.duration = 259200; // 3 days, sliding (the app refreshes per request)
		admins.oauth2.mappedFields.name = 'name';

		const clientId = $os.getenv('PB_GOOGLE_CLIENT_ID');
		const clientSecret = $os.getenv('PB_GOOGLE_CLIENT_SECRET');
		if (clientId && clientSecret) {
			admins.oauth2.enabled = true;
			admins.oauth2.providers = [{ name: 'google', clientId, clientSecret }];
		} else {
			// Kept in sync on every start by pb_hooks/cozy_admin.pb.js once the
			// PB_GOOGLE_* variables are provided.
			console.log(
				'[migration] PB_GOOGLE_CLIENT_ID/SECRET not set, Google admin login disabled for now'
			);
			admins.oauth2.enabled = false;
		}
		app.save(admins);

		// --- public-read / admin-write structural collections -------------------
		for (const name of ['houses', 'rooms', 'beds', 'app_settings']) {
			const c = app.findCollectionByNameOrId(name);
			c.listRule = '';
			c.viewRule = '';
			c.createRule = ADMIN_RULE;
			c.updateRule = ADMIN_RULE;
			c.deleteRule = name === 'app_settings' ? null : ADMIN_RULE;

			if (name === 'beds') {
				// Older backups predate these flags.
				for (const flag of ['is_locked', 'enabled']) {
					if (!c.fields.getByName(flag)) {
						c.fields.add(new BoolField({ name: flag }));
					}
				}
			}
			app.save(c);
		}

		// --- orders: superuser-only, ticket-code hash index -------------------
		const orders = app.findCollectionByNameOrId('orders');
		orders.listRule = null;
		orders.viewRule = null;
		orders.createRule = null;
		orders.updateRule = null;
		orders.deleteRule = null;
		if (!orders.fields.getByName('order_hash')) {
			orders.fields.add(new TextField({ name: 'order_hash' }));
		}
		// Unique only among non-empty hashes: orders imported with just a plain
		// order_number get their hash on first login (BookingService), and a plain
		// UNIQUE index would allow only a single such order to exist.
		orders.indexes = orders.indexes
			.filter((idx) => !/\border_hash\b/.test(idx))
			.concat([
				"CREATE UNIQUE INDEX idx_orders_hash ON orders (order_hash) WHERE order_hash != ''"
			]);
		app.save(orders);

		// --- default `users` collection: no public sign-up ----------------------
		const users = find('users');
		if (users) {
			users.createRule = null;
			users.oauth2.enabled = false;
			app.save(users);
		}
	},
	(app) => {
		try {
			app.delete(app.findCollectionByNameOrId('admins'));
		} catch (_) {
			/* already gone */
		}
	}
);
