// tests/bunk-hook.test.ts — the PocketBase side of bunk beds: both spots of a
// pair point at each other, whatever wrote one of them.
import { describe, expect, it } from 'vitest';
import { loadHookModule } from './hook-module';

type Row = { id: string; room: string; bunk_partner: string; bed_type: string };

/** A record like the JSVM's: get/set over a plain row. */
function record(row: Row) {
	return {
		id: row.id,
		get: (key: keyof Row) => row[key],
		set: (key: keyof Row, value: string) => {
			row[key] = value;
		},
		row
	};
}

/** A fake app over a few beds, with the two finders and save() the module uses. */
function fakeApp(rows: Row[]) {
	const saved: string[] = [];
	const app = {
		findRecordById: (_collection: string, id: string) => {
			const row = rows.find((r) => r.id === id);
			if (!row) throw new Error('not found');
			return record(row);
		},
		findRecordsByFilter: (
			_collection: string,
			filter: string,
			_sort: string,
			_limit: number,
			_offset: number,
			params: { id: string; partner: string }
		) => {
			expect(filter).toBe('bunk_partner = {:id} && id != {:partner}');
			return rows
				.filter((r) => r.bunk_partner === params.id && r.id !== params.partner)
				.map(record);
		},
		save: (rec: ReturnType<typeof record>) => {
			saved.push(rec.id);
		}
	};
	return { app, saved, rows };
}

const bunks = loadHookModule('lib/bunks.js');

describe('a spot written on its own', () => {
	it('makes its partner point back', () => {
		const { app, saved, rows } = fakeApp([
			{ id: 'a', room: 'r', bunk_partner: 'b', bed_type: 'bunk_lower' },
			{ id: 'b', room: 'r', bunk_partner: '', bed_type: '' }
		]);
		expect(bunks.afterWrite(app, app.findRecordById('beds', 'a'))).toBe(1);
		expect(rows[1].bunk_partner).toBe('a');
		expect(saved).toEqual(['b']);
	});

	it('does nothing when both sides agree already', () => {
		const { app, saved } = fakeApp([
			{ id: 'a', room: 'r', bunk_partner: 'b', bed_type: 'bunk_lower' },
			{ id: 'b', room: 'r', bunk_partner: 'a', bed_type: 'bunk_upper' }
		]);
		expect(bunks.afterWrite(app, app.findRecordById('beds', 'a'))).toBe(0);
		expect(saved).toEqual([]);
	});

	it('lets the old partner go when the spot picks a new one', () => {
		const { app, rows } = fakeApp([
			{ id: 'a', room: 'r', bunk_partner: 'c', bed_type: 'bunk_lower' },
			{ id: 'b', room: 'r', bunk_partner: 'a', bed_type: 'bunk_upper' },
			{ id: 'c', room: 'r', bunk_partner: '', bed_type: '' }
		]);
		expect(bunks.afterWrite(app, app.findRecordById('beds', 'a'))).toBe(2);
		expect(rows[1]).toMatchObject({ bunk_partner: '', bed_type: '' });
		expect(rows[2].bunk_partner).toBe('a');
	});

	it('lets the partner go when the spot was unstacked', () => {
		const { app, rows } = fakeApp([
			{ id: 'a', room: 'r', bunk_partner: '', bed_type: '' },
			{ id: 'b', room: 'r', bunk_partner: 'a', bed_type: 'bunk_upper' }
		]);
		expect(bunks.afterWrite(app, app.findRecordById('beds', 'a'))).toBe(1);
		expect(rows[1]).toMatchObject({ bunk_partner: '', bed_type: '' });
	});

	it('stands alone again when its partner is gone or in another room', () => {
		const gone = fakeApp([{ id: 'a', room: 'r', bunk_partner: 'zz', bed_type: 'bunk_lower' }]);
		expect(bunks.afterWrite(gone.app, gone.app.findRecordById('beds', 'a'))).toBe(1);
		expect(gone.rows[0]).toMatchObject({ bunk_partner: '', bed_type: '' });

		const elsewhere = fakeApp([
			{ id: 'a', room: 'r', bunk_partner: 'b', bed_type: 'single' },
			{ id: 'b', room: 'other', bunk_partner: '', bed_type: '' }
		]);
		bunks.afterWrite(elsewhere.app, elsewhere.app.findRecordById('beds', 'a'));
		// A bed type that is not a bunk level stays.
		expect(elsewhere.rows[0]).toMatchObject({ bunk_partner: '', bed_type: 'single' });
	});
});

describe('a deleted spot', () => {
	it('leaves its partner standing alone', () => {
		const { app, rows, saved } = fakeApp([
			{ id: 'b', room: 'r', bunk_partner: 'a', bed_type: 'bunk_upper' }
		]);
		const deleted = record({ id: 'a', room: 'r', bunk_partner: 'b', bed_type: 'bunk_lower' });
		expect(bunks.afterDelete(app, deleted)).toBe(1);
		expect(rows[0]).toMatchObject({ bunk_partner: '', bed_type: '' });
		expect(saved).toEqual(['b']);
	});

	it('does not touch a spot that already has another partner', () => {
		const { app, rows } = fakeApp([
			{ id: 'b', room: 'r', bunk_partner: 'c', bed_type: 'bunk_upper' }
		]);
		const deleted = record({ id: 'a', room: 'r', bunk_partner: 'b', bed_type: 'bunk_lower' });
		expect(bunks.afterDelete(app, deleted)).toBe(0);
		expect(rows[0].bunk_partner).toBe('c');
	});
});

describe('a write request', () => {
	it('refuses a partner that is the spot itself, missing, or in another room', () => {
		const { app } = fakeApp([
			{ id: 'a', room: 'r', bunk_partner: '', bed_type: '' },
			{ id: 'b', room: 'other', bunk_partner: '', bed_type: '' }
		]);
		expect(
			bunks.requestProblem(app, record({ id: 'a', room: 'r', bunk_partner: 'a', bed_type: '' }))
		).toMatch(/itself|own/);
		expect(
			bunks.requestProblem(app, record({ id: 'a', room: 'r', bunk_partner: 'zz', bed_type: '' }))
		).toMatch(/not exist/);
		expect(
			bunks.requestProblem(app, record({ id: 'a', room: 'r', bunk_partner: 'b', bed_type: '' }))
		).toMatch(/same room/);
		expect(
			bunks.requestProblem(app, record({ id: 'a', room: 'r', bunk_partner: '', bed_type: '' }))
		).toBe('');
	});
});
