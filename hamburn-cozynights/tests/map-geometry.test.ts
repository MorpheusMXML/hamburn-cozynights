import { describe, it, expect } from 'vitest';
import {
	MAP_WIDTH,
	MAP_HEIGHT,
	clampToMap,
	isTooCloseToOtherHouse,
	parseMapCoordinate,
	screenToMap
} from '../src/lib/map-geometry';

describe('screenToMap', () => {
	it('maps a pointer position on a scaled, offset map back to map units', () => {
		// A 1000x700 map drawn 390px wide (scale 0.39), 12px from the left, 200px from the top.
		const ctm = { a: 0.39, b: 0, c: 0, d: 0.39, e: 12, f: 200 };
		const point = screenToMap(12 + 0.39 * 500, 200 + 0.39 * 350, ctm);
		expect(point?.x).toBeCloseTo(500);
		expect(point?.y).toBeCloseTo(350);
	});

	it('handles different horizontal and vertical scale', () => {
		const point = screenToMap(110, 60, { a: 2, b: 0, c: 0, d: 0.5, e: 10, f: 10 });
		expect(point).toEqual({ x: 50, y: 100 });
	});

	it('returns null for a degenerate matrix (map not laid out yet)', () => {
		expect(screenToMap(10, 10, { a: 0, b: 0, c: 0, d: 0, e: 0, f: 0 })).toBeNull();
	});
});

describe('clampToMap', () => {
	it('rounds to whole units and keeps the pin on the map', () => {
		expect(clampToMap({ x: 10.6, y: 20.2 })).toEqual({ x: 11, y: 20 });
		expect(clampToMap({ x: -50, y: 9999 })).toEqual({ x: 0, y: MAP_HEIGHT });
		expect(clampToMap({ x: 5000, y: -1 })).toEqual({ x: MAP_WIDTH, y: 0 });
	});
});

describe('isTooCloseToOtherHouse', () => {
	const houses = [
		{ id: 'a', x: 100, y: 100 },
		{ id: 'b', x: 300, y: 300 }
	];

	it('blocks a position on top of another pin', () => {
		expect(isTooCloseToOtherHouse(houses, 'a', { x: 310, y: 305 })).toBe(true);
	});

	it('ignores the house that is being moved', () => {
		expect(isTooCloseToOtherHouse(houses, 'a', { x: 101, y: 101 })).toBe(false);
	});

	it('checks every house for a new one', () => {
		expect(isTooCloseToOtherHouse(houses, null, { x: 101, y: 101 })).toBe(true);
		expect(isTooCloseToOtherHouse(houses, null, { x: 600, y: 100 })).toBe(false);
	});
});

describe('parseMapCoordinate', () => {
	it('accepts numbers and numeric strings inside the map', () => {
		expect(parseMapCoordinate('250', MAP_WIDTH)).toBe(250);
		expect(parseMapCoordinate(699.6, MAP_HEIGHT)).toBe(700);
		expect(parseMapCoordinate('0', MAP_WIDTH)).toBe(0);
	});

	it('rejects everything else', () => {
		for (const bad of ['', '  ', 'abc', '12px', null, undefined, NaN, Infinity, -1, 1001, {}, []]) {
			expect(parseMapCoordinate(bad, MAP_WIDTH)).toBeNull();
		}
	});
});
