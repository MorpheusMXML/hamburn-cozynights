// tests/template-diff.test.ts — comparing a layout template with the camp and
// choosing what to apply (src/lib/template-diff.ts)
import { describe, it, expect } from 'vitest';
import {
	changeKeys,
	defaultSelection,
	describePlan,
	diffLayout,
	normalizeSelection,
	planChanges,
	planSize,
	selectionState,
	toggleSelection,
	type CampRecords,
	type LayoutDiff
} from '../src/lib/template-diff';
import type { LayoutTemplate, TemplateBed, TemplateHouse } from '../src/lib/template';

const spot = (label: string, extra: Partial<TemplateBed> = {}): TemplateBed => ({
	label,
	enabled: true,
	is_locked: false,
	...extra
});

function template(houses: TemplateHouse[]): LayoutTemplate {
	return {
		format: 'cozynights-layout',
		version: '2.1',
		name: 'Test',
		exported_at: '',
		map: { image: '/map.png', width: 1000, height: 700 },
		houses
	};
}

/** A camp built from the same shape as a template, with ids and optional bookings. */
function camp(
	houses: TemplateHouse[],
	booked: string[] = [],
	extraBed: Record<string, unknown> = {}
): CampRecords {
	const records: CampRecords = { houses: [], rooms: [], beds: [] };
	houses.forEach((house, h) => {
		const houseId = `house${h}`;
		records.houses.push({ id: houseId, name: house.name, x: house.x, y: house.y });
		house.rooms.forEach((room, r) => {
			const roomId = `${houseId}room${r}`;
			records.rooms.push({
				id: roomId,
				house: houseId,
				name: room.name,
				room_number: room.room_number
			});
			room.beds.forEach((bed, b) => {
				const id = `${roomId}bed${b}`;
				const isBooked = booked.includes(`${house.name}/${room.room_number}/${bed.label}`);
				records.beds.push({
					id,
					room: roomId,
					...bed,
					...extraBed,
					occupied: isBooked,
					order: isBooked ? `order-${id}` : ''
				});
			});
		});
	});
	return records;
}

const neonCave = (): TemplateHouse => ({
	name: 'Neon Cave',
	x: 100,
	y: 200,
	rooms: [
		{ name: 'Bunks', room_number: 1, beds: [spot('B1'), spot('B2')] },
		{ name: 'Loft', room_number: 2, beds: [spot('L1')] }
	]
});
const villa = (): TemplateHouse => ({
	name: 'Villa',
	x: 500,
	y: 300,
	rooms: [{ name: 'Dorm', room_number: 1, beds: [spot('D1'), spot('D2')] }]
});

const find = (diff: LayoutDiff, key: string) => {
	for (const house of diff.houses) {
		if (house.key === key) return house;
		for (const room of house.rooms) {
			if (room.key === key) return room;
			for (const s of room.spots) if (s.key === key) return s;
		}
	}
	throw new Error(`no node ${key}`);
};

