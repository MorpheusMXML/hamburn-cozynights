// tests/floor-plans.test.ts — reading a house's floor plans (src/lib/floor-plans.ts)
import { describe, it, expect } from 'vitest';
import { FLOOR_PLANS_MAX, isFloorPlanImage, readFloorPlans } from '../src/lib/floor-plans';

describe('isFloorPlanImage', () => {
	it('takes pictures in the floorplans folder only', () => {
		expect(isFloorPlanImage('/floorplans/haus-am-see-ground-floor-2026.webp')).toBe(true);
		expect(isFloorPlanImage('/floorplans/villa.v2.jpeg')).toBe(true);
		for (const other of [
			'floorplans/villa.webp',
			'/floorplans/villa.webp?x=1',
			'/floorplans/sub/villa.webp',
			'/floorplans/Villa.webp',
			'/floorplans/.webp',
			'/floorplans/villa.gif',
			'https://example.org/floorplans/villa.webp',
			null
		]) {
			expect(isFloorPlanImage(other)).toBe(false);
		}
	});
});

describe('readFloorPlans', () => {
	it('reads nothing from what is not a list', () => {
		for (const raw of [undefined, null, '', 'x', {}, 3]) expect(readFloorPlans(raw)).toEqual([]);
	});

	it('keeps the plans, cleans the captions and skips the rest', () => {
		expect(
			readFloorPlans([
				{ image: '/floorplans/a.webp', caption: ' Ground\n floor ' },
				{ image: '/floorplans/b.webp' },
				{ image: 'https://example.org/c.webp', caption: 'Elsewhere' },
				{ image: '/floorplans/d.webp', caption: 'x'.repeat(100) },
				'junk',
				null
			])
		).toEqual([
			{ image: '/floorplans/a.webp', caption: 'Ground floor' },
			{ image: '/floorplans/b.webp', caption: '' },
			{ image: '/floorplans/d.webp', caption: 'x'.repeat(80) }
		]);
	});

	it(`shows at most ${FLOOR_PLANS_MAX} plans`, () => {
		const many = Array.from({ length: 6 }, (_, i) => ({ image: `/floorplans/p${i}.webp` }));
		expect(readFloorPlans(many)).toHaveLength(FLOOR_PLANS_MAX);
	});
});
