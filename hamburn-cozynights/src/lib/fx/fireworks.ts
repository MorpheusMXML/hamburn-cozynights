/**
 * Booking fireworks: the reward for grabbing a spot.
 *
 * A volley of neon rockets rises, from the booked spot's card when it is on
 * screen, and every rocket bursts the way the cursor's click burst does: a
 * shockwave ring, a flash and embers that sweep the rainbow. The finale is one
 * big fire rocket that blooms in the colours of the burning effigy title: a
 * white-hot core, orange, deep red, crackling glitter and slow embers that
 * drift up while they fade.
 *
 * `FireworksSim` is the whole show as a deterministic simulation: a seeded
 * random source, a simulated clock and preallocated typed arrays (no
 * allocations while it runs). It writes its geometry into a vertex buffer that
 * `createFireworks` draws with one WebGL draw call per frame on a
 * full-viewport canvas, the same way the cursor trail draws. The loop stops
 * the moment the sky is dark again.
 */

export interface Point {
	x: number;
	y: number;
}

/** One rocket of the plan. Times are seconds of simulated show time. */
export interface Launch {
	t: number;
	kind: 'neon' | 'fire';
	/** 1 is a rocket of the volley; the finale is bigger. */
	size: number;
	x: number;
	y: number;
	/** Height the rocket bursts at. */
	targetY: number;
	/** Sideways travel until the burst, in px. */
	drift: number;
	/** Flight time in seconds. */
	fuse: number;
	/** Hue of a neon rocket (0..1, wraps). */
	hue: number;
}

/** Floats per vertex: pos(2) uv(2) tint(1) alpha(1) kind(1). */
export const VERTEX_SIZE = 7;
export const MAX_VERTS = 12000;
export const PARTICLE_CAP = 1500;
export const ROCKET_CAP = 12;
/** Rockets of the volley before the finale. */
export const VOLLEY_SIZE = 9;
/** Seconds between two rockets of the volley. */
export const VOLLEY_SPACING = 0.34;
/** Launch of the finale rocket, seconds after the show starts. */
export const FINALE_AT = 3.35;
/** The show is over by then, whatever is still glowing. */
export const SHOW_HARD_STOP = 8;
/** A rocket that starts at the card needs this much sky above it. */
export const MIN_RISE = 150;

/** How many rockets of the volley start at the booked card. */
const ORIGIN_ROCKETS = 3;
const RING_CAP = 12;
const FLASH_CAP = 12;
const CRACKLE_CAP = 4;
/** Tail samples kept per rocket. */
const TAIL_CAP = 24;
/** Seconds a tail sample stays visible. */
const TAIL_LIFE = 0.26;
/** Min distance in px between tail samples. */
const TAIL_MIN_DIST = 3;
/** Core half-width of a tail at the rocket, in px. */
const TAIL_WIDTH = 3.6;
/** Geometry half-width = core * GLOW_SPREAD (the rest is glow falloff). */
const GLOW_SPREAD = 3.2;
const RING_LIFE = 0.55;
/** Rocket drag per second: shoot fast, hang near the top. */
const ROCKET_DRAG = 2.4;
/** Hue drift per second, the cursor trail's pace. */
const HUE_SPEED = 0.12;
/** Warm hues for the finale's ring and flash. */
const FIRE_HUE = 0.07;

const KIND_EMBER = 0;
const KIND_RING = 1;
const KIND_FLASH = 2;
const KIND_RIBBON = 3;
const KIND_FIRE = 4;

const VERT_SRC = `
attribute vec2 a_pos;
attribute vec2 a_uv;
attribute float a_tint;
attribute float a_alpha;
attribute float a_kind;
uniform vec2 u_res;
varying vec2 v_uv;
varying float v_tint;
varying float v_alpha;
varying float v_kind;
void main() {
	v_uv = a_uv;
	v_tint = a_tint;
	v_alpha = a_alpha;
	v_kind = a_kind;
	vec2 clip = a_pos / u_res * 2.0 - 1.0;
	gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
}`;

