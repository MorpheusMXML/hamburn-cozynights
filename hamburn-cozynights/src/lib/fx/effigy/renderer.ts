/**
 * Canvas 2D renderer for the effigy simulation.
 *
 * - Every letter wears a rainbow skin, pre-rendered once into a sprite. While
 *   a skin burns, a scratch canvas cuts the burnt area out of the sprite and
 *   chars the rim along the ragged front; the glowing edge goes on top. The
 *   same scratch canvas paints a fresh skin over a finished frame.
 * - Beams are drawn in batches (one path per color and width) instead of one
 *   stroke per beam, and all particles are pre-rendered sprites drawn with
 *   additive blending ("lighter"), so a full fire is a few dozen draw calls.
 *
 * Particles are pure decoration: they read the simulation, never change it.
 */
import { pointInLetter, type LetterDef } from './structure';
import {
	EMBER_SECONDS,
	FALLING,
	FLYING,
	RESTING,
	SKIN_BURN_SPEED,
	SKIN_PAINT_SPEED,
	STANDING,
	frontShape,
	insideFront,
	type EffigySimulation,
	type Origin,
	type SimEvent
} from './simulation';

type Rgb = [number, number, number];

const TAU = Math.PI * 2;

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

function hslRgb(h: number, s: number, l: number): Rgb {
	h = (((h % 360) + 360) % 360) / 360;
	const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
	const p = 2 * l - q;
	const channel = (t: number) => {
		if (t < 0) t += 1;
		if (t > 1) t -= 1;
		if (t < 1 / 6) return p + (q - p) * 6 * t;
		if (t < 1 / 2) return q;
		if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
		return p;
	};
	return [
		Math.round(channel(h + 1 / 3) * 255),
		Math.round(channel(h) * 255),
		Math.round(channel(h - 1 / 3) * 255)
	];
}

/** Hue of a letter's skin: each line runs through the rainbow, red to violet. */
export function letterHue(letter: LetterDef): number {
	return letter.slots > 1 ? (letter.slot / (letter.slots - 1)) * 285 : 0;
}

/** Rainbow hues in steps, for sparkles and glowing beams. */
const HUE_STEPS = 24;
const hueStep = (hue: number) => Math.round((hue / 360) * HUE_STEPS) % HUE_STEPS;
const HUE_RGB = Array.from({ length: HUE_STEPS }, (_, k) => hslRgb((k * 360) / HUE_STEPS, 1, 0.62));

// Pine: fresh timber, its lit side, its shaded side and grain.
const WOOD = ['#a57646', '#b0814d', '#bb8b55', '#c6965e'];
const WOOD_HI = ['#d6ab72', '#ddb47c', '#e4bd86', '#ebc690'];
const WOOD_SHADOW = 'rgba(62, 36, 16, 0.55)';
const GRAIN = 'rgba(96, 60, 30, 0.5)';
const BOLT = '#2d2926';
const BOLT_HI = 'rgba(190, 182, 172, 0.55)';
const OUTLINE = 'rgba(18, 10, 5, 0.85)';
/** Where the light comes from (top left). */
const LIGHT_X = -0.6;
const LIGHT_Y = -0.8;

/** Bare timber darkens while it heats up behind the burnt skin. */
const SCORCH_LEVELS = 4;
const SCORCH = Array.from({ length: SCORCH_LEVELS }, (_, i) =>
	css(mix(hex('#a57646'), hex('#4a2c17'), (i + 1) / SCORCH_LEVELS))
);
const CHAR_STOPS: [number, string][] = [
	[0, '#5a3820'],
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
	css(mix(hex('#57504b'), hex('#b0814d'), i / (FLY_LEVELS - 1)))
);

const COLOR_WOOD = 0;
const COLOR_SCORCH = WOOD.length;
const COLOR_CHAR = COLOR_SCORCH + SCORCH_LEVELS;
const COLOR_FLY = COLOR_CHAR + CHAR_LEVELS;
const COLORS = COLOR_FLY + FLY_LEVELS;
const BASE_COLORS = [...WOOD, ...SCORCH, ...CHAR, ...FLY];

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

/** Points on the outline of a burn front. */
const FRONT_POINTS = 72;
const FRONT_COS = Float32Array.from({ length: FRONT_POINTS }, (_, k) =>
	Math.cos((k / FRONT_POINTS) * TAU)
);
const FRONT_SIN = Float32Array.from({ length: FRONT_POINTS }, (_, k) =>
	Math.sin((k / FRONT_POINTS) * TAU)
);

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

/** A letter's skin: its outline and the pre-rendered rainbow sprite. */
interface Skin {
	letter: LetterDef;
	hue: number;
	hueStep: number;
	/** All loops of the skin; their nonzero fill is the skin. */
	path: Path2D;
	/** Every outline point, flat x,y. */
	outline: Float32Array;
	sprite: HTMLCanvasElement;
	/** Where the sprite goes, in structure px. */
	x: number;
	y: number;
	w: number;
	h: number;
}

/** One path for all strokes of a letter; its nonzero fill is the skin. */
function skinPath(letter: LetterDef): { path: Path2D; outline: Float32Array } {
	const path = new Path2D();
	const points: number[] = [];
	for (const shape of letter.skin) {
		for (const loop of shape) {
			path.moveTo(loop[0], loop[1]);
			for (let k = 2; k < loop.length; k += 2) path.lineTo(loop[k], loop[k + 1]);
			path.closePath();
			points.push(...loop);
		}
	}
	return { path, outline: Float32Array.from(points) };
}

