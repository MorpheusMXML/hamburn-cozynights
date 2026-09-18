/**
 * The burn cycle of the effigy title, without any drawing:
 *
 *   build → stand → burn → embers → rebuild → stand → …
 *
 * - Build: magic rainbow balls fly in, one per line. Where one lands, that
 *   letter's timber frame assembles and the build runs on from letter to
 *   letter; every finished frame is painted over with its rainbow skin.
 * - Burn: one spot catches fire (a fire ball, or the visitor's torch). Each letter then burns in stages: its skin burns
 *   away from where the fire reached it, the timber frame shows, glows,
 *   bursts into flames, collapses and smoulders. The fire walks on to the
 *   neighbouring letters as the burn front reaches them, and to the other
 *   line once the skin of the first letter has burnt away.
 * - Flames on the frame run along the beams, pass on at joints and jump by
 *   heat, but only to beams whose skin has already burnt away. The sills
 *   catch fire from the debris that lands on them.
 * - Burnt-through beams break; whatever loses its connection to the ground
 *   falls, swinging on its last joint first, and shatters on the pile.
 * - Debris tumbles with simple rigid-body contacts and burns down to embers.
 *
 * State lives in typed arrays indexed by beam and letter id. Randomness comes
 * from a seeded generator, so a run is reproducible (tests/effigy.test.ts).
 */
import { computeSupport, pointInLetter, type EffigyStructure, type LetterDef } from './structure';

export type Phase = 'build' | 'stand' | 'burn' | 'embers' | 'rebuild';
export type IgnitionKind = 'spark' | 'torch';

/** Beam states. */
export const STANDING = 0;
export const FALLING = 1;
export const RESTING = 2;
export const FLYING = 3;

/** Seconds the finished title stands before it is lit. */
export const HOLD_SECONDS = 2.8;
/** Seconds the embers glow before the rebuild. */
export const EMBER_SECONDS = 2.4;
/** How fast a letter's skin burns away, in letter heights per second. */
export const SKIN_BURN_SPEED = 0.4;
/** How fast the rainbow skin paints over a finished frame. */
export const SKIN_PAINT_SPEED = 2.4;
/** A beam starts glowing this long after its skin is gone … */
export const GLOW_AFTER = 0.35;
/** … and bursts into flames after this long (plus up to BLAZE_AFTER_SPREAD). */
const BLAZE_AFTER_MIN = 1.3;
const BLAZE_AFTER_SPREAD = 0.8;
/** Seconds the fire needs to jump the gap to the neighbouring letter. */
const GAP_DELAY = 0.35;
/** After the skin of the first letter has burnt away, the other line catches this much later. */
const CROSS_LINE_DELAY = 1.2;
/** How fast the build runs through a letter from where it started. */
const BUILD_SPEED = 1.6;
/** Seconds the build needs to reach the next letter. */
const BUILD_HOP = 0.3;
/** How fast fire creeps along a sill. */
const SILL_SPEED = 0.35;
/** Safety nets: every letter gets built and lit eventually, every cycle ends. */
const BUILD_MAX = 9;
const BURN_ASSIST_AFTER = 32;
const BURN_MAX = 48;
const RADIATION_TICK = 0.1;
const SKIN_TICK = 0.05;
const MAX_STEP = 1 / 90;
const MAX_ORIGINS = 3;

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

const clamp = (x: number, lo: number, hi: number) => (x < lo ? lo : x > hi ? hi : x);
const smoothstep = (e0: number, e1: number, x: number) => {
	const t = clamp((x - e0) / (e1 - e0), 0, 1);
	return t * t * (3 - 2 * t);
};
const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
/** Ragged outline of a burn front: its radius in the direction `angle`, relative to the mean. */
export function frontShape(angle: number, seed: number): number {
	return (
		1 +
		0.07 * Math.sin(3 * angle + seed) +
		0.045 * Math.sin(7 * angle + seed * 1.7) +
		0.03 * Math.sin(13 * angle + seed * 2.3)
	);
}

/** Has a burn front of mean radius `r` from `origin` reached (x, y)? */
export function insideFront(origin: Origin, r: number, x: number, y: number): boolean {
	const dx = x - origin.x;
	const dy = y - origin.y;
	const d = Math.hypot(dx, dy);
	if (d < r * 0.85) return true;
	if (d > r * 1.15) return false;
	return d < r * frontShape(Math.atan2(dy, dx), origin.seed);
}

const wrapAngle = (a: number) => {
	a = (a + Math.PI) % (Math.PI * 2);
	if (a < 0) a += Math.PI * 2;
	return a - Math.PI;
};

export interface SimEvent {
	kind: 'impact' | 'magic' | 'ignite' | 'arrive' | 'crash';
	x: number;
	y: number;
	/** Letter index (for colors) or -1. */
	letter: number;
	/** 0..1 */
	strength: number;
}

/** Where a letter's skin started to burn, or where its build started. */
export interface Origin {
	x: number;
	y: number;
	t: number;
	/** Shapes the ragged burn front (renderer). */
	seed: number;
}

interface Cluster {
	members: number[];
	lx: Float32Array;
	ly: Float32Array;
	la: Float32Array;
	cx: number;
	cy: number;
	angle: number;
	vx: number;
	vy: number;
	av: number;
	pivoting: boolean;
	pivotX: number;
	pivotY: number;
	pivotUntil: number;
}

export interface Projectile {
	/** A fire ball lights a letter, a magic ball builds one. */
	kind: 'fire' | 'magic';
	active: boolean;
	/** Launch time (simulation seconds); it waits off screen until then. */
	launchAt: number;
	x: number;
	y: number;
	vx: number;
	vy: number;
	t: number;
	duration: number;
	letter: number;
	/** Impact point. */
	tx: number;
	ty: number;
}

export interface SimulationOptions {
	seed?: number;
	/** 'build' starts with the magic balls, 'stand' with a finished title. */
	start?: 'build' | 'stand';
	/** Light the title automatically after it has stood for a while. */
	autoIgnite?: boolean;
}

export class EffigySimulation {
	readonly structure: EffigyStructure;
	readonly count: number;
	readonly letterCount: number;
	readonly rand: () => number;
	readonly autoIgnite: boolean;

	phase: Phase = 'stand';
	time = 0;
	phaseStart = 0;
	cycle = 0;
	/** Horizontal wind in px/s, changes every cycle. */
	wind = 0;
	lastIgnition: IgnitionKind | null = null;
	/** Fire balls and magic balls in the air. */
	readonly projectiles: Projectile[] = [];

	// Target pose per beam.
	readonly tcx: Float32Array;
	readonly tcy: Float32Array;
	readonly tang: Float32Array;
	readonly len: Float32Array;

