// tests/clear-groups-migration.test.ts — pb_migrations/1760900000_clear_request_groups.js
// deletes every request group made before v1.32.2 (all test data, Max
// 2026-10-12): the requests lose their group first, then the groups go, with
// plain SQL so no hook (and no message) runs. Loaded like the JSVM would,
// against a stand-in app that records the queries; the real PocketBase runs
// it on every start of the test stack (tests/integration).
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import vm from 'vm';

function loadMigration(): (app: unknown) => void {
	const source = fs.readFileSync(
		new URL('../pb_migrations/1760900000_clear_request_groups.js', import.meta.url),
		'utf8'
	);
	let up: ((app: unknown) => void) | undefined;
	vm.runInNewContext(
		source,
		{
			migrate: (fn: (app: unknown) => void) => {
				up = fn;
			}
		},
		{ filename: '1760900000_clear_request_groups.js' }
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
	const up = loadMigration();

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
