/// <reference path="../pb_data/types.d.ts" />

// Establishes the app's core schema (houses / rooms / beds / orders /
// app_settings) as code, reverse-engineered from the running instance
// because it had never been exported before — this is meant to be the
// baseline going forward: PocketBase auto-writes a migration file here
// whenever the schema changes through the Dashboard or Admin API from now
// on (see docker-compose.yml's pb_migrations mount and --automigrate,
// which defaults to on).
//
// Access rules were derived from how the app actually talks to PocketBase,
// not guessed from scratch — grep the codebase for `locals.pb.collection(`
// vs `locals.adminPb.collection(`/`this.adminPb.collection(`:
//   - `locals.pb` carries whatever the request is actually authenticated
//     as: nothing for an anonymous playa guest, or a `users` record once
//     someone has logged in at /admin/login. Every collection rule below
//     reflects exactly what the app performs through this client.
//   - `locals.adminPb` / `this.adminPb` (src/lib/server/pocketbase.ts,
//     src/lib/server/booking.ts) is a separate, server-only superuser
//     singleton that bypasses collection rules entirely. Guests booking or
//     releasing a bed, and the guest-facing order/booking-code lookup, all
//     go through this client — which is why `orders` can stay locked down
//     even though bookings are a guest-facing feature.
// Every create/update/delete rule below matches a real call site gated by
// `locals.pb.authStore.model?.verified` in the corresponding +page.server.ts
// action, so this is defense-in-depth for an existing app-level check, not
// a new restriction.

migrate(
	(app) => {
		const verifiedOnly = '@request.auth.id != "" && @request.auth.verified = true';

		// Base collections don't get `created`/`updated` for free — every
		// collection below appends these explicitly to match what
		// pocketbase-typegen already generated for them.
		const timestamps = [
			{ name: 'created', type: 'autodate', onCreate: true },
			{ name: 'updated', type: 'autodate', onCreate: true, onUpdate: true }
		];

		// --- houses ---------------------------------------------------------
		// Read publicly (guests browse /map and /house/[id] unauthenticated).
		// Written only from the admin dashboard, always as a verified user.
		const houses = new Collection({
			type: 'base',
			name: 'houses',
			listRule: '',
			viewRule: '',
			createRule: verifiedOnly,
			updateRule: verifiedOnly,
			deleteRule: verifiedOnly,
			fields: [
				{ name: 'name', type: 'text', required: true, max: 200 },
				{ name: 'x', type: 'number' },
				{ name: 'y', type: 'number' },
				{ name: 'occupied', type: 'bool' },
				...timestamps
			]
		});
		app.save(houses);

		// --- orders -----------------------------------------------------------
		// Contains the booking code (order_number/order_hash act as a bearer
		// secret — anyone holding one can claim a bed with it) and guest PII,
		// so nothing here is public. The app never creates or updates orders
		// through `locals.pb` at all (only through the superuser client), so
		// createRule/updateRule stay superuser-only (null). list/view/delete
		// are reachable from the admin dashboard's "clear all bookings" and
		// booking-overview actions, always behind a verified-user check.
		const orders = new Collection({
			type: 'base',
			name: 'orders',
			listRule: verifiedOnly,
			viewRule: verifiedOnly,
			createRule: null,
			updateRule: null,
			deleteRule: verifiedOnly,
			fields: [
				{ name: 'order_number', type: 'text', required: true, max: 100 },
				{ name: 'order_hash', type: 'text', max: 100 },
				{ name: 'customer_name', type: 'text', required: true, max: 200 },
				{ name: 'burner_name', type: 'text', max: 500 },
				{ name: 'booking_date', type: 'date' },
				...timestamps
			],
			indexes: [
				'CREATE UNIQUE INDEX idx_orders_order_number ON orders (order_number)',
				// Partial: legacy orders are auto-migrated to a hash on first
				// lookup (src/lib/server/booking.ts), so more than one row can
				// transiently have an empty order_hash before that runs.
				"CREATE UNIQUE INDEX idx_orders_order_hash ON orders (order_hash) WHERE order_hash != ''"
			]
		});
		app.save(orders);

		// --- rooms ------------------------------------------------------------
		const rooms = new Collection({
			type: 'base',
			name: 'rooms',
			listRule: '',
			viewRule: '',
			createRule: verifiedOnly,
			updateRule: verifiedOnly,
			deleteRule: verifiedOnly,
			fields: [
				{ name: 'name', type: 'text', required: true, max: 200 },
				{ name: 'room_number', type: 'number', required: true },
				{ name: 'amount_beds', type: 'number' },
				{
					name: 'house',
					type: 'relation',
					required: true,
					collectionId: houses.id,
					maxSelect: 1
				},
				{ name: 'occupied', type: 'bool' },
				...timestamps
			]
		});
		app.save(rooms);

		// --- beds ---------------------------------------------------------
		// Same public-read / verified-write split as houses and rooms. Guest
		// booking writes (occupied/order) always go through the superuser
		// client (BookingService), never through this rule-checked path.
		const beds = new Collection({
			type: 'base',
			name: 'beds',
			listRule: '',
			viewRule: '',
			createRule: verifiedOnly,
			updateRule: verifiedOnly,
			deleteRule: verifiedOnly,
			fields: [
				{ name: 'label', type: 'text', max: 100 },
				{
					name: 'room',
					type: 'relation',
					required: true,
					collectionId: rooms.id,
					maxSelect: 1
				},
				{
					name: 'order',
					type: 'relation',
					collectionId: orders.id,
					maxSelect: 1
				},
				// Present in the current schema but never read anywhere in the
				// app — only ever set to '' / null alongside `order` when a
				// booking is cleared. Best guess at intent (superseded by
				// `order`); confirm before relying on it for anything new.
				{
					name: 'bookedBy',
					type: 'relation',
					collectionId: orders.id,
					maxSelect: 1
				},
				{ name: 'occupied', type: 'bool' },
				{ name: 'enabled', type: 'bool' },
				{ name: 'is_locked', type: 'bool' },
				...timestamps
			]
		});
		app.save(beds);

		// --- app_settings -------------------------------------------------
		// Singleton config record — see src/lib/server/constants.ts for why
		// its fixed id is `appsettings0123` and not the old `abcsettings123`
		// (the latter is 14 chars and fails PocketBase's 15-char id
		// validation on any fresh instance, permanently blocking creation).
		// Publicly viewable: every guest-facing page reads is_booking_active
		// via getBookingSettings(locals.pb) to know whether booking is open.
		const appSettings = new Collection({
			type: 'base',
			name: 'app_settings',
			listRule: '',
			viewRule: '',
			createRule: verifiedOnly,
			updateRule: verifiedOnly,
			deleteRule: null,
			fields: [
				{ name: 'is_booking_active', type: 'bool' },
				{ name: 'booking_unlock_at', type: 'date' },
				...timestamps
			]
		});
		app.save(appSettings);

		const settingsRecord = new Record(appSettings, {
			id: 'appsettings0123',
			is_booking_active: false
		});
		app.save(settingsRecord);
	},
	(app) => {
		// Reverse dependency order.
		for (const name of ['app_settings', 'beds', 'rooms', 'orders', 'houses']) {
			const collection = app.findCollectionByNameOrId(name);
			if (collection) app.delete(collection);
		}
	}
);
