// tests/clear-special-needs-migrations.test.ts — the two migrations that delete the
// special-needs test data before v1.32.2 (Max, 2026-10-12):
// pb_migrations/1760900000_clear_request_groups.js (the requests lose their
// group first, then the groups go) and 1760910000_clear_special_requests.js
// (then every request), with plain SQL so no hook (and no message) runs.
// Loaded like the JSVM would, against a stand-in app that records the
// queries; the real PocketBase runs them on every start of the test stack
// (tests/integration).
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import vm from 'vm';

function loadMigration(file: string): (app: unknown) => void {
	const source = fs.readFileSync(new URL(`../pb_migrations/${file}`, import.meta.url), 'utf8');
	let up: ((app: unknown) => void) | undefined;
	vm.runInNewContext(
		source,
		{
			migrate: (fn: (app: unknown) => void) => {
				up = fn;
			}
		},
		{ filename: file }
	);
	if (!up) throw new Error('no migration');
	return up;
}

/** A stand-in app with these collections (and request_group on special_requests when asked). */
function app(collections: string[], withRelation = true) {
	const queries: string[] = [];
	return {
		queries,
		findCollectionByNameOrId: (name: string) => {
			if (!collections.includes(name)) throw new Error(`no collection ${name}`);
			return {
				fields: {
					getByName: (field: string) =>
						name === 'special_requests' && field === 'request_group' && withRelation ? {} : null
				}
			};
		},
		db: () => ({ newQuery: (sql: string) => ({ execute: () => queries.push(sql) }) })
	};
}

describe('the migration that deletes the test groups (1760900000)', () => {
	const up = loadMigration('1760900000_clear_request_groups.js');

	it('empties every request’s group first, then deletes every group', () => {
		const stack = app(['special_requests', 'request_groups']);
		up(stack);
		expect(stack.queries).toEqual([
			"UPDATE {{special_requests}} SET [[request_group]] = '' WHERE [[request_group]] != ''",
			'DELETE FROM {{request_groups}}'
		]);
	});

	it('changes nothing where there never were groups', () => {
		const stack = app(['special_requests']);
		up(stack);
		expect(stack.queries).toEqual([]);
	});

	it('only deletes the groups when the requests have no group field', () => {
		const stack = app(['special_requests', 'request_groups'], false);
		up(stack);
		expect(stack.queries).toEqual(['DELETE FROM {{request_groups}}']);
	});
});

describe('the migration that deletes the test requests (1760910000)', () => {
	const up = loadMigration('1760910000_clear_special_requests.js');

	it('deletes every request in one plain query', () => {
		const stack = app(['special_requests', 'request_groups']);
		up(stack);
		expect(stack.queries).toEqual(['DELETE FROM {{special_requests}}']);
	});

	it('changes nothing on a database without requests', () => {
		const stack = app([]);
		up(stack);
		expect(stack.queries).toEqual([]);
	});
});