/** Paint the inner edge of the skin that faces away from `shift`: half a bevel. */
function bevel(
	g: CanvasRenderingContext2D,
	temp: HTMLCanvasElement,
	skin: Skin,
	dpr: number,
	shift: number,
	color: string
) {
	const t = temp.getContext('2d')!;
	const { width, height } = skin.sprite;
	t.setTransform(1, 0, 0, 1, 0, 0);
	t.globalCompositeOperation = 'source-over';
	t.clearRect(0, 0, width, height);
	t.setTransform(dpr, 0, 0, dpr, -skin.x * dpr, -skin.y * dpr);
	t.fillStyle = color;
	t.fill(skin.path);
	t.globalCompositeOperation = 'destination-out';
	t.translate(shift * 0.7, shift);
	t.fillStyle = '#000';
	t.fill(skin.path);
	t.globalCompositeOperation = 'source-over';
	g.save();
	g.setTransform(1, 0, 0, 1, 0, 0);
	g.drawImage(temp, 0, 0, width, height, 0, 0, width, height);
	g.restore();
}

/** The rainbow skin: glow, dark rim, colored body, painted boards, sheen and bevel. */
function paintSkin(skin: Skin, temp: HTMLCanvasElement, dpr: number, S: number, margin: number) {
	const g = skin.sprite.getContext('2d')!;
	const { letter, path, hue } = skin;
	g.setTransform(dpr, 0, 0, dpr, -skin.x * dpr, -skin.y * dpr);
	g.lineJoin = 'round';

	g.shadowColor = `hsla(${hue}, 100%, 60%, 0.75)`;
	g.shadowBlur = 0.1 * S * dpr;
	g.strokeStyle = `hsl(${hue}, 55%, 14%)`;
	g.lineWidth = 0.036 * S;
	g.stroke(path);
	g.shadowBlur = 0;
	g.shadowColor = 'rgba(0, 0, 0, 0)';

	const body = g.createLinearGradient(
		letter.x,
		letter.y,
		letter.x + letter.width * 0.3,
		letter.y + letter.height
	);
	body.addColorStop(0, `hsl(${hue - 6}, 100%, 77%)`);
	body.addColorStop(0.45, `hsl(${hue + 4}, 96%, 61%)`);
	body.addColorStop(1, `hsl(${hue + 16}, 90%, 45%)`);
	g.fillStyle = body;
	g.fill(path);

	g.save();
	g.clip(path);
	g.strokeStyle = `hsla(${hue + 20}, 70%, 22%, 0.16)`;
	g.lineWidth = Math.max(0.7, 0.008 * S);
	g.beginPath();
	for (let y = letter.y + 0.14 * S; y < letter.y + letter.height; y += 0.14 * S) {
		g.moveTo(letter.x - margin, y);
		g.lineTo(letter.x + letter.width + margin, y);
	}
	g.stroke();
	const sheen = g.createLinearGradient(
		letter.x,
		letter.y,
		letter.x + letter.width,
		letter.y + letter.height * 0.7
	);
	sheen.addColorStop(0.2, 'rgba(255, 255, 255, 0)');
	sheen.addColorStop(0.38, 'rgba(255, 255, 255, 0.2)');
	sheen.addColorStop(0.52, 'rgba(255, 255, 255, 0)');
	g.fillStyle = sheen;
	g.fillRect(
		letter.x - margin,
		letter.y - margin,
		letter.width + 2 * margin,
		letter.height + 2 * margin
	);
	g.restore();

	bevel(g, temp, skin, dpr, 0.014 * S, `hsla(${hue}, 100%, 94%, 0.55)`);
	bevel(g, temp, skin, dpr, 0.028 * S, `hsla(${hue}, 100%, 90%, 0.3)`);
	bevel(g, temp, skin, dpr, -0.02 * S, `hsla(${hue + 30}, 85%, 20%, 0.45)`);
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

	private readonly skins: Skin[];
	private readonly scratch: HTMLCanvasElement;
	private readonly scratchCtx: CanvasRenderingContext2D;
	/** Per letter: radius of the fresh paint (-1 none, Infinity all of it). */
	private readonly paint: Float32Array;
	/** Per letter: 1 once the skin has burnt away completely. */
	private readonly gone: Uint8Array;
	/** Per letter: 1 while the whole frame hides behind an intact skin. */
	private readonly hidden: Uint8Array;
	private readonly shapes = new WeakMap<Origin, Float32Array>();

	private readonly widths: number[];
	/** Grain streak per beam: start, length, offset (0..1 each). */
	private readonly grainOf: Float32Array;
	private readonly base: SegmentBatch;
	private readonly outline: SegmentBatch;
	private readonly highlight: SegmentBatch;
	private readonly shadow: SegmentBatch;
	private readonly grain: SegmentBatch;
	private readonly bolts: SegmentBatch;
	private readonly glow: SegmentBatch;
	private readonly heat: SegmentBatch;
	private readonly ember: SegmentBatch;
	private readonly neon: SegmentBatch;

	private readonly flames = new Particles(1400);
	private readonly sparks = new Particles(480);
	private readonly smoke = new Particles(110);
	private readonly neonSparks = new Particles(700);

	private readonly flameSprites: Sprite[];
	private readonly sparkSprite: Sprite;
	private readonly smokeSprite: Sprite;
	private readonly lightSprite: Sprite;
	private readonly whiteSprite: Sprite;
	private readonly hueSprites: Sprite[];
	private flash = 0;
	private flashX = 0;
	private flashY = 0;
	private magic = 0;
	private magicX = 0;
	private magicY = 0;
	private magicHue = 0;

	constructor(canvas: HTMLCanvasElement, sim: EffigySimulation, view: Viewport) {
		const ctx = canvas.getContext('2d');
		if (!ctx) throw new Error('2D canvas unavailable');
		this.ctx = ctx;
		this.sim = sim;
		this.view = view;
		const n = sim.count;
		const S = sim.structure.scale;

		this.widths = [2, 1.5, 1, 4];
		for (const b of sim.structure.beams) this.widths[widthClass[b.kind]] = b.width;
		this.grainOf = new Float32Array(n * 3);
		for (let i = 0; i < n * 3; i++) this.grainOf[i] = Math.random();

		const segments = n * 3 + 16;
		this.base = new SegmentBatch(WIDTH_CLASSES * COLORS, segments);
		this.outline = new SegmentBatch(WIDTH_CLASSES, n + 16);
		this.highlight = new SegmentBatch(WIDTH_CLASSES * WOOD.length, n * 2 + 16);
		this.shadow = new SegmentBatch(WIDTH_CLASSES, n * 2 + 16);
		this.grain = new SegmentBatch(WIDTH_CLASSES, n + 16);
		this.bolts = new SegmentBatch(1, n * 2 + 16);
		this.glow = new SegmentBatch(GLOW_LEVELS, n + 16);
		this.heat = new SegmentBatch(GLOW_LEVELS, n * 2 + 16);
		this.ember = new SegmentBatch(GLOW_LEVELS, n + 16);
		this.neon = new SegmentBatch(HUE_STEPS * NEON_LEVELS, n + 16);

		// Skins, aligned with device pixels so they stay crisp.
		const margin = 0.16 * S;
		const dpr = view.dpr;
		let temp: HTMLCanvasElement | null = null;
		this.skins = sim.structure.letters.map((letter) => {
			const { path, outline } = skinPath(letter);
			const px = Math.floor((view.originX + letter.x - margin) * dpr);
			const py = Math.floor((view.originY + letter.y - margin) * dpr);
			const pw = Math.ceil((letter.width + 2 * margin) * dpr) + 1;
			const ph = Math.ceil((letter.height + 2 * margin) * dpr) + 1;
			const sprite = document.createElement('canvas');
			sprite.width = pw;
			sprite.height = ph;
			const hue = letterHue(letter);
			const skin: Skin = {
				letter,
				hue,
				hueStep: hueStep(hue),
				path,
				outline,
				sprite,
				x: px / dpr - view.originX,
				y: py / dpr - view.originY,
				w: pw / dpr,
				h: ph / dpr
			};
			if (!temp || temp.width < pw || temp.height < ph) {
				temp = document.createElement('canvas');
				temp.width = pw;
				temp.height = ph;
			}
			paintSkin(skin, temp, dpr, S, margin);
			return skin;
		});
		this.scratch = document.createElement('canvas');
		this.scratch.width = Math.max(1, ...this.skins.map((s) => s.sprite.width));
		this.scratch.height = Math.max(1, ...this.skins.map((s) => s.sprite.height));
		this.scratchCtx = this.scratch.getContext('2d')!;
		const letters = sim.letterCount;
		this.paint = new Float32Array(letters);
		this.gone = new Uint8Array(letters);
		this.hidden = new Uint8Array(letters);

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
		this.whiteSprite = radialSprite(32, [
			[0, 'rgba(255,255,255,1)'],
			[0.3, 'rgba(255,255,255,0.85)'],
			[1, 'rgba(255,255,255,0)']
		]);
		this.hueSprites = HUE_RGB.map(([r, g, b]) =>
			radialSprite(32, [
				[0, 'rgba(255,255,255,1)'],
				[0.22, `rgba(${r},${g},${b},0.95)`],
				[0.55, `rgba(${r},${g},${b},0.35)`],
				[1, `rgba(${r},${g},${b},0)`]
			])
		);
	}

	/** Draw one frame; `dt` advances the particles (0 for a still frame). */
	render(dt: number, time: number) {
		const { ctx, sim, view } = this;
		const S = sim.structure.scale;

		this.handleEvents();
		this.updateLetters();
		if (dt > 0) {
			this.emit(dt);
			this.updateParticles(dt, time);
		}

		ctx.setTransform(1, 0, 0, 1, 0, 0);
		ctx.clearRect(0, 0, view.width * view.dpr, view.height * view.dpr);
		ctx.setTransform(view.dpr, 0, 0, view.dpr, view.originX * view.dpr, view.originY * view.dpr);
		ctx.lineCap = 'round';
		ctx.lineJoin = 'round';
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
		this.drawBeams();
		this.drawSkins();

		ctx.globalCompositeOperation = 'lighter';
		this.drawFirelight();
		this.drawBeamLight();
		this.drawBurnEdges(time);
		this.drawPaintEdges();

		this.drawParticles(this.flames, (i, t) => {
			const tone = this.flames.tone[i] * Math.pow(1 - t, 0.85);
			const sprite =
				this.flameSprites[Math.min(FLAME_SPRITES - 1, Math.floor(tone * FLAME_SPRITES))];
			const r = this.flames.size[i] * (1 + 0.7 * t) * (1 - 0.4 * t);
			ctx.globalAlpha = Math.pow(1 - t, 1.2) * Math.min(1, t * 10) * 0.78;
			ctx.drawImage(sprite, this.flames.x[i] - r, this.flames.y[i] - r, r * 2, r * 2);
		});
		this.drawParticles(this.sparks, (i, t) => {
			const flicker = 0.6 + 0.4 * Math.sin(time * 23 + this.sparks.seed[i]);
			const r = this.sparks.size[i] * (1 - 0.5 * t);
			ctx.globalAlpha = (1 - t) * flicker;
			ctx.drawImage(this.sparkSprite, this.sparks.x[i] - r, this.sparks.y[i] - r, r * 2, r * 2);
		});
		this.drawParticles(this.neonSparks, (i, t) => {
			const sprite = this.hueSprites[this.neonSparks.tone[i] | 0];
			const twinkle = 0.7 + 0.3 * Math.sin(time * 19 + this.neonSparks.seed[i]);
			const r = this.neonSparks.size[i] * (1 - 0.4 * t);
			ctx.globalAlpha = (1 - t) * Math.min(1, t * 6) * twinkle;
			ctx.drawImage(sprite, this.neonSparks.x[i] - r, this.neonSparks.y[i] - r, r * 2, r * 2);
		});

		for (const p of sim.projectiles) {
			if (!p.active || p.t <= 0) continue;
			if (p.kind === 'magic') {
				// A magic ball: white core, halo running through the rainbow.
				const r = 0.12 * S;
				const halo = this.hueSprites[Math.floor(time * 10) % HUE_STEPS];
				ctx.globalAlpha = 0.9;
				ctx.drawImage(halo, p.x - r * 2.4, p.y - r * 2.4, r * 4.8, r * 4.8);
				ctx.globalAlpha = 1;
				ctx.drawImage(this.whiteSprite, p.x - r, p.y - r, r * 2, r * 2);
			} else {
				const r = 0.16 * S;
				ctx.globalAlpha = 1;
				ctx.drawImage(this.lightSprite, p.x - r * 2.5, p.y - r * 2.5, r * 5, r * 5);
				ctx.drawImage(this.sparkSprite, p.x - r, p.y - r, r * 2, r * 2);
			}
		}
		if (this.flash > 0.01) {
			const r = 1.0 * S;
			ctx.globalAlpha = this.flash * 0.6;
			ctx.drawImage(this.lightSprite, this.flashX - r, this.flashY - r, r * 2, r * 2);
		}
		if (this.magic > 0.01) {
			const r = 0.9 * S;
			ctx.globalAlpha = this.magic * 0.45;
			ctx.drawImage(this.hueSprites[this.magicHue], this.magicX - r, this.magicY - r, r * 2, r * 2);
		}

		ctx.globalAlpha = 1;
		ctx.globalCompositeOperation = 'source-over';
	}

	// --- Skins --------------------------------------------------------------------

	/** Paint, burn and hide state of every letter for this frame. */
	private updateLetters() {
		const sim = this.sim;
		const S = sim.structure.scale;
		for (const skin of this.skins) {
			const l = skin.letter.index;
			let paint = -1;
			if (sim.paintAt[l] >= 0) {
				const o = sim.buildOrigin[l];
				const r = (sim.time - sim.paintAt[l]) * SKIN_PAINT_SPEED * S;
				paint = r >= reach(skin.outline, o.x, o.y) ? Infinity : r;
			} else if (sim.skinPaint[l] >= 1) {
				paint = Infinity;
			}
			this.paint[l] = paint;
			const origins = sim.burnOrigins[l];
			if (!origins.length) this.gone[l] = sim.skinLeft[l] <= 0 ? 1 : 0;
			else if (!this.gone[l] && sim.skinLeft[l] <= 0 && this.burntThrough(skin, origins)) {
				this.gone[l] = 1;
			}
			this.hidden[l] = paint === Infinity && !origins.length && !this.gone[l] ? 1 : 0;
		}
	}

	/** Has the fire reached every point of the skin's outline? */
	private burntThrough(skin: Skin, origins: Origin[]): boolean {
		const pts = skin.outline;
		for (let k = 0; k < pts.length; k += 2) {
			if (!this.burnt(origins, null, pts[k], pts[k + 1])) return false;
		}
		return true;
	}

	private burnt(origins: Origin[], except: Origin | null, x: number, y: number): boolean {
		for (const o of origins) {
			if (o !== except && insideFront(o, this.sim.frontRadius(o, SKIN_BURN_SPEED), x, y)) {
				return true;
			}
		}
		return false;
	}

	/** Radius factors of a front's ragged outline, one per FRONT_POINTS direction. */
	private shapeOf(o: Origin): Float32Array {
		let shape = this.shapes.get(o);
		if (!shape) {
			shape = Float32Array.from({ length: FRONT_POINTS }, (_, k) =>
				frontShape((k / FRONT_POINTS) * TAU, o.seed)
			);
			this.shapes.set(o, shape);
		}
		return shape;
	}

	private traceFront(c: CanvasRenderingContext2D, o: Origin, r: number) {
		const shape = this.shapeOf(o);
		c.beginPath();
		for (let k = 0; k < FRONT_POINTS; k++) {
			const x = o.x + FRONT_COS[k] * r * shape[k];
			const y = o.y + FRONT_SIN[k] * r * shape[k];
			if (k === 0) c.moveTo(x, y);
			else c.lineTo(x, y);
		}
		c.closePath();
	}

	/** Copy a skin's sprite to the scratch canvas and switch to its coordinates. */
	private toScratch(skin: Skin): CanvasRenderingContext2D {
		const sc = this.scratchCtx;
		const dpr = this.view.dpr;
		sc.setTransform(1, 0, 0, 1, 0, 0);
		sc.globalCompositeOperation = 'source-over';
		sc.clearRect(0, 0, skin.sprite.width, skin.sprite.height);
		sc.drawImage(skin.sprite, 0, 0);
		sc.setTransform(dpr, 0, 0, dpr, -skin.x * dpr, -skin.y * dpr);
		return sc;
	}

	private fromScratch(skin: Skin) {
		this.scratchCtx.globalCompositeOperation = 'source-over';
		const { width, height } = skin.sprite;
		this.ctx.drawImage(this.scratch, 0, 0, width, height, skin.x, skin.y, skin.w, skin.h);
	}

	private drawSkins() {
		const sim = this.sim;
		const S = sim.structure.scale;
		for (const skin of this.skins) {
			const l = skin.letter.index;
			const paint = this.paint[l];
			if (paint < 0 || this.gone[l]) continue;
			const origins = sim.burnOrigins[l];
			if (origins.length) {
				// Char the skin ahead of the fire, then cut out what has burnt.
				const sc = this.toScratch(skin);
				sc.lineJoin = 'round';
				sc.globalCompositeOperation = 'source-atop';
				for (const o of origins) {
					this.traceFront(sc, o, sim.frontRadius(o, SKIN_BURN_SPEED));
					sc.strokeStyle = 'rgba(92, 50, 20, 0.3)';
					sc.lineWidth = 0.36 * S;
					sc.stroke();
					sc.strokeStyle = 'rgba(45, 24, 10, 0.6)';
					sc.lineWidth = 0.17 * S;
					sc.stroke();
					sc.strokeStyle = 'rgba(14, 8, 5, 0.95)';
					sc.lineWidth = 0.07 * S;
					sc.stroke();
				}
				sc.globalCompositeOperation = 'destination-out';
				sc.fillStyle = '#000';
				for (const o of origins) {
					this.traceFront(sc, o, sim.frontRadius(o, SKIN_BURN_SPEED));
					sc.fill();
				}
				this.fromScratch(skin);
			} else if (paint < Infinity) {
				// Fresh paint spreads from where the build began.
				const o = sim.buildOrigin[l];
				const sc = this.toScratch(skin);
				sc.globalCompositeOperation = 'destination-in';
				sc.fillStyle = '#000';
				sc.beginPath();
				sc.arc(o.x, o.y, Math.max(0.1, paint), 0, TAU);
				sc.fill();
				this.fromScratch(skin);
			} else {
				this.ctx.drawImage(skin.sprite, skin.x, skin.y, skin.w, skin.h);
			}
		}
	}

	/** The glowing edge of every burn front, only where there is skin. */
	private drawBurnEdges(time: number) {
		const { ctx, sim } = this;
		const S = sim.structure.scale;
		for (const skin of this.skins) {
			const l = skin.letter.index;
			const origins = sim.burnOrigins[l];
			if (!origins.length || this.gone[l]) continue;
			ctx.save();
			ctx.clip(skin.path);
			ctx.beginPath();
			for (const o of origins) {
				const r = sim.frontRadius(o, SKIN_BURN_SPEED);
				if (r <= 0) continue;
				const shape = this.shapeOf(o);
				let pen = false;
				for (let j = 0; j <= FRONT_POINTS; j++) {
					const k = j % FRONT_POINTS;
					const x = o.x + FRONT_COS[k] * r * shape[k];
					const y = o.y + FRONT_SIN[k] * r * shape[k];
					// No edge where another front has already burnt through.
					if (origins.length > 1 && this.burnt(origins, o, x, y)) {
						pen = false;
						continue;
					}
					if (pen) ctx.lineTo(x, y);
					else ctx.moveTo(x, y);
					pen = true;
				}
			}
			const flicker = 0.82 + 0.18 * Math.sin(time * 17 + l * 2.1);
			ctx.strokeStyle = `rgba(255, 84, 20, ${0.45 * flicker})`;
			ctx.lineWidth = 0.09 * S;
			ctx.stroke();
			ctx.strokeStyle = `rgba(255, 196, 110, ${0.9 * flicker})`;
			ctx.lineWidth = 0.028 * S;
			ctx.stroke();
			ctx.restore();
		}
	}

	/** A shimmering rim where fresh paint spreads. */
	private drawPaintEdges() {
		const { ctx, sim } = this;
		const S = sim.structure.scale;
		for (const skin of this.skins) {
			const l = skin.letter.index;
			const r = this.paint[l];
			if (r <= 0 || r === Infinity) continue;
			const o = sim.buildOrigin[l];
			const [cr, cg, cb] = HUE_RGB[skin.hueStep];
			ctx.save();
			ctx.clip(skin.path);
			ctx.beginPath();
			ctx.arc(o.x, o.y, r, 0, TAU);
			ctx.strokeStyle = `rgba(${cr},${cg},${cb},0.6)`;
			ctx.lineWidth = 0.08 * S;
			ctx.stroke();
			ctx.strokeStyle = 'rgba(255,255,255,0.85)';
			ctx.lineWidth = 0.02 * S;
			ctx.stroke();
			ctx.restore();
		}
	}

	// --- Beams ------------------------------------------------------------------

	private collectBeams(time: number) {
		const sim = this.sim;
		const beams = sim.structure.beams;
		const S = sim.structure.scale;
		this.base.reset();
		this.outline.reset();
		this.highlight.reset();
		this.shadow.reset();
		this.grain.reset();
		this.bolts.reset();
		this.glow.reset();
		this.heat.reset();
		this.ember.reset();
		this.neon.reset();
		const embers =
			sim.phase === 'embers' ? 1 - Math.min(1, (sim.time - sim.phaseStart) / EMBER_SECONDS) : 1;

		for (let i = 0; i < sim.count; i++) {
			const beam = beams[i];
			const state = sim.state[i];
			// An intact skin hides the frame.
			if (state === STANDING && beam.letter >= 0 && this.hidden[beam.letter]) continue;
			const L = sim.len[i] * sim.grow[i];
			if (L < 0.5) continue;
			const w = widthClass[beam.kind];
			const shade = Math.min(WOOD.length - 1, Math.floor(beam.shade * WOOD.length));
			const cos = Math.cos(sim.ang[i]);
			const sin = Math.sin(sim.ang[i]);
			const dx = cos * L;
			const dy = sin * L;
			const ax = sim.cx[i] - dx / 2;
			const ay = sim.cy[i] - dy / 2;
			const flight = sim.flight[i];

			if (state === FLYING && flight > 0 && flight < 1) {
				const level = Math.min(FLY_LEVELS - 1, Math.floor(flight * FLY_LEVELS));
				this.outline.add(w, ax, ay, ax + dx, ay + dy);
				this.base.add(w * COLORS + COLOR_FLY + level, ax, ay, ax + dx, ay + dy);
				const glow = Math.sin(Math.PI * Math.min(1, flight * 1.15));
				if (glow > 0.05 && beam.letter >= 0) {
					const lvl = Math.min(NEON_LEVELS - 1, Math.floor(glow * NEON_LEVELS));
					const hue = this.skins[beam.letter].hueStep;
					this.neon.add(hue * NEON_LEVELS + lvl, ax, ay, ax + dx, ay + dy);
				}
				continue;
			}

			this.outline.add(w, ax, ay, ax + dx, ay + dy);
			const ignited = sim.ignited[i] === 1;
			const c = sim.char[i];
			// Bare timber heats up before it burns: it darkens and glows.
			const heat = ignited ? 0.8 * Math.max(0, 1 - c * 10) : sim.glow(i);
			const color =
				heat > 0.05
					? COLOR_SCORCH + Math.min(SCORCH_LEVELS - 1, Math.floor(heat * SCORCH_LEVELS))
					: COLOR_WOOD + shade;
			// The light side of the beam faces the top left.
			let nx = -sin;
			let ny = cos;
			if (nx * LIGHT_X + ny * LIGHT_Y < 0) {
				nx = -nx;
				ny = -ny;
			}
			const lit = heat < 0.45 && state !== FLYING;
			const pulse = 0.75 + 0.25 * Math.sin(time * 6.3 + i * 1.3);
			const heatLevel = Math.min(GLOW_LEVELS - 1, Math.floor(heat * pulse * GLOW_LEVELS));

			if (!ignited) {
				this.wood(w, color, shade, lit, beam.width, ax, ay, dx, dy, nx, ny, 0, 1);
				if (lit && L > 0.09 * S) {
					const g = i * 3;
					const u0 = 0.08 + this.grainOf[g] * 0.45;
					const u1 = Math.min(0.92, u0 + 0.22 + this.grainOf[g + 1] * 0.3);
					const off = (this.grainOf[g + 2] - 0.5) * beam.width * 0.45;
					this.grain.add(
						w,
						ax + dx * u0 + nx * off,
						ay + dy * u0 + ny * off,
						ax + dx * u1 + nx * off,
						ay + dy * u1 + ny * off
					);
				}
				if (heat > 0.04) this.heat.add(heatLevel, ax, ay, ax + dx, ay + dy);
			} else {
				const lo = sim.lo[i];
				const hi = sim.hi[i];
				if (lo > 0.02) {
					this.wood(w, color, shade, lit, beam.width, ax, ay, dx, dy, nx, ny, 0, lo);
					if (heat > 0.04) this.heat.add(heatLevel, ax, ay, ax + dx * lo, ay + dy * lo);
				}
				if (hi < 0.98) {
					this.wood(w, color, shade, lit, beam.width, ax, ay, dx, dy, nx, ny, hi, 1);
					if (heat > 0.04) this.heat.add(heatLevel, ax + dx * hi, ay + dy * hi, ax + dx, ay + dy);
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
				const k = sim.intensity(i) * flicker;
				if (k > 0.04) {
					this.glow.add(Math.min(GLOW_LEVELS - 1, Math.floor(k * GLOW_LEVELS)), x1, y1, x2, y2);
				} else if (c > 0.6 && (state === RESTING || state === FALLING || beam.kind === 'sill')) {
					// Hot spots and dark spots that come and go.
					const pulse = 0.5 + 0.5 * Math.sin(time * 1.7 + i * 2.3);
					const smolder = embers * pulse * Math.sqrt(pulse) * (c >= 1 ? 0.5 : 0.85);
					if (smolder > 0.06) {
						this.ember.add(
							Math.min(GLOW_LEVELS - 1, Math.floor(smolder * GLOW_LEVELS)),
							x1,
							y1,
							x2,
							y2
						);
					}
				}
			}

			// Steel bolts where the posts meet the rails.
			if (beam.kind === 'post' && state === STANDING && c < 0.4) {
				this.bolts.add(0, ax, ay, ax + 0.01, ay);
				this.bolts.add(0, ax + dx, ay + dy, ax + dx + 0.01, ay + dy);
			}
		}
	}

	/** Unburnt timber from u0 to u1 along the beam: body, shaded side, lit side. */
	private wood(
		w: number,
		color: number,
		shade: number,
		lit: boolean,
		width: number,
		ax: number,
		ay: number,
		dx: number,
		dy: number,
		nx: number,
		ny: number,
		u0: number,
		u1: number
	) {
		const x1 = ax + dx * u0;
		const y1 = ay + dy * u0;
		const x2 = ax + dx * u1;
		const y2 = ay + dy * u1;
		this.base.add(w * COLORS + color, x1, y1, x2, y2);
		if (!lit) return;
		const off = width * 0.2;
		this.shadow.add(w, x1 - nx * off, y1 - ny * off, x2 - nx * off, y2 - ny * off);
		this.highlight.add(
			w * WOOD.length + shade,
			x1 + nx * off,
			y1 + ny * off,
			x2 + nx * off,
			y2 + ny * off
		);
	}

	private drawBeams() {
		const { ctx, widths } = this;
		const S = this.sim.structure.scale;
		this.outline.flush(ctx, (b) => {
			ctx.strokeStyle = OUTLINE;
			ctx.lineWidth = widths[b] + Math.max(1.2, 0.012 * S);
			return true;
		});
		this.base.flush(ctx, (b) => {
			ctx.strokeStyle = BASE_COLORS[b % COLORS];
			ctx.lineWidth = widths[Math.floor(b / COLORS)];
			return true;
		});
		this.shadow.flush(ctx, (b) => {
			ctx.strokeStyle = WOOD_SHADOW;
			ctx.lineWidth = widths[b] * 0.36;
			return true;
		});
		this.highlight.flush(ctx, (b) => {
			ctx.strokeStyle = WOOD_HI[b % WOOD.length];
			ctx.lineWidth = widths[Math.floor(b / WOOD.length)] * 0.3;
			return true;
		});
		this.grain.flush(ctx, (b) => {
			ctx.strokeStyle = GRAIN;
			ctx.lineWidth = Math.max(0.5, widths[b] * 0.14);
			return true;
		});
		const rail = widths[0];
		this.bolts.flush(ctx, () => {
			ctx.strokeStyle = BOLT;
			ctx.lineWidth = rail * 1.2;
			return true;
		});
		ctx.translate(-rail * 0.16, -rail * 0.18);
		this.bolts.flush(ctx, () => {
			ctx.strokeStyle = BOLT_HI;
			ctx.lineWidth = rail * 0.38;
			return true;
		});
		ctx.translate(rail * 0.16, rail * 0.18);
	}

	/** Additive light of the frame: heat, flames, smoldering debris, the rebuild's neon. */
	private drawBeamLight() {
		const { ctx } = this;
		const rail = this.widths[0];
		this.ember.flush(ctx, (b) => {
			ctx.strokeStyle = `rgba(230,40,12,${((b + 1) / GLOW_LEVELS) * 0.55})`;
			ctx.lineWidth = rail * 1.1;
			return true;
		});
		this.heat.flush(ctx, (b) => {
			ctx.strokeStyle = `rgba(255,62,16,${((b + 1) / GLOW_LEVELS) * 0.4})`;
			ctx.lineWidth = rail * 2.4;
			return true;
		});
		this.heat.flush(ctx, (b) => {
			ctx.strokeStyle = `rgba(255,140,50,${((b + 1) / GLOW_LEVELS) * 0.55})`;
			ctx.lineWidth = rail * 0.8;
			return true;
		});
		this.glow.flush(ctx, (b) => {
			ctx.strokeStyle = `rgba(255,70,12,${((b + 1) / GLOW_LEVELS) * 0.36})`;
			ctx.lineWidth = rail * 2.8;
			return true;
		});
		this.glow.flush(ctx, (b) => {
			ctx.strokeStyle = `rgba(255,176,70,${((b + 1) / GLOW_LEVELS) * 0.75})`;
			ctx.lineWidth = rail * 0.9;
			return true;
		});
		this.neon.flush(ctx, (b) => {
			const [r, g, bl] = HUE_RGB[Math.floor(b / NEON_LEVELS)];
			ctx.strokeStyle = `rgba(${r},${g},${bl},${(((b % NEON_LEVELS) + 1) / NEON_LEVELS) * 0.45})`;
			ctx.lineWidth = rail * 2;
			return true;
		});
		this.neon.flush(ctx, (b) => {
			ctx.strokeStyle = `rgba(255,255,255,${(((b % NEON_LEVELS) + 1) / NEON_LEVELS) * 0.45})`;
			ctx.lineWidth = rail * 0.6;
			return true;
		});
	}

	private drawFirelight() {
		const sim = this.sim;
		const S = sim.structure.scale;
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
		// Burning skins light up the night as well.
		for (const skin of this.skins) {
			const l = skin.letter.index;
			if (!sim.burnOrigins[l].length || this.gone[l]) continue;
			const k = 2.5 * S;
			sum += k;
			sx += (skin.letter.x + skin.letter.width / 2) * k;
			sy += (skin.letter.y + skin.letter.height / 2) * k;
		}
		if (sum <= 0) return;
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
			const hue = e.letter >= 0 ? this.skins[e.letter].hueStep : 0;
			if (e.kind === 'impact') {
				this.flash = 1;
				this.flashX = e.x;
				this.flashY = e.y;
				this.burst(e.x, e.y, 36, 1.6 * S);
			} else if (e.kind === 'ignite') {
				this.burst(e.x, e.y, 10, 0.7 * S);
			} else if (e.kind === 'magic') {
				this.magic = 1;
				this.magicX = e.x;
				this.magicY = e.y;
				this.magicHue = hue;
				for (let k = 0; k < 44; k++) {
					const a = Math.random() * TAU;
					const v = (0.4 + Math.random() * 1.1) * S;
					this.neonSparks.spawn(
						e.x,
						e.y,
						Math.cos(a) * v,
						Math.sin(a) * v - 0.3 * S,
						0.5 + Math.random() * 0.6,
						(0.025 + Math.random() * 0.035) * S,
						(Math.random() * HUE_STEPS) | 0
					);
				}
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
				for (let k = 0; k < 3; k++) {
					const a = Math.random() * TAU;
					const v = (0.3 + Math.random() * 0.5) * S;
					this.neonSparks.spawn(
						e.x,
						e.y,
						Math.cos(a) * v,
						Math.sin(a) * v - 0.2 * S,
						0.35 + Math.random() * 0.3,
						0.03 * S,
						hue
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
				const beam = sim.structure.beams[i];
				if (f > 0.05 && f < 0.95 && beam.letter >= 0 && Math.random() < 5 * dt * q) {
					const [px, py] = sim.pointAt(i, Math.random());
					this.neonSparks.spawn(
						px,
						py,
						(Math.random() - 0.5) * 0.3 * S,
						-(0.1 + Math.random() * 0.4) * S,
						0.35 + Math.random() * 0.5,
						(0.018 + Math.random() * 0.018) * S,
						this.skins[beam.letter].hueStep
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
						0.66 + Math.random() * 0.3
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

		for (const skin of this.skins) {
			const l = skin.letter.index;
			const origins = sim.burnOrigins[l];
			// Low flames, embers and smoke along a burning skin's front.
			if (origins.length && !this.gone[l]) {
				for (const o of origins) {
					const r = sim.frontRadius(o, SKIN_BURN_SPEED);
					if (r <= 0) continue;
					const shape = this.shapeOf(o);
					let expected = 70 * q * dt;
					while (expected > 0) {
						if (expected < 1 && Math.random() > expected) break;
						expected -= 1;
						const k = (Math.random() * FRONT_POINTS) | 0;
						const rr = r * shape[k] + (Math.random() - 0.3) * 0.03 * S;
						const x = o.x + FRONT_COS[k] * rr;
						const y = o.y + FRONT_SIN[k] * rr;
						if (!pointInLetter(skin.letter, x, y)) continue;
						if (origins.length > 1 && this.burnt(origins, o, x, y)) continue;
						this.flames.spawn(
							x,
							y,
							sim.wind * 0.2 + (Math.random() - 0.5) * 0.1 * S,
							-(0.25 + Math.random() * 0.35) * S,
							0.25 + Math.random() * 0.35,
							(0.04 + Math.random() * 0.05) * S,
							0.6 + Math.random() * 0.3
						);
						if (Math.random() < 0.12) {
							this.sparks.spawn(
								x,
								y,
								(Math.random() - 0.5) * 0.3 * S,
								-(0.2 + Math.random() * 0.6) * S,
								0.4 + Math.random() * 0.6,
								(0.01 + Math.random() * 0.012) * S,
								0
							);
						}
						if (Math.random() < 0.04) {
							this.smoke.spawn(
								x,
								y - 0.2 * S,
								sim.wind * 0.5,
								-(0.2 + Math.random() * 0.2) * S,
								1.6 + Math.random(),
								(0.14 + Math.random() * 0.1) * S,
								0
							);
						}
					}
				}
			}
			// Rainbow glitter where fresh paint spreads.
			const paint = this.paint[l];
			if (paint > 0 && paint < Infinity) {
				const o = sim.buildOrigin[l];
				let expected = 60 * q * dt;
				while (expected > 0) {
					if (expected < 1 && Math.random() > expected) break;
					expected -= 1;
					const a = Math.random() * TAU;
					const x = o.x + Math.cos(a) * paint;
					const y = o.y + Math.sin(a) * paint;
					if (!pointInLetter(skin.letter, x, y)) continue;
					this.neonSparks.spawn(
						x,
						y,
						(Math.random() - 0.5) * 0.2 * S,
						-(0.05 + Math.random() * 0.25) * S,
						0.35 + Math.random() * 0.4,
						(0.02 + Math.random() * 0.02) * S,
						(skin.hueStep + Math.round((Math.random() - 0.5) * 4) + HUE_STEPS) % HUE_STEPS
					);
				}
			}
		}

		for (const p of sim.projectiles) {
			if (!p.active || p.t <= 0) continue;
			if (p.kind === 'magic') {
				for (let k = 0; k < 4; k++) {
					this.neonSparks.spawn(
						p.x + (Math.random() - 0.5) * 0.06 * S,
						p.y + (Math.random() - 0.5) * 0.06 * S,
						-p.vx * 0.08 + (Math.random() - 0.5) * 0.3 * S,
						-p.vy * 0.08 + (Math.random() - 0.5) * 0.3 * S,
						0.45 + Math.random() * 0.5,
						(0.02 + Math.random() * 0.03) * S,
						(Math.random() * HUE_STEPS) | 0
					);
				}
				continue;
			}
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
		this.magic *= Math.exp(-dt * 5);
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

/** Farthest outline point from (x, y). */
function reach(outline: Float32Array, x: number, y: number): number {
	let best = 0;
	for (let k = 0; k < outline.length; k += 2) {
		best = Math.max(best, Math.hypot(outline[k] - x, outline[k + 1] - y));
	}
	return best;
}