	// Dynamic state per beam.
	readonly state: Uint8Array;
	readonly cx: Float32Array;
	readonly cy: Float32Array;
	readonly ang: Float32Array;
	readonly vx: Float32Array;
	readonly vy: Float32Array;
	readonly av: Float32Array;
	/** 1 while a beam moves as part of a falling piece (see `Cluster`). */
	private readonly inCluster: Uint8Array;
	readonly heat: Float32Array;
	readonly ignited: Uint8Array;
	/** Burning stretch [lo, hi] along the beam from end A (0) to end B (1). */
	readonly lo: Float32Array;
	readonly hi: Float32Array;
	private readonly spreadA: Uint8Array;
	private readonly spreadB: Uint8Array;
	readonly char: Float32Array;
	/** When the skin over the beam burnt away (Infinity while covered). */
	readonly exposeAt: Float32Array;
	private readonly blazeAfter: Float32Array;
	private readonly burnSeconds: Float32Array;
	private readonly breakAt: Float32Array;
	private readonly speed: Float32Array;
	private readonly pendingAt: Float32Array;
	private readonly pendingU: Float32Array;
	private readonly contactTime: Float32Array;
	private readonly fallTime: Float32Array;
	// Flight (build / rebuild).
	private readonly flightStart: Float32Array;
	private readonly flightDur: Float32Array;
	private readonly flightX: Float32Array;
	private readonly flightY: Float32Array;
	private readonly flightA: Float32Array;
	private readonly flightLift: Float32Array;
	private readonly flightGrow: Uint8Array;
	/** 0..1 progress of a flying beam (1 once it has landed). */
	readonly flight: Float32Array;
	/** Length multiplier while a beam grows out of a spark. */
	readonly grow: Float32Array;

	// Per letter.
	/** When the letter caught fire (-1 = not yet), and where its skin burns from. */
	readonly litAt: Float32Array;
	readonly burnOrigins: Origin[][];
	/** Share of the skin still there, 0..1. */
	readonly skinLeft: Float32Array;
	/** When and where the build reached the letter (-1 = not yet). */
	readonly buildAt: Float32Array;
	readonly buildOrigin: Origin[];
	/** When the rainbow paint started (-1) and how much of the skin is painted, 0..1. */
	readonly paintAt: Float32Array;
	readonly skinPaint: Float32Array;
	private readonly litPendingAt: Float32Array;
	private readonly litPendingX: Float32Array;
	private readonly litPendingY: Float32Array;
	private readonly buildPendingAt: Float32Array;
	private readonly buildPendingX: Float32Array;
	private readonly buildPendingY: Float32Array;
	/** Points spread over each letter's skin, to measure burnt and painted shares. */
	private readonly samples: Float32Array[];

	private readonly standingMask: Uint8Array;
	private readonly supported: Uint8Array;
	private readonly queue: Int32Array;
	private readonly piles: Float32Array[];
	private readonly pileBin: number;
	private readonly pileMax: number;
	private readonly gravity: number;
	private clusters: Cluster[] = [];
	private broken: number[] = [];
	private supportDirty = false;
	private crossLineDone = false;
	private radiationClock = 0;
	private skinClock = 0;
	private idleClock = 0;
	private assistClock = 0;
	private letterAssistClock = 0;
	private readonly gridSize: number;
	private readonly gridCols: number;
	private readonly gridRows: number;
	private readonly gridHead: Int32Array;
	private readonly gridNext: Int32Array;

	private readonly eventPool: SimEvent[] = [];
	private eventCount = 0;

	constructor(structure: EffigyStructure, options: SimulationOptions = {}) {
		this.structure = structure;
		this.count = structure.beams.length;
		this.letterCount = structure.letters.length;
		this.rand = mulberry32(options.seed ?? 1);
		this.autoIgnite = options.autoIgnite ?? true;
		const n = this.count;
		const nl = this.letterCount;
		const S = structure.scale;

		this.tcx = new Float32Array(n);
		this.tcy = new Float32Array(n);
		this.tang = new Float32Array(n);
		this.len = new Float32Array(n);
		for (const b of structure.beams) {
			this.tcx[b.id] = (b.ax + b.bx) / 2;
			this.tcy[b.id] = (b.ay + b.by) / 2;
			this.tang[b.id] = Math.atan2(b.by - b.ay, b.bx - b.ax);
			this.len[b.id] = b.length;
		}

		this.state = new Uint8Array(n);
		this.cx = new Float32Array(n);
		this.cy = new Float32Array(n);
		this.ang = new Float32Array(n);
		this.vx = new Float32Array(n);
		this.vy = new Float32Array(n);
		this.av = new Float32Array(n);
		this.inCluster = new Uint8Array(n);
		this.heat = new Float32Array(n);
		this.ignited = new Uint8Array(n);
		this.lo = new Float32Array(n);
		this.hi = new Float32Array(n);
		this.spreadA = new Uint8Array(n);
		this.spreadB = new Uint8Array(n);
		this.char = new Float32Array(n);
		this.exposeAt = new Float32Array(n);
		this.blazeAfter = new Float32Array(n);
		this.burnSeconds = new Float32Array(n);
		this.breakAt = new Float32Array(n);
		this.speed = new Float32Array(n);
		this.pendingAt = new Float32Array(n).fill(-1);
		this.pendingU = new Float32Array(n);
		this.contactTime = new Float32Array(n);
		this.fallTime = new Float32Array(n);
		this.flightStart = new Float32Array(n);
		this.flightDur = new Float32Array(n).fill(1);
		this.flightX = new Float32Array(n);
		this.flightY = new Float32Array(n);
		this.flightA = new Float32Array(n);
		this.flightLift = new Float32Array(n);
		this.flightGrow = new Uint8Array(n);
		this.flight = new Float32Array(n).fill(1);
		this.grow = new Float32Array(n).fill(1);

		this.litAt = new Float32Array(nl).fill(-1);
		this.burnOrigins = Array.from({ length: nl }, () => []);
		this.skinLeft = new Float32Array(nl).fill(1);
		this.buildAt = new Float32Array(nl).fill(-1);
		this.buildOrigin = structure.letters.map((l) => ({
			x: l.x + l.width / 2,
			y: l.y + l.height / 2,
			t: 0,
			seed: 0
		}));
		this.paintAt = new Float32Array(nl).fill(-1);
		this.skinPaint = new Float32Array(nl).fill(1);
		this.litPendingAt = new Float32Array(nl).fill(-1);
		this.litPendingX = new Float32Array(nl);
		this.litPendingY = new Float32Array(nl);
		this.buildPendingAt = new Float32Array(nl).fill(-1);
		this.buildPendingX = new Float32Array(nl);
		this.buildPendingY = new Float32Array(nl);
		this.samples = structure.letters.map((l) => skinSamples(l));

		this.standingMask = new Uint8Array(n);
		this.supported = new Uint8Array(structure.jointCount);
		this.queue = new Int32Array(Math.max(1, structure.jointCount));

		this.pileBin = Math.max(2, 0.05 * S);
		this.pileMax = 0.3 * S;
		this.piles = structure.lines.map(
			(line) => new Float32Array(Math.ceil((line.x1 - line.x0) / this.pileBin) + 2)
		);
		this.gravity = 6 * S;

		this.gridSize = Math.max(8, 0.7 * S);
		this.gridCols = Math.ceil((structure.width + 4 * S) / this.gridSize) + 1;
		this.gridRows = Math.ceil((structure.height + 4 * S) / this.gridSize) + 1;
		this.gridHead = new Int32Array(this.gridCols * this.gridRows);
		this.gridNext = new Int32Array(n);

		for (let i = 0; i < n; i++) {
			this.placeAtTarget(i);
			this.resetFire(i);
		}
		this.newCycleWeather();

		if ((options.start ?? 'build') === 'build') {
			this.startBuild(true);
		} else {
			this.enter('stand');
		}
	}

