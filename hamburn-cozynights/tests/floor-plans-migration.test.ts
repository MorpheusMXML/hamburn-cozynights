// tests/floor-plans-migration.test.ts — pb_migrations/1760800000_floor_plans_2026_v2.js
// moves a server that imported the v0.30.0 Hamburn 2026 layout onto the
// current floor plans. Loaded like the JSVM would; the app is a small
// stand-in for PocketBase's, holding houses, rooms and spots in memory.
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import vm from 'vm';
import { parseTemplate } from '../src/lib/template';

type Fields = Record<string, unknown>;

function loadMigration(): (app: unknown) => void {
	const source = fs.readFileSync(
		new URL('../pb_migrations/1760800000_floor_plans_2026_v2.js', import.meta.url),
		'utf8'
	);
	let up: ((app: unknown) => void) | undefined;
	vm.runInNewContext(
		source,
		{
			migrate: (fn: (app: unknown) => void) => {
				up = fn;
			},
			$dbx: { hashExp: (exp: Fields) => exp }
		},
		{ filename: '1760800000_floor_plans_2026_v2.js' }
	);
	if (!up) throw new Error('no migration');
	return up;
}

function record(collection: string, id: string, fields: Fields) {
	const data: Fields = { ...fields };
	return {
		id,
		collection,
		data,
		getString: (k: string) =>
			typeof data[k] === 'string'
				? (data[k] as string)
				: data[k] == null
					? ''
					: JSON.stringify(data[k]),
		getInt: (k: string) => Number(data[k] ?? 0),
		set: (k: string, v: unknown) => {
			data[k] = v;
		}
	};
}
type Rec = ReturnType<typeof record>;

function stack(houses: Rec[], rooms: Rec[] = [], beds: Rec[] = []) {
	const saved: string[] = [];
	const app = {
		findAllRecords: (name: string) => (name === 'houses' ? houses : []),
		findRecordsByFilter: (name: string, filter: string, ...rest: unknown[]) => {
			expect(name).toBe('rooms');
			expect(filter).toBe('house = {:house} && (room_number = 1 || room_number = 2)');
			const { house } = rest[rest.length - 1] as { house: string };
			return rooms.filter(
				(r) => r.data.house === house && [1, 2].includes(r.getInt('room_number'))
			);
		},
		countRecords: (name: string, exp: { room: string }) => {
			expect(name).toBe('beds');
			return beds.filter((b) => b.data.room === exp.room).length;
		},
		save: (r: Rec) => saved.push(`${r.collection}:${r.id}`)
	};
	return { app, saved };
}

const parsed = parseTemplate(fs.readFileSync('static/templates/hamburn-2026.json', 'utf8'));
if (!parsed.ok) throw new Error(parsed.errors.join(' | '));
const plansOf = (name: string) =>
	parsed.template.houses.find((house) => house.name === name)?.floor_plans;

const OLD = {
	villa: [{ image: '/floorplans/brahmsee-villa-upper-floor-2026.webp', caption: 'Upper floor' }],
	see: [
		{ image: '/floorplans/haus-am-see-ground-floor-2026.webp', caption: 'Ground floor' },
		{ image: '/floorplans/haus-am-see-upper-floor-2026.webp', caption: 'Upper floor' }
	],
	waelder: [
		{ image: '/floorplans/waelderhaus-lower-floor-2026.webp', caption: 'Lower floor' },
		{ image: '/floorplans/waelderhaus-upper-floor-2026.webp', caption: 'Upper floor' }
	]
};
const spots = (room: string, count: number) =>
	Array.from({ length: count }, (_, i) => record('beds', `${room}-b${i}`, { room }));

describe('the floor plans of 2026-10-06 (migration 1760800000)', () => {
	const up = loadMigration();

	it('puts the same plans on the houses as the layout template', () => {
		const villa = record('houses', 'villa', {
			name: 'Brahmsee-Villa',
			floor_plans: OLD.villa,
			description: 'The bar. Rooms 101 to 106 are upstairs and carry the names from the floor plan.'
		});
		const see = record('houses', 'see', { name: 'Haus am See', floor_plans: OLD.see });
		const waelder = record('houses', 'waelder', { name: 'Wälderhaus', floor_plans: OLD.waelder });
		const huts = record('houses', 'huts', { name: 'Waldhütten', floor_plans: null });
		const { app } = stack([villa, see, waelder, huts]);
		up(app);

		expect(villa.data.floor_plans).toEqual(plansOf('Brahmsee-Villa'));
		expect(see.data.floor_plans).toEqual(plansOf('Haus am See'));
		expect(waelder.data.floor_plans).toEqual(plansOf('Wälderhaus'));
		expect(huts.data.floor_plans).toEqual(plansOf('Waldhütten'));
		expect(villa.data.description).toBe(
			'The bar. Rooms 101 to 106 are upstairs, each with a name of its own.'
		);
		expect(villa.data.description).toBe(
			'The bar. ' +
				parsed.template.houses
					.find((house) => house.name === 'Brahmsee-Villa')
					?.description?.match(/Rooms 101.*$/)?.[0]
		);
	});

	it('gives the Wälderhaus rooms 1 and 2 the door numbers of the new plan', () => {
		const waelder = record('houses', 'waelder', { name: 'Wälderhaus', floor_plans: OLD.waelder });
		const single = record('rooms', 'single', { house: 'waelder', room_number: 1 });
		const five = record('rooms', 'five', { house: 'waelder', room_number: 2 });
		const { app } = stack([waelder], [single, five], [...spots('single', 1), ...spots('five', 5)]);
		up(app);
		expect([single.data.room_number, five.data.room_number]).toEqual([2, 1]);

		// A second run changes nothing: the old pictures are gone.
		const again = stack([waelder], [single, five], [...spots('single', 1), ...spots('five', 5)]);
		up(again.app);
		expect(again.saved).toEqual([]);
		expect([single.data.room_number, five.data.room_number]).toEqual([2, 1]);
	});

	it('leaves rooms alone that an admin changed', () => {
		const waelder = record('houses', 'waelder', { name: 'Wälderhaus', floor_plans: OLD.waelder });
		const one = record('rooms', 'one', { house: 'waelder', room_number: 1 });
		const two = record('rooms', 'two', { house: 'waelder', room_number: 2 });
		const { app } = stack([waelder], [one, two], [...spots('one', 2), ...spots('two', 5)]);
		up(app);
		expect([one.data.room_number, two.data.room_number]).toEqual([1, 2]);
		expect(waelder.data.floor_plans).toEqual(plansOf('Wälderhaus'));
	});

	it('leaves houses alone that never had the v0.30.0 plans', () => {
		const own = [{ image: '/floorplans/neon-cave-2026.webp', caption: 'Ours' }];
		const custom = record('houses', 'custom', { name: 'Brahmsee-Villa', floor_plans: own });
		const huts = record('houses', 'huts', { name: 'Waldhütten', floor_plans: own });
		const other = record('houses', 'other', { name: 'Neon Cave', floor_plans: [] });
		const { app, saved } = stack([custom, huts, other]);
		up(app);
		expect(saved).toEqual([]);
		expect(custom.data.floor_plans).toEqual(own);
		expect(huts.data.floor_plans).toEqual(own);
	});
});
