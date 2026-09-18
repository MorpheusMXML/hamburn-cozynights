import { describe, it, expect } from 'vitest';
import { GLYPHS, GLYPH_WIDTH, hasGlyph } from '../src/lib/fx/effigy/glyphs';
import {
	DEFAULT_LINES,
	buildStructure,
	computeSupport,
	effigyAspect,
	layoutUnits,
	pointInLetter,
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

	it('wraps every letter in a skin that hides its whole frame', () => {
		const s = build();
		for (const letter of s.letters) {
			for (const id of letter.beams) {
				const b = s.beams[id];
				for (const [x, y] of [
					[b.ax, b.ay],
					[(b.ax + b.bx) / 2, (b.ay + b.by) / 2],
					[b.bx, b.by]
				]) {
					expect(pointInLetter(letter, x, y), `${letter.char} beam ${id}`).toBe(true);
				}
			}
			// Beside the letter and in the gap to its neighbour there is no skin.
			expect(pointInLetter(letter, letter.x - 0.05 * SCALE, letter.y + letter.height / 2)).toBe(
				false
			);
		}
		const o = s.letters.find((l) => l.char === 'O')!;
		expect(pointInLetter(o, o.x + o.width / 2, o.y + o.height / 2), 'the hole of the O').toBe(
			false
		);
	});

	it('knows the neighbours of every letter', () => {
		const s = build();
		const line = s.letters.filter((l) => l.line === 0);
		expect(line.map((l) => l.slot)).toEqual(line.map((_, k) => k));
		expect(line[0].left).toBe(-1);
		expect(line[0].right).toBe(line[1].index);
		expect(line[line.length - 1].right).toBe(-1);
		expect(line.every((l) => l.slots === line.length)).toBe(true);
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
		expect(runUntil(sim, 'stand', 12)).toBe(true);
		expect(sim.standingLetterBeams()).toBeGreaterThan(0);

		expect(runUntil(sim, 'burn', 5)).toBe(true);
		expect(runUntil(sim, 'embers', 55)).toBe(true);
		// Nothing of the letters is left standing or in the air.
		for (let i = 0; i < sim.count; i++) {
			if (sim.structure.beams[i].kind === 'sill') continue;
			expect(sim.state[i]).toBe(RESTING);
		}

		expect(runUntil(sim, 'rebuild', 5)).toBe(true);
		expect(runUntil(sim, 'stand', 12)).toBe(true);
		expect(sim.cycle).toBe(1);
		for (let i = 0; i < sim.count; i++) {
			expect(sim.state[i]).toBe(STANDING);
			expect(sim.cx[i]).toBeCloseTo(sim.tcx[i], 3);
			expect(sim.cy[i]).toBeCloseTo(sim.tcy[i], 3);
			expect(sim.ignited[i]).toBe(0);
		}
		// Every letter has a fresh skin again.
		for (let l = 0; l < sim.letterCount; l++) {
			expect(sim.skinPaint[l]).toBe(1);
			expect(sim.skinLeft[l]).toBe(1);
			expect(sim.burnOrigins[l]).toEqual([]);
		}
	});

	it('builds letter by letter from where each magic ball lands, then paints the skin', () => {
		const sim = new EffigySimulation(build(), { seed: 8 });
		expect(sim.projectiles.map((p) => p.kind)).toEqual(['magic', 'magic']);
		let landed = 0;
		let paintedTooEarly = 0;
		for (let t = 0; t < 12 && sim.phase === 'build'; t += 1 / 60) {
			sim.step(1 / 60);
			sim.drainEvents((e) => {
				if (e.kind === 'magic') landed++;
			});
			for (const letter of sim.structure.letters) {
				const painting = sim.paintAt[letter.index] >= 0;
				if (painting && letter.beams.some((b) => sim.state[b] !== STANDING)) paintedTooEarly++;
			}
		}
		expect(sim.phase).toBe('stand');
		expect(landed).toBe(2);
		expect(paintedTooEarly).toBe(0);
		for (const line of sim.structure.lines) {
			const letters = sim.structure.letters.filter((l) => l.line === line.index);
			const first = letters.reduce((a, b) => (sim.buildAt[b.index] < sim.buildAt[a.index] ? b : a));
			// Away from the letter the ball hit, each letter is built after its neighbour.
			for (const l of letters) {
				const toward = l.slot < first.slot ? l.right : l.slot > first.slot ? l.left : -1;
				if (toward >= 0) expect(sim.buildAt[l.index]).toBeGreaterThan(sim.buildAt[toward]);
				expect(sim.skinPaint[l.index]).toBe(1);
			}
		}
	});

	it('burns the skin first, then walks from letter to letter and line to line', () => {
		const sim = new EffigySimulation(build(), { seed: 21, start: 'stand', autoIgnite: false });
		const letters = sim.structure.letters;
		const beams = sim.structure.beams;
		const h = letters[0];
		const leg = beams[h.beams[0]];
		expect(sim.torch((leg.ax + leg.bx) / 2, (leg.ay + leg.by) / 2, 4)).toBe(true);
		expect(Array.from(sim.ignited).some(Boolean)).toBe(false);

		let burntUnderSkin = 0;
		let fellWithSkin = 0;
		let firstSkinGone = -1;
		for (let t = 0; t < 50 && sim.phase === 'burn'; t += 1 / 60) {
			sim.step(1 / 60);
			if (firstSkinGone < 0 && sim.skinLeft[h.index] <= 0) firstSkinGone = sim.time;
			for (let i = 0; i < sim.count; i++) {
				const letter = beams[i].letter;
				if (letter < 0) continue;
				// Flames only on timber the burning skin has laid bare …
				if (sim.ignited[i] && sim.exposeAt[i] > sim.time) burntUnderSkin++;
				// … and nothing comes down while the letter still has skin.
				if (sim.state[i] !== STANDING && sim.skinLeft[letter] > 0) fellWithSkin++;
			}
		}
		expect(sim.phase).toBe('embers');
		expect(burntUnderSkin).toBe(0);
		expect(fellWithSkin).toBe(0);

		// The first line caught fire letter by letter, starting at the H.
		const first = letters.filter((l) => l.line === 0).map((l) => sim.litAt[l.index]);
		expect(first[0]).toBe(0);
		for (let k = 1; k < first.length; k++) expect(first[k]).toBeGreaterThan(first[k - 1] + 0.5);
		// The second line only once the skin of the H had burnt away.
		const second = letters
			.filter((l) => l.line === 1)
			.map((l) => sim.litAt[l.index])
			.filter((t) => t >= 0);
		expect(second.length).toBeGreaterThan(0);
		expect(firstSkinGone).toBeGreaterThan(0);
		expect(Math.min(...second)).toBeGreaterThan(firstSkinGone);
	});

	it('keeps debris on or above the ground of its line', () => {
		const sim = new EffigySimulation(build(), { seed: 3, start: 'stand' });
		let below = 0;
		let resting = 0;
		for (let t = 0; t < 24; t += 1 / 60) {
			sim.step(1 / 60);
			for (let i = 0; i < sim.count; i++) {
				if (sim.state[i] !== RESTING && sim.state[i] !== FALLING) continue;
				const line = sim.structure.lines[sim.structure.beams[i].line];
				if (sim.cy[i] > line.ground + 2) below++;
				if (sim.state[i] === RESTING) resting++;
			}
		}
		expect(resting).toBeGreaterThan(0);
		expect(below).toBe(0);
	});

	it('lights up where the torch touches a standing letter', () => {
		const sim = new EffigySimulation(build(), { seed: 5, start: 'stand' });
		expect(sim.phase).toBe('stand');
		const h = sim.structure.letters[0];
		const beam = sim.structure.beams[h.beams[0]];
		expect(sim.torch((beam.ax + beam.bx) / 2, (beam.ay + beam.by) / 2, 4)).toBe(true);
		expect(sim.phase).toBe('burn');
		expect(sim.lastIgnition).toBe('torch');
		expect(sim.litAt[h.index]).toBe(sim.time);
		expect(sim.burnOrigins[h.index]).toHaveLength(1);
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
