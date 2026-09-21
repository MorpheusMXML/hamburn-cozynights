/**
 * Leave No Trace (/random-bed): a spot card swept away by a little dust devil.
 *
 * The card's area turns into glitter, left edge first, as the whirlwind
 * crosses it: every speck is caught by the swirl, rises and fades, and
 * nothing stays behind. `GlitterSim` is the whole effect as a deterministic
 * simulation (seeded random source, preallocated typed arrays, no
 * allocations while it runs); `createGlitterSweep` draws it on a 2D canvas
 * over the viewport and stops its loop when the last speck is gone.
 */
import { mulberry32 } from './fireworks';

export interface SweepRect {
	left: number;
	top: number;
	width: number;
	height: number;
}

/** How long the whirlwind needs to cross the card, in seconds. */
export const SWEEP_TIME = 0.45;
/** No speck lives longer than this after the sweep reached it, in seconds. */
export const MAX_LIFE = 1.4;
/** The whole effect is over by then, whatever happens, in seconds. */
export const SWEEP_HARD_STOP = SWEEP_TIME + 0.12 + MAX_LIFE;

export const MIN_SPECKS = 160;
export const MAX_SPECKS = 420;

/** Glitter in the app's neon colours, plus white-hot and playa gold. */
const PALETTE = ['#2dd4bf', '#f472b6', '#fde68a', '#ffffff', '#a855f7', '#fb923c'];

/** The funnel seen from the side: its orbits are ellipses this flat. */
const FLAT = 0.5;

export class GlitterSim {
	readonly count: number;
	/** Position (px) */
	readonly x: Float32Array;
	readonly y: Float32Array;
	/** When the whirlwind reaches the speck, and how long it lives after that (s). */
	private start: Float32Array;
	private life: Float32Array;
	/** Its orbit around the eye, fixed when it is caught: radius, angle, turn rate. */
	private radius: Float32Array;
	private angle: Float32Array;
	private turn: Float32Array;
	private caught: Uint8Array;
	readonly size: Float32Array;
	readonly color: Uint8Array;
	private phase: Float32Array;
	/** Current opacity of each speck, 0 while it waits or after it faded. */
	readonly alpha: Float32Array;
	time = 0;

	constructor(
		readonly rect: SweepRect,
		rand: () => number = Math.random
	) {
		const area = Math.max(1, rect.width * rect.height);
		this.count = Math.round(Math.min(MAX_SPECKS, Math.max(MIN_SPECKS, area / 90)));
		const n = this.count;
		this.x = new Float32Array(n);
		this.y = new Float32Array(n);
		this.start = new Float32Array(n);
		this.life = new Float32Array(n);
		this.radius = new Float32Array(n);
		this.angle = new Float32Array(n);
		this.turn = new Float32Array(n);
		this.caught = new Uint8Array(n);
		this.size = new Float32Array(n);
		this.color = new Uint8Array(n);
		this.phase = new Float32Array(n);
		this.alpha = new Float32Array(n);
		for (let i = 0; i < n; i++) {
			const u = rand();
			this.x[i] = rect.left + u * rect.width;
			this.y[i] = rect.top + rand() * rect.height;
			// the left edge goes first: the whirlwind crosses the card
			this.start[i] = u * SWEEP_TIME + rand() * 0.12;
			this.life[i] = 0.7 + rand() * (MAX_LIFE - 0.7);
			this.turn[i] = 8 + rand() * 5;
			this.size[i] = 1 + rand() * 2.2;
			this.color[i] = Math.floor(rand() * PALETTE.length);
			this.phase[i] = rand() * Math.PI * 2;
		}
	}

	/** The eye of the whirlwind at time t: it crosses most of the card, then rises. */
	eye(t: number): [number, number] {
		const { left, top, width, height } = this.rect;
		const across = Math.min(1, t / SWEEP_TIME);
		const after = Math.max(0, t - SWEEP_TIME);
		return [left + width * (0.1 + 0.52 * across) + after * 12, top + height / 2 - after * 70];
	}