describe('diffLayout', () => {
	it('finds nothing to do when the file matches the camp', () => {
		const diff = diffLayout(camp([neonCave(), villa()]), template([neonCave(), villa()]));
		expect(changeKeys(diff)).toEqual([]);
		expect(diff.counts.houses).toEqual({ new: 0, changed: 0, removed: 0, unchanged: 2 });
		expect(diff.counts.spots.unchanged).toBe(5);
	});

	it('matches houses by name, rooms by number and spots by label, ignoring case', () => {
		const file = neonCave();
		file.name = 'NEON cave';
		file.rooms[0].beds[0].label = 'b1';
		const diff = diffLayout(camp([neonCave()]), template([file]));
		// matched, but the spelling differs: a rename, not a new house
		expect(diff.houses).toHaveLength(1);
		expect(diff.houses[0].own).toBe('changed');
		expect(diff.houses[0].changes).toEqual([{ field: 'name', from: 'Neon Cave', to: 'NEON cave' }]);
		const b1 = find(diff, 'h:neon%20cave/r:1/s:b1');
		expect(b1).toMatchObject({
			own: 'changed',
			changes: [{ field: 'label', from: 'B1', to: 'b1' }]
		});
	});

	it('sees new, moved, renamed, changed and missing items at every level', () => {
		const file = neonCave();
		file.x = 120; // moved
		file.rooms[0].name = 'Bunk Room'; // renamed
		file.rooms[0].beds[1] = spot('B2', { is_locked: true }); // locked
		file.rooms[0].beds.push(spot('B3')); // new spot
		file.rooms[1].beds = []; // L1 missing
		file.rooms.push({ name: 'Attic', room_number: 3, beds: [spot('A1')] }); // new room
		const tent: TemplateHouse = { name: 'Tent', x: 800, y: 600, rooms: [] };

		const diff = diffLayout(
			camp([neonCave(), villa()], ['Neon Cave/2/L1']),
			template([file, tent])
		);

		const house = find(diff, 'h:neon%20cave');
		expect(house).toMatchObject({
			own: 'changed',
			changes: [{ field: 'position', from: '100 / 200', to: '120 / 200' }]
		});
		expect(find(diff, 'h:neon%20cave/r:1')).toMatchObject({
			own: 'changed',
			changes: [{ field: 'name', from: 'Bunks', to: 'Bunk Room' }]
		});
		expect(find(diff, 'h:neon%20cave/r:1/s:b2')).toMatchObject({
			own: 'changed',
			changes: [{ field: 'is_locked', from: false, to: true }]
		});
		expect(find(diff, 'h:neon%20cave/r:1/s:b3')).toMatchObject({ own: 'new', id: null });
		expect(find(diff, 'h:neon%20cave/r:2/s:l1')).toMatchObject({ own: 'removed', booked: 1 });
		expect(find(diff, 'h:neon%20cave/r:3')).toMatchObject({ own: 'new' });
		expect(find(diff, 'h:tent')).toMatchObject({ own: 'new', x: 800, y: 600 });
		expect(find(diff, 'h:villa')).toMatchObject({ own: 'removed', booked: 0, id: 'house1' });
		expect(find(diff, 'h:villa/r:1/s:d2')).toMatchObject({ own: 'removed' });

		expect(diff.counts.houses).toEqual({ new: 1, changed: 1, removed: 1, unchanged: 0 });
		expect(diff.counts.rooms).toEqual({ new: 1, changed: 1, removed: 1, unchanged: 1 });
		expect(diff.counts.spots).toEqual({ new: 2, changed: 1, removed: 3, unchanged: 1 });
	});

	it('compares every spot flag, also ones this version does not know yet', () => {
		// A camp field the export mapping doesn't know stays out; a flag the file
		// has and the camp lacks counts as off there.
		const file = neonCave();
		file.rooms[0].beds[0] = { ...spot('B1'), is_special: true } as TemplateBed;
		const diff = diffLayout(camp([neonCave()]), template([file]));
		expect(find(diff, 'h:neon%20cave/r:1/s:b1')).toMatchObject({
			own: 'changed',
			changes: [{ field: 'is_special', from: false, to: true }]
		});
	});

	it('never gives a file house the key of a duplicate in the camp', () => {
		const records = camp([neonCave()]);
		records.houses.push({ id: 'zz-copy', name: 'Neon Cave', x: 1, y: 1 });
		const tricky: TemplateHouse = { name: 'Neon Cave~2', x: 5, y: 5, rooms: [] };
		const diff = diffLayout(records, template([neonCave(), tricky]));
		const keys = changeKeys(diff);
		expect(new Set(keys).size).toBe(keys.length);
		expect(find(diff, 'h:neon%20cave~2')).toMatchObject({ own: 'new', name: 'Neon Cave~2' });
		expect(find(diff, 'h:neon%20cave#zz-copy')).toMatchObject({ own: 'removed', id: 'zz-copy' });
	});

	it('gives the same keys however the records are ordered', () => {
		const records = camp([neonCave(), villa()]);
		const shuffled: CampRecords = {
			houses: [...records.houses].reverse(),
			rooms: [...records.rooms].reverse(),
			beds: [...records.beds].reverse()
		};
		const file = template([villa()]);
		expect(changeKeys(diffLayout(shuffled, file))).toEqual(changeKeys(diffLayout(records, file)));
	});

	it('keeps duplicates of the camp apart and warns about them', () => {
		const records = camp([neonCave()]);
		// the copies were made later; their ids sort first on purpose
		const later = '2026-09-18 12:00:00.000Z';
		records.houses.push({ id: 'a-copy', created: later, name: 'neon cave', x: 1, y: 1 });
		records.rooms.push({
			id: 'a-room',
			created: later,
			house: 'house0',
			name: 'Second one',
			room_number: 1
		});
		records.beds.push({
			id: 'a-bed',
			created: later,
			room: 'house0room0',
			label: 'b1',
			enabled: true
		});
		for (const list of [records.houses, records.rooms, records.beds]) {
			for (const record of list) record.created ??= '2026-09-01 12:00:00.000Z';
		}

		const diff = diffLayout(records, template([neonCave()]));
		expect(diff.warnings).toHaveLength(3);
		const keys = changeKeys(diff);
		expect(new Set(keys).size).toBe(keys.length);
		expect(keys).toContain('h:neon%20cave#a-copy');
		expect(keys).toContain('h:neon%20cave/r:1#a-room');
		expect(keys).toContain('h:neon%20cave/r:1/s:b1#a-bed');
		// the originals still match
		expect(find(diff, 'h:neon%20cave')).toMatchObject({ own: null, id: 'house0' });
		expect(find(diff, 'h:neon%20cave/r:1')).toMatchObject({ own: null, id: 'house0room0' });
		expect(find(diff, 'h:neon%20cave/r:1/s:b1#a-bed')).toMatchObject({
			own: 'removed',
			id: 'a-bed'
		});
	});
});

