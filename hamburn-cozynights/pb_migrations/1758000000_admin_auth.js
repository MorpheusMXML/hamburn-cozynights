/// <reference path="../pb_data/types.d.ts" />
//
// Admin access model (see docs/admin/access.md and docs/reference/security.md):
//
// - `admins` is a dedicated auth collection. Signing in is Google OAuth2 only
//   (password/OTP login disabled). Records are created either by a superuser
//   on the server (`scripts/cozy-admin.sh`, the `cozy-admin` console command in
//   pb_hooks/cozy_admin.pb.js) or as an access request during a Google sign-in
//   (createRule only allows the oauth2 context). The guard in
//   pb_hooks/admins_oauth_guard.pb.js only lets verified @mauersegler.art
//   Google Workspace accounts through and forces new records to role `pending`.
// - `role`: `pending` (access requested, no rights at all), `admin`,
//   `superuser` (additionally destructive actions). Approving = changing the
//   role, in the PocketBase dashboard or with `cozy-admin.sh approve`.
//   Nobody but superusers can update records (updateRule null), so a pending
//   account cannot approve itself.
// - Structural writes on houses/rooms/beds/app_settings require an approved
//   admins token — no longer "any verified record of any auth collection",
//   which the default, publicly sign-up-able `users` collection also satisfied.
//
// Every rule/field below is (re)applied unconditionally, so a database restored
// from an older backup gets normalized as well.

// Collections created from JS migrations don't get the `created`/`updated`
// autodate fields the dashboard adds by default (the admin dashboard's booking
// trend reads orders.created), so add them wherever they are missing.
function ensureAutodateFields(collection) {
	if (!collection.fields.getByName('created')) {
		collection.fields.add(new AutodateField({ name: 'created', onCreate: true, onUpdate: false }));
	}
	if (!collection.fields.getByName('updated')) {
		collection.fields.add(new AutodateField({ name: 'updated', onCreate: true, onUpdate: true }));
	}
}

const ADMIN_RULE =
	'@request.auth.collectionName = "admins" && (@request.auth.role = "admin" || @request.auth.role = "superuser")';

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
						values: ['pending', 'admin', 'superuser']
					}
				]
			});
		}
		admins.fields.getByName('role').values = ['pending', 'admin', 'superuser'];
		admins.listRule = null;
		admins.viewRule = null;
		// Only the OAuth2 sign-in may create records (as access requests); the
		// plain records API may not.
		admins.createRule = '@request.context = "oauth2"';
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
		ensureAutodateFields(admins);
		app.save(admins);

		// --- public-read / admin-write structural collections -------------------
		for (const name of ['houses', 'rooms', 'beds', 'app_settings']) {
			const c = app.findCollectionByNameOrId(name);
			c.listRule = '';
			c.viewRule = '';
			c.createRule = ADMIN_RULE;
			c.updateRule = ADMIN_RULE;
			c.deleteRule = name === 'app_settings' ? null : ADMIN_RULE;

			ensureAutodateFields(c);
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
		ensureAutodateFields(orders);
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