const FRAG_SRC = `
precision mediump float;
varying vec2 v_uv;
varying float v_tint;
varying float v_alpha;
varying float v_kind;

// The cursor trail's neon palette.
vec3 neon(float h) {
	vec3 k = clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
	return mix(k, vec3(1.0), 0.12);
}

// The effigy's fire: deep red when cold, orange, then near white when hot.
vec3 fire(float heat) {
	vec3 c = mix(vec3(0.55, 0.06, 0.0), vec3(1.0, 0.42, 0.06), smoothstep(0.0, 0.55, heat));
	return mix(c, vec3(1.0, 0.93, 0.78), smoothstep(0.55, 1.0, heat));
}

void main() {
	float r = length(v_uv);
	vec3 col;
	if (v_kind < 0.5) {
		// Neon ember: white-hot core, coloured glow.
		col = neon(v_tint) * exp(-r * r * 6.0) + vec3(smoothstep(0.28, 0.0, r) * 0.9);
	} else if (v_kind < 1.5) {
		// Shockwave ring.
		float band = (r - 0.8) * 12.0;
		float ring = exp(-band * band);
		col = neon(v_tint) * ring * 1.2 + vec3(ring * ring * 0.35);
	} else if (v_kind < 2.5) {
		// The flash of a burst.
		col = neon(v_tint) * exp(-r * r * 3.5);
	} else if (v_kind < 3.5) {
		// Rocket tail: uv.y is the signed distance across the strip.
		float s = abs(v_uv.y);
		float body = smoothstep(0.42, 0.12, s);
		float glow = exp(-s * s * 5.0);
		float core = smoothstep(0.14, 0.0, s);
		col = neon(v_tint) * (body * 0.85 + glow * 0.5) + vec3(core * 0.65);
	} else {
		// Fire ember: the tint is its heat.
		col = fire(v_tint) * exp(-r * r * 5.0)
			+ vec3(1.0, 0.96, 0.85) * smoothstep(0.22, 0.0, r) * v_tint * 0.9;
	}
	col *= v_alpha;
	// Premultiplied output; alpha tracks brightness so it composites like
	// "screen" over the page instead of darkening it.
	float a = clamp(max(col.r, max(col.g, col.b)), 0.0, 1.0);
	gl_FragColor = vec4(min(col, vec3(a)), a);
}`;

function clamp(v: number, lo: number, hi: number): number {
	return v < lo ? lo : v > hi ? hi : v;
}

