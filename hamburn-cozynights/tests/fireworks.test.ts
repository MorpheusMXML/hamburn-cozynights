import { describe, it, expect } from 'vitest';
import {
	FINALE_AT,
	FireworksSim,
	MAX_VERTS,
	MIN_RISE,
	PARTICLE_CAP,
	SHOW_HARD_STOP,
	VERTEX_SIZE,
	VOLLEY_SIZE,
	mulberry32,
	planShow,
	rocketProgress
} from '../src/lib/fx/fireworks';

const W = 1280;
const H = 800;
const FRAME = 1 / 60;

describe('fireworks planShow', () => {
	it('plans a volley and a fire finale inside the viewport', () => {
		const plan = planShow(W, H, null, mulberry32(1));
		expect(plan).toHaveLength(VOLLEY_SIZE + 1);
		for (let i = 1; i < plan.length; i++) {
			expect(plan[i].t).toBeGreaterThanOrEqual(plan[i - 1].t);
		}
		expect(plan.filter((l) => l.kind === 'neon')).toHaveLength(VOLLEY_SIZE);
		const finale = plan[plan.length - 1];
		expect(finale.kind).toBe('fire');
		expect(finale.t).toBe(FINALE_AT);
		expect(finale.size).toBeGreaterThan(1.5);
		for (const l of plan) {
			expect(l.x).toBeGreaterThanOrEqual(0);
			expect(l.x).toBeLessThanOrEqual(W);
			expect(l.x + l.drift).toBeGreaterThanOrEqual(0);
			expect(l.x + l.drift).toBeLessThanOrEqual(W);
			expect(l.targetY).toBeGreaterThanOrEqual(40);
			expect(l.targetY).toBeLessThanOrEqual(l.y - MIN_RISE);
			expect(l.fuse).toBeGreaterThan(0);
			expect(l.t).toBeLessThanOrEqual(FINALE_AT);
		}
	});

	it('starts the first rockets and the finale at the booked card', () => {
		const origin = { x: 400, y: 500 };
		const plan = planShow(W, H, origin, mulberry32(2));
		const fromCard = plan.filter((l) => l.y === origin.y);
		expect(fromCard.map((l) => l.kind)).toEqual(['neon', 'neon', 'neon', 'fire']);
		for (const l of fromCard) {
			expect(Math.abs(l.x - origin.x)).toBeLessThanOrEqual(20);
			expect(l.targetY).toBeLessThanOrEqual(origin.y - MIN_RISE);
		}
		// The rest of the volley comes from below the bottom edge.
		expect(plan.filter((l) => l.y > H)).toHaveLength(VOLLEY_SIZE - 3);
	});

	it('launches everything from the bottom when the card is off screen or too high', () => {
		const origins = [
			{ x: 400, y: 60 },
			{ x: -50, y: 500 },
			{ x: W + 10, y: 500 },
			{ x: 400, y: H + 300 }
		];
		for (const origin of origins) {
			const plan = planShow(W, H, origin, mulberry32(3));
			expect(plan.every((l) => l.y > H)).toBe(true);
		}
	});

	it('fits a phone screen', () => {
		const plan = planShow(375, 667, { x: 180, y: 520 }, mulberry32(4));
		for (const l of plan) {
			expect(l.x).toBeGreaterThanOrEqual(0);
			expect(l.x).toBeLessThanOrEqual(375);
			expect(l.x + l.drift).toBeGreaterThanOrEqual(0);
			expect(l.x + l.drift).toBeLessThanOrEqual(375);
			expect(l.targetY).toBeGreaterThanOrEqual(40);
			expect(l.targetY).toBeLessThanOrEqual(l.y - MIN_RISE);
		}
	});
});

