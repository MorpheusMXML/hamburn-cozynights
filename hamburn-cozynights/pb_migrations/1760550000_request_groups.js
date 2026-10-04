/// <reference path="../pb_data/types.d.ts" />
//
// Request groups (docs/admin/special-needs.md, "Groups"): guests who ask for
// spots together — an art project, a workshop, a theme camp, a crew or
// friends who want to sleep close to each other.
//
// - request_groups: a voluntary link between special-needs requests. It has
//   NO status of its own: every decision and every booking lives on each
//   member's own request (special_requests), so the guest messages, fixed
//   spots and every other request rule work for group members unchanged.
//   `name` is what the guest called the group: the app ENCRYPTS it
//   (AES-256-GCM with ENCRYPTION_KEY, like orders.burner_name), because a
//   guest-chosen name may reveal something. `code` is a random join token
//   from the booking pass alphabet (src/lib/pass.ts, no look-alikes), shared
//   by the members as a code or an invite link; unique. `removed` lists the
//   tickets (order ids) the crew took out of the group: they can't join it
//   again with its code (src/lib/server/request-groups.ts).
//   A group is deleted as soon as its last request leaves it, whichever way
//   (pb_hooks/cozy_groups.pb.js), and all of them by
//   `cozy-admin tickets forget-contacts` after the event.
// - special_requests.request_group: the group a request is in, empty for
//   none. A ticket has one request, so it is in at most one group. No cascade:
//   a request outlives its group (the hook never deletes a group that still
//   has members).
//
// The new collection has no API rules (superusers only): the app uses it
// through its service account. Idempotent like the earlier migrations.

migrate(
	(app) => {
		const find = (name) => {
			try {
				return app.findCollectionByNameOrId(name);
			} catch (_) {
				return null;
			}
		};

		if (!find('request_groups')) {
			app.save(
				new Collection({
					name: 'request_groups',
					type: 'base',
					fields: [
						// PASS_ALPHABET of src/lib/pass.ts, stored without dashes
						{
							name: 'code',
							type: 'text',
							required: true,
							min: 8,
							max: 8,
							pattern: '^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$'
						},
						// ciphertext of a name of 2 to 40 characters
						{ name: 'name', type: 'text', required: true, max: 1000 },
						// order ids the crew took out of the group
						{ name: 'removed', type: 'json', maxSize: 20000 },
						{ name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
						{ name: 'updated', type: 'autodate', onCreate: true, onUpdate: true }
					],
					indexes: ['CREATE UNIQUE INDEX `idx_request_groups_code` ON `request_groups` (`code`)']
				})
			);
		}

		const groups = app.findCollectionByNameOrId('request_groups');
		if (!groups.fields.getByName('removed')) {
			groups.fields.add(new JSONField({ name: 'removed', maxSize: 20000 }));
			app.save(groups);
		}
		const requests = app.findCollectionByNameOrId('special_requests');
		if (!requests.fields.getByName('request_group')) {
			requests.fields.add(
				new RelationField({
					name: 'request_group',
					collectionId: groups.id,
					maxSelect: 1,
					cascadeDelete: false
				})
			);
		}
		requests.indexes = requests.indexes
			.filter((idx) => !/idx_special_requests_request_group/.test(idx))
			.concat([
				'CREATE INDEX `idx_special_requests_request_group` ON `special_requests` (`request_group`)'
			]);
		app.save(requests);
	},
	(app) => {
		// Intentionally a no-op, like the other data migrations: groups may hold
		// members, and `migrate down` must not throw the links away. The old app
		// ignores the field and the collection.
	}
);
