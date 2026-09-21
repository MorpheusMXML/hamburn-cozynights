/// <reference path="../pb_data/types.d.ts" />
//
// beds are no longer publicly readable (docs/reference/security.md). They
// carry `order` (which ticket holds the spot), `is_special` and `booked_at`:
// together with the burner names on the room pages that would tell who has
// special needs. The app serves guests only what a page shows, through its
// service account; admins read beds with their own token. Same rule string as
// pb_migrations/1758000000_admin_auth.js. Idempotent; the down branch restores
// the old public read.

const ADMIN_RULE =
	'@request.auth.collectionName = "admins" && (@request.auth.role = "admin" || @request.auth.role = "superuser")';

migrate(
	(app) => {
		const beds = app.findCollectionByNameOrId('beds');
		beds.listRule = ADMIN_RULE;
		beds.viewRule = ADMIN_RULE;
		app.save(beds);
	},
	(app) => {
		const beds = app.findCollectionByNameOrId('beds');
		beds.listRule = '';
		beds.viewRule = '';
		app.save(beds);
	}
);
