/**
 * Canvas 2D renderer for the effigy simulation.
 *
 * Beams are drawn in batches (one path per color and width) instead of one
 * stroke per beam, and all particles are pre-rendered sprites drawn with
 * additive blending ("lighter"), so a full fire is a few dozen draw calls.
 * Particles are pure decoration: they read the simulation, never change it.
 */
import { FALLING, FLYING, RESTING, type EffigySimulation, type SimEvent } from './simulation';

/** Neon colors of the rebuild, per letter (the app's palette). */
export const NEON = ['#f472b6', '#2dd4bf', '#a855f7', '#fb923c', '#38bdf8'];

type Rgb = [number, number, number];

const hex = (h: string): Rgb => [
	parseInt(h.slice(1, 3), 16),
	parseInt(h.slice(3, 5), 16),
	parseInt(h.slice(5, 7), 16)
];
const mix = (a: Rgb, b: Rgb, t: number): Rgb => [
	Math.round(a[0] + (b[0] - a[0]) * t),
	Math.round(a[1] + (b[1] - a[1]) * t),
	Math.round(a[2] + (b[2] - a[2]) * t)
];
const css = ([r, g, b]: Rgb, a = 1) =>
	a >= 1 ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${a})`;

/** Piecewise-linear color ramp. */
function ramp(stops: [number, string][], t: number): Rgb {
	for (let i = 1; i < stops.length; i++) {
		if (t <= stops[i][0]) {
			const [t0, c0] = stops[i - 1];
			const [t1, c1] = stops[i];
			return mix(hex(c0), hex(c1), (t - t0) / (t1 - t0 || 1));
		}
	}
	return hex(stops[stops.length - 1][1]);
}

// Wood from dark to light, charring, ash.
const WOOD = ['#7a4f2c', '#8c5c35', '#9d6a3e', '#ae7948'];
const WOOD_HI = ['#a8784a', '#b98856', '#c99862', '#d9a970'];
const CHAR_STOPS: [number, string][] = [
	[0, '#6b4428'],
	[0.25, '#3a2416'],
	[0.5, '#21160f'],
	[0.8, '#161210'],
	[0.93, '#2c2825'],
	[1, '#4d4844']
];
const CHAR_LEVELS = 10;
const CHAR = Array.from({ length: CHAR_LEVELS }, (_, i) =>
	css(ramp(CHAR_STOPS, (i + 0.5) / CHAR_LEVELS))
);
const FLY_LEVELS = 5;
const FLY = Array.from({ length: FLY_LEVELS }, (_, i) =>
	css(mix(hex('#57504b'), hex('#9d6a3e'), i / (FLY_LEVELS - 1)))
);
const OUTLINE = 'rgba(18, 10, 5, 0.85)';

const COLOR_WOOD = 0;
const COLOR_CHAR = WOOD.length;
const COLOR_FLY = COLOR_CHAR + CHAR_LEVELS;
const COLORS = COLOR_FLY + FLY_LEVELS;
const BASE_COLORS = [...WOOD, ...CHAR, ...FLY];

const WIDTH_CLASSES = 4;
const widthClass = { rail: 0, post: 1, brace: 2, sill: 3 } as const;

const GLOW_LEVELS = 8;
const NEON_LEVELS = 4;

const FLAME_STOPS: [number, string][] = [
	[0, '#5c1409'],
	[0.16, '#a8250f'],
	[0.3, '#e0431a'],
	[0.45, '#ff6f1f'],
	[0.6, '#ff9c2e'],
	[0.75, '#ffc54f'],
	[0.88, '#ffe38c'],
	[1, '#fff6d8']
];
const FLAME_SPRITES = 14;

/** Collects line segments per bucket; one stroke per bucket when flushed. */
class SegmentBatch {
	private readonly head: Int32Array;
	private readonly next: Int32Array;
	private readonly seg: Float32Array;
	private count = 0;

	constructor(
		readonly buckets: number,
		private readonly capacity: number
	) {
		this.head = new Int32Array(buckets).fill(-1);
		this.next = new Int32Array(capacity);
		this.seg = new Float32Array(capacity * 4);
	}

	reset() {
		this.head.fill(-1);
		this.count = 0;
	}

	add(bucket: number, x1: number, y1: number, x2: number, y2: number) {
		if (this.count >= this.capacity) return;
		const i = this.count++;
		const o = i * 4;
		this.seg[o] = x1;
		this.seg[o + 1] = y1;
		this.seg[o + 2] = x2;
		this.seg[o + 3] = y2;
		this.next[i] = this.head[bucket];
		this.head[bucket] = i;
	}

	flush(ctx: CanvasRenderingContext2D, style: (bucket: number) => boolean) {
		for (let b = 0; b < this.buckets; b++) {
			if (this.head[b] < 0 || !style(b)) continue;
			ctx.beginPath();
			for (let i = this.head[b]; i >= 0; i = this.next[i]) {
				const o = i * 4;
				ctx.moveTo(this.seg[o], this.seg[o + 1]);
				ctx.lineTo(this.seg[o + 2], this.seg[o + 3]);
			}
			ctx.stroke();
		}
	}
}

/** Structure-of-arrays particle pool. */
class Particles {
	readonly x: Float32Array;
	readonly y: Float32Array;
	readonly vx: Float32Array;
	readonly vy: Float32Array;
	readonly age: Float32Array;
	readonly life: Float32Array;
	readonly size: Float32Array;
	readonly tone: Float32Array;
	readonly seed: Float32Array;
	count = 0;

	constructor(readonly capacity: number) {
		this.x = new Float32Array(capacity);
		this.y = new Float32Array(capacity);
		this.vx = new Float32Array(capacity);
		this.vy = new Float32Array(capacity);
		this.age = new Float32Array(capacity);
		this.life = new Float32Array(capacity);
		this.size = new Float32Array(capacity);
		this.tone = new Float32Array(capacity);
		this.seed = new Float32Array(capacity);
	}

	spawn(
		x: number,
		y: number,
		vx: number,
		vy: number,
		life: number,
		size: number,
		tone: number
	): boolean {
		if (this.count >= this.capacity) return false;
		const i = this.count++;
		this.x[i] = x;
		this.y[i] = y;
		this.vx[i] = vx;
		this.vy[i] = vy;
		this.age[i] = 0;
		this.life[i] = life;
		this.size[i] = size;
		this.tone[i] = tone;
		this.seed[i] = Math.random() * 100;
		return true;
	}

	/** Age particles and swap-remove the dead ones. */
	advance(dt: number) {
		for (let i = 0; i < this.count;) {
			this.age[i] += dt;
			if (this.age[i] >= this.life[i]) {
				const j = --this.count;
				this.x[i] = this.x[j];
				this.y[i] = this.y[j];
				this.vx[i] = this.vx[j];
				this.vy[i] = this.vy[j];
				this.age[i] = this.age[j];
				this.life[i] = this.life[j];
				this.size[i] = this.size[j];
				this.tone[i] = this.tone[j];
				this.seed[i] = this.seed[j];
				continue;
			}
			i++;
		}
	}
}

type Sprite = HTMLCanvasElement;

function radialSprite(size: number, stops: [number, string][]): Sprite {
	const c = document.createElement('canvas');
	c.width = c.height = size;
	const g = c.getContext('2d')!;
	const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
	for (const [o, color] of stops) grad.addColorStop(o, color);
	g.fillStyle = grad;
	g.fillRect(0, 0, size, size);
	return c;
}

export interface Viewport {
	/** CSS px from the canvas' left/top edge to the structure origin. */
	originX: number;
	originY: number;
	/** CSS size of the canvas. */
	width: number;
	height: number;
	dpr: number;
}

export class EffigyRenderer {
	private readonly ctx: CanvasRenderingContext2D;
	private readonly sim: EffigySimulation;
	private readonly view: Viewport;
	/** 0.35..1: scales particle counts on slow devices. */
	quality = 1;

	private readonly base: SegmentBatch;
	private readonly outline: SegmentBatch;
	private readonly highlight: SegmentBatch;
	private readonly glow: SegmentBatch;
	private readonly ember: SegmentBatch;
	private readonly neon: SegmentBatch;

	private readonly flames = new Particles(1100);
	private readonly sparks = new Particles(420);
	private readonly smoke = new Particles(90);
	private readonly neonSparks = new Particles(520);

	private readonly flameSprites: Sprite[];
	private readonly sparkSprite: Sprite;
	private readonly smokeSprite: Sprite;
	private readonly lightSprite: Sprite;
	private readonly neonSprites: Sprite[];
	private flash = 0;
	private flashX = 0;
	private flashY = 0;

	constructor(canvas: HTMLCanvasElement, sim: EffigySimulation, view: Viewport) {
		const ctx = canvas.getContext('2d');
		if (!ctx) throw new Error('2D canvas unavailable');
		this.ctx = ctx;
		this.sim = sim;
		this.view = view;

		const segments = sim.count * 3 + 16;
		this.base = new SegmentBatch(WIDTH_CLASSES * COLORS, segments);
		this.outline = new SegmentBatch(WIDTH_CLASSES, segments);
		this.highlight = new SegmentBatch(WIDTH_CLASSES * WOOD.length, segments);
		this.glow = new SegmentBatch(GLOW_LEVELS, segments);
		this.ember = new SegmentBatch(GLOW_LEVELS, segments);
		this.neon = new SegmentBatch(NEON.length * NEON_LEVELS, sim.count + 16);

		this.flameSprites = Array.from({ length: FLAME_SPRITES }, (_, i) => {
			const [r, g, b] = ramp(FLAME_STOPS, i / (FLAME_SPRITES - 1));
			return radialSprite(64, [
				[0, `rgba(${r},${g},${b},1)`],
				[0.35, `rgba(${r},${g},${b},0.55)`],
				[1, `rgba(${r},${g},${b},0)`]
			]);
		});
		this.sparkSprite = radialSprite(32, [
			[0, 'rgba(255,250,235,1)'],
			[0.25, 'rgba(255,200,110,0.9)'],
			[0.6, 'rgba(255,120,40,0.35)'],
			[1, 'rgba(255,80,20,0)']
		]);
		this.smokeSprite = radialSprite(64, [
			[0, 'rgba(120,108,100,0.55)'],
			[0.5, 'rgba(90,80,74,0.3)'],
			[1, 'rgba(60,54,50,0)']
		]);
		this.lightSprite = radialSprite(128, [
			[0, 'rgba(255,150,60,0.9)'],
			[0.25, 'rgba(255,110,30,0.4)'],
			[0.6, 'rgba(255,90,20,0.08)'],
			[1, 'rgba(255,80,20,0)']
		]);
		this.neonSprites = NEON.map((color) => {
			const [r, g, b] = hex(color);
			return radialSprite(32, [
				[0, 'rgba(255,255,255,1)'],
				[0.25, `rgba(${r},${g},${b},0.95)`],
				[1, `rgba(${r},${g},${b},0)`]
			]);
		});
	}

	/** Draw one frame; `dt` advances the particles (0 for a still frame). */
	render(dt: number, time: number) {
		const { ctx, sim, view } = this;
		const S = sim.structure.scale;

		this.handleEvents();
		if (dt > 0) {
			this.emit(dt);
			this.updateParticles(dt, time);
		}

		ctx.setTransform(1, 0, 0, 1, 0, 0);
		ctx.clearRect(0, 0, view.width * view.dpr, view.height * view.dpr);
		ctx.setTransform(view.dpr, 0, 0, view.dpr, view.originX * view.dpr, view.originY * view.dpr);
		ctx.lineCap = 'round';
		ctx.globalCompositeOperation = 'source-over';

		// Smoke behind everything.
		this.drawParticles(this.smoke, (i, t) => {
			const a = 0.16 * (1 - t) * Math.min(1, t * 4);
			const r = this.smoke.size[i] * (0.5 + 1.2 * t);
			ctx.globalAlpha = a;
			ctx.drawImage(this.smokeSprite, this.smoke.x[i] - r, this.smoke.y[i] - r, r * 2, r * 2);
		});
		ctx.globalAlpha = 1;

		this.collectBeams(time);
		const widths = this.widthTable();

		this.outline.flush(ctx, (b) => {
			ctx.strokeStyle = OUTLINE;
			ctx.lineWidth = widths[b] + Math.max(1.2, 0.012 * S);
			return true;
		});
		this.base.flush(ctx, (b) => {
			const w = Math.floor(b / COLORS);
			ctx.strokeStyle = BASE_COLORS[b % COLORS];
			ctx.lineWidth = widths[w];
			return true;
		});
		this.highlight.flush(ctx, (b) => {
			const w = Math.floor(b / WOOD.length);
			ctx.strokeStyle = WOOD_HI[b % WOOD.length];
			ctx.lineWidth = widths[w] * 0.38;
			return true;
		});

		ctx.globalCompositeOperation = 'lighter';
		this.drawFirelight();

		const railWidth = widths[0];
		this.ember.flush(ctx, (b) => {
			ctx.strokeStyle = `rgba(230,40,12,${((b + 1) / GLOW_LEVELS) * 0.7})`;
			ctx.lineWidth = railWidth * 1.1;
			return true;
		});
		this.glow.flush(ctx, (b) => {
			ctx.strokeStyle = `rgba(255,70,12,${((b + 1) / GLOW_LEVELS) * 0.45})`;
			ctx.lineWidth = railWidth * 2.8;
			return true;
		});
		this.glow.flush(ctx, (b) => {
			ctx.strokeStyle = `rgba(255,176,70,${((b + 1) / GLOW_LEVELS) * 0.9})`;
			ctx.lineWidth = railWidth * 0.9;
			return true;
		});
		this.neon.flush(ctx, (b) => {
			const [r, g, bl] = hex(NEON[Math.floor(b / NEON_LEVELS)]);
			ctx.strokeStyle = `rgba(${r},${g},${bl},${(((b % NEON_LEVELS) + 1) / NEON_LEVELS) * 0.4})`;
			ctx.lineWidth = railWidth * 2;
			return true;
		});
		this.neon.flush(ctx, (b) => {
			ctx.strokeStyle = `rgba(255,255,255,${(((b % NEON_LEVELS) + 1) / NEON_LEVELS) * 0.45})`;
			ctx.lineWidth = railWidth * 0.6;
			return true;
		});

		this.drawParticles(this.flames, (i, t) => {
			const tone = this.flames.tone[i] * Math.pow(1 - t, 0.85);
			const sprite =
				this.flameSprites[Math.min(FLAME_SPRITES - 1, Math.floor(tone * FLAME_SPRITES))];
			const r = this.flames.size[i] * (1 + 0.7 * t) * (1 - 0.4 * t);
			ctx.globalAlpha = Math.pow(1 - t, 1.2) * Math.min(1, t * 10) * 0.85;
			ctx.drawImage(sprite, this.flames.x[i] - r, this.flames.y[i] - r, r * 2, r * 2);
		});
		this.drawParticles(this.sparks, (i, t) => {
			const flicker = 0.6 + 0.4 * Math.sin(time * 23 + this.sparks.seed[i]);
			const r = this.sparks.size[i] * (1 - 0.5 * t);
			ctx.globalAlpha = (1 - t) * flicker;
			ctx.drawImage(this.sparkSprite, this.sparks.x[i] - r, this.sparks.y[i] - r, r * 2, r * 2);
		});
		this.drawParticles(this.neonSparks, (i, t) => {
			const sprite = this.neonSprites[this.neonSparks.tone[i] | 0];
			const r = this.neonSparks.size[i] * (1 - 0.4 * t);
			ctx.globalAlpha = (1 - t) * Math.min(1, t * 6);
			ctx.drawImage(sprite, this.neonSparks.x[i] - r, this.neonSparks.y[i] - r, r * 2, r * 2);
		});

		for (const p of sim.projectiles) {
			if (!p.active || p.t <= 0) continue;
			const r = 0.16 * S;
			ctx.globalAlpha = 1;
			ctx.drawImage(this.lightSprite, p.x - r * 2.5, p.y - r * 2.5, r * 5, r * 5);
			ctx.drawImage(this.sparkSprite, p.x - r, p.y - r, r * 2, r * 2);
		}
		if (this.flash > 0.01) {
			const r = 1.0 * S;
			ctx.globalAlpha = this.flash * 0.6;
			ctx.drawImage(this.lightSprite, this.flashX - r, this.flashY - r, r * 2, r * 2);
		}

		ctx.globalAlpha = 1;
		ctx.globalCompositeOperation = 'source-over';
	}

	// --- Beams ------------------------------------------------------------------

	private widthTable(): number[] {
		const beams = this.sim.structure.beams;
		const table = [2, 1.5, 1, 4];
		for (const b of beams) table[widthClass[b.kind]] = b.width;
		return table;
	}

	private collectBeams(time: number) {
		const sim = this.sim;
		const beams = sim.structure.beams;
		this.base.reset();
		this.outline.reset();
		this.highlight.reset();
		this.glow.reset();
		this.ember.reset();
		this.neon.reset();
		const embers = sim.phase === 'embers' ? 1 - Math.min(1, (sim.time - sim.phaseStart) / 2.4) : 1;

		for (let i = 0; i < sim.count; i++) {
			const beam = beams[i];
			const w = widthClass[beam.kind];
			const shade = Math.min(WOOD.length - 1, Math.floor(beam.shade * WOOD.length));
			const L = sim.len[i] * sim.grow[i];
			const dx = Math.cos(sim.ang[i]) * L;
			const dy = Math.sin(sim.ang[i]) * L;
			const ax = sim.cx[i] - dx / 2;
			const ay = sim.cy[i] - dy / 2;
			const state = sim.state[i];
			const flight = sim.flight[i];

			if (state === FLYING && flight > 0 && flight < 1) {
				const level = Math.min(FLY_LEVELS - 1, Math.floor(flight * FLY_LEVELS));
				this.outline.add(w, ax, ay, ax + dx, ay + dy);
				this.base.add(w * COLORS + COLOR_FLY + level, ax, ay, ax + dx, ay + dy);
				const glow = Math.sin(Math.PI * Math.min(1, flight * 1.15));
				if (glow > 0.05 && beam.kind !== 'sill') {
					const color = beam.letter >= 0 ? beam.letter % NEON.length : 0;
					const lvl = Math.min(NEON_LEVELS - 1, Math.floor(glow * NEON_LEVELS));
					this.neon.add(color * NEON_LEVELS + lvl, ax, ay, ax + dx, ay + dy);
				}
				continue;
			}

			this.outline.add(w, ax, ay, ax + dx, ay + dy);
			if (!sim.ignited[i]) {
				this.base.add(w * COLORS + COLOR_WOOD + shade, ax, ay, ax + dx, ay + dy);
				this.highlight.add(w * WOOD.length + shade, ax, ay, ax + dx, ay + dy);
				continue;
			}

			const lo = sim.lo[i];
			const hi = sim.hi[i];
			const c = sim.char[i];
			if (lo > 0.02) {
				this.base.add(w * COLORS + COLOR_WOOD + shade, ax, ay, ax + dx * lo, ay + dy * lo);
				this.highlight.add(w * WOOD.length + shade, ax, ay, ax + dx * lo, ay + dy * lo);
			}
			if (hi < 0.98) {
				this.base.add(
					w * COLORS + COLOR_WOOD + shade,
					ax + dx * hi,
					ay + dy * hi,
					ax + dx,
					ay + dy
				);
				this.highlight.add(w * WOOD.length + shade, ax + dx * hi, ay + dy * hi, ax + dx, ay + dy);
			}
			const level = Math.min(CHAR_LEVELS - 1, Math.floor(c * CHAR_LEVELS));
			const x1 = ax + dx * lo;
			const y1 = ay + dy * lo;
			const x2 = ax + dx * hi;
			const y2 = ay + dy * hi;
			this.base.add(w * COLORS + COLOR_CHAR + level, x1, y1, x2, y2);

			// Glowing while it burns; charred wood on the pile smolders red, fading with the embers.
			const flicker =
				0.72 + 0.28 * Math.sin(time * 9.1 + i * 1.7) * Math.sin(time * 5.3 + i * 0.61);
			const heat = sim.intensity(i) * flicker;
			if (heat > 0.04) {
				const lvl = Math.min(GLOW_LEVELS - 1, Math.floor(heat * GLOW_LEVELS));
				this.glow.add(lvl, x1, y1, x2, y2);
			} else if (c > 0.6 && (state === RESTING || state === FALLING || beam.kind === 'sill')) {
				const pulse = 0.55 + 0.45 * Math.sin(time * 2.1 + i * 2.3);
				const smolder = embers * pulse * (c >= 1 ? 0.6 : 0.9);
				if (smolder > 0.06) {
					const lvl = Math.min(GLOW_LEVELS - 1, Math.floor(smolder * GLOW_LEVELS));
					this.ember.add(lvl, x1, y1, x2, y2);
				}
			}
		}
	}

	private drawFirelight() {
		const sim = this.sim;
		let sum = 0;
		let sx = 0;
		let sy = 0;
		for (let i = 0; i < sim.count; i++) {
			const k = sim.intensity(i) * sim.len[i];
			if (k <= 0) continue;
			sum += k;
			sx += sim.cx[i] * k;
			sy += sim.cy[i] * k;
		}
		if (sum <= 0) return;
		const S = sim.structure.scale;
		// Small enough that the glow never reaches the canvas edges.
		const strength = Math.min(1, sum / (40 * S));
		const r = (0.8 + 0.5 * strength) * S;
		this.ctx.globalAlpha = 0.35 * strength;
		this.ctx.drawImage(this.lightSprite, sx / sum - r, sy / sum - r, r * 2, r * 2);
		this.ctx.globalAlpha = 1;
	}

	// --- Particles ----------------------------------------------------------------

	private handleEvents() {
		const S = this.sim.structure.scale;
		this.sim.drainEvents((e: SimEvent) => {
			if (e.kind === 'impact') {
				this.flash = 1;
				this.flashX = e.x;
				this.flashY = e.y;
				this.burst(e.x, e.y, 36, 1.6 * S);
			} else if (e.kind === 'crash') {
				this.burst(
					e.x,
					e.y,
					Math.round(6 + 26 * e.strength * this.quality),
					1.1 * S * e.strength + 0.3 * S
				);
				for (let k = 0; k < 2; k++) {
					this.smoke.spawn(
						e.x + (Math.random() - 0.5) * 0.4 * S,
						e.y - 0.1 * S,
						this.sim.wind * 0.4,
						-0.2 * S,
						1.6 + Math.random(),
						(0.25 + Math.random() * 0.2) * S,
						0
					);
				}
			} else if (e.kind === 'arrive') {
				const tone = e.letter >= 0 ? e.letter % NEON.length : 0;
				for (let k = 0; k < 3; k++) {
					const a = Math.random() * Math.PI * 2;
					const v = (0.3 + Math.random() * 0.5) * S;
					this.neonSparks.spawn(
						e.x,
						e.y,
						Math.cos(a) * v,
						Math.sin(a) * v - 0.2 * S,
						0.35 + Math.random() * 0.3,
						0.03 * S,
						tone
					);
				}
			}
		});
	}

	private burst(x: number, y: number, n: number, speed: number) {
		const S = this.sim.structure.scale;
		for (let k = 0; k < n; k++) {
			const a = -Math.PI * (0.1 + Math.random() * 0.8);
			const v = speed * (0.3 + Math.random() * 0.7);
			this.sparks.spawn(
				x,
				y,
				Math.cos(a) * v,
				Math.sin(a) * v,
				0.5 + Math.random() * 0.9,
				(0.018 + Math.random() * 0.02) * S,
				0
			);
		}
	}

	private emit(dt: number) {
		const sim = this.sim;
		const S = sim.structure.scale;
		const q = this.quality;
		const flameRate = 95 * q;

		for (let i = 0; i < sim.count; i++) {
			const state = sim.state[i];
			if (state === FLYING) {
				const f = sim.flight[i];
				if (f > 0.05 && f < 0.95 && Math.random() < 5 * dt * q) {
					const [px, py] = sim.pointAt(i, Math.random());
					const beam = sim.structure.beams[i];
					this.neonSparks.spawn(
						px,
						py,
						(Math.random() - 0.5) * 0.3 * S,
						-(0.1 + Math.random() * 0.4) * S,
						0.35 + Math.random() * 0.5,
						(0.018 + Math.random() * 0.018) * S,
						beam.letter >= 0 ? beam.letter % NEON.length : 0
					);
				}
				if (!sim.ignited[i] || f > 0) continue;
			}
			const intensity = sim.intensity(i);
			if (intensity <= 0.02) continue;
			const span = sim.hi[i] - sim.lo[i];
			const length = (sim.len[i] * span) / S;
			let expected = flameRate * intensity * (0.12 + length) * dt;
			while (expected > 0) {
				if (expected < 1 && Math.random() > expected) break;
				expected -= 1;
				const [px, py] = sim.pointAt(i, sim.lo[i] + Math.random() * span);
				const lift = 0.35 + Math.random() * 0.45;
				if (
					!this.flames.spawn(
						px + (Math.random() - 0.5) * 0.04 * S,
						py + (Math.random() - 0.5) * 0.04 * S,
						sim.wind * 0.25 + (Math.random() - 0.5) * 0.15 * S,
						-lift * S,
						(0.32 + Math.random() * 0.4) * (0.7 + 0.5 * intensity),
						(0.06 + Math.random() * 0.07) * S * (0.6 + 0.6 * intensity),
						0.72 + Math.random() * 0.28
					)
				) {
					break;
				}
			}
			if (Math.random() < 0.7 * intensity * dt * q) {
				const [px, py] = sim.pointAt(i, sim.lo[i] + Math.random() * span);
				this.sparks.spawn(
					px,
					py,
					sim.wind * 0.5 + (Math.random() - 0.5) * 0.5 * S,
					-(0.5 + Math.random() * 1.1) * S,
					0.8 + Math.random() * 1.1,
					(0.012 + Math.random() * 0.016) * S,
					0
				);
			}
			if (Math.random() < 0.35 * intensity * dt * q) {
				const [px, py] = sim.pointAt(i, sim.lo[i] + Math.random() * span);
				this.smoke.spawn(
					px,
					py - 0.3 * S,
					sim.wind * 0.6,
					-(0.25 + Math.random() * 0.2) * S,
					2 + Math.random() * 1.4,
					(0.18 + Math.random() * 0.14) * S,
					0
				);
			}
		}

		for (const p of sim.projectiles) {
			if (!p.active || p.t <= 0) continue;
			for (let k = 0; k < 3; k++) {
				this.sparks.spawn(
					p.x,
					p.y,
					-p.vx * 0.1 + (Math.random() - 0.5) * 0.3 * S,
					-p.vy * 0.1 + (Math.random() - 0.5) * 0.3 * S,
					0.3 + Math.random() * 0.4,
					(0.02 + Math.random() * 0.02) * S,
					0
				);
			}
			this.flames.spawn(p.x, p.y, 0, -0.2 * S, 0.25, 0.12 * S, 1);
		}
		this.flash *= Math.exp(-dt * 7);
	}

	private updateParticles(dt: number, time: number) {
		const S = this.sim.structure.scale;
		const wind = this.sim.wind;

		const f = this.flames;
		f.advance(dt);
		const buoyancy = 0.9 * S;
		for (let i = 0; i < f.count; i++) {
			f.vy[i] -= buoyancy * dt;
			f.vx[i] += ((wind - f.vx[i]) * 0.8 + Math.sin(time * 7 + f.seed[i]) * 0.35 * S) * dt;
			f.x[i] += f.vx[i] * dt;
			f.y[i] += f.vy[i] * dt;
		}

		const s = this.sparks;
		s.advance(dt);
		const drag = Math.exp(-1.2 * dt);
		for (let i = 0; i < s.count; i++) {
			s.vx[i] =
				s.vx[i] * drag +
				(wind * 0.6 - s.vx[i]) * 0.3 * dt +
				Math.sin(time * 5 + s.seed[i]) * 0.4 * S * dt;
			s.vy[i] = s.vy[i] * drag - 0.25 * S * dt;
			s.x[i] += s.vx[i] * dt;
			s.y[i] += s.vy[i] * dt;
		}

		const m = this.smoke;
		m.advance(dt);
		for (let i = 0; i < m.count; i++) {
			m.vx[i] += (wind * 0.8 - m.vx[i]) * 0.5 * dt;
			m.vy[i] *= Math.exp(-0.3 * dt);
			m.x[i] += m.vx[i] * dt;
			m.y[i] += m.vy[i] * dt;
		}

		const n = this.neonSparks;
		n.advance(dt);
		const ndrag = Math.exp(-2 * dt);
		for (let i = 0; i < n.count; i++) {
			n.vx[i] *= ndrag;
			n.vy[i] = n.vy[i] * ndrag - 0.15 * S * dt;
			n.x[i] += n.vx[i] * dt;
			n.y[i] += n.vy[i] * dt;
		}
	}

	private drawParticles(pool: Particles, draw: (i: number, t: number) => void) {
		for (let i = 0; i < pool.count; i++) draw(i, pool.age[i] / pool.life[i]);
	}
}
