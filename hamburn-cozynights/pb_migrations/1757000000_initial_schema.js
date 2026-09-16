/// <reference path="../pb_data/types.d.ts" />
//
// Initial collection schema for Hamburn Cozynights, extracted from
// src/lib/pocketbase-types.ts and the API rules the application code
// assumes. PocketBase auto-applies any file in pb_migrations/ on startup, so a
// fresh instance gets the correct schema without manual setup.
//
// IDEMPOTENT on purpose: environments restored from a database backup already
// contain these collections but have no `_migrations` row for this file.
// Unconditionally creating them would fail with "Collection name must be
// unique" and put PocketBase into a crash loop. Existing collections are left
// untouched here; their API rules are normalized by the later admin-auth
// migration (1758000000_admin_auth.js), which applies to restored databases too.
//
// Rule conventions used throughout (write rules are finalized in 1758000000):
// - listRule/viewRule "" (public): houses, rooms, beds, app_settings — the
//   guest map/room/house pages read these through the unauthenticated `pb`
//   connection (see hooks.server.ts). None of these expose personal data.
// - orders: no public rules at all (null/superuser-only). Orders hold PII
//   (customer_name, burner_name) and are only ever read or written through
//   the privileged adminPb connection via BookingService — see
//   src/lib/server/booking.ts and docs/SECURITY.md.

migrate(
	(app) => {
		const find = (name) => {
			try {
				return app.findCollectionByNameOrId(name);
			} catch (_) {
				return null;
			}
		};

		let orders = find('orders');
		if (!orders) {
			orders = new Collection({
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
		}

		let appSettings = find('app_settings');
		if (!appSettings) {
			appSettings = new Collection({
				name: 'app_settings',
				type: 'base',
				fields: [
					{ name: 'is_booking_active', type: 'bool' },
					{ name: 'booking_unlock_at', type: 'date' }
				],
				listRule: '',
				viewRule: ''
			});
			app.save(appSettings);
		}

		let houses = find('houses');
		if (!houses) {
			houses = new Collection({
				name: 'houses',
				type: 'base',
				fields: [
					{ name: 'name', type: 'text', required: true },
					{ name: 'x', type: 'number' },
					{ name: 'y', type: 'number' },
					{ name: 'occupied', type: 'bool' }
				],
				listRule: '',
				viewRule: ''
			});
			app.save(houses);
		}

		let rooms = find('rooms');
		if (!rooms) {
			rooms = new Collection({
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
				viewRule: ''
			});
			app.save(rooms);
		}

		if (!find('beds')) {
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
				viewRule: ''
			});
			app.save(beds);
		}

		// The app reads/writes this exact singleton record by id everywhere
		// (see src/lib/server/constants.ts) — seed it so a fresh instance can
		// go live immediately instead of depending on the admin's first toggle
		// click to lazily create it.
		try {
			app.findRecordById('app_settings', 'appsettings0123');
		} catch (_) {
			app.save(
				new Record(appSettings, {
					id: 'appsettings0123',
					is_booking_active: false,
					booking_unlock_at: ''
				})
			);
		}
	},
	(app) => {
		// Intentionally a no-op: this migration may have "adopted" collections of
		// a restored production database, and `migrate down` must never delete
		// real booking data.
	}
);
