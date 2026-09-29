// tests/glitter.test.ts — Leave No Trace's dust devil (src/lib/fx/glitter.ts):
// the card becomes glitter from the left edge on, every speck fades, and the
// effect always ends, so the roulette page gets its `done` and spins again.
import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../src/lib/fx/fireworks';
import {
	GlitterSim,
	MAX_SPECKS,
	MIN_SPECKS,
	SWEEP_HARD_STOP,
	SWEEP_TIME
} from '../src/lib/fx/glitter';

const CARD = { left: 40, top: 200, width: 300, height: 120 };
const FRAME = 1 / 60;

describe('Leave No Trace glitter', () => {
	it('starts as the card: every speck inside it, dark until the whirlwind reaches it', () => {
		const sim = new GlitterSim(CARD, mulberry32(1));
		expect(sim.count).toBeGreaterThanOrEqual(MIN_SPECKS);
		expect(sim.count).toBeLessThanOrEqual(MAX_SPECKS);
		for (let i = 0; i < sim.count; i++) {
			expect(sim.x[i]).toBeGreaterThanOrEqual(CARD.left);
			expect(sim.x[i]).toBeLessThanOrEqual(CARD.left + CARD.width);
			expect(sim.y[i]).toBeGreaterThanOrEqual(CARD.top);
			expect(sim.y[i]).toBeLessThanOrEqual(CARD.top + CARD.height);
			expect(sim.alpha[i]).toBe(0);
		}
	});

	it('sweeps from the left edge: the left half glitters before the right half', () => {
		const sim = new GlitterSim(CARD, mulberry32(2));
		const left: number[] = [];
		const right: number[] = [];
		for (let i = 0; i < sim.count; i++) {
			(sim.x[i] < CARD.left + CARD.width / 2 ? left : right).push(i);
		}
		sim.step(SWEEP_TIME * 0.3);
		const lit = (ids: number[]) => ids.filter((i) => sim.alpha[i] > 0).length / ids.length;
		expect(lit(left)).toBeGreaterThan(lit(right));
	});

	it('leaves no trace: every speck has faded by the hard stop, and the loop ends', () => {
		const sim = new GlitterSim(CARD, mulberry32(3));
		let frames = 0;
		while (sim.alive) {
			sim.step(FRAME);
			frames++;
			expect(frames).toBeLessThan(SWEEP_HARD_STOP * 60 + 2);
		}
		expect(sim.time).toBeLessThanOrEqual(SWEEP_HARD_STOP + FRAME);
		sim.step(FRAME);
		expect(Array.from(sim.alpha).every((a) => a === 0)).toBe(true);
	});

	it('scales with the card, within bounds, even for a card of no size', () => {
		expect(new GlitterSim({ left: 0, top: 0, width: 0, height: 0 }).count).toBe(MIN_SPECKS);
		expect(new GlitterSim({ left: 0, top: 0, width: 2000, height: 1000 }).count).toBe(MAX_SPECKS);
	});
});
