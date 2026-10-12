// tests/one-spot-migration.test.ts — pb_migrations/1761100000_one_spot_per_ticket.js:
// a unique index on beds.order, but only after checking that no ticket holds
// two spots already; if one does, the migration stops and names them (Max,
// 2026-10-12: which spot is theirs is a crew decision). Loaded like the JSVM
// would, against a stand-in app; the real PocketBase runs it on every start of
// the test stack (tests/integration/book.test.ts checks the index works).
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import vm from 'vm';

type Row = { ticket: string; spots: string };

function loadMigration(file: string) {
	const source = fs.readFileSync(new URL(`../pb_migrations/${file}`, import.meta.url), 'utf8');
	let up: ((app: unknown) => void) | undefined;
	let down: ((app: unknown) => void) | undefined;
	vm.runInNewContext(
		source,
		{
			migrate: (u: typeof up, d: typeof down) => {
				up = u;
				down = d;
			},
			// the JSVM's result holders for a raw query
			DynamicModel: class {
				constructor(shape: Row) {
					Object.assign(this, shape);
				}
			},
			arrayOf: () => [] as Row[]
		},
		{ filename: file }
	);
	if (!up || !down) throw new Error('no migration');
	return { up, down };
}

/** A stand-in app whose duplicate query answers `duplicates`. */
function app(duplicates: Row[], indexes: string[] = []) {
	const beds = {
		indexes: [...indexes],
		addIndex(name: string, unique: boolean, columns: string, where: string) {
			this.indexes.push(`${unique ? 'UNIQUE ' : ''}${name} ON (${columns}) WHERE ${where}`);
		},
		removeIndex(name: string) {
			this.indexes = this.indexes.filter((sql) => !sql.includes(name));
		}
	};
	const saved: unknown[] = [];
	const queries: string[] = [];
	return {
		beds,
		saved,
		queries,
		findCollectionByNameOrId: () => beds,
		save: (collection: unknown) => saved.push(collection),
		db: () => ({
			newQuery: (sql: string) => ({
				all: (rows: Row[]) => {
					queries.push(sql);
					rows.push(...duplicates);
				}
			})
		})
	};
}

describe('one spot per ticket (1761100000)', () => {
	const { up, down } = loadMigration('1761100000_one_spot_per_ticket.js');

	it('adds the unique index for booked spots when no ticket holds two', () => {
		const stack = app([]);
		up(stack);
		expect(stack.queries[0]).toMatch(/GROUP BY \[\[order\]\] HAVING COUNT\(\*\) > 1/);
		expect(stack.beds.indexes).toEqual([
			"UNIQUE idx_beds_order_unique ON (`order`) WHERE `order` != ''"
		]);
		expect(stack.saved).toHaveLength(1);
	});

	it('stops and names the tickets and spots when one holds two, changing nothing', () => {
		const stack = app([{ ticket: 'ord123', spots: 'A1 (bed1), B2 (bed2)' }]);
		expect(() => up(stack)).toThrow(
			/1 ticket\(s\) hold more than one spot.*ticket ord123: A1 \(bed1\), B2 \(bed2\)/
		);
		expect(stack.beds.indexes).toEqual([]);
		expect(stack.saved).toHaveLength(0);
	});

	it('runs once: an index that is there already stays as it is', () => {
		const stack = app([], ['CREATE UNIQUE INDEX `idx_beds_order_unique` ON `beds` (`order`)']);
		up(stack);
		expect(stack.queries).toEqual([]);
		expect(stack.saved).toHaveLength(0);
	});

	it('takes the index away again on the way down', () => {
		const stack = app([]);
		up(stack);
		down(stack);
		expect(stack.beds.indexes).toEqual([]);
	});
});
