/**
 * The burn cycle of the effigy title, without any drawing:
 *
 *   build → stand → burn → embers → rebuild → stand → …
 *
 * - Fire runs along each beam from where it caught, passes on to the beams
 *   bolted to the same joint, and jumps to anything close by through heat
 *   (upwards much more than sideways or down).
 * - Burning beams char, and once they are charred far enough they break.
 *   Whatever no longer connects to the ground falls, first swinging on the
 *   joint it hung from, then as one piece that shatters when it hits the pile.
 * - Debris tumbles with simple rigid-body contacts, piles up on the sill and
 *   burns down to embers.
 * - The rebuild lifts every beam back into place ("phoenix").
 *
 * All state lives in typed arrays indexed by beam id. Randomness comes from a
 * seeded generator, so a run is reproducible (see tests/effigy.test.ts).
 */
import { computeSupport, type EffigyStructure } from './structure';

export type Phase = 'build' | 'stand' | 'burn' | 'embers' | 'rebuild';
export type IgnitionKind = 'fuse' | 'spark' | 'torch';

/** Beam states. */
export const STANDING = 0;
export const FALLING = 1;
export const RESTING = 2;
export const FLYING = 3;

/** Seconds the title stands before it is lit. */
export const HOLD_SECONDS = 2.2;
/** Seconds the embers glow before the rebuild. */
export const EMBER_SECONDS = 2.4;
/** From here on the fire gets help, so no cycle drags on. */
const BURN_ASSIST_AFTER = 5;
/** Anything still standing then collapses. */
const BURN_MAX = 10;
const RADIATION_TICK = 0.1;
const MAX_STEP = 1 / 90;

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
const wrapAngle = (a: number) => {
	a = (a + Math.PI) % (Math.PI * 2);
	if (a < 0) a += Math.PI * 2;
	return a - Math.PI;
};

export interface SimEvent {
	kind: 'impact' | 'arrive' | 'crash';
	x: number;
	y: number;
	/** Letter index (for colors) or -1. */
	letter: number;
	/** 0..1 */
	strength: number;
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
	active: boolean;
	/** Launch time (simulation seconds); it waits off screen until then. */
	launchAt: number;
	x: number;
	y: number;
	vx: number;
	vy: number;
	t: number;
	duration: number;
	target: number;
}

export interface SimulationOptions {
	seed?: number;
	/** 'build' starts with sparks forming the letters, 'stand' with a finished title. */
	start?: 'build' | 'stand';
	/** Light the title automatically after it has stood for a while. */
	autoIgnite?: boolean;
}

export class EffigySimulation {
	readonly structure: EffigyStructure;
	readonly count: number;
	readonly rand: () => number;
	readonly autoIgnite: boolean;