	// --- Public API ----------------------------------------------------------

	/** Advance the simulation by `dt` seconds (clamped internally). */
	step(dt: number) {
		dt = clamp(dt, 0, 0.1);
		while (dt > 1e-6) {
			const h = Math.min(dt, MAX_STEP);
			this.substep(h);
			dt -= h;
		}
	}

	/**
	 * The cursor or a finger as a torch at (x, y): lights the skin of a letter
	 * it touches, or bare beams nearby. Returns true when something caught fire.
	 */
	torch(x: number, y: number, radius: number): boolean {
		if (this.phase !== 'stand' && this.phase !== 'burn') return false;
		let lit = false;
		// Timber the fire has laid bare catches right away …
		for (let i = 0; i < this.count; i++) {
			if (
				this.state[i] !== STANDING ||
				this.ignited[i] ||
				this.structure.beams[i].kind === 'sill'
			) {
				continue;
			}
			if (this.exposeAt[i] > this.time) continue;
			const reach = this.len[i] / 2 + radius + this.structure.beams[i].width;
			if (Math.abs(this.cx[i] - x) > reach || Math.abs(this.cy[i] - y) > reach) continue;
			const u = this.closestParam(i, x, y);
			const [px, py] = this.pointAt(i, u);
			if (Math.hypot(px - x, py - y) <= radius + this.structure.beams[i].width) {
				this.ignite(i, u);
				lit = true;
			}
		}
		// … a skin starts burning where the torch touches it.
		for (const letter of this.structure.letters) {
			if (this.skinLeft[letter.index] <= 0) continue;
			if (
				pointInLetter(letter, x, y) ||
				pointInLetter(letter, x - radius, y) ||
				pointInLetter(letter, x + radius, y) ||
				pointInLetter(letter, x, y - radius) ||
				pointInLetter(letter, x, y + radius)
			) {
				if (this.igniteLetter(letter.index, x, y)) lit = true;
			}
		}
		if (lit && this.phase === 'stand') {
			this.lastIgnition = 'torch';
			this.enter('burn');
		}
		return lit;
	}

	/** How strongly beam `i` burns right now, 0..1. */
	intensity(i: number): number {
		if (!this.ignited[i]) return 0;
		const c = this.char[i];
		if (c >= 1) return 0;
		return smoothstep(0, 0.1, c) * (1 - smoothstep(0.55, 1, c));
	}

	/** How hot a beam glows that the burning skin has laid bare, 0..1 (0 once it burns). */
	glow(i: number): number {
		if (this.ignited[i] || this.structure.beams[i].kind === 'sill') return 0;
		const since = this.time - this.exposeAt[i] - GLOW_AFTER;
		if (!(since > 0)) return 0;
		return clamp(since / this.blazeAfter[i], 0, 1);
	}

	/** Radius of a burn (or paint) front that started at `origin`, at `speed` letter heights per second. */
	frontRadius(origin: Origin, speed: number): number {
		return Math.max(0, (this.time - origin.t) * speed * this.structure.scale);
	}

	/** Point at parameter u (0 = end A, 1 = end B) of beam i, in its current pose. */
	pointAt(i: number, u: number): [number, number] {
		const half = this.len[i] * this.grow[i];
		const k = (u - 0.5) * half;
		return [this.cx[i] + Math.cos(this.ang[i]) * k, this.cy[i] + Math.sin(this.ang[i]) * k];
	}

	/** Has the flight of beam i begun (or is it no flight at all)? */
	flightStarted(i: number): boolean {
		return this.state[i] !== FLYING || this.time >= this.flightStart[i];
	}

	/** Beams still standing in the letters (not the sill). */
	standingLetterBeams(): number {
		let standing = 0;
		for (let i = 0; i < this.count; i++) {
			if (this.state[i] === STANDING && this.structure.beams[i].kind !== 'sill') standing++;
		}
		return standing;
	}

	/** Hand the events of this frame to `fn` and clear them. */
	drainEvents(fn: (event: SimEvent) => void) {
		for (let i = 0; i < this.eventCount; i++) fn(this.eventPool[i]);
		this.eventCount = 0;
	}

	// --- Phases ----------------------------------------------------------------

	private enter(phase: Phase) {
		this.phase = phase;
		this.phaseStart = this.time;
		this.idleClock = 0;
		this.assistClock = 0;
		this.letterAssistClock = 0;
	}

	private newCycleWeather() {
		const S = this.structure.scale;
		this.wind = (this.rand() * 2 - 1) * 0.45 * S;
	}

	private substep(dt: number) {
		this.time += dt;
		const since = this.time - this.phaseStart;

		switch (this.phase) {
			case 'build':
			case 'rebuild':
				if (since > BUILD_MAX) {
					for (const letter of this.structure.letters) {
						if (this.buildAt[letter.index] < 0) {
							this.buildLetter(
								letter.index,
								this.buildOrigin[letter.index].x,
								this.buildOrigin[letter.index].y
							);
						}
					}
				}
				this.updateLetterSchedules();
				if (this.updateFlight()) this.enter('stand');
				break;
			case 'stand':
				if (this.autoIgnite && since >= (this.cycle === 0 ? HOLD_SECONDS + 0.4 : HOLD_SECONDS)) {
					this.autoLight();
				}
				break;
			case 'burn':
				this.updateLetterSchedules();
				if (since > BURN_ASSIST_AFTER) this.assist(dt);
				if (since > BURN_MAX) this.collapseAll();
				if (since > BURN_MAX + 3) this.settleAll();
				if (this.nothingLeftStanding()) this.enter('embers');
				break;
			case 'embers':
				if (since > EMBER_SECONDS) this.startBuild(false);
				break;
		}

		this.updateProjectiles(dt);
		this.updateFire(dt);
		this.updateBodies(dt);
		this.skinClock += dt;
		if (this.skinClock >= SKIN_TICK) {
			this.skinClock = 0;
			this.updateSkins();
		}
	}

	/** One fire ball at one letter. */
	private autoLight() {
		this.lastIgnition = 'spark';
		this.launch('fire', Math.floor(this.rand() * this.letterCount), 0);
		this.enter('burn');
	}

	/** Throw a ball at a random point of the letter's frame. */
	private launch(kind: Projectile['kind'], letterIndex: number, delay: number) {
		const letter = this.structure.letters[letterIndex];
		if (!letter) return;
		const S = this.structure.scale;
		const pool = letter.beams.filter((id) => this.structure.beams[id].kind !== 'brace');
		const target = pool.length ? pool[Math.floor(this.rand() * pool.length)] : letter.beams[0];
		const tx = target !== undefined ? this.tcx[target] : letter.x + letter.width / 2;
		const ty = target !== undefined ? this.tcy[target] : letter.y + letter.height / 2;
		const fromLeft = tx > this.structure.width / 2;
		const sx = fromLeft ? -0.6 * S : this.structure.width + 0.6 * S;
		const sy = -1.0 * S;
		const duration = 0.9 + this.rand() * 0.3;
		const g = 2.4 * S;
		this.projectiles.push({
			kind,
			active: true,
			launchAt: this.time + delay,
			x: sx,
			y: sy,
			vx: (tx - sx) / duration,
			vy: (ty - sy - 0.5 * g * duration * duration) / duration,
			t: 0,
			duration,
			letter: letterIndex,
			tx,
			ty
		});
	}