describe('fireworks rocketProgress', () => {
	it('runs from 0 to 1, fast off the ground and slow near the top', () => {
		expect(rocketProgress(0, 1)).toBe(0);
		expect(rocketProgress(1, 1)).toBeCloseTo(1, 10);
		expect(rocketProgress(2, 1)).toBeCloseTo(1, 10);
		const first = rocketProgress(0.25, 1);
		const second = rocketProgress(0.5, 1) - first;
		const last = 1 - rocketProgress(0.75, 1);
		expect(first).toBeGreaterThan(second);
		expect(second).toBeGreaterThan(last);
	});
});

describe('FireworksSim', () => {
	function fullBuffer() {
		return new Float32Array(MAX_VERTS * VERTEX_SIZE);
	}

	it('plays the whole show and ends with the sky dark', () => {
		const sim = new FireworksSim(W, H, { x: 400, y: 500 }, mulberry32(5));
		const out = fullBuffer();
		let finales = 0;
		let peak = 0;
		while (!sim.done) {
			if (sim.step(FRAME)) finales++;
			const o = sim.emit(out);
			expect(o % (6 * VERTEX_SIZE)).toBe(0);
			expect(sim.stats.particles).toBeLessThanOrEqual(PARTICLE_CAP);
			peak = Math.max(peak, o);
		}
		expect(finales).toBe(1);
		expect(sim.finaleFired).toBe(true);
		expect(sim.time).toBeGreaterThan(FINALE_AT + 1);
		expect(sim.time).toBeLessThan(SHOW_HARD_STOP);
		expect(sim.stats).toEqual({ rockets: 0, particles: 0, rings: 0, flashes: 0 });
		expect(sim.emit(out)).toBe(0);
		// The vertex buffer has headroom: nothing was dropped for lack of space.
		expect(peak).toBeLessThan(out.length * 0.9);
		expect(peak).toBeGreaterThan(0);
	});

	it('bursts the finale once every rocket of the volley is gone', () => {
		const sim = new FireworksSim(W, H, null, mulberry32(6));
		const out = fullBuffer();
		let rocketsAtFinale = -1;
		let timeAtFinale = 0;
		while (!sim.done) {
			if (sim.step(FRAME)) {
				rocketsAtFinale = sim.stats.rockets;
				timeAtFinale = sim.time;
			}
			sim.emit(out);
		}
		expect(rocketsAtFinale).toBe(0);
		expect(timeAtFinale).toBeGreaterThan(FINALE_AT);
		expect(timeAtFinale).toBeLessThan(FINALE_AT + 1.2);
	});

	it('draws the same show for the same seed', () => {
		const a = new FireworksSim(W, H, { x: 640, y: 600 }, mulberry32(9));
		const b = new FireworksSim(W, H, { x: 640, y: 600 }, mulberry32(9));
		const oa = fullBuffer();
		const ob = fullBuffer();
		for (let i = 0; i < 150; i++) {
			a.step(FRAME);
			b.step(FRAME);
		}
		const na = a.emit(oa);
		const nb = b.emit(ob);
		expect(na).toBe(nb);
		expect(na).toBeGreaterThan(0);
		expect(Array.from(oa.subarray(0, na))).toEqual(Array.from(ob.subarray(0, nb)));
	});

	it('never writes past a small vertex buffer', () => {
		const sim = new FireworksSim(W, H, null, mulberry32(7));
		const out = new Float32Array(30 * 6 * VERTEX_SIZE);
		while (!sim.done) {
			sim.step(FRAME);
			const o = sim.emit(out);
			expect(o).toBeLessThanOrEqual(out.length);
			expect(o % (6 * VERTEX_SIZE)).toBe(0);
		}
	});

	it('stays within the particle cap and finishes at 20 fps too', () => {
		const sim = new FireworksSim(W, H, { x: 300, y: 700 }, mulberry32(8));
		const out = fullBuffer();
		while (!sim.done) {
			sim.step(0.05);
			expect(sim.stats.particles).toBeLessThanOrEqual(PARTICLE_CAP);
			sim.emit(out);
		}
		expect(sim.finaleFired).toBe(true);
		expect(sim.time).toBeLessThan(SHOW_HARD_STOP);
	});
});