	phase: Phase = 'stand';
	time = 0;
	phaseStart = 0;
	cycle = 0;
	/** Horizontal wind in px/s, changes every cycle. */
	wind = 0;
	lastIgnition: IgnitionKind | null = null;
	/** Burning arrows of the 'spark' ignition, one per line of text. */
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
	private readonly burnSeconds: Float32Array;
	private readonly breakAt: Float32Array;
	private readonly speed: Float32Array;
	private readonly pendingAt: Float32Array;
	private readonly pendingU: Float32Array;
	/** Seconds a falling beam has been touching the ground / tumbling on its own. */
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
	private radiationClock = 0;
	private idleClock = 0;
	private assistClock = 0;
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
		this.rand = mulberry32(options.seed ?? 1);
		this.autoIgnite = options.autoIgnite ?? true;
		const n = this.count;
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
			this.startFlight(true);
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
	 * Light standing beams near (x, y) — the cursor or a finger acting as a
	 * torch. Returns true when something caught fire.
	 */
	torch(x: number, y: number, radius: number): boolean {
		if (this.phase !== 'stand' && this.phase !== 'burn') return false;
		let lit = false;
		for (let i = 0; i < this.count; i++) {
			if (
				this.state[i] !== STANDING ||
				this.ignited[i] ||
				this.structure.beams[i].kind === 'sill'
			) {
				continue;
			}
			const reach = this.len[i] / 2 + radius + this.structure.beams[i].width;
			if (Math.abs(this.cx[i] - x) > reach || Math.abs(this.cy[i] - y) > reach) continue;
			const u = this.closestParam(i, x, y);
			const [px, py] = this.pointAt(i, u);
			if (Math.hypot(px - x, py - y) <= radius + this.structure.beams[i].width) {
				this.ignite(i, u);
				lit = true;
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

	/** Point at parameter u (0 = end A, 1 = end B) of beam i, in its current pose. */
	pointAt(i: number, u: number): [number, number] {
		const half = this.len[i] * this.grow[i];
		const k = (u - 0.5) * half;
		return [this.cx[i] + Math.cos(this.ang[i]) * k, this.cy[i] + Math.sin(this.ang[i]) * k];
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
				if (this.updateFlight()) this.enter('stand');
				break;
			case 'stand':
				if (this.autoIgnite && since >= (this.cycle === 0 ? HOLD_SECONDS + 0.4 : HOLD_SECONDS)) {
					this.autoLight();
				}
				break;
			case 'burn':
				if (since > BURN_ASSIST_AFTER) this.assist(dt);
				if (since > BURN_MAX) this.collapseAll();
				if (since > BURN_MAX + 3) this.settleAll();
				if (this.nothingLeftStanding()) this.enter('embers');
				break;
			case 'embers':
				if (since > EMBER_SECONDS) this.startFlight(false);
				break;
		}

		this.updateProjectiles(dt);
		this.updateFire(dt);
		this.updateBodies(dt);
	}

	private autoLight() {
		this.lastIgnition = this.rand() < 0.5 ? 'fuse' : 'spark';
		if (this.lastIgnition === 'fuse') {
			this.structure.lines.forEach((line, index) => {
				const sill = this.structure.beams.filter((b) => b.kind === 'sill' && b.line === index);
				if (!sill.length) return;
				const fromLeft = this.rand() < 0.6;
				const first = fromLeft ? sill[0] : sill[sill.length - 1];
				this.schedule(first.id, index * 0.5, fromLeft ? 0 : 1);
			});
		} else {
			// One burning arrow per line, the second one a moment later.
			const first = this.rand() < 0.5 ? 0 : 1;
			this.structure.lines.forEach((_, index) => {
				this.launchProjectile(index, index === first % this.structure.lines.length ? 0 : 0.55);
			});
		}
		this.enter('burn');
	}

	private launchProjectile(line: number, delay: number) {
		const S = this.structure.scale;
		const letters = this.structure.letters.filter((l) => l.line === line);
		if (!letters.length) return;
		const letter = letters[Math.floor(this.rand() * letters.length)];
		const candidates = letter.beams.filter(
			(id) => this.state[id] === STANDING && this.tcy[id] > letter.y + letter.height * 0.55
		);
		const pool = candidates.length ? candidates : letter.beams;
		const target = pool[Math.floor(this.rand() * pool.length)];
		const p: Projectile = {
			active: true,
			launchAt: this.time + delay,
			x: 0,
			y: 0,
			vx: 0,
			vy: 0,
			t: 0,
			duration: 1,
			target
		};
		this.projectiles.push(p);
		const fromLeft = this.tcx[target] > this.structure.width / 2;
		const sx = fromLeft ? -0.6 * S : this.structure.width + 0.6 * S;
		const sy = -1.0 * S;
		const duration = 0.85 + this.rand() * 0.3;
		const g = 2.4 * S;
		p.x = sx;
		p.y = sy;
		p.duration = duration;
		p.vx = (this.tcx[target] - sx) / duration;
		p.vy = (this.tcy[target] - sy - 0.5 * g * duration * duration) / duration;
	}

	private updateProjectiles(dt: number) {
		if (!this.projectiles.length) return;
		const S = this.structure.scale;
		const g = 2.4 * S;
		for (const p of this.projectiles) {
			if (!p.active || this.time < p.launchAt) continue;
			p.vy += g * dt;
			p.x += p.vx * dt;
			p.y += p.vy * dt;
			p.t += dt;
			if (p.t < p.duration) continue;
			p.active = false;
			for (let i = 0; i < this.count; i++) {
				if (this.state[i] !== STANDING || this.ignited[i]) continue;
				const reach = this.len[i] / 2 + 0.3 * S;
				if (Math.abs(this.cx[i] - p.x) > reach || Math.abs(this.cy[i] - p.y) > reach) continue;
				const u = this.closestParam(i, p.x, p.y);
				const [px, py] = this.pointAt(i, u);
				if (Math.hypot(px - p.x, py - p.y) < 0.28 * S) this.ignite(i, u);
			}
			this.emit('impact', p.x, p.y, this.structure.beams[p.target]?.letter ?? -1, 1);
		}
		if (this.projectiles.every((p) => !p.active)) this.projectiles.length = 0;
	}

	/** Late in a burn: keep the fire going and bring down stubborn remains. */
	private assist(dt: number) {
		this.assistClock += dt;
		if (this.assistClock < 0.3) return;
		this.assistClock = 0;
		const standing: number[] = [];
		for (let i = 0; i < this.count; i++) {
			if (
				this.state[i] === STANDING &&
				!this.ignited[i] &&
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
		for (let i = 0; i < this.count; i++) {
			if (this.state[i] === STANDING && this.structure.beams[i].kind !== 'sill') {
				if (!this.ignited[i]) this.ignite(i, 0.5);
				this.breakBeam(i);
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

	// --- Flight (build / rebuild) -------------------------------------------

	private startFlight(first: boolean) {
		const S = this.structure.scale;
		const beams = this.structure.beams;
		this.clusters = [];
		this.projectiles.length = 0;
		for (const pile of this.piles) pile.fill(0);

		for (const beam of beams) {
			const i = beam.id;
			const line = this.structure.lines[beam.line];
			this.inCluster[i] = 0;
			this.vx[i] = this.vy[i] = this.av[i] = 0;
			if (first) {
				// Sparks rising from the sill grow into beams.
				this.cx[i] = this.tcx[i] + (this.rand() - 0.5) * 0.5 * S;
				this.cy[i] = line.ground + 0.02 * S;
				this.ang[i] = this.tang[i] + (this.rand() - 0.5) * 2.4;
				this.resetFire(i);
			}
			const relHeight = clamp((line.ground - this.tcy[i]) / S, 0, 1);
			const letterOrder =
				beam.letter >= 0 ? beam.letter / Math.max(1, this.structure.letters.length) : 0;
			// Letter by letter from left to right, each one from the ground up.
			const delay =
				beam.kind === 'sill'
					? this.rand() * 0.25
					: 0.1 + letterOrder * 1.1 + relHeight * 0.45 + this.rand() * 0.12;
			this.flightStart[i] = this.time + delay;
			this.flightDur[i] = (beam.kind === 'sill' ? 0.55 : 0.7) + this.rand() * 0.25;
			this.flightX[i] = this.cx[i];
			this.flightY[i] = this.cy[i];
			this.flightA[i] = this.ang[i];
			this.flightLift[i] = first ? 0 : (0.2 + this.rand() * 0.3) * S;
			this.flightGrow[i] = first ? 1 : 0;
			this.flight[i] = 0;
			this.grow[i] = first ? 0 : 1;
			this.state[i] = FLYING;
		}
		this.cycle += first ? 0 : 1;
		this.newCycleWeather();
		this.enter(first ? 'build' : 'rebuild');
	}

	/** Returns true once every beam is back in place. */
	private updateFlight(): boolean {
		let done = true;
		for (let i = 0; i < this.count; i++) {
			if (this.state[i] !== FLYING) continue;
			const raw = (this.time - this.flightStart[i]) / this.flightDur[i];
			if (raw <= 0) {
				done = false;
				continue;
			}
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
				if (beam.kind === 'post' && this.rand() < 0.35) {
					this.emit('arrive', this.cx[i], this.cy[i], beam.letter, 0.5);
				}
			} else {
				done = false;
			}
		}
		return done;
	}

	// --- Fire -------------------------------------------------------------------

	private resetFire(i: number) {
		const S = this.structure.scale;
		const sill = this.structure.beams[i].kind === 'sill';
		this.heat[i] = 0;
		this.ignited[i] = 0;
		this.lo[i] = this.hi[i] = 0;
		this.spreadA[i] = this.spreadB[i] = 0;
		this.char[i] = 0;
		this.pendingAt[i] = -1;
		this.contactTime[i] = 0;
		this.fallTime[i] = 0;
		this.burnSeconds[i] = sill ? 3.4 + this.rand() * 1.2 : 2.6 + this.rand() * 1.6;
		// Braces drop out early, rails and posts carry the burning frame for longer.
		const brace = this.structure.beams[i].kind === 'brace';
		this.breakAt[i] = brace ? 0.35 + this.rand() * 0.3 : 0.62 + this.rand() * 0.28;
		this.speed[i] = (sill ? 2.6 : 0.9 + this.rand() * 0.6) * S;
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
		this.ignited[i] = 1;
		this.pendingAt[i] = -1;
		this.lo[i] = this.hi[i] = clamp(u, 0, 1);
		// No need to hand the fire back to the joint it came from.
		this.spreadA[i] = u <= 0 ? 1 : 0;
		this.spreadB[i] = u >= 1 ? 1 : 0;
		this.char[i] = Math.max(this.char[i], 0.001);
	}

	private spreadFrom(i: number, joint: number) {
		if (this.state[i] !== STANDING) return;
		for (const k of this.structure.jointBeams[joint]) {
			if (k === i || this.ignited[k] || this.state[k] !== STANDING) continue;
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
			if (
				this.state[i] === STANDING &&
				beams[i].kind !== 'sill' &&
				this.char[i] >= this.breakAt[i]
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
		if (this.phase === 'burn' && !anyBurning && !anyPending && !this.projectiles.length) {
			this.idleClock += dt;
			if (this.idleClock > 0.8) {
				this.idleClock = 0;
				this.assistClock = 1;
				this.assist(0);
			}
		} else {
			this.idleClock = 0;
		}
	}

	/** Heat from burning beams reaches whatever is close, mostly above. */
	private radiate(dt: number) {
		const S = this.structure.scale;
		const R = 0.7 * S;
		const rate =
			(this.phase === 'burn' && this.time - this.phaseStart > BURN_ASSIST_AFTER ? 9 : 4.5) * dt;
		const beams = this.structure.beams;
		const size = this.gridSize;
		const cols = this.gridCols;
		const rows = this.gridRows;
		const ox = 2 * S;
		const oy = 2 * S;

		// Bucket the beams that can still catch fire.
		this.gridHead.fill(-1);
		for (let i = 0; i < this.count; i++) {
			if (this.ignited[i] || this.state[i] === FLYING) continue;
			const gx = Math.floor((this.cx[i] + ox) / size);
			const gy = Math.floor((this.cy[i] + oy) / size);
			if (gx < 0 || gy < 0 || gx >= cols || gy >= rows) continue;
			const cell = gy * cols + gx;
			this.gridNext[i] = this.gridHead[cell];
			this.gridHead[cell] = i;
		}

		for (let i = 0; i < this.count; i++) {
			if (!this.ignited[i] || this.state[i] === FLYING) continue;
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
						if (this.ignited[k]) continue;
						const dx = this.cx[k] - sx;
						const dy = this.cy[k] - sy;
						const d = Math.hypot(dx, dy);
						if (d >= R) continue;
						const falloff = (1 - d / R) * (1 - d / R);
						const upward = 1 + 0.7 * clamp(-dy / R, -1, 1);
						// Debris lying on the sill sets it alight.
						const fuel = beams[k].kind === 'sill' ? 3 : 1;
						this.heat[k] += rate * power * falloff * upward * fuel;
						if (this.heat[k] >= 1) {
							const u = this.closestParam(k, sx, sy);
							this.ignite(k, u);
						}
					}
				}
			}
		}
	}

	private breakBeam(i: number) {
		if (this.state[i] !== STANDING || this.structure.beams[i].kind === 'sill') return;
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