	private updateProjectiles(dt: number) {
		if (!this.projectiles.length) return;
		const g = 2.4 * this.structure.scale;
		for (const p of this.projectiles) {
			if (!p.active || this.time < p.launchAt) continue;
			p.vy += g * dt;
			p.x += p.vx * dt;
			p.y += p.vy * dt;
			p.t += dt;
			if (p.t < p.duration) continue;
			p.active = false;
			p.x = p.tx;
			p.y = p.ty;
			if (p.kind === 'magic') {
				this.buildLetter(p.letter, p.tx, p.ty);
				this.emit('magic', p.tx, p.ty, p.letter, 1);
			} else {
				this.igniteLetter(p.letter, p.tx, p.ty);
				this.emit('impact', p.tx, p.ty, p.letter, 1);
			}
		}
		if (this.projectiles.every((p) => !p.active)) this.projectiles.length = 0;
	}

	/** Late in a burn: keep the fire going and bring down stubborn remains. */
	private assist(dt: number) {
		// A letter nobody lit yet catches from its foot.
		this.letterAssistClock += dt;
		if (this.letterAssistClock >= 1) {
			this.letterAssistClock = 0;
			const letter = this.structure.letters.find((l) => this.litAt[l.index] < 0);
			if (letter)
				this.igniteLetter(
					letter.index,
					letter.x + letter.width / 2,
					letter.y + letter.height * 0.96
				);
		}
		this.assistClock += dt;
		if (this.assistClock < 0.3) return;
		this.assistClock = 0;
		const standing: number[] = [];
		for (let i = 0; i < this.count; i++) {
			if (
				this.state[i] === STANDING &&
				!this.ignited[i] &&
				this.exposeAt[i] <= this.time &&
				this.structure.beams[i].kind !== 'sill'
			) {
				standing.push(i);
			}
		}
		if (!standing.length) return;
		// Light the lowest of a few random picks: fires climb.
		let pick = standing[Math.floor(this.rand() * standing.length)];
		for (let k = 0; k < 3; k++) {
			const other = standing[Math.floor(this.rand() * standing.length)];
			if (this.tcy[other] > this.tcy[pick]) pick = other;
		}
		this.ignite(pick, this.rand());
	}

	private collapseAll() {
		for (let l = 0; l < this.letterCount; l++) this.skinLeft[l] = 0;
		for (let i = 0; i < this.count; i++) {
			if (this.state[i] === STANDING && this.structure.beams[i].kind !== 'sill') {
				this.exposeAt[i] = Math.min(this.exposeAt[i], this.time);
				if (!this.ignited[i]) this.ignite(i, 0.5);
				this.breakBeam(i, true);
			}
		}
	}

	/** Last resort against debris that never comes to rest. */
	private settleAll() {
		this.clusters = [];
		for (let i = 0; i < this.count; i++) {
			if (this.state[i] === FALLING) {
				this.inCluster[i] = 0;
				this.settle(i);
			}
		}
	}

	private nothingLeftStanding(): boolean {
		if (this.projectiles.length || this.clusters.length) return false;
		for (let i = 0; i < this.count; i++) {
			const s = this.state[i];
			if (s === FALLING) return false;
			if (s === STANDING && this.structure.beams[i].kind !== 'sill') return false;
		}
		return true;
	}

	// --- Letters: lighting and building ----------------------------------------

	/** Scheduled letter ignitions and builds whose time has come. */
	private updateLetterSchedules() {
		for (let l = 0; l < this.letterCount; l++) {
			if (this.litPendingAt[l] >= 0 && this.time >= this.litPendingAt[l]) {
				this.litPendingAt[l] = -1;
				this.igniteLetter(l, this.litPendingX[l], this.litPendingY[l]);
			}
			if (this.buildPendingAt[l] >= 0 && this.time >= this.buildPendingAt[l]) {
				this.buildPendingAt[l] = -1;
				this.buildLetter(l, this.buildPendingX[l], this.buildPendingY[l]);
			}
		}
	}

	/** The letter's skin catches fire at (x, y). Returns false if there was nothing to light. */
	igniteLetter(l: number, x: number, y: number): boolean {
		const letter = this.structure.letters[l];
		if (!letter || this.skinLeft[l] <= 0) return false;
		const origins = this.burnOrigins[l];
		if (origins.length >= MAX_ORIGINS) return false;
		// A spot the fire has already eaten doesn't start a new front.
		if (origins.some((o) => insideFront(o, this.frontRadius(o, SKIN_BURN_SPEED), x, y)))
			return false;
		const now = this.time;
		const origin: Origin = { x, y, t: now, seed: this.rand() * 100 };
		origins.push(origin);
		if (this.litAt[l] < 0) {
			this.litAt[l] = now;
			this.emit('ignite', x, y, l, 0.6);
		}
		const v = SKIN_BURN_SPEED * this.structure.scale;
		for (const b of letter.beams) {
			// A beam comes to light when the ragged front passes its middle.
			const dx = this.tcx[b] - x;
			const dy = this.tcy[b] - y;
			const te = now + Math.hypot(dx, dy) / (v * frontShape(Math.atan2(dy, dx), origin.seed));
			if (te < this.exposeAt[b]) {
				this.exposeAt[b] = te;
				this.schedule(b, te + this.blazeAfter[b] - now, this.closestParam(b, x, y));
			}
		}
		// The burn front walks on to the neighbours in the line.
		for (const [neighbour, edge] of [
			[letter.left, letter.x],
			[letter.right, letter.x + letter.width]
		] as const) {
			if (neighbour < 0 || this.litAt[neighbour] >= 0) continue;
			const next = this.structure.letters[neighbour];
			const t = now + Math.abs(edge - x) / v + GAP_DELAY * (0.8 + this.rand() * 0.5);
			const tx =
				neighbour === letter.left ? next.x + next.width * 0.97 : next.x + next.width * 0.03;
			const ty = clamp(y, next.y + next.height * 0.15, next.y + next.height * 0.85);
			this.scheduleLetter(neighbour, t, tx, ty);
		}
		return true;
	}

	private scheduleLetter(l: number, at: number, x: number, y: number) {
		if (this.litPendingAt[l] < 0 || at < this.litPendingAt[l]) {
			this.litPendingAt[l] = at;
			this.litPendingX[l] = x;
			this.litPendingY[l] = y;
		}
	}