/** Small seeded random source, for reproducible shows (and tests). */
export function mulberry32(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/**
 * Plan the show for a viewport of `width` × `height` CSS px. With an `origin`
 * on screen (the booked card) that has enough sky above it, the first rockets
 * of the volley and the finale rise from there; everything else comes from
 * below the bottom edge.
 */
export function planShow(
	width: number,
	height: number,
	origin: Point | null,
	rand: () => number
): Launch[] {
	const fromCard =
		!!origin &&
		origin.x >= 0 &&
		origin.x <= width &&
		origin.y <= height &&
		origin.y - MIN_RISE >= 40;

	const plan = (t: number, kind: Launch['kind'], size: number, atCard: boolean): Launch => {
		let x: number;
		let y: number;
		let drift: number;
		if (atCard && origin) {
			x = clamp(origin.x + (rand() - 0.5) * 40, 8, width - 8);
			y = origin.y;
			drift = (rand() - 0.5) * 220;
		} else if (kind === 'fire') {
			x = width * (0.4 + rand() * 0.2);
			y = height + 8;
			drift = (rand() - 0.5) * 60;
		} else {
			x = width * (0.12 + rand() * 0.76);
			y = height + 8;
			drift = (rand() - 0.5) * 80;
		}
		// The finale is the climax: it heads for the middle of the screen.
		if (kind === 'fire') drift = (width / 2 - x) * 0.7 + (rand() - 0.5) * 60;
		drift = clamp(drift, 20 - x, width - 20 - x);
		const top = kind === 'fire' ? height * (0.26 + rand() * 0.1) : height * (0.12 + rand() * 0.34);
		const targetY = clamp(top, 40, Math.max(40, y - MIN_RISE));
		const fuse = kind === 'fire' ? 1 : 0.78 + rand() * 0.3;
		return { t, kind, size, x, y, targetY, drift, fuse, hue: rand() };
	};

	const launches: Launch[] = [];
	for (let i = 0; i < VOLLEY_SIZE; i++) {
		const t = 0.05 + i * VOLLEY_SPACING + (rand() - 0.5) * 0.12;
		launches.push(plan(t, 'neon', 0.85 + rand() * 0.4, fromCard && i < ORIGIN_ROCKETS));
	}
	launches.push(plan(FINALE_AT, 'fire', 2.2, fromCard));
	launches.sort((a, b) => a.t - b.t);
	return launches;
}

/**
 * Share of the way a rocket has come after `age` seconds of a `fuse`-second
 * flight: fast off the ground, slow near the top.
 */
export function rocketProgress(age: number, fuse: number): number {
	const a = clamp(age, 0, fuse);
	return (1 - Math.exp(-ROCKET_DRAG * a)) / (1 - Math.exp(-ROCKET_DRAG * fuse));
}

function vtx(
	out: Float32Array,
	o: number,
	x: number,
	y: number,
	u: number,
	v: number,
	tint: number,
	alpha: number,
	kind: number
): number {
	out[o] = x;
	out[o + 1] = y;
	out[o + 2] = u;
	out[o + 3] = v;
	out[o + 4] = tint;
	out[o + 5] = alpha;
	out[o + 6] = kind;
	return o + VERTEX_SIZE;
}

/** Axis-aligned quad centered at (x, y) with uv in [-1, 1]. */
function quad(
	out: Float32Array,
	o: number,
	x: number,
	y: number,
	half: number,
	tint: number,
	alpha: number,
	kind: number
): number {
	if (o + 6 * VERTEX_SIZE > out.length) return o;
	const x0 = x - half,
		x1 = x + half,
		y0 = y - half,
		y1 = y + half;
	o = vtx(out, o, x0, y0, -1, -1, tint, alpha, kind);
	o = vtx(out, o, x1, y0, 1, -1, tint, alpha, kind);
	o = vtx(out, o, x0, y1, -1, 1, tint, alpha, kind);
	o = vtx(out, o, x1, y0, 1, -1, tint, alpha, kind);
	o = vtx(out, o, x1, y1, 1, 1, tint, alpha, kind);
	o = vtx(out, o, x0, y1, -1, 1, tint, alpha, kind);
	return o;
}

// Scratch buffers for one rocket tail (oldest sample first, the rocket last).
const sx = new Float32Array(TAIL_CAP + 1);
const sy = new Float32Array(TAIL_CAP + 1);
const sAge = new Float32Array(TAIL_CAP + 1);

/** Append the strip for the `n` scratch samples to `out`; returns the new offset. */
function emitStrip(
	n: number,
	out: Float32Array,
	offset: number,
	headWidth: number,
	hueBase: number,
	hueRate: number
): number {
	let nx = 0;
	let ny = 1;
	let prevLx = 0,
		prevLy = 0,
		prevRx = 0,
		prevRy = 0,
		prevHue = 0,
		prevAlpha = 0;
	for (let i = 0; i < n; i++) {
		const ip = i > 0 ? i - 1 : i;
		const inext = i < n - 1 ? i + 1 : i;
		const tx = sx[inext] - sx[ip];
		const ty = sy[inext] - sy[ip];
		const tl = Math.hypot(tx, ty);
		if (tl > 1e-4) {
			nx = -ty / tl;
			ny = tx / tl;
		}
		const fade = 1 - clamp(sAge[i] / TAIL_LIFE, 0, 1);
		const w = headWidth * GLOW_SPREAD * Math.pow(fade, 1.3);
		const lx = sx[i] + nx * w;
		const ly = sy[i] + ny * w;
		const rx = sx[i] - nx * w;
		const ry = sy[i] - ny * w;
		const hue = hueBase + sAge[i] * hueRate;
		const alpha = Math.min(1, fade * 1.6);
		if (i > 0) {
			if (offset + 6 * VERTEX_SIZE > out.length) return offset;
			offset = vtx(out, offset, prevLx, prevLy, 0, 1, prevHue, prevAlpha, KIND_RIBBON);
			offset = vtx(out, offset, prevRx, prevRy, 0, -1, prevHue, prevAlpha, KIND_RIBBON);
			offset = vtx(out, offset, lx, ly, 0, 1, hue, alpha, KIND_RIBBON);
			offset = vtx(out, offset, prevRx, prevRy, 0, -1, prevHue, prevAlpha, KIND_RIBBON);
			offset = vtx(out, offset, rx, ry, 0, -1, hue, alpha, KIND_RIBBON);
			offset = vtx(out, offset, lx, ly, 0, 1, hue, alpha, KIND_RIBBON);
		}
		prevLx = lx;
		prevLy = ly;
		prevRx = rx;
		prevRy = ry;
		prevHue = hue;
		prevAlpha = alpha;
	}
	return offset;
}

/**
 * The show itself, without a canvas. `step` advances the simulated clock,
 * `emit` writes the current frame's geometry. Deterministic for a given
 * viewport, origin and random source.
 */
export class FireworksSim {
	readonly launches: Launch[];
	/** Simulated seconds since the show began. */
	time = 0;
	/** The big one has burst. */
	finaleFired = false;

	private next = 0;
	private readonly rand: () => number;
	/** Bursts are sized for a desktop; phones get them a little smaller. */
	private readonly scale: number;

	// Rockets in flight. A slot is in use while rLaunch[i] is set.
	private readonly rLaunch: (Launch | null)[] = new Array(ROCKET_CAP).fill(null);
	private readonly rX = new Float32Array(ROCKET_CAP);
	private readonly rY = new Float32Array(ROCKET_CAP);
	private readonly rSpark = new Float32Array(ROCKET_CAP);
	private rocketCount = 0;

	// Each rocket's tail: a ring of its recent positions.
	private readonly tX = new Float32Array(ROCKET_CAP * TAIL_CAP);
	private readonly tY = new Float32Array(ROCKET_CAP * TAIL_CAP);
	private readonly tT = new Float32Array(ROCKET_CAP * TAIL_CAP);
	private readonly tHead = new Uint8Array(ROCKET_CAP);
	private readonly tCount = new Uint8Array(ROCKET_CAP);

	// Embers, sparks and glitter (structure of arrays).
	private readonly pX = new Float32Array(PARTICLE_CAP);
	private readonly pY = new Float32Array(PARTICLE_CAP);
	private readonly pVx = new Float32Array(PARTICLE_CAP);
	private readonly pVy = new Float32Array(PARTICLE_CAP);
	private readonly pLife = new Float32Array(PARTICLE_CAP);
	private readonly pMax = new Float32Array(PARTICLE_CAP);
	private readonly pSize = new Float32Array(PARTICLE_CAP);
	/** Hue of a neon ember, heat of a fire ember. */
	private readonly pTint = new Float32Array(PARTICLE_CAP);
	private readonly pGrav = new Float32Array(PARTICLE_CAP);
	private readonly pDrag = new Float32Array(PARTICLE_CAP);
	private readonly pKind = new Uint8Array(PARTICLE_CAP);
	private particleCount = 0;

	// Shockwave rings.
	private readonly ringX = new Float32Array(RING_CAP);
	private readonly ringY = new Float32Array(RING_CAP);
	private readonly ringBorn = new Float32Array(RING_CAP);
	private readonly ringSize = new Float32Array(RING_CAP);
	private readonly ringHue = new Float32Array(RING_CAP);
	private ringCount = 0;

	// The flash of a burst.
	private readonly fX = new Float32Array(FLASH_CAP);
	private readonly fY = new Float32Array(FLASH_CAP);
	private readonly fBorn = new Float32Array(FLASH_CAP);
	private readonly fLife = new Float32Array(FLASH_CAP);
	private readonly fRadius = new Float32Array(FLASH_CAP);
	private readonly fStrength = new Float32Array(FLASH_CAP);
	private readonly fHue = new Float32Array(FLASH_CAP);
	private flashCount = 0;

	// Glitter that pops around the finale a moment after the burst.
	private readonly cX = new Float32Array(CRACKLE_CAP);
	private readonly cY = new Float32Array(CRACKLE_CAP);
	private readonly cAt = new Float32Array(CRACKLE_CAP);
	private readonly cRadius = new Float32Array(CRACKLE_CAP);
	private crackleCount = 0;

	constructor(
		width: number,
		height: number,
		origin: Point | null = null,
		rand: () => number = Math.random
	) {
		this.rand = rand;
		this.scale = clamp(Math.min(width, height) / 800, 0.6, 1.1);
		this.launches = planShow(width, height, origin, rand);
	}

	/** Every rocket has flown and nothing glows any more (or the hard stop hit). */
	get done(): boolean {
		return (
			this.time >= SHOW_HARD_STOP ||
			(this.next >= this.launches.length &&
				this.rocketCount === 0 &&
				this.particleCount === 0 &&
				this.ringCount === 0 &&
				this.flashCount === 0 &&
				this.crackleCount === 0)
		);
	}

	get stats() {
		return {
			rockets: this.rocketCount,
			particles: this.particleCount,
			rings: this.ringCount,
			flashes: this.flashCount
		};
	}

	/** Advance the show by `dt` seconds. Returns true when the finale burst this step. */
	step(dt: number): boolean {
		this.time += dt;
		const now = this.time;
		let finale = false;

		while (this.next < this.launches.length && this.launches[this.next].t <= now) {
			this.launch(this.launches[this.next++]);
		}

		for (let i = 0; i < ROCKET_CAP; i++) {
			const l = this.rLaunch[i];
			if (!l) continue;
			const age = now - l.t;
			if (age >= l.fuse) {
				const x = l.x + l.drift;
				if (l.kind === 'fire') {
					this.burstFire(x, l.targetY, l.size);
					this.finaleFired = true;
					finale = true;
				} else {
					this.burstNeon(x, l.targetY, l.hue + now * HUE_SPEED, l.size);
				}
				this.rLaunch[i] = null;
				this.rocketCount--;
				continue;
			}
			const p = rocketProgress(age, l.fuse);
			const x = l.x + l.drift * p;
			const y = l.y + (l.targetY - l.y) * p;
			this.rX[i] = x;
			this.rY[i] = y;
			this.pushTail(i, x, y, now);
			this.rocketSparks(i, l, x, y, dt);
		}

		for (let i = 0; i < this.crackleCount;) {
			if (this.cAt[i] <= now) {
				this.crackle(this.cX[i], this.cY[i], this.cRadius[i]);
				const j = --this.crackleCount;
				this.cX[i] = this.cX[j];
				this.cY[i] = this.cY[j];
				this.cAt[i] = this.cAt[j];
				this.cRadius[i] = this.cRadius[j];
				continue;
			}
			i++;
		}

		// Integrate particles (swap-remove dead ones).
		for (let i = 0; i < this.particleCount;) {
			this.pLife[i] -= dt;
			if (this.pLife[i] <= 0) {
				const j = --this.particleCount;
				this.pX[i] = this.pX[j];
				this.pY[i] = this.pY[j];
				this.pVx[i] = this.pVx[j];
				this.pVy[i] = this.pVy[j];
				this.pLife[i] = this.pLife[j];
				this.pMax[i] = this.pMax[j];
				this.pSize[i] = this.pSize[j];
				this.pTint[i] = this.pTint[j];
				this.pGrav[i] = this.pGrav[j];
				this.pDrag[i] = this.pDrag[j];
				this.pKind[i] = this.pKind[j];
				continue;
			}
			const k = Math.exp(-this.pDrag[i] * dt);
			this.pVx[i] *= k;
			this.pVy[i] = this.pVy[i] * k + this.pGrav[i] * dt;
			this.pX[i] += this.pVx[i] * dt;
			this.pY[i] += this.pVy[i] * dt;
			i++;
		}

		for (let i = 0; i < this.ringCount;) {
			if (now - this.ringBorn[i] >= RING_LIFE) {
				const j = --this.ringCount;
				this.ringX[i] = this.ringX[j];
				this.ringY[i] = this.ringY[j];
				this.ringBorn[i] = this.ringBorn[j];
				this.ringSize[i] = this.ringSize[j];
				this.ringHue[i] = this.ringHue[j];
				continue;
			}
			i++;
		}

		for (let i = 0; i < this.flashCount;) {
			if (now - this.fBorn[i] >= this.fLife[i]) {
				const j = --this.flashCount;
				this.fX[i] = this.fX[j];
				this.fY[i] = this.fY[j];
				this.fBorn[i] = this.fBorn[j];
				this.fLife[i] = this.fLife[j];
				this.fRadius[i] = this.fRadius[j];
				this.fStrength[i] = this.fStrength[j];
				this.fHue[i] = this.fHue[j];
				continue;
			}
			i++;
		}

		return finale;
	}

	/** Write the frame's geometry to `out`; returns the number of floats written. */
	emit(out: Float32Array): number {
		let o = 0;
		const now = this.time;

		// Flashes (back) → rings → rocket tails and heads → embers (front).
		for (let i = 0; i < this.flashCount; i++) {
			const k = (now - this.fBorn[i]) / this.fLife[i];
			const fade = (1 - k) * (1 - k);
			o = quad(
				out,
				o,
				this.fX[i],
				this.fY[i],
				this.fRadius[i] * (0.7 + 0.3 * k),
				this.fHue[i],
				this.fStrength[i] * fade,
				KIND_FLASH
			);
		}
		for (let i = 0; i < this.ringCount; i++) {
			const k = (now - this.ringBorn[i]) / RING_LIFE;
			const ease = 1 - Math.pow(1 - k, 3);
			const radius = (10 + 95 * this.ringSize[i] * this.scale) * ease;
			o = quad(
				out,
				o,
				this.ringX[i],
				this.ringY[i],
				radius / 0.8,
				this.ringHue[i],
				(1 - k) * (1 - k),
				KIND_RING
			);
		}
		for (let i = 0; i < ROCKET_CAP; i++) {
			const l = this.rLaunch[i];
			if (!l) continue;
			const fire = l.kind === 'fire';
			const grow = Math.sqrt(l.size);
			const hue = fire ? FIRE_HUE + 0.015 : l.hue + now * HUE_SPEED;
			o = this.emitTail(i, now, out, o, TAIL_WIDTH * grow, hue, fire ? 0.1 : 1.2);
			if (fire) o = quad(out, o, this.rX[i], this.rY[i], 18 * grow, 1, 1, KIND_FIRE);
			else o = quad(out, o, this.rX[i], this.rY[i], 14 * grow, hue, 1, KIND_EMBER);
		}
		for (let i = 0; i < this.particleCount; i++) {
			const lifeT = this.pLife[i] / this.pMax[i];
			const flicker = 0.75 + 0.25 * Math.sin(now * 30 + i * 1.7);
			const half = this.pSize[i] * 4;
			if (this.pKind[i] === KIND_FIRE) {
				const heat = Math.pow(lifeT, 0.6) * this.pTint[i];
				const alpha = Math.pow(lifeT, 1.1) * flicker;
				o = quad(out, o, this.pX[i], this.pY[i], half, heat, alpha, KIND_FIRE);
			} else {
				o = quad(
					out,
					o,
					this.pX[i],
					this.pY[i],
					half,
					this.pTint[i],
					lifeT * lifeT * flicker,
					KIND_EMBER
				);
			}
		}
		return o;
	}

	private launch(l: Launch) {
		let slot = -1;
		for (let i = 0; i < ROCKET_CAP; i++) {
			if (!this.rLaunch[i]) {
				slot = i;
				break;
			}
		}
		if (slot < 0) return;
		this.rLaunch[slot] = l;
		this.rX[slot] = l.x;
		this.rY[slot] = l.y;
		this.rSpark[slot] = 0;
		this.tHead[slot] = 0;
		this.tCount[slot] = 0;
		this.rocketCount++;
	}

	private pushTail(i: number, x: number, y: number, now: number) {
		const base = i * TAIL_CAP;
		while (this.tCount[i] > 0) {
			const oldest = base + ((this.tHead[i] - this.tCount[i] + TAIL_CAP) % TAIL_CAP);
			if (now - this.tT[oldest] <= TAIL_LIFE) break;
			this.tCount[i]--;
		}
		if (this.tCount[i] > 0) {
			const last = base + ((this.tHead[i] - 1 + TAIL_CAP) % TAIL_CAP);
			const dx = x - this.tX[last];
			const dy = y - this.tY[last];
			if (dx * dx + dy * dy < TAIL_MIN_DIST * TAIL_MIN_DIST) return;
		}
		const at = base + this.tHead[i];
		this.tX[at] = x;
		this.tY[at] = y;
		this.tT[at] = now;
		this.tHead[i] = (this.tHead[i] + 1) % TAIL_CAP;
		if (this.tCount[i] < TAIL_CAP) this.tCount[i]++;
	}

	private emitTail(
		i: number,
		now: number,
		out: Float32Array,
		o: number,
		headWidth: number,
		hueBase: number,
		hueRate: number
	): number {
		const count = this.tCount[i];
		if (count < 1) return o;
		const base = i * TAIL_CAP;
		let n = 0;
		for (let j = 0; j < count; j++) {
			const at = base + ((this.tHead[i] - count + j + TAIL_CAP) % TAIL_CAP);
			sx[n] = this.tX[at];
			sy[n] = this.tY[at];
			sAge[n] = now - this.tT[at];
			n++;
		}
		// The rocket itself is the head of the strip.
		sx[n] = this.rX[i];
		sy[n] = this.rY[i];
		sAge[n] = 0;
		n++;
		return emitStrip(n, out, o, headWidth, hueBase, hueRate);
	}

	/** Sparks that trail behind a rocket. */
	private rocketSparks(i: number, l: Launch, x: number, y: number, dt: number) {
		const rate = l.kind === 'fire' ? 130 : 70;
		this.rSpark[i] += dt * rate;
		const n = Math.floor(this.rSpark[i]);
		this.rSpark[i] -= n;
		const r = this.rand;
		for (let k = 0; k < n; k++) {
			const jx = x + (r() - 0.5) * 6;
			const jy = y + (r() - 0.5) * 6;
			if (l.kind === 'fire') {
				this.spawn(
					jx,
					jy,
					(r() - 0.5) * 70,
					40 + r() * 70,
					0.3 + r() * 0.35,
					1.3 + r() * 1.1,
					0.9,
					KIND_FIRE,
					60,
					3
				);
			} else {
				const hue = l.hue + this.time * HUE_SPEED + r() * 0.12;
				this.spawn(
					jx,
					jy,
					(r() - 0.5) * 60,
					30 + r() * 50,
					0.22 + r() * 0.3,
					1.1 + r() * 0.9,
					hue,
					KIND_EMBER,
					90,
					3
				);
			}
		}
	}

	private spawn(
		x: number,
		y: number,
		vx: number,
		vy: number,
		life: number,
		size: number,
		tint: number,
		kind: number,
		grav: number,
		drag: number
	) {
		if (this.particleCount >= PARTICLE_CAP) return;
		const i = this.particleCount++;
		this.pX[i] = x;
		this.pY[i] = y;
		this.pVx[i] = vx;
		this.pVy[i] = vy;
		this.pLife[i] = life;
		this.pMax[i] = life;
		this.pSize[i] = size;
		this.pTint[i] = tint;
		this.pGrav[i] = grav;
		this.pDrag[i] = drag;
		this.pKind[i] = kind;
	}

	private ring(x: number, y: number, size: number, hue: number) {
		if (this.ringCount >= RING_CAP) return;
		const i = this.ringCount++;
		this.ringX[i] = x;
		this.ringY[i] = y;
		this.ringBorn[i] = this.time;
		this.ringSize[i] = size;
		this.ringHue[i] = hue;
	}

	private flash(x: number, y: number, radius: number, life: number, strength: number, hue: number) {
		if (this.flashCount >= FLASH_CAP) return;
		const i = this.flashCount++;
		this.fX[i] = x;
		this.fY[i] = y;
		this.fBorn[i] = this.time;
		this.fLife[i] = life;
		this.fRadius[i] = radius;
		this.fStrength[i] = strength;
		this.fHue[i] = hue;
	}

	/** The cursor's click burst, scaled up: ring, flash and a rainbow sweep of embers. */
	private burstNeon(x: number, y: number, hue: number, size: number) {
		this.ring(x, y, size, hue);
		this.flash(x, y, 120 * size * this.scale, 0.3, 0.5, hue);
		const r = this.rand;
		const speed = Math.sqrt(size) * this.scale;
		const n = Math.round(44 + 22 * size);
		for (let k = 0; k < n; k++) {
			const angle = (k / n) * Math.PI * 2 + (r() - 0.5) * 0.25;
			const v = (150 + r() * 230) * speed;
			this.spawn(
				x,
				y,
				Math.cos(angle) * v,
				Math.sin(angle) * v - 20,
				0.8 + r() * 0.7,
				1.8 + r() * 1.5,
				hue + k / n,
				KIND_EMBER,
				150,
				1.7
			);
		}
		// A few streamers reach further out.
		for (let k = 0; k < 8; k++) {
			const angle = r() * Math.PI * 2;
			const v = (380 + r() * 160) * speed;
			this.spawn(
				x,
				y,
				Math.cos(angle) * v,
				Math.sin(angle) * v - 20,
				1.1 + r() * 0.5,
				2.2 + r() * 0.8,
				hue + r(),
				KIND_EMBER,
				150,
				1.5
			);
		}
	}

	/** The finale: a fire bloom in the effigy's colours. */
	private burstFire(x: number, y: number, size: number) {
		this.ring(x, y, size, FIRE_HUE);
		this.flash(x, y, 170 * size * this.scale, 0.55, 0.6, FIRE_HUE - 0.01);
		const r = this.rand;
		const speed = Math.sqrt(size) * this.scale;
		// Fast, bright sparks that fall.
		for (let k = 0; k < 150; k++) {
			const angle = r() * Math.PI * 2;
			const v = (120 + r() * 360) * speed;
			this.spawn(
				x,
				y,
				Math.cos(angle) * v,
				Math.sin(angle) * v - 30,
				0.9 + r() * 0.9,
				1.4 + r() * 1.6,
				1,
				KIND_FIRE,
				120,
				1.9
			);
		}
		// Slow embers that drift up.
		for (let k = 0; k < 90; k++) {
			const angle = r() * Math.PI * 2;
			const v = (30 + r() * 110) * speed;
			this.spawn(
				x,
				y,
				Math.cos(angle) * v,
				Math.sin(angle) * v,
				1.4 + r() * 0.9,
				2.2 + r() * 2.2,
				1,
				KIND_FIRE,
				-22,
				2.6
			);
		}
		if (this.crackleCount < CRACKLE_CAP) {
			const i = this.crackleCount++;
			this.cX[i] = x;
			this.cY[i] = y;
			this.cAt[i] = this.time + 0.32;
			this.cRadius[i] = 140 * size * this.scale;
		}
	}

	/** Glitter popping all over the bloom. */
	private crackle(x: number, y: number, radius: number) {
		const r = this.rand;
		for (let k = 0; k < 70; k++) {
			const angle = r() * Math.PI * 2;
			const d = radius * Math.sqrt(r());
			this.spawn(
				x + Math.cos(angle) * d,
				y + Math.sin(angle) * d,
				(r() - 0.5) * 40,
				(r() - 0.5) * 40,
				0.25 + r() * 0.45,
				1 + r() * 1.2,
				1,
				KIND_FIRE,
				60,
				3
			);
		}
	}
}

function compile(gl: WebGLRenderingContext, type: number, src: string): WebGLShader | null {
	const shader = gl.createShader(type);
	if (!shader) return null;
	gl.shaderSource(shader, src);
	gl.compileShader(shader);
	if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
		console.warn('[fireworks] shader error:', gl.getShaderInfoLog(shader));
		gl.deleteShader(shader);
		return null;
	}
	return shader;
}

