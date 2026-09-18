import { describe, it, expect } from 'vitest';
import { GLYPHS, GLYPH_WIDTH, hasGlyph } from '../src/lib/fx/effigy/glyphs';
import {
	DEFAULT_LINES,
	buildStructure,
	computeSupport,
	effigyAspect,
	layoutUnits,
	type EffigyStructure
} from '../src/lib/fx/effigy/structure';
import {
	EffigySimulation,
	FALLING,
	FLYING,
	RESTING,
	STANDING,
	mulberry32,
	type Phase
} from '../src/lib/fx/effigy/simulation';

const SCALE = 100;

function build(scale = SCALE): EffigyStructure {
	return buildStructure(DEFAULT_LINES, scale, { rand: mulberry32(7) });
}

/** Run until `phase` is entered (or give up after `maxSeconds`). */
function runUntil(sim: EffigySimulation, phase: Phase, maxSeconds = 40): boolean {
	for (let t = 0; t < maxSeconds; t += 1 / 60) {
		sim.step(1 / 60);
		if (sim.phase === phase) return true;
	}
	return false;
}

describe('effigy glyphs', () => {
	it('has a glyph for every letter of the title', () => {
		for (const line of DEFAULT_LINES) {
			for (const char of line) expect(hasGlyph(char), char).toBe(true);
		}
	});

	it('keeps every stroke inside the letter box', () => {
		for (const [char, strokes] of Object.entries(GLYPHS)) {
			for (const stroke of strokes) {
				for (const [x, y] of stroke.points) {
					expect(x, char).toBeGreaterThanOrEqual(0);
					expect(x, char).toBeLessThanOrEqual(GLYPH_WIDTH);
					expect(y, char).toBeGreaterThanOrEqual(0);
					expect(y, char).toBeLessThanOrEqual(1);
				}
			}
		}
	});
});

describe('effigy structure', () => {
	it('lays out two centered lines that fit the layout box', () => {
		const s = build();
		const units = layoutUnits(DEFAULT_LINES);
		expect(s.width).toBeCloseTo(units.width * SCALE);
		expect(s.height).toBeCloseTo(units.height * SCALE);
		expect(effigyAspect()).toBeCloseTo(units.width / units.height);
		expect(s.letters.map((l) => l.char).join('')).toBe('HAMBURNCOZYNIGHTS');
		for (const b of s.beams) {
			for (const [x, y] of [
				[b.ax, b.ay],
				[b.bx, b.by]
			]) {
				expect(x).toBeGreaterThanOrEqual(-1);
				expect(x).toBeLessThanOrEqual(s.width + 1);
				expect(y).toBeGreaterThanOrEqual(-1);
				expect(y).toBeLessThanOrEqual(s.height + 1);
			}
		}
	});

	it('bolts every letter into one piece that stands on the ground', () => {
		const s = build();
		const standing = new Uint8Array(s.beams.length).fill(1);
		const supported = new Uint8Array(s.jointCount);
		computeSupport(s, standing, supported);
		for (const letter of s.letters) {
			expect(letter.beams.length, letter.char).toBeGreaterThan(20);
			const floating = letter.beams.filter((id) => {
				const b = s.beams[id];
				return !supported[b.jointA] || !supported[b.jointB];
			});
			expect(floating, `${letter.char} has unsupported beams`).toEqual([]);
		}
	});

	it('lets the top of a letter fall when its legs are gone', () => {
		const s = build();
		const h = s.letters.find((l) => l.char === 'H')!;
		const standing = new Uint8Array(s.beams.length).fill(1);
		// Cut through both legs just above the ground.
		for (const id of h.beams) {
			const b = s.beams[id];
			const low = Math.max(b.ay, b.by) > h.y + h.height * 0.75;
			if (low) standing[id] = 0;
		}
		const supported = new Uint8Array(s.jointCount);
		computeSupport(s, standing, supported);
		const top = h.beams.filter(
			(id) => Math.max(s.beams[id].ay, s.beams[id].by) < h.y + h.height * 0.5
		);
		expect(top.length).toBeGreaterThan(0);
		for (const id of top) expect(supported[s.beams[id].jointA]).toBe(0);
	});

	it('uses simpler bracing on small screens', () => {
		const small = buildStructure(DEFAULT_LINES, 40, { rand: mulberry32(1) });
		const large = buildStructure(DEFAULT_LINES, 100, { rand: mulberry32(1) });
		const braces = (s: EffigyStructure) => s.beams.filter((b) => b.kind === 'brace').length;
		const posts = (s: EffigyStructure) => s.beams.filter((b) => b.kind === 'post').length;
		expect(braces(small) / posts(small)).toBeLessThan(braces(large) / posts(large));
	});
});