	/** The skin of the first letter has burnt away: the other line catches a little later. */
	private crossLine(l: number) {
		if (this.crossLineDone || this.structure.lines.length < 2) return;
		this.crossLineDone = true;
		const letter = this.structure.letters[l];
		const centerX = letter.x + letter.width / 2;
		let best: LetterDef | null = null;
		for (const other of this.structure.letters) {
			if (other.line === letter.line || this.litAt[other.index] >= 0) continue;
			if (
				!best ||
				Math.abs(other.x + other.width / 2 - centerX) < Math.abs(best.x + best.width / 2 - centerX)
			) {
				best = other;
			}
		}
		if (!best) return;
		const below = best.line > letter.line;
		this.scheduleLetter(
			best.index,
			this.time + CROSS_LINE_DELAY,
			clamp(centerX, best.x + best.width * 0.15, best.x + best.width * 0.85),
			below ? best.y + best.height * 0.04 : best.y + best.height * 0.96
		);
	}

	/** The build reaches the letter at (x, y): its frame assembles from there. */
	private buildLetter(l: number, x: number, y: number) {
		if (this.buildAt[l] >= 0) return;
		const letter = this.structure.letters[l];
		const now = this.time;
		this.buildAt[l] = now;
		this.buildOrigin[l] = { x, y, t: now, seed: this.rand() * 100 };
		const v = BUILD_SPEED * this.structure.scale;
		for (const b of letter.beams) {
			const d = Math.hypot(this.tcx[b] - x, this.tcy[b] - y);
			this.flightStart[b] = now + d / v + this.rand() * 0.1;
		}
		for (const neighbour of [letter.left, letter.right]) {
			if (neighbour < 0 || this.buildAt[neighbour] >= 0) continue;
			const next = this.structure.letters[neighbour];
			const at = now + BUILD_HOP * (0.8 + this.rand() * 0.4);
			if (this.buildPendingAt[neighbour] < 0 || at < this.buildPendingAt[neighbour]) {
				this.buildPendingAt[neighbour] = at;
				this.buildPendingX[neighbour] =
					neighbour === letter.left ? next.x + next.width * 0.9 : next.x + next.width * 0.1;
				this.buildPendingY[neighbour] = clamp(
					y,
					next.y + next.height * 0.2,
					next.y + next.height * 0.8
				);
			}
		}
	}

	/** Burnt and painted shares of every skin, measured on its sample points. */
	private updateSkins() {
		const S = this.structure.scale;
		for (let l = 0; l < this.letterCount; l++) {
			const pts = this.samples[l];
			const total = pts.length / 2;
			// Burning.
			const origins = this.burnOrigins[l];
			if (origins.length && this.skinLeft[l] > 0) {
				let left = 0;
				for (let k = 0; k < pts.length; k += 2) {
					let burnt = false;
					for (const o of origins) {
						if (insideFront(o, (this.time - o.t) * SKIN_BURN_SPEED * S, pts[k], pts[k + 1])) {
							burnt = true;
							break;
						}
					}
					if (!burnt) left++;
				}
				this.skinLeft[l] = left / total;
				if (left === 0 && this.phase === 'burn') this.crossLine(l);
			}
			// Painting.
			if (this.paintAt[l] >= 0 && this.skinPaint[l] < 1) {
				const o = this.buildOrigin[l];
				const r = (this.time - this.paintAt[l]) * SKIN_PAINT_SPEED * S;
				let painted = 0;
				for (let k = 0; k < pts.length; k += 2) {
					if (Math.hypot(pts[k] - o.x, pts[k + 1] - o.y) < r) painted++;
				}
				this.skinPaint[l] = painted / total;
			}
		}
	}

	// --- Flight (build / rebuild) -------------------------------------------

	private startBuild(first: boolean) {
		const S = this.structure.scale;
		this.clusters = [];
		this.projectiles.length = 0;
		this.crossLineDone = false;
		for (const pile of this.piles) pile.fill(0);
		for (let l = 0; l < this.letterCount; l++) {
			this.litAt[l] = -1;
			this.burnOrigins[l] = [];
			this.skinLeft[l] = 1;
			this.buildAt[l] = -1;
			this.paintAt[l] = -1;
			this.skinPaint[l] = 0;
			this.litPendingAt[l] = -1;
			this.buildPendingAt[l] = -1;
		}

		for (const beam of this.structure.beams) {
			const i = beam.id;
			const line = this.structure.lines[beam.line];
			this.inCluster[i] = 0;
			this.vx[i] = this.vy[i] = this.av[i] = 0;
			if (first) {
				// Sparks at the sill grow into beams.
				this.cx[i] = this.tcx[i] + (this.rand() - 0.5) * 0.5 * S;
				this.cy[i] = line.ground + 0.02 * S;
				this.ang[i] = this.tang[i] + (this.rand() - 0.5) * 2.4;
				this.resetFire(i);
			}
			const sill = beam.kind === 'sill';
			// Letters wait for the build to reach them; the sill heals right away.
			this.flightStart[i] = sill ? this.time + this.rand() * 0.25 : Infinity;
			this.flightDur[i] = (sill ? 0.55 : 0.6) + this.rand() * 0.25;
			this.flightX[i] = this.cx[i];
			this.flightY[i] = this.cy[i];
			this.flightA[i] = this.ang[i];
			this.flightLift[i] = first ? 0 : (0.2 + this.rand() * 0.3) * S;
			this.flightGrow[i] = first ? 1 : 0;
			this.flight[i] = 0;
			this.grow[i] = first ? 0 : 1;
			this.state[i] = FLYING;
		}
		// One magic ball per line, the second a moment later.
		this.structure.lines.forEach((line, index) => {
			const letters = this.structure.letters.filter((l) => l.line === index);
			if (!letters.length) return;
			const pick = letters[Math.floor(this.rand() * letters.length)];
			this.launch('magic', pick.index, 0.15 + index * 0.45);
		});
		this.cycle += first ? 0 : 1;
		this.newCycleWeather();
		this.enter(first ? 'build' : 'rebuild');
	}

	/** Returns true once every beam is back in place and every skin painted. */
	private updateFlight(): boolean {
		let done = true;
		for (let i = 0; i < this.count; i++) {
			if (this.state[i] !== FLYING) continue;
			done = false;
			const raw = (this.time - this.flightStart[i]) / this.flightDur[i];
			if (!(raw > 0)) continue;
			if (this.flight[i] === 0 && this.ignited[i]) {
				// Lifting off puts the fire out; the char fades into fresh wood.
				this.ignited[i] = 0;
				this.lo[i] = this.hi[i] = 0;
			}
			const e = Math.min(1, raw);
			this.flight[i] = Math.max(e, 1e-4);
			const p = easeInOutCubic(e);
			this.cx[i] = this.flightX[i] + (this.tcx[i] - this.flightX[i]) * p;
			this.cy[i] =
				this.flightY[i] +
				(this.tcy[i] - this.flightY[i]) * p -
				Math.sin(Math.PI * e) * this.flightLift[i];
			this.ang[i] = this.flightA[i] + wrapAngle(this.tang[i] - this.flightA[i]) * easeOutCubic(e);
			if (this.flightGrow[i]) this.grow[i] = 0.08 + 0.92 * easeOutCubic(e);
			if (e >= 1) {
				this.placeAtTarget(i);
				this.resetFire(i);
				this.state[i] = STANDING;
				this.flight[i] = 1;
				this.grow[i] = 1;
				const beam = this.structure.beams[i];
				if (beam.kind === 'post' && this.rand() < 0.3) {
					this.emit('arrive', this.cx[i], this.cy[i], beam.letter, 0.5);
				}
			}
		}
		// A finished frame gets its rainbow skin.
		for (const letter of this.structure.letters) {
			const l = letter.index;
			if (this.paintAt[l] >= 0) {
				if (this.skinPaint[l] < 1) done = false;
				continue;
			}
			done = false;
			if (this.buildAt[l] < 0) continue;
			if (letter.beams.every((b) => this.state[b] === STANDING)) this.paintAt[l] = this.time;
		}
		return done;
	}

