/// <reference path="../pb_data/types.d.ts" />
//
// Initial collection schema for Hamburn Cozynights, extracted from
// src/lib/pocketbase-types.ts and the API rules the application code
// assumes (see docs/DEPLOYMENT.md #7 — this file is what closes that gap).
// PocketBase auto-applies any file in pb_migrations/ on startup, so a fresh
// instance gets the correct schema and rules without manual setup.
//
// Rule conventions used throughout:
// - listRule/viewRule "" (public): houses, rooms, beds, app_settings — the
//   guest map/room/house pages read these through the unauthenticated `pb`
//   connection (see hooks.server.ts). None of these expose personal data.
// - createRule/updateRule/deleteRule "@request.auth.verified = true":
//   admin-only structural writes, matching every admin/*.server.ts action's
//   own `locals.pb.authStore.model?.verified` check — this is the database
//   backing that check, not a substitute for it.
// - orders: no public rules at all (null/superuser-only). Orders hold PII
//   (customer_name, burner_name) and are only ever read or written through
//   the privileged adminPb connection via BookingService — see
//   src/lib/server/booking.ts and docs/SECURITY.md.
// - beds also allow admin *update* for occupancy fields even though guest
//   booking writes go through adminPb (bypassing rules entirely) — the
//   verified-admin rule here is for the admin room-management UI, which
//   writes through the ordinary `pb` connection.

migrate(
	(app) => {
		const orders = new Collection({
			name: 'orders',
			type: 'base',
			fields: [
				{ name: 'order_number', type: 'text', required: true },
				{ name: 'order_hash', type: 'text' },
				{ name: 'customer_name', type: 'text', required: true },
				{ name: 'burner_name', type: 'text' },
				{ name: 'booking_date', type: 'date' }
			],
			indexes: ['CREATE UNIQUE INDEX idx_orders_hash ON orders (order_hash)']
			// listRule/viewRule/createRule/updateRule/deleteRule intentionally left
			// null (superuser-only) — see file header.
		});
		app.save(orders);

		const appSettings = new Collection({
			name: 'app_settings',
			type: 'base',
			fields: [
				{ name: 'is_booking_active', type: 'bool' },
				{ name: 'booking_unlock_at', type: 'date' }
			],
			listRule: '',
			viewRule: '',
			createRule: '@request.auth.verified = true',
			updateRule: '@request.auth.verified = true'
		});
		app.save(appSettings);

		const houses = new Collection({
			name: 'houses',
			type: 'base',
			fields: [
				{ name: 'name', type: 'text', required: true },
				{ name: 'x', type: 'number' },
				{ name: 'y', type: 'number' },
				{ name: 'occupied', type: 'bool' }
			],
			listRule: '',
			viewRule: '',
			createRule: '@request.auth.verified = true',
			updateRule: '@request.auth.verified = true',
			deleteRule: '@request.auth.verified = true'
		});
		app.save(houses);

		const rooms = new Collection({
			name: 'rooms',
			type: 'base',
			fields: [
				{ name: 'name', type: 'text', required: true },
				{ name: 'room_number', type: 'number' },
				{
					name: 'house',
					type: 'relation',
					required: true,
					collectionId: houses.id,
					maxSelect: 1,
					cascadeDelete: true
				},
				{ name: 'amount_beds', type: 'number' },
				{ name: 'occupied', type: 'bool' }
			],
			listRule: '',
			viewRule: '',
			createRule: '@request.auth.verified = true',
			updateRule: '@request.auth.verified = true',
			deleteRule: '@request.auth.verified = true'
		});
		app.save(rooms);

		const beds = new Collection({
			name: 'beds',
			type: 'base',
			fields: [
				{ name: 'label', type: 'text' },
				{
					name: 'room',
					type: 'relation',
					required: true,
					collectionId: rooms.id,
					maxSelect: 1,
					cascadeDelete: true
				},
				{ name: 'occupied', type: 'bool' },
				{
					name: 'order',
					type: 'relation',
					collectionId: orders.id,
					maxSelect: 1
				},
				{ name: 'is_locked', type: 'bool' },
				{ name: 'enabled', type: 'bool' }
			],
			listRule: '',
			viewRule: '',
			createRule: '@request.auth.verified = true',
			// Booking writes for guests always go through adminPb (rules bypassed
			// by design — see booking.ts), so this rule only governs the admin
			// room-management UI's own occupancy/lock toggles.
			updateRule: '@request.auth.verified = true',
			deleteRule: '@request.auth.verified = true'
		});
		app.save(beds);

		// The app reads/writes this exact singleton record by id everywhere
		// (see src/lib/server/constants.ts) — seed it so a fresh instance can
		// go live immediately instead of depending on the admin's first toggle
		// click to lazily create it.
		const settingsRecord = new Record(appSettings, {
			id: 'appsettings0123',
			is_booking_active: false,
			booking_unlock_at: ''
		});
		app.save(settingsRecord);
	},
	(app) => {
		for (const name of ['beds', 'rooms', 'houses', 'app_settings', 'orders']) {
			const collection = app.findCollectionByNameOrId(name);
			app.delete(collection);
		}
	}
);