describe('effigy simulation', () => {
	it('builds, stands, burns down completely and rises again', () => {
		const sim = new EffigySimulation(build(), { seed: 42 });
		expect(sim.phase).toBe('build');
		expect(runUntil(sim, 'stand', 6)).toBe(true);
		expect(sim.standingLetterBeams()).toBeGreaterThan(0);

		expect(runUntil(sim, 'burn', 5)).toBe(true);
		expect(runUntil(sim, 'embers', 25)).toBe(true);
		// Nothing of the letters is left standing or in the air.
		for (let i = 0; i < sim.count; i++) {
			if (sim.structure.beams[i].kind === 'sill') continue;
			expect(sim.state[i]).toBe(RESTING);
		}

		expect(runUntil(sim, 'rebuild', 5)).toBe(true);
		expect(runUntil(sim, 'stand', 6)).toBe(true);
		expect(sim.cycle).toBe(1);
		for (let i = 0; i < sim.count; i++) {
			expect(sim.state[i]).toBe(STANDING);
			expect(sim.cx[i]).toBeCloseTo(sim.tcx[i], 3);
			expect(sim.cy[i]).toBeCloseTo(sim.tcy[i], 3);
			expect(sim.ignited[i]).toBe(0);
		}
	});

	it('keeps debris on or above the ground of its line', () => {
		const sim = new EffigySimulation(build(), { seed: 3, start: 'stand' });
		for (let t = 0; t < 14; t += 1 / 60) {
			sim.step(1 / 60);
			for (let i = 0; i < sim.count; i++) {
				if (sim.state[i] !== RESTING && sim.state[i] !== FALLING) continue;
				const line = sim.structure.lines[sim.structure.beams[i].line];
				expect(sim.cy[i]).toBeLessThanOrEqual(line.ground + 2);
			}
		}
	});

	it('lights up where the torch touches a standing letter', () => {
		const sim = new EffigySimulation(build(), { seed: 5, start: 'stand' });
		expect(sim.phase).toBe('stand');
		const h = sim.structure.letters[0];
		const beam = sim.structure.beams[h.beams[0]];
		expect(sim.torch((beam.ax + beam.bx) / 2, (beam.ay + beam.by) / 2, 4)).toBe(true);
		expect(sim.phase).toBe('burn');
		expect(sim.lastIgnition).toBe('torch');
		// Far away from every letter nothing happens.
		expect(sim.torch(-500, -500, 4)).toBe(false);
	});

	it('does not light anything while the letters are still flying in', () => {
		const sim = new EffigySimulation(build(), { seed: 5 });
		sim.step(0.3);
		const flying = Array.from(sim.state).filter((s) => s === FLYING).length;
		expect(flying).toBeGreaterThan(0);
		const beam = sim.structure.beams[0];
		expect(sim.torch((beam.ax + beam.bx) / 2, (beam.ay + beam.by) / 2, 50)).toBe(false);
	});

	it('never lights itself without autoIgnite (reduced motion)', () => {
		const sim = new EffigySimulation(build(), { seed: 9, start: 'stand', autoIgnite: false });
		for (let t = 0; t < 10; t += 0.05) sim.step(0.05);
		expect(sim.phase).toBe('stand');
		expect(Array.from(sim.ignited).some(Boolean)).toBe(false);
	});

	it('is reproducible for the same seed', () => {
		const run = () => {
			const sim = new EffigySimulation(build(), { seed: 11, start: 'stand' });
			for (let t = 0; t < 8; t += 1 / 60) sim.step(1 / 60);
			let hash = 0;
			for (let i = 0; i < sim.count; i++)
				hash = (hash * 31 + Math.round(sim.cx[i] * 10 + sim.cy[i])) | 0;
			return { phase: sim.phase, hash };
		};
		expect(run()).toEqual(run());
	});
});