	// --- Fire -------------------------------------------------------------------

	private resetFire(i: number) {
		const S = this.structure.scale;
		const beam = this.structure.beams[i];
		const sill = beam.kind === 'sill';
		this.heat[i] = 0;
		this.ignited[i] = 0;
		this.lo[i] = this.hi[i] = 0;
		this.spreadA[i] = this.spreadB[i] = 0;
		this.char[i] = 0;
		this.pendingAt[i] = -1;
		this.contactTime[i] = 0;
		this.fallTime[i] = 0;
		// The sill has no skin; letter beams are covered until their skin burns.
		this.exposeAt[i] = sill ? 0 : Infinity;
		this.blazeAfter[i] = BLAZE_AFTER_MIN + this.rand() * BLAZE_AFTER_SPREAD;
		this.burnSeconds[i] = sill ? 3.4 + this.rand() * 1.2 : 2.6 + this.rand() * 1.6;
		// Braces drop out early, rails and posts carry the burning frame for longer.
		this.breakAt[i] = beam.kind === 'brace' ? 0.35 + this.rand() * 0.3 : 0.62 + this.rand() * 0.28;
		this.speed[i] = (sill ? SILL_SPEED : 0.9 + this.rand() * 0.6) * S;
	}

	private placeAtTarget(i: number) {
		this.cx[i] = this.tcx[i];
		this.cy[i] = this.tcy[i];
		this.ang[i] = this.tang[i];
		this.vx[i] = this.vy[i] = this.av[i] = 0;
		this.inCluster[i] = 0;
	}

	private schedule(i: number, delay: number, u: number) {
		if (this.ignited[i]) return;
		const at = this.time + delay;
		if (this.pendingAt[i] < 0 || at < this.pendingAt[i]) {
			this.pendingAt[i] = at;
			this.pendingU[i] = u;
		}
	}

	ignite(i: number, u: number) {
		if (this.ignited[i] || this.state[i] === FLYING) return;
		const beam = this.structure.beams[i];
		this.ignited[i] = 1;
		this.pendingAt[i] = -1;
		this.lo[i] = this.hi[i] = clamp(u, 0, 1);
		// No need to hand the fire back to the joint it came from.
		this.spreadA[i] = u <= 0 ? 1 : 0;
		this.spreadB[i] = u >= 1 ? 1 : 0;
		this.char[i] = Math.max(this.char[i], 0.001);
		if (beam.letter >= 0) this.exposeAt[i] = Math.min(this.exposeAt[i], this.time);
	}

	private spreadFrom(i: number, joint: number) {
		if (this.state[i] !== STANDING) return;
		for (const k of this.structure.jointBeams[joint]) {
			if (k === i || this.ignited[k] || this.state[k] !== STANDING) continue;
			if (this.exposeAt[k] > this.time) continue;
			const beam = this.structure.beams[k];
			this.schedule(k, 0.02 + this.rand() * 0.12, beam.jointA === joint ? 0 : 1);
		}
	}

	private updateFire(dt: number) {
		const beams = this.structure.beams;
		let anyBurning = false;
		let anyPending = false;

		for (let i = 0; i < this.count; i++) {
			if (this.pendingAt[i] >= 0) {
				if (this.state[i] === FLYING) this.pendingAt[i] = -1;
				else if (this.time >= this.pendingAt[i]) this.ignite(i, this.pendingU[i]);
				else anyPending = true;
			}
			if (!this.ignited[i] || this.state[i] === FLYING) continue;

			const step = (this.speed[i] * dt) / Math.max(1, this.len[i]);
			if (this.lo[i] > 0) {
				this.lo[i] = Math.max(0, this.lo[i] - step);
			} else if (!this.spreadA[i]) {
				this.spreadA[i] = 1;
				this.spreadFrom(i, beams[i].jointA);
			}
			if (this.hi[i] < 1) {
				this.hi[i] = Math.min(1, this.hi[i] + step);
			} else if (!this.spreadB[i]) {
				this.spreadB[i] = 1;
				this.spreadFrom(i, beams[i].jointB);
			}

			if (this.char[i] < 1) {
				this.char[i] = Math.min(1, this.char[i] + dt / this.burnSeconds[i]);
				anyBurning = true;
			}
			// A letter only comes down once its skin is gone.
			if (
				this.state[i] === STANDING &&
				beams[i].kind !== 'sill' &&
				this.char[i] >= this.breakAt[i] &&
				this.skinLeft[beams[i].letter] <= 0
			) {
				this.breakBeam(i);
			}
		}

		this.radiationClock += dt;
		if (this.radiationClock >= RADIATION_TICK) {
			this.radiate(this.radiationClock);
			this.radiationClock = 0;
		}

		if (this.supportDirty) this.refreshSupport();

		// A fire that went out before the title came down gets relit.
		const lettersWaiting = this.litPendingAt.some((t) => t >= 0);
		const skinsBurning = this.burnOrigins.some((o, l) => o.length > 0 && this.skinLeft[l] > 0);
		if (
			this.phase === 'burn' &&
			!anyBurning &&
			!anyPending &&
			!lettersWaiting &&
			!skinsBurning &&
			!this.projectiles.length
		) {
			this.idleClock += dt;
			if (this.idleClock > 1.5) {
				this.idleClock = 0;
				this.letterAssistClock = 1;
				this.assistClock = 1;
				this.assist(0);
			}
		} else {
			this.idleClock = 0;
		}
	}