	/** Advances the effect by `dt` seconds. */
	step(dt: number): void {
		this.time += dt;
		const t = this.time;
		const [ex, ey] = this.eye(t);
		for (let i = 0; i < this.count; i++) {
			const age = t - this.start[i];
			if (age < 0) continue;
			const life = this.life[i];
			if (age > life) {
				this.alpha[i] = 0;
				continue;
			}
			if (!this.caught[i]) {
				// Caught where it is: its orbit starts at its place on the card.
				const [cx, cy] = this.eye(this.start[i]);
				const dx = this.x[i] - cx;
				const dy = (this.y[i] - cy) / FLAT;
				this.radius[i] = Math.hypot(dx, dy);
				this.angle[i] = Math.atan2(dy, dx);
				this.caught[i] = 1;
			}
			// Pulled in first, then the funnel widens as it rises; the updraft grows,
			// so the specks circle the card a moment before they are carried off.
			const r = this.radius[i] * (1 - 0.45 * Math.min(1, age / 0.3)) + 40 * age;
			const a = this.angle[i] + this.turn[i] * age;
			const rise = 25 * age + 90 * age * age;
			this.x[i] = ex + r * Math.cos(a);
			this.y[i] = ey - rise + r * Math.sin(a) * FLAT;
			const fade = age / life;
			const twinkle = 0.65 + 0.35 * Math.sin(this.phase[i] + age * 22);
			this.alpha[i] = (fade < 0.6 ? 1 : 1 - (fade - 0.6) / 0.4) * twinkle;
		}
	}

	/** True while a speck waits or still glows. */
	get alive(): boolean {
		if (this.time >= SWEEP_HARD_STOP) return false;
		for (let i = 0; i < this.count; i++) {
			if (this.time < this.start[i] + this.life[i]) return true;
		}
		return false;
	}

	static palette(index: number): string {
		return PALETTE[index % PALETTE.length];
	}
}

const PALETTE_SIZE = PALETTE.length;

export interface GlitterSweep {
	destroy(): void;
}

/**
 * Plays the sweep over `rect` (viewport px) on a full-viewport canvas and
 * calls `onDone` when the last speck is gone. Without a 2D context nothing
 * plays and `onDone` follows at once.
 */
export function createGlitterSweep(
	canvas: HTMLCanvasElement,
	rect: SweepRect,
	{ onDone, seed }: { onDone?: () => void; seed?: number } = {}
): GlitterSweep {
	const g = canvas.getContext('2d');
	if (!g) {
		const skip = setTimeout(() => onDone?.(), 0);
		return { destroy: () => clearTimeout(skip) };
	}
	const dpr = Math.min(2, window.devicePixelRatio || 1);
	const width = window.innerWidth;
	const height = window.innerHeight;
	canvas.width = Math.round(width * dpr);
	canvas.height = Math.round(height * dpr);
	g.setTransform(dpr, 0, 0, dpr, 0, 0);
	const sim = new GlitterSim(rect, seed === undefined ? Math.random : mulberry32(seed));
	// One soft glowing dot per colour, drawn once; every speck is a copy of one.
	const sprites = Array.from({ length: PALETTE_SIZE }, (_, i) => {
		const sprite = document.createElement('canvas');
		sprite.width = sprite.height = 32;
		const s = sprite.getContext('2d')!;
		const glow = s.createRadialGradient(16, 16, 0, 16, 16, 16);
		glow.addColorStop(0, '#ffffff');
		glow.addColorStop(0.22, GlitterSim.palette(i));
		glow.addColorStop(1, 'rgba(0, 0, 0, 0)');
		s.fillStyle = glow;
		s.fillRect(0, 0, 32, 32);
		return sprite;
	});
	let frame = 0;
	let last = 0;
	let finished = false;

	function draw(now: number) {
		const dt = last ? Math.min(0.05, (now - last) / 1000) : 1 / 60;
		last = now;
		sim.step(dt);
		g!.clearRect(0, 0, width, height);
		g!.globalCompositeOperation = 'lighter';
		for (let i = 0; i < sim.count; i++) {
			const a = sim.alpha[i];
			if (a <= 0.01) continue;
			const s = sim.size[i] * 5;
			g!.globalAlpha = a;
			g!.drawImage(sprites[sim.color[i]], sim.x[i] - s / 2, sim.y[i] - s / 2, s, s);
		}
		if (sim.alive) {
			frame = requestAnimationFrame(draw);
		} else {
			g!.clearRect(0, 0, width, height);
			finished = true;
			onDone?.();
		}
	}
	frame = requestAnimationFrame(draw);

	return {
		destroy() {
			cancelAnimationFrame(frame);
			if (!finished) g.clearRect(0, 0, width, height);
		}
	};
}
