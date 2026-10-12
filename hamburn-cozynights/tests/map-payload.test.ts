// tests/map-payload.test.ts — the camp map gets one small summary per house,
// not the camp tree with every room and spot record (~107 KB per visit for
// Hamburn 2026), and it is loaded once per visit, not twice.
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { FakePb } from './fake-pb';
import { APP_SETTINGS_ID } from '../src/lib/server/constants';
import { InventoryService } from '../src/lib/server/inventory';
import { forgetAvailableFilters } from '../src/lib/server/wishes';
import { load as mapLoad } from '../src/routes/map/+page.server';
import { load as universalLoad } from '../src/routes/map/+page';

const root = path.resolve(__dirname, '..');
const read = (file: string) => readFileSync(path.join(root, file), 'utf8');

/** What the map draws for a house; fittingFree only while the map is filtered. */
const MAP_HOUSE_KEYS = ['freeBeds', 'id', 'kind', 'mine', 'name', 'totalBeds', 'x', 'y'];

/**
 * The Hamburn 2026 camp (static/templates/hamburn-2026.json: 7 houses, 57
 * rooms, 297 spots) as PocketBase would hold it, every second spot booked by
 * another guest. The guest signed in here holds the first booked spot.
 */
function hamburnCamp({ phase = 'live' } = {}) {
	const pb = new FakePb();
	pb.seed('app_settings', {
		id: APP_SETTINGS_ID,
		is_booking_active: phase === 'live',
		booking_closed: phase === 'closed'
	});
	const template = JSON.parse(read('static/templates/hamburn-2026.json'));
	let count = 0;
	for (const { rooms, ...houseFields } of template.houses) {
		const house = pb.seed('houses', { ...houseFields, features: houseFields.features ?? [] });
		for (const { beds, ...roomFields } of rooms) {
			const room = pb.seed('rooms', {
				...roomFields,
				house: house.id,
				features: roomFields.features ?? [],
				features_off: []
			});
			for (const spot of beds) {
				count++;
				const booked = count % 2 === 0;
				const order = booked
					? pb.seed('orders', {
							order_number: `HB-${1000 + count}`,
							customer_name: `Guest Number${count}`,
							burner_name: `Burner Number${count}`
						})
					: null;
				pb.seed('beds', {
					label: spot.label,
					enabled: spot.enabled,
					is_locked: spot.is_locked,
					bed_type: spot.bed_type ?? '',
					room: room.id,
					occupied: booked,
					order: order?.id ?? '',
					booked_at: booked ? '2026-10-12 10:00:00.000Z' : ''
				});
			}
		}
	}
	const order = pb.rows('orders')[0];
	const locals = { pb, adminPb: pb, orderNumber: order.order_number, order, admin: null };
	return { pb, order, locals };
}

/** The headers the load sets, of the last call. */
let headers: Record<string, string> = {};
const mapAt = (locals: object, search = '') =>
	mapLoad({
		url: new URL(`http://test.local/map${search}`),
		locals,
		setHeaders: (set: Record<string, string>) => {
			headers = { ...headers, ...set };
		}
	} as any) as Promise<any>;

