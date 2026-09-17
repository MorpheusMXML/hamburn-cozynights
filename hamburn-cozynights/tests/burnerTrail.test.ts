import { describe, it, expect } from 'vitest';
import {
	PointBuffer,
	POINT_CAP,
	RIBBON_LIFE,
	VERTEX_SIZE,
	buildRibbon
} from '../src/lib/fx/burnerTrail';

describe('burnerTrail PointBuffer', () => {
	it('drops samples closer than the min distance within a stroke', () => {
		const b = new PointBuffer();
		expect(b.push(0, 0, 0, 1)).toBe(true);
		expect(b.push(1, 0, 1, 1)).toBe(false);
		expect(b.push(1, 0, 1, 2)).toBe(true); // new stroke always records
		expect(b.count).toBe(2);
	});

	it('wraps around and keeps order oldest → newest', () => {
		const b = new PointBuffer();
		for (let i = 0; i < POINT_CAP + 10; i++) b.push(i * 10, 0, i, 1);
		expect(b.count).toBe(POINT_CAP);
		expect(b.x[b.at(0)]).toBe(100);
		expect(b.x[b.at(POINT_CAP - 1)]).toBe((POINT_CAP + 9) * 10);
	});

	it('expires samples older than the lifetime', () => {
		const b = new PointBuffer();
		b.push(0, 0, 0, 1);
		b.push(10, 0, 300, 1);
		b.expire(RIBBON_LIFE + 100, RIBBON_LIFE);
		expect(b.count).toBe(1);
		expect(b.x[b.at(0)]).toBe(10);
	});
});

describe('burnerTrail buildRibbon', () => {
	it('emits whole triangles and never connects separate strokes', () => {
		const b = new PointBuffer();
		b.push(0, 0, 0, 1);
		b.push(30, 0, 5, 1);
		b.push(500, 500, 10, 2);
		b.push(530, 500, 15, 2);
		const out = new Float32Array(10000 * VERTEX_SIZE);
		const end = buildRibbon(b, 20, 0, out, 0);
		expect(end % (6 * VERTEX_SIZE)).toBe(0);
		for (let o = 0; o < end; o += VERTEX_SIZE) {
			const x = out[o];
			expect(Number.isFinite(x)).toBe(true);
			// No vertex should land in the gap between the two strokes.
			expect(x < 100 || x > 400).toBe(true);
		}
	});

	it('respects the output buffer capacity', () => {
		const b = new PointBuffer();
		for (let i = 0; i < POINT_CAP; i++) b.push(i * 50, (i % 2) * 50, i, 1);
		const out = new Float32Array(60 * VERTEX_SIZE);
		expect(buildRibbon(b, POINT_CAP, 0, out, 0)).toBeLessThanOrEqual(out.length);
	});
});