	/** Heat from burning beams reaches bare beams close by, mostly above. */
	private radiate(dt: number) {
		const S = this.structure.scale;
		const R = 0.7 * S;
		const rate = 4.5 * dt;
		const beams = this.structure.beams;
		const size = this.gridSize;
		const cols = this.gridCols;
		const rows = this.gridRows;
		const ox = 2 * S;
		const oy = 2 * S;

		// Bucket the beams that can still catch fire: bare, not burning, not flying.
		this.gridHead.fill(-1);
		for (let i = 0; i < this.count; i++) {
			if (this.ignited[i] || this.state[i] === FLYING || this.exposeAt[i] > this.time) continue;
			const gx = Math.floor((this.cx[i] + ox) / size);
			const gy = Math.floor((this.cy[i] + oy) / size);
			if (gx < 0 || gy < 0 || gx >= cols || gy >= rows) continue;
			const cell = gy * cols + gx;
			this.gridNext[i] = this.gridHead[cell];
			this.gridHead[cell] = i;
		}

		for (let i = 0; i < this.count; i++) {
			if (!this.ignited[i] || this.state[i] === FLYING) continue;
			const fromSill = beams[i].kind === 'sill';
			const power = this.intensity(i) * (0.35 + 0.65 * (this.hi[i] - this.lo[i]));
			if (power < 0.08) continue;
			const [sx, sy] = this.pointAt(i, (this.lo[i] + this.hi[i]) / 2);
			const gx = Math.floor((sx + ox) / size);
			const gy = Math.floor((sy + oy) / size);
			for (let y = gy - 1; y <= gy + 1; y++) {
				if (y < 0 || y >= rows) continue;
				for (let x = gx - 1; x <= gx + 1; x++) {
					if (x < 0 || x >= cols) continue;
					for (let k = this.gridHead[y * cols + x]; k >= 0; k = this.gridNext[k]) {
						// Along a sill the fire only creeps from plank to plank.
						if (this.ignited[k] || (fromSill && beams[k].kind === 'sill')) continue;
						const dx = this.cx[k] - sx;
						const dy = this.cy[k] - sy;
						const d = Math.hypot(dx, dy);
						if (d >= R) continue;
						const falloff = (1 - d / R) * (1 - d / R);
						const upward = 1 + 0.7 * clamp(-dy / R, -1, 1);
						// Debris lying on the sill sets it alight.
						const fuel = beams[k].kind === 'sill' ? 3 : 1;
						this.heat[k] += rate * power * falloff * upward * fuel;
						if (this.heat[k] >= 1) this.ignite(k, this.closestParam(k, sx, sy));
					}
				}
			}
		}
	}

	private breakBeam(i: number, force = false) {
		const beam = this.structure.beams[i];
		if (this.state[i] !== STANDING || beam.kind === 'sill') return;
		if (!force && this.skinLeft[beam.letter] > 0) return;
		this.state[i] = FALLING;
		this.broken.push(i);
		this.supportDirty = true;
	}

	/** After beams broke: hinge them, and let unsupported parts fall. */
	private refreshSupport() {
		this.supportDirty = false;
		const { beams, jointBeams } = this.structure;
		for (let i = 0; i < this.count; i++) this.standingMask[i] = this.state[i] === STANDING ? 1 : 0;
		computeSupport(this.structure, this.standingMask, this.supported, this.queue);

		// Broken beams swing on an end that still holds, then drop.
		for (const i of this.broken) {
			const holdsA = this.supported[beams[i].jointA] === 1;
			const holdsB = this.supported[beams[i].jointB] === 1;
			let pivot: 0 | 1 | -1 = -1;
			if (holdsA && holdsB) pivot = this.rand() < 0.5 ? 0 : 1;
			else if (holdsA) pivot = 0;
			else if (holdsB) pivot = 1;
			this.makeCluster([i], pivot === -1 ? null : this.pointAt(i, pivot));
		}

		// Parts that lost their connection to the ground fall as one piece.
		const seen = this.standingMask; // reuse: 2 = visited
		for (let i = 0; i < this.count; i++) {
			if (this.state[i] !== STANDING || beams[i].kind === 'sill') continue;
			if (this.supported[beams[i].jointA] || seen[i] === 2) continue;
			const members: number[] = [];
			const stack = [i];
			seen[i] = 2;
			while (stack.length) {
				const b = stack.pop()!;
				members.push(b);
				for (const joint of [beams[b].jointA, beams[b].jointB]) {
					for (const k of jointBeams[joint]) {
						if (seen[k] === 2 || this.state[k] !== STANDING || beams[k].kind === 'sill') continue;
						seen[k] = 2;
						stack.push(k);
					}
				}
			}
			// Hinge on the joint of a beam that just broke, if it touches this part.
			let pivot: [number, number] | null = null;
			const memberJoints = new Set<number>();
			for (const m of members) {
				memberJoints.add(beams[m].jointA);
				memberJoints.add(beams[m].jointB);
			}
			for (const b of this.broken) {
				if (memberJoints.has(beams[b].jointA)) pivot = [beams[b].ax, beams[b].ay];
				else if (memberJoints.has(beams[b].jointB)) pivot = [beams[b].bx, beams[b].by];
				if (pivot) break;
			}
			for (const m of members) this.state[m] = FALLING;
			this.makeCluster(members, pivot);
		}
		this.broken = [];
	}

	// --- Bodies -------------------------------------------------------------------

	private makeCluster(members: number[], pivot: [number, number] | null) {
		let mass = 0;
		let mx = 0;
		let my = 0;
		for (const m of members) {
			const w = this.len[m];
			mass += w;
			mx += this.cx[m] * w;
			my += this.cy[m] * w;
		}
		mx /= mass || 1;
		my /= mass || 1;
		const n = members.length;
		const cluster: Cluster = {
			members,
			lx: new Float32Array(n),
			ly: new Float32Array(n),
			la: new Float32Array(n),
			cx: mx,
			cy: my,
			angle: 0,
			vx: 0,
			vy: 0,
			av: (this.rand() - 0.5) * 0.5,
			pivoting: !!pivot,
			pivotX: pivot ? pivot[0] : mx,
			pivotY: pivot ? pivot[1] : my,
			pivotUntil: this.time + 0.3 + this.rand() * 0.35
		};
		members.forEach((m, k) => {
			cluster.lx[k] = this.cx[m] - mx;
			cluster.ly[k] = this.cy[m] - my;
			cluster.la[k] = this.ang[m];
			this.state[m] = FALLING;
			this.inCluster[m] = 1;
		});
		this.clusters.push(cluster);
	}