export interface FireworksOptions {
	/** Where the first rockets rise from, in viewport px (the booked card). */
	origin?: Point | null;
	/** Random source; seed it for a reproducible show. */
	rand?: () => number;
	/** Called once, when the finale bursts. */
	onFinale?: () => void;
	/** Called once, when the sky is dark again (or the WebGL context was lost). */
	onDone?: () => void;
}

export interface FireworksShow {
	destroy(): void;
}

/**
 * Play the show on `canvas` (expected to be a fixed, full-viewport,
 * pointer-events:none element). Returns a handle to stop it early, or null
 * when WebGL is unavailable.
 */
export function createFireworks(
	canvas: HTMLCanvasElement,
	{ origin = null, rand = Math.random, onFinale, onDone }: FireworksOptions = {}
): FireworksShow | null {
	const glOrNull = canvas.getContext('webgl', {
		alpha: true,
		premultipliedAlpha: true,
		antialias: false,
		depth: false,
		stencil: false,
		preserveDrawingBuffer: false,
		powerPreference: 'low-power'
	});
	if (!glOrNull) return null;
	const gl: WebGLRenderingContext = glOrNull;

	const vs = compile(gl, gl.VERTEX_SHADER, VERT_SRC);
	const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG_SRC);
	if (!vs || !fs) return null;
	const program = gl.createProgram();
	if (!program) return null;
	gl.attachShader(program, vs);
	gl.attachShader(program, fs);
	gl.linkProgram(program);
	gl.deleteShader(vs);
	gl.deleteShader(fs);
	if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
		console.warn('[fireworks] link error:', gl.getProgramInfoLog(program));
		gl.deleteProgram(program);
		return null;
	}
	gl.useProgram(program);

	const verts = new Float32Array(MAX_VERTS * VERTEX_SIZE);
	const vbo = gl.createBuffer();
	gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
	gl.bufferData(gl.ARRAY_BUFFER, verts.byteLength, gl.DYNAMIC_DRAW);

	const stride = VERTEX_SIZE * 4;
	const attrib = (name: string, size: number, off: number) => {
		const loc = gl.getAttribLocation(program, name);
		if (loc < 0) return;
		gl.enableVertexAttribArray(loc);
		gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride, off * 4);
	};
	attrib('a_pos', 2, 0);
	attrib('a_uv', 2, 2);
	attrib('a_tint', 1, 4);
	attrib('a_alpha', 1, 5);
	attrib('a_kind', 1, 6);
	const uRes = gl.getUniformLocation(program, 'u_res');
	gl.enable(gl.BLEND);
	gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
	gl.clearColor(0, 0, 0, 0);

	let width = 0;
	let height = 0;
	function resize() {
		const dpr = Math.min(window.devicePixelRatio || 1, 2);
		width = window.innerWidth;
		height = window.innerHeight;
		canvas.width = Math.round(width * dpr);
		canvas.height = Math.round(height * dpr);
		gl.viewport(0, 0, canvas.width, canvas.height);
		gl.uniform2f(uRes, width, height);
	}
	resize();

	const sim = new FireworksSim(width, height, origin, rand);
	let raf = 0;
	let last = performance.now();
	let ended = false;

	function finish() {
		if (ended) return;
		ended = true;
		raf = 0;
		gl.clear(gl.COLOR_BUFFER_BIT);
		onDone?.();
	}

	function frame(now: number) {
		// A tab in the background gets no frames; the show waits instead of skipping.
		const dt = Math.min(0.05, Math.max(0.001, (now - last) / 1000));
		last = now;
		if (sim.step(dt)) onFinale?.();
		const o = sim.emit(verts);
		gl.clear(gl.COLOR_BUFFER_BIT);
		if (o > 0) {
			gl.bufferSubData(gl.ARRAY_BUFFER, 0, verts.subarray(0, o));
			gl.drawArrays(gl.TRIANGLES, 0, o / VERTEX_SIZE);
		}
		if (sim.done) {
			finish();
			return;
		}
		raf = requestAnimationFrame(frame);
	}

	const onContextLost = (e: Event) => {
		e.preventDefault();
		cancelAnimationFrame(raf);
		finish();
	};

	window.addEventListener('resize', resize, { passive: true });
	canvas.addEventListener('webglcontextlost', onContextLost);
	raf = requestAnimationFrame(frame);

	return {
		destroy() {
			cancelAnimationFrame(raf);
			ended = true;
			window.removeEventListener('resize', resize);
			canvas.removeEventListener('webglcontextlost', onContextLost);
			if (vbo) gl.deleteBuffer(vbo);
			gl.deleteProgram(program);
			gl.getExtension('WEBGL_lose_context')?.loseContext();
		}
	};
}
