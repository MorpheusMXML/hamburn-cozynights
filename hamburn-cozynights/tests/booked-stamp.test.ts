// tests/booked-stamp.test.ts — pb_hooks/lib/booked.js: beds.booked_at follows
// the ticket, and a bed whose ticket goes is free again. Loaded like the JSVM
// would (CommonJS); the record is a small stand-in for PocketBase's.
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import vm from 'vm';

function loadBooked() {
	const source = fs.readFileSync(new URL('../pb_hooks/lib/booked.js', import.meta.url), 'utf8');
	const module = { exports: {} as Record<string, any> };
	vm.runInNewContext(
		source,
		{ module, exports: module.exports, console },
		{ filename: 'booked.js' }
	);
	return module.exports;
}
const { stamp } = loadBooked();

function record(fields: Record<string, unknown>, original?: Record<string, unknown>) {
	const data: Record<string, unknown> = { ...fields };
	const orig = original ? record(original) : null;
	return {
		id: 'bed1',
		getString: (k: string) => String(data[k] ?? ''),
		getBool: (k: string) => data[k] === true,
		set: (k: string, v: unknown) => {
			data[k] = v;
		},
		original: () => {
			if (!orig) throw new Error('no original');
			return orig;
		},
		data
	};
}

describe('beds.booked_at and occupied', () => {
	it('stamps booked_at when a spot gets a ticket', () => {
		const e = { record: record({ order: 'o1', occupied: true }, { order: '', occupied: false }) };
		stamp(e);
		expect(String(e.record.data.booked_at)).toMatch(/^\d{4}-\d{2}-\d{2}T/);
	});

	it('re-stamps on a move to another ticket, keeps the stamp on an unrelated save', () => {
		const moved = {
			record: record({ order: 'o2', booked_at: 'old' }, { order: 'o1', booked_at: 'old' })
		};
		stamp(moved);
		expect(moved.record.data.booked_at).not.toBe('old');
		const renamed = {
			record: record(
				{ order: 'o1', booked_at: 'old', label: 'B1' },
				{ order: 'o1', booked_at: 'old' }
			)
		};
		stamp(renamed);
		expect(renamed.record.data.booked_at).toBe('old');
	});

	it('clears the stamp and frees the spot when the ticket goes (release or deleted ticket)', () => {
		const e = {
			record: record(
				{ order: '', occupied: true, booked_at: 'x' },
				{ order: 'o1', occupied: true, booked_at: 'x' }
			)
		};
		stamp(e);
		expect(e.record.data.booked_at).toBe('');
		expect(e.record.data.occupied).toBe(false);
	});

	it("leaves the crew's mark-as-taken alone (no ticket before or after)", () => {
		const e = { record: record({ order: '', occupied: true }, { order: '', occupied: false }) };
		stamp(e);
		expect(e.record.data.occupied).toBe(true);
		expect(e.record.data.booked_at ?? '').toBe('');
	});

	it('treats a record without an original (created in this process) as a new booking', () => {
		const e = { record: record({ order: 'o1', occupied: true }) };
		stamp(e);
		expect(String(e.record.data.booked_at)).toMatch(/T/);
	});
});