describe('choosing what to apply', () => {
	function scenario() {
		const file = neonCave();
		file.rooms.push({ name: 'Attic', room_number: 3, beds: [spot('A1'), spot('A2')] });
		file.rooms[0].beds[0] = spot('B1', { enabled: false });
		const tent: TemplateHouse = {
			name: 'Tent',
			x: 800,
			y: 600,
			rooms: [{ name: 'Canvas', room_number: 1, beds: [spot('T1')] }]
		};
		return diffLayout(camp([neonCave(), villa()], ['Villa/1/D1']), template([file, tent]));
	}

	it('starts with everything new and changed, and nothing removed', () => {
		const diff = scenario();
		const selection = defaultSelection(diff);
		expect([...selection].sort()).toEqual(
			[
				'h:neon%20cave/r:1/s:b1',
				'h:neon%20cave/r:3',
				'h:neon%20cave/r:3/s:a1',
				'h:neon%20cave/r:3/s:a2',
				'h:tent',
				'h:tent/r:1',
				'h:tent/r:1/s:t1'
			].sort()
		);
		expect(selectionState(find(diff, 'h:villa'), selection)).toBe('none');
		expect(selectionState(find(diff, 'h:neon%20cave'), selection)).toBe('all');
	});

	it('brings the new house along with a new spot, and takes everything along with a removed house', () => {
		const diff = scenario();
		expect([...normalizeSelection(diff, ['h:tent/r:1/s:t1'])].sort()).toEqual([
			'h:tent',
			'h:tent/r:1',
			'h:tent/r:1/s:t1'
		]);
		expect([...normalizeSelection(diff, ['h:villa', 'unknown-key'])].sort()).toEqual([
			'h:villa',
			'h:villa/r:1',
			'h:villa/r:1/s:d1',
			'h:villa/r:1/s:d2'
		]);
	});

	it('toggles whole branches, and keeping one spot keeps its house', () => {
		const diff = scenario();
		let selection = toggleSelection(diff, new Set(), 'h:villa');
		expect(selectionState(find(diff, 'h:villa'), selection)).toBe('all');

		// keep D2: the room and the house can't be removed anymore, D1 still can
		selection = toggleSelection(diff, selection, 'h:villa/r:1/s:d2');
		expect([...selection].sort()).toEqual(['h:villa/r:1/s:d1']);
		expect(selectionState(find(diff, 'h:villa'), selection)).toBe('some');

		// a click on a partly chosen house chooses all of it again
		selection = toggleSelection(diff, selection, 'h:villa');
		expect(selectionState(find(diff, 'h:villa'), selection)).toBe('all');
		// and one more click chooses none of it
		selection = toggleSelection(diff, selection, 'h:villa');
		expect(selectionState(find(diff, 'h:villa'), selection)).toBe('none');
	});

	it('does not let a new room stay chosen without its new house', () => {
		const diff = scenario();
		let selection = defaultSelection(diff);
		selection = toggleSelection(diff, selection, 'h:tent');
		expect([...selection].filter((key) => key.startsWith('h:tent'))).toEqual([]);
		// choosing the spot again brings house and room back
		selection = toggleSelection(diff, selection, 'h:tent/r:1/s:t1');
		expect([...selection].filter((key) => key.startsWith('h:tent')).sort()).toEqual([
			'h:tent',
			'h:tent/r:1',
			'h:tent/r:1/s:t1'
		]);
	});
});