describe('the camp map payload', () => {
	beforeEach(() => forgetAvailableFilters());

	it('carries only what the map draws for each house', async () => {
		const { locals } = hamburnCamp();
		const data = await mapAt(locals);
		expect(data.houses).toHaveLength(7);
		for (const house of data.houses) {
			expect(Object.keys(house).sort()).toEqual(MAP_HOUSE_KEYS);
		}

		const filtered = await mapAt(locals, '?w=quiet');
		for (const house of filtered.houses) {
			expect(Object.keys(house).sort()).toEqual([...MAP_HOUSE_KEYS, 'fittingFree'].sort());
		}
	});

	it('holds no room or spot records, and no names of guests', async () => {
		const { pb, locals } = hamburnCamp();
		const text = JSON.stringify(await mapAt(locals, '?w=quiet'));
		for (const field of ['rooms', 'beds', 'order', 'label', 'booked_at', 'features']) {
			expect(text).not.toContain(`"${field}"`);
		}
		for (const row of [...pb.rows('rooms'), ...pb.rows('beds'), ...pb.rows('orders')]) {
			expect(text).not.toContain(row.id);
		}
		expect(text).not.toMatch(/Guest Number|Burner Number/);
	});

	it('stays small for the whole Hamburn camp (it was ~125 KB of JSON)', async () => {
		const { locals } = hamburnCamp();
		expect(JSON.stringify(await mapAt(locals)).length).toBeLessThan(3000);
		expect(JSON.stringify(await mapAt(locals, '?w=quiet,heated')).length).toBeLessThan(3000);
	});

	it("counts the spots, the free ones and the guest's own house as the tree does", async () => {
		const { pb, order, locals } = hamburnCamp();
		const tree = await new InventoryService(pb as any).getFullTree({ orderId: order.id });
		const data = await mapAt(locals);
		expect(data.houses).toEqual(
			tree.map((house) => ({
				id: house.id,
				name: house.name,
				x: house.x,
				y: house.y,
				kind: house.kind,
				totalBeds: house.totalBeds,
				freeBeds: house.freeBeds,
				mine: house.mine
			}))
		);
		expect(data.houses.reduce((sum: number, h: any) => sum + h.totalBeds, 0)).toBe(297);
		expect(data.houses.filter((h: any) => h.mine)).toHaveLength(1);
		// the first booked spot is in the first house of the template
		expect(data.houses.find((h: any) => h.mine).name).toBe('Brahmsee-Buden');
	});

	it('counts the free spots that fit the wishes per house', async () => {
		const { locals } = hamburnCamp();
		const data = await mapAt(locals, '?w=quiet');
		const byName = Object.fromEntries(data.houses.map((h: any) => [h.name, h]));
		// quiet as a whole: every free spot fits
		for (const name of ['Haus am See', 'See-Hütten']) {
			expect(byName[name].fittingFree).toBe(byName[name].freeBeds);
			expect(byName[name].fittingFree).toBeGreaterThan(0);
		}
		for (const house of data.houses) {
			expect(house.fittingFree).toBeLessThanOrEqual(house.freeBeds);
		}
		const fitting = data.houses.filter((h: any) => h.fittingFree > 0).length;
		expect(data.wishFit).toBe(`${fitting} houses have a fitting free spot`);
	});

	it('shows unconfigured houses in Staging only, as before', async () => {
		for (const phase of ['staging', 'live', 'closed']) {
			const { pb, locals } = hamburnCamp({ phase });
			pb.seed('houses', { name: 'Not set up yet', x: 500, y: 500 });
			const data = await mapAt(locals);
			const names = data.houses.map((h: any) => h.name);
			expect(names.includes('Not set up yet'), phase).toBe(phase === 'staging');
		}
	});
});

describe('loading the map', () => {
	it('loads once per visit: asks again only for data that is already old', () => {
		const page = read('src/routes/map/+page.svelte');
		// after the navigation is complete (a refresh during it aborts it), and
		// by the browser's own clock (receivedAt, +page.ts), never the server's
		expect(page).toMatch(
			/afterNavigate\(\(\) => \{\s*if \(Date\.now\(\) - data\.receivedAt > STALE_AFTER_MS\) invalidateAll\(\);/
		);
		expect(page).not.toMatch(/onMount\(/);
		expect(page).not.toMatch(/loadedAt/);
	});

	it('is never served from a cache', async () => {
		const { locals } = hamburnCamp();
		headers = {};
		await mapAt(locals);
		expect(headers['cache-control']).toBe('private, no-store');
	});

	it('notes when the browser got the data, by the browser clock', async () => {
		const before = Date.now();
		const data = (await universalLoad({ data: { houses: [] } } as never)) as Record<
			string,
			unknown
		>;
		expect(data.houses).toEqual([]);
		expect(data.receivedAt).toBeGreaterThanOrEqual(before);
		expect(data.receivedAt).toBeLessThanOrEqual(Date.now());
	});

	it('preloads page data on tap, not on hover', () => {
		const html = read('src/app.html');
		expect(html).toMatch(/<body[^>]*\bdata-sveltekit-preload-data="tap"/);
		expect(html).not.toMatch(/preload-data="hover"/);
	});
});