	private updateBodies(dt: number) {
		const g = this.gravity;

		for (let c = this.clusters.length - 1; c >= 0; c--) {
			const cl = this.clusters[c];
			if (cl.pivoting) {
				const rx = cl.cx - cl.pivotX;
				const ry = cl.cy - cl.pivotY;
				const r2 = Math.max(rx * rx + ry * ry, (0.12 * this.structure.scale) ** 2);
				cl.av += ((g * rx) / r2) * dt;
				const da = cl.av * dt;
				cl.angle += da;
				const cos = Math.cos(da);
				const sin = Math.sin(da);
				cl.cx = cl.pivotX + rx * cos - ry * sin;
				cl.cy = cl.pivotY + rx * sin + ry * cos;
				if (this.time >= cl.pivotUntil || Math.abs(cl.angle) > 1.3) {
					cl.pivoting = false;
					cl.vx = -cl.av * (cl.cy - cl.pivotY);
					cl.vy = cl.av * (cl.cx - cl.pivotX);
				}
			} else {
				cl.vy += g * dt;
				cl.cx += cl.vx * dt;
				cl.cy += cl.vy * dt;
				cl.angle += cl.av * dt;
			}
			const cos = Math.cos(cl.angle);
			const sin = Math.sin(cl.angle);
			let hit = false;
			cl.members.forEach((m, k) => {
				this.cx[m] = cl.cx + cl.lx[k] * cos - cl.ly[k] * sin;
				this.cy[m] = cl.cy + cl.lx[k] * sin + cl.ly[k] * cos;
				this.ang[m] = cl.la[k] + cl.angle;
				if (!hit && this.belowGround(m)) hit = true;
			});
			if (hit) {
				// Shatter: every beam goes its own way with the velocity it had.
				let speed = 0;
				for (const m of cl.members) {
					const rx = this.cx[m] - cl.cx;
					const ry = this.cy[m] - cl.cy;
					this.vx[m] = cl.vx - cl.av * ry + (this.rand() - 0.5) * 0.3 * this.structure.scale;
					this.vy[m] = cl.vy + cl.av * rx;
					this.av[m] = cl.av + (this.rand() - 0.5) * 5;
					this.inCluster[m] = 0;
					speed = Math.max(speed, Math.abs(this.vy[m]));
				}
				const lead = cl.members[0];
				this.emit(
					'crash',
					cl.cx,
					this.structure.lines[this.structure.beams[lead].line].ground,
					this.structure.beams[lead].letter,
					clamp(speed / (3 * this.structure.scale), 0.2, 1) * Math.min(1, cl.members.length / 6)
				);
				this.clusters.splice(c, 1);
			}
		}

		for (let i = 0; i < this.count; i++) {
			if (this.state[i] !== FALLING || this.inCluster[i]) continue;
			this.vy[i] += g * dt;
			const drag = Math.exp(-0.4 * dt);
			this.vx[i] *= drag;
			this.vy[i] *= drag;
			// Debris that tumbles past the end of the sill is nudged back onto it.
			const line = this.structure.lines[this.structure.beams[i].line];
			if (this.cx[i] < line.x0) this.vx[i] += 4 * this.structure.scale * dt;
			else if (this.cx[i] > line.x1) this.vx[i] -= 4 * this.structure.scale * dt;
			this.cx[i] += this.vx[i] * dt;
			this.cy[i] += this.vy[i] * dt;
			this.ang[i] += this.av[i] * dt;
			this.collide(i, dt);
			// Nothing tumbles for ever: a real pile would have caught it by now.
			this.fallTime[i] += dt;
			if (this.state[i] === FALLING && this.fallTime[i] > 2.2) this.settle(i);
		}
	}

	private groundAt(line: number, x: number): number {
		const l = this.structure.lines[line];
		const pile = this.piles[line];
		const bin = clamp(Math.floor((x - l.x0) / this.pileBin), 0, pile.length - 1);
		return l.ground - pile[bin];
	}

	private belowGround(i: number): boolean {
		const line = this.structure.beams[i].line;
		const half = this.len[i] / 2;
		const c = Math.cos(this.ang[i]) * half;
		const s = Math.sin(this.ang[i]) * half;
		const w = this.structure.beams[i].width / 2;
		return (
			this.cy[i] + s + w > this.groundAt(line, this.cx[i] + c) ||
			this.cy[i] - s + w > this.groundAt(line, this.cx[i] - c)
		);
	}

	/** Rigid rod against the ground: contact impulses with restitution and friction. */
	private collide(i: number, dt: number) {
		const beam = this.structure.beams[i];
		const L = this.len[i];
		const inertia = Math.max((L * L) / 12, 1);
		const half = L / 2;
		let contacts = 0;
		for (const sign of [-1, 1]) {
			const rx = Math.cos(this.ang[i]) * half * sign;
			const ry = Math.sin(this.ang[i]) * half * sign;
			const ground = this.groundAt(beam.line, this.cx[i] + rx) - beam.width / 2;
			const ey = this.cy[i] + ry;
			if (ey < ground) continue;
			contacts++;
			this.cy[i] -= ey - ground;
			const vex = this.vx[i] - this.av[i] * ry;
			const vey = this.vy[i] + this.av[i] * rx;
			if (vey > 0) {
				const rn = -rx;
				const j = (1.25 * vey) / (1 + (rn * rn) / inertia);
				this.vy[i] -= j;
				this.av[i] += (rn * j) / inertia;
				const rt = -ry;
				let jt = -vex / (1 + (rt * rt) / inertia);
				jt = clamp(jt, -0.6 * j, 0.6 * j);
				this.vx[i] += jt;
				this.av[i] += (rt * jt) / inertia;
			}
		}
		if (!contacts) return;
		this.av[i] = clamp(this.av[i] * Math.exp(-8 * dt), -10, 10);
		this.vx[i] *= Math.exp(-3 * dt);
		this.contactTime[i] += dt;
		const slow =
			Math.hypot(this.vx[i], this.vy[i]) < 0.12 * this.structure.scale &&
			Math.abs(this.av[i]) < 0.8;
		// Rest when it lies flat, has calmed down, or has rocked on the pile long enough.
		if (contacts === 2 || (slow && this.contactTime[i] > 0.08) || this.contactTime[i] > 0.7) {
			this.settle(i);
		}
	}

	private settle(i: number) {
		this.state[i] = RESTING;
		this.vx[i] = this.vy[i] = this.av[i] = 0;
		const beam = this.structure.beams[i];
		const line = this.structure.lines[beam.line];
		const pile = this.piles[beam.line];
		const half = (this.len[i] / 2) * Math.abs(Math.cos(this.ang[i]));
		const from = clamp(
			Math.floor((this.cx[i] - half - line.x0) / this.pileBin),
			0,
			pile.length - 1
		);
		const to = clamp(Math.floor((this.cx[i] + half - line.x0) / this.pileBin), 0, pile.length - 1);
		const add = beam.width * 0.55;
		for (let b = from; b <= to; b++) pile[b] = Math.min(this.pileMax, pile[b] + add);
	}

	// --- Helpers ----------------------------------------------------------------

	private closestParam(i: number, x: number, y: number): number {
		const L = this.len[i] * this.grow[i];
		if (L < 1e-6) return 0.5;
		const dx = Math.cos(this.ang[i]);
		const dy = Math.sin(this.ang[i]);
		const ax = this.cx[i] - (dx * L) / 2;
		const ay = this.cy[i] - (dy * L) / 2;
		return clamp(((x - ax) * dx + (y - ay) * dy) / L, 0, 1);
	}

	private emit(kind: SimEvent['kind'], x: number, y: number, letter: number, strength: number) {
		if (this.eventCount >= 96) return;
		const e = this.eventPool[this.eventCount] ?? { kind, x, y, letter, strength };
		e.kind = kind;
		e.x = x;
		e.y = y;
		e.letter = letter;
		e.strength = strength;
		this.eventPool[this.eventCount++] = e;
	}
}

/** A grid of points on the letter's skin, to measure how much of it is burnt or painted. */
function skinSamples(letter: LetterDef): Float32Array {
	const pts: number[] = [];
	const nx = 7;
	const ny = 10;
	for (let iy = 0; iy < ny; iy++) {
		for (let ix = 0; ix < nx; ix++) {
			const x = letter.x + ((ix + 0.5) / nx) * letter.width;
			const y = letter.y + ((iy + 0.5) / ny) * letter.height;
			if (pointInLetter(letter, x, y)) pts.push(x, y);
		}
	}
	if (!pts.length) pts.push(letter.x + letter.width / 2, letter.y + letter.height / 2);
	return Float32Array.from(pts);
}