describe('planChanges', () => {
	it('turns a selection into database steps', () => {
		const file = neonCave();
		file.x = 111;
		file.rooms[0].beds[1] = spot('B2', { is_locked: true });
		file.rooms.push({ name: 'Attic', room_number: 3, beds: [spot('A1'), spot('A2')] });
		const diff = diffLayout(
			camp([neonCave(), villa()], ['Villa/1/D2']),
			template([file, { name: 'Tent', x: 800, y: 600, rooms: [] }])
		);
		const selection = new Set([
			...defaultSelection(diff),
			'h:villa' // with its room and both spots
		]);
		selection.delete('h:neon%20cave/r:3/s:a2');

		const plan = planChanges(diff, selection);
		expect(plan.createHouses).toEqual([
			{
				key: 'h:tent',
				name: 'Tent',
				x: 800,
				y: 600,
				details: { kind: '', features: [], description: '' }
			}
		]);
		expect(plan.createRooms).toEqual([
			expect.objectContaining({
				key: 'h:neon%20cave/r:3',
				houseId: 'house0',
				name: 'Attic',
				room_number: 3,
				spots: 1
			})
		]);
		expect(plan.createSpots).toEqual([
			expect.objectContaining({ roomKey: 'h:neon%20cave/r:3', roomId: null, bed: spot('A1') })
		]);
		expect(plan.updateHouses).toEqual([
			{
				key: 'h:neon%20cave',
				id: 'house0',
				name: 'Neon Cave',
				x: 111,
				y: 200,
				details: { kind: '', features: [], description: '' }
			}
		]);
		// The file decides: everything it says about the spot is written, not only
		// what differs (a change line carries labels, not stored values).
		expect(plan.updateSpots).toEqual([
			expect.objectContaining({
				id: 'house0room0bed1',
				fields: {
					label: 'B2',
					enabled: true,
					is_locked: true,
					is_special: false,
					bed_type: '',
					features: []
				}
			})
		]);
		expect(plan.removeSpots.map((s) => [s.id, s.booked])).toEqual([
			['house1room0bed0', false],
			['house1room0bed1', true]
		]);
		expect(plan.removeRooms.map((r) => r.id)).toEqual(['house1room0']);
		expect(plan.removeHouses.map((h) => h.id)).toEqual(['house1']);
		expect(planSize(plan)).toBe(9);
		expect(describePlan(plan)).toEqual([
			'3 houses: 1 new, 1 moved or renamed, 1 removed',
			'2 rooms: 1 new, 1 removed',
			'4 spots: 1 new, 1 changed, 2 removed'
		]);
	});

	it('plans nothing for an empty selection', () => {
		const diff = diffLayout(camp([neonCave()]), template([villa()]));
		expect(planSize(planChanges(diff, new Set()))).toBe(0);
		expect(describePlan(planChanges(diff, new Set()))).toEqual([]);
	});
});
