/**
 * Burner cursor FX: a neon, hue-cycling light ribbon with ember sparks,
 * click shockwaves and a soft cursor spotlight.
 *
 * Everything is rendered by a single WebGL program into one full-viewport
 * canvas with one draw call per frame. All per-frame state lives in
 * preallocated typed arrays (no allocations in the hot path), pointer input
 * only records samples, and the render loop parks itself when nothing is
 * visible so an idle page costs zero frames.
 */

/** Ribbon lifetime in ms — how long a trail sample stays visible. */
export const RIBBON_LIFE = 420;
/** Max stored pointer samples (ring buffer). */
export const POINT_CAP = 128;
/** Min distance in px between stored samples. */
const MIN_SAMPLE_DIST = 2;
/** Core half-width of the ribbon head in CSS px. */
const HEAD_WIDTH = 7.5;
/** Geometry half-width = core * GLOW_SPREAD (the rest is glow falloff). */
const GLOW_SPREAD = 3.2;
/** Max Catmull-Rom subdivisions per sample segment. */
const MAX_SUBDIV = 8;

const EMBER_CAP = 420;
const RING_CAP = 8;
const RING_LIFE = 520;
const HALO_RADIUS = 300;
const HALO_STRENGTH = 0.085;
const HALO_IDLE_MS = 900;

/** Floats per vertex: pos(2) uv(2) hue(1) alpha(1) kind(1). */
export const VERTEX_SIZE = 7;
const MAX_VERTS = 16000;

const KIND_EMBER = 0;
const KIND_RING = 1;
const KIND_HALO = 2;
const KIND_RIBBON = 3;

const VERT_SRC = `
attribute vec2 a_pos;
attribute vec2 a_uv;
attribute float a_hue;
attribute float a_alpha;
attribute float a_kind;
uniform vec2 u_res;
varying vec2 v_uv;
varying float v_hue;
varying float v_alpha;
varying float v_kind;
void main() {
	v_uv = a_uv;
	v_hue = a_hue;
	v_alpha = a_alpha;
	v_kind = a_kind;
	vec2 clip = a_pos / u_res * 2.0 - 1.0;
	gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
}`;

const FRAG_SRC = `
precision mediump float;
varying vec2 v_uv;
varying float v_hue;
varying float v_alpha;
varying float v_kind;

vec3 neon(float h) {
	vec3 k = clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
	return mix(k, vec3(1.0), 0.12);
}

void main() {
	vec3 hue = neon(v_hue);
	vec3 col;
	if (v_kind < 0.5) {
		// Ember: white-hot core, colored glow.
		float r = length(v_uv);
		col = hue * exp(-r * r * 6.0) + vec3(smoothstep(0.28, 0.0, r) * 0.9);
	} else if (v_kind < 1.5) {
		// Shockwave ring.
		float r = length(v_uv);
		float band = (r - 0.8) * 12.0;
		float ring = exp(-band * band);
		col = hue * ring * 1.2 + vec3(ring * ring * 0.35);
	} else if (v_kind < 2.5) {
		// Spotlight halo.
		float r = length(v_uv);
		col = hue * exp(-r * r * 3.5);
	} else {
		// Ribbon: uv.y is the signed distance across the strip.
		float s = abs(v_uv.y);
		float body = smoothstep(0.42, 0.12, s);
		float glow = exp(-s * s * 5.0);
		float core = smoothstep(0.14, 0.0, s);
		col = hue * (body * 0.85 + glow * 0.5) + vec3(core * 0.65);
	}
	col *= v_alpha;
	// Premultiplied output; alpha tracks brightness so it composites like
	// "screen" over the page instead of darkening it.
	float a = clamp(max(col.r, max(col.g, col.b)), 0.0, 1.0);
	gl_FragColor = vec4(min(col, vec3(a)), a);
}`;

/** Circular buffer of pointer samples. Newest sample is at `head - 1`. */
export class PointBuffer {
	readonly x = new Float32Array(POINT_CAP);
	readonly y = new Float32Array(POINT_CAP);
	readonly t = new Float64Array(POINT_CAP);
	readonly stroke = new Uint32Array(POINT_CAP);
	head = 0;
	count = 0;

	push(x: number, y: number, t: number, stroke: number): boolean {
		if (this.count > 0) {
			const last = (this.head - 1 + POINT_CAP) % POINT_CAP;
			if (this.stroke[last] === stroke) {
				const dx = x - this.x[last];
				const dy = y - this.y[last];
				if (dx * dx + dy * dy < MIN_SAMPLE_DIST * MIN_SAMPLE_DIST) return false;
			}
		}
		this.x[this.head] = x;
		this.y[this.head] = y;
		this.t[this.head] = t;
		this.stroke[this.head] = stroke;
		this.head = (this.head + 1) % POINT_CAP;
		if (this.count < POINT_CAP) this.count++;
		return true;
	}

	/** Drop samples older than `life` ms. */
	expire(now: number, life: number) {
		while (this.count > 0) {
			const oldest = (this.head - this.count + POINT_CAP) % POINT_CAP;
			if (now - this.t[oldest] <= life) break;
			this.count--;
		}
	}

	/** Index of the i-th sample from oldest (0) to newest (count - 1). */
	at(i: number): number {
		return (this.head - this.count + i + POINT_CAP) % POINT_CAP;
	}
}

// Scratch buffers for the subdivided ribbon centerline.
const SAMPLE_CAP = POINT_CAP * MAX_SUBDIV + 1;
const sx = new Float32Array(SAMPLE_CAP);
const sy = new Float32Array(SAMPLE_CAP);
const sAge = new Float32Array(SAMPLE_CAP);

/**
 * Append ribbon triangles for every stroke in `points` to `out`, starting at
 * float offset `offset`. Returns the new offset.
 */
export function buildRibbon(
	points: PointBuffer,
	now: number,
	hueBase: number,
	out: Float32Array,
	offset: number
): number {
	let start = 0;
	while (start < points.count) {
		// Find the run of samples sharing a stroke id.
		const strokeId = points.stroke[points.at(start)];
		let end = start + 1;
		while (end < points.count && points.stroke[points.at(end)] === strokeId) end++;
		if (end - start >= 2) {
			const n = subdivide(points, start, end, now);
			offset = emitStrip(n, hueBase, out, offset);
		}
		start = end;
	}
	return offset;
}

/** Catmull-Rom subdivide samples [start, end) into sx/sy/sAge. */
function subdivide(points: PointBuffer, start: number, end: number, now: number): number {
	let n = 0;
	const last = end - 1;
	for (let i = start; i < last; i++) {
		const i0 = points.at(Math.max(i - 1, start));
		const i1 = points.at(i);
		const i2 = points.at(i + 1);
		const i3 = points.at(Math.min(i + 2, last));
		const x0 = points.x[i0],
			y0 = points.y[i0];
		const x1 = points.x[i1],
			y1 = points.y[i1];
		const x2 = points.x[i2],
			y2 = points.y[i2];
		const x3 = points.x[i3],
			y3 = points.y[i3];
		const a1 = now - points.t[i1];
		const a2 = now - points.t[i2];
		const len = Math.hypot(x2 - x1, y2 - y1);
		const steps = Math.min(MAX_SUBDIV, Math.max(1, Math.ceil(len / 6)));
		for (let s = 0; s < steps && n < SAMPLE_CAP - 1; s++) {
			const t = s / steps;
			const t2 = t * t;
			const t3 = t2 * t;
			sx[n] =
				0.5 *
				(2 * x1 +
					(-x0 + x2) * t +
					(2 * x0 - 5 * x1 + 4 * x2 - x3) * t2 +
					(-x0 + 3 * x1 - 3 * x2 + x3) * t3);
			sy[n] =
				0.5 *
				(2 * y1 +
					(-y0 + y2) * t +
					(2 * y0 - 5 * y1 + 4 * y2 - y3) * t2 +
					(-y0 + 3 * y1 - 3 * y2 + y3) * t3);
			sAge[n] = a1 + (a2 - a1) * t;
			n++;
		}
	}
	const li = points.at(last);
	sx[n] = points.x[li];
	sy[n] = points.y[li];
	sAge[n] = now - points.t[li];
	return n + 1;
}

function emitStrip(n: number, hueBase: number, out: Float32Array, offset: number): number {
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
		const life = Math.min(1, Math.max(0, sAge[i] / RIBBON_LIFE));
		const fade = 1 - life;
		const w = HEAD_WIDTH * GLOW_SPREAD * Math.pow(fade, 1.3);
		const lx = sx[i] + nx * w;
		const ly = sy[i] + ny * w;
		const rx = sx[i] - nx * w;
		const ry = sy[i] - ny * w;
		const hue = hueBase + sAge[i] * 0.0009;
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

function vtx(
	out: Float32Array,
	o: number,
	x: number,
	y: number,
	u: number,
	v: number,
	hue: number,
	alpha: number,
	kind: number
): number {
	out[o] = x;
	out[o + 1] = y;
	out[o + 2] = u;
	out[o + 3] = v;
	out[o + 4] = hue;
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
	hue: number,
	alpha: number,
	kind: number
): number {
	if (o + 6 * VERTEX_SIZE > out.length) return o;
	const x0 = x - half,
		x1 = x + half,
		y0 = y - half,
		y1 = y + half;
	o = vtx(out, o, x0, y0, -1, -1, hue, alpha, kind);
	o = vtx(out, o, x1, y0, 1, -1, hue, alpha, kind);
	o = vtx(out, o, x0, y1, -1, 1, hue, alpha, kind);
	o = vtx(out, o, x1, y0, 1, -1, hue, alpha, kind);
	o = vtx(out, o, x1, y1, 1, 1, hue, alpha, kind);
	o = vtx(out, o, x0, y1, -1, 1, hue, alpha, kind);
	return o;
}

function compile(gl: WebGLRenderingContext, type: number, src: string): WebGLShader | null {
	const shader = gl.createShader(type);
	if (!shader) return null;
	gl.shaderSource(shader, src);
	gl.compileShader(shader);
	if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
		console.warn('[burnerTrail] shader error:', gl.getShaderInfoLog(shader));
		gl.deleteShader(shader);
		return null;
	}
	return shader;
}

export interface BurnerTrailOptions {
	/** Follow finger drags on touch devices (off for phones: it would chase every scroll). */
	touch?: boolean;
	/** Shockwave + spark burst on click/tap. */
	clickBurst?: boolean;
	/** Soft spotlight glow that follows the mouse. */
	spotlight?: boolean;
}

/**
 * Mount the FX onto `canvas` (expected to be a fixed, full-viewport,
 * pointer-events:none element). Returns a teardown function, or null when
 * WebGL is unavailable.
 */
export function createBurnerTrail(
	canvas: HTMLCanvasElement,
	{ touch = true, clickBurst = true, spotlight = true }: BurnerTrailOptions = {}
): (() => void) | null {
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

	const verts = new Float32Array(MAX_VERTS * VERTEX_SIZE);
	const points = new PointBuffer();

	// Embers (structure of arrays).
	const ex = new Float32Array(EMBER_CAP);
	const ey = new Float32Array(EMBER_CAP);
	const evx = new Float32Array(EMBER_CAP);
	const evy = new Float32Array(EMBER_CAP);
	const eLife = new Float32Array(EMBER_CAP);
	const eMax = new Float32Array(EMBER_CAP);
	const eSize = new Float32Array(EMBER_CAP);
	const eHue = new Float32Array(EMBER_CAP);
	let emberCount = 0;

	// Shockwave rings.
	const rx = new Float32Array(RING_CAP);
	const ry = new Float32Array(RING_CAP);
	const rBorn = new Float64Array(RING_CAP);
	const rHue = new Float32Array(RING_CAP);
	let ringCount = 0;

	let program: WebGLProgram | null = null;
	let vbo: WebGLBuffer | null = null;
	let uRes: WebGLUniformLocation | null = null;
	let dpr = 1;
	let width = 0;
	let height = 0;

	let raf = 0;
	let running = false;
	let lastFrame = 0;
	let strokeId = 1;
	let strokeActive = false;
	let pointerX = -1;
	let pointerY = -1;
	let lastEmitX = -1;
	let lastEmitY = -1;
	let emberAcc = 0;
	let haloX = 0;
	let haloY = 0;
	let haloAlpha = 0;
	let lastMouseMove = -Infinity;
	let contextLost = false;

	function initGl(): boolean {
		const vs = compile(gl, gl.VERTEX_SHADER, VERT_SRC);
		const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG_SRC);
		if (!vs || !fs) return false;
		program = gl.createProgram();
		if (!program) return false;
		gl.attachShader(program, vs);
		gl.attachShader(program, fs);
		gl.linkProgram(program);
		gl.deleteShader(vs);
		gl.deleteShader(fs);
		if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
			console.warn('[burnerTrail] link error:', gl.getProgramInfoLog(program));
			return false;
		}
		gl.useProgram(program);

		vbo = gl.createBuffer();
		gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
		gl.bufferData(gl.ARRAY_BUFFER, verts.byteLength, gl.DYNAMIC_DRAW);

		const stride = VERTEX_SIZE * 4;
		const attrib = (name: string, size: number, off: number) => {
			const loc = gl.getAttribLocation(program!, name);
			if (loc < 0) return;
			gl.enableVertexAttribArray(loc);
			gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride, off * 4);
		};
		attrib('a_pos', 2, 0);
		attrib('a_uv', 2, 2);
		attrib('a_hue', 1, 4);
		attrib('a_alpha', 1, 5);
		attrib('a_kind', 1, 6);

		uRes = gl.getUniformLocation(program, 'u_res');
		gl.enable(gl.BLEND);
		gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
		gl.clearColor(0, 0, 0, 0);
		resize();
		return true;
	}

	function resize() {
		dpr = Math.min(window.devicePixelRatio || 1, 2);
		width = window.innerWidth;
		height = window.innerHeight;
		canvas.width = Math.round(width * dpr);
		canvas.height = Math.round(height * dpr);
		gl.viewport(0, 0, canvas.width, canvas.height);
		if (uRes) gl.uniform2f(uRes, width, height);
		if (!running) {
			gl.clear(gl.COLOR_BUFFER_BIT);
		}
		wake();
	}

	function wake() {
		if (running || contextLost) return;
		running = true;
		lastFrame = performance.now();
		raf = requestAnimationFrame(frame);
	}

	function spawnEmber(
		x: number,
		y: number,
		vx: number,
		vy: number,
		life: number,
		size: number,
		hue: number
	) {
		if (emberCount >= EMBER_CAP) return;
		const i = emberCount++;
		ex[i] = x;
		ey[i] = y;
		evx[i] = vx;
		evy[i] = vy;
		eLife[i] = life;
		eMax[i] = life;
		eSize[i] = size;
		eHue[i] = hue;
	}

	function addSample(x: number, y: number, t: number) {
		if (!strokeActive) {
			strokeId++;
			strokeActive = true;
			lastEmitX = x;
			lastEmitY = y;
		}
		pointerX = x;
		pointerY = y;
		points.push(x, y, t, strokeId);
	}

	function endStroke() {
		strokeActive = false;
	}

	function burst(x: number, y: number, now: number) {
		const hue = now * 0.00012;
		if (ringCount < RING_CAP) {
			const i = ringCount++;
			rx[i] = x;
			ry[i] = y;
			rBorn[i] = now;
			rHue[i] = hue;
		}
		const n = 30;
		for (let k = 0; k < n; k++) {
			const angle = (k / n) * Math.PI * 2 + Math.random() * 0.2;
			const speed = 220 + Math.random() * 260;
			spawnEmber(
				x,
				y,
				Math.cos(angle) * speed,
				Math.sin(angle) * speed,
				0.45 + Math.random() * 0.35,
				1.6 + Math.random() * 1.6,
				hue + k / n
			);
		}
		wake();
	}

	function frame(now: number) {
		const dt = Math.min(0.05, Math.max(0.001, (now - lastFrame) / 1000));
		lastFrame = now;
		const hueBase = now * 0.00012;

		points.expire(now, RIBBON_LIFE);

		// Emit embers along fast pointer movement.
		if (strokeActive && lastEmitX >= 0) {
			const dx = pointerX - lastEmitX;
			const dy = pointerY - lastEmitY;
			const dist = Math.hypot(dx, dy);
			const speed = dist / dt;
			emberAcc += Math.max(0, speed - 350) / 260;
			const spawn = Math.min(6, Math.floor(emberAcc));
			emberAcc = Math.min(emberAcc - spawn, 1);
			if (dist > 0) {
				const px = -dy / dist;
				const py = dx / dist;
				for (let k = 0; k < spawn; k++) {
					const f = Math.random();
					const side = (Math.random() - 0.5) * 2 * (50 + Math.random() * 120);
					spawnEmber(
						lastEmitX + dx * f,
						lastEmitY + dy * f,
						(dx / dt) * 0.1 + px * side,
						(dy / dt) * 0.1 + py * side,
						0.45 + Math.random() * 0.45,
						1.4 + Math.random() * 1.8,
						hueBase + (Math.random() - 0.5) * 0.16
					);
				}
			}
		}
		lastEmitX = pointerX;
		lastEmitY = pointerY;

		// Integrate embers (swap-remove dead ones).
		const drag = Math.exp(-2.8 * dt);
		for (let i = 0; i < emberCount;) {
			eLife[i] -= dt;
			if (eLife[i] <= 0) {
				const j = --emberCount;
				ex[i] = ex[j];
				ey[i] = ey[j];
				evx[i] = evx[j];
				evy[i] = evy[j];
				eLife[i] = eLife[j];
				eMax[i] = eMax[j];
				eSize[i] = eSize[j];
				eHue[i] = eHue[j];
				continue;
			}
			evx[i] *= drag;
			evy[i] = evy[i] * drag - 60 * dt; // embers drift upward
			ex[i] += evx[i] * dt;
			ey[i] += evy[i] * dt;
			i++;
		}

		// Expire rings.
		for (let i = 0; i < ringCount;) {
			if (now - rBorn[i] >= RING_LIFE) {
				const j = --ringCount;
				rx[i] = rx[j];
				ry[i] = ry[j];
				rBorn[i] = rBorn[j];
				rHue[i] = rHue[j];
				continue;
			}
			i++;
		}

		// Spotlight follows the mouse with a little easing, fades when idle.
		const haloTarget = spotlight && now - lastMouseMove < HALO_IDLE_MS ? 1 : 0;
		haloAlpha += (haloTarget - haloAlpha) * (1 - Math.exp(-dt * (haloTarget ? 6 : 2.5)));
		const follow = 1 - Math.exp(-dt * 14);
		haloX += (pointerX - haloX) * follow;
		haloY += (pointerY - haloY) * follow;

		// Build geometry: halo (back) → rings → ribbon → embers (front).
		let o = 0;
		if (haloAlpha > 0.002) {
			o = quad(
				verts,
				o,
				haloX,
				haloY,
				HALO_RADIUS,
				hueBase + 0.45,
				haloAlpha * HALO_STRENGTH,
				KIND_HALO
			);
		}
		for (let i = 0; i < ringCount; i++) {
			const t = (now - rBorn[i]) / RING_LIFE;
			const ease = 1 - Math.pow(1 - t, 3);
			const radius = 10 + 75 * ease;
			o = quad(verts, o, rx[i], ry[i], radius / 0.8, rHue[i], (1 - t) * (1 - t), KIND_RING);
		}
		o = buildRibbon(points, now, hueBase, verts, o);
		if (strokeActive && points.count > 0) {
			const newest = points.at(points.count - 1);
			const age = now - points.t[newest];
			const headAlpha = Math.max(0, 1 - age / RIBBON_LIFE);
			if (headAlpha > 0) {
				o = quad(verts, o, pointerX, pointerY, HEAD_WIDTH * 2.6, hueBase, headAlpha, KIND_EMBER);
			}
		}
		for (let i = 0; i < emberCount; i++) {
			const lifeT = eLife[i] / eMax[i];
			const flicker = 0.75 + 0.25 * Math.sin(now * 0.03 + i * 1.7);
			o = quad(verts, o, ex[i], ey[i], eSize[i] * 4, eHue[i], lifeT * lifeT * flicker, KIND_EMBER);
		}

		gl.clear(gl.COLOR_BUFFER_BIT);
		if (o > 0) {
			gl.bufferSubData(gl.ARRAY_BUFFER, 0, verts.subarray(0, o));
			gl.drawArrays(gl.TRIANGLES, 0, o / VERTEX_SIZE);
		}

		const idle =
			points.count === 0 &&
			emberCount === 0 &&
			ringCount === 0 &&
			haloTarget === 0 &&
			haloAlpha <= 0.002;
		if (idle) {
			running = false;
			raf = 0;
			return;
		}
		raf = requestAnimationFrame(frame);
	}

	// --- Input -------------------------------------------------------------

	const onPointerMove = (e: PointerEvent) => {
		if (e.pointerType === 'touch') return; // handled by touch listeners (survive scrolling)
		const events = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
		if (events.length > 1) {
			for (const ce of events) addSample(ce.clientX, ce.clientY, ce.timeStamp || e.timeStamp);
		} else {
			addSample(e.clientX, e.clientY, e.timeStamp);
		}
		if (haloAlpha <= 0.002) {
			haloX = e.clientX;
			haloY = e.clientY;
		}
		lastMouseMove = performance.now();
		wake();
	};

	const onPointerDown = (e: PointerEvent) => {
		if (e.pointerType === 'mouse' && e.button !== 0) return;
		burst(e.clientX, e.clientY, performance.now());
	};

	const onLeave = (e: MouseEvent) => {
		if (!e.relatedTarget) {
			endStroke();
			lastMouseMove = -Infinity;
		}
	};

	const onTouchStart = (e: TouchEvent) => {
		endStroke();
		const t = e.touches[0];
		if (t) {
			addSample(t.clientX, t.clientY, performance.now());
			wake();
		}
	};

	const onTouchMove = (e: TouchEvent) => {
		const t = e.touches[0];
		if (!t) return;
		addSample(t.clientX, t.clientY, performance.now());
		wake();
	};

	const onTouchEnd = () => endStroke();

	// Hidden tab: browsers park requestAnimationFrame anyway, but the loop
	// would resume mid-stroke with a stale pointer and a huge frame gap. Stop
	// it cleanly and let the next input (or the return) wake it again.
	const onVisibility = () => {
		if (document.hidden) {
			cancelAnimationFrame(raf);
			raf = 0;
			running = false;
			endStroke();
			lastMouseMove = -Infinity;
		} else {
			wake();
		}
	};

	const onContextLost = (e: Event) => {
		e.preventDefault();
		contextLost = true;
		cancelAnimationFrame(raf);
		running = false;
	};

	const onContextRestored = () => {
		contextLost = false;
		initGl();
	};

	if (!initGl()) return null;

	const passive: AddEventListenerOptions = { passive: true };
	window.addEventListener('pointermove', onPointerMove, passive);
	window.addEventListener('resize', resize, passive);
	document.addEventListener('mouseout', onLeave, passive);
	if (clickBurst) window.addEventListener('pointerdown', onPointerDown, passive);
	if (touch) {
		window.addEventListener('touchstart', onTouchStart, passive);
		window.addEventListener('touchmove', onTouchMove, passive);
		window.addEventListener('touchend', onTouchEnd, passive);
		window.addEventListener('touchcancel', onTouchEnd, passive);
	}
	document.addEventListener('visibilitychange', onVisibility);
	canvas.addEventListener('webglcontextlost', onContextLost);
	canvas.addEventListener('webglcontextrestored', onContextRestored);

	return () => {
		cancelAnimationFrame(raf);
		running = false;
		document.removeEventListener('visibilitychange', onVisibility);
		window.removeEventListener('pointermove', onPointerMove);
		window.removeEventListener('resize', resize);
		document.removeEventListener('mouseout', onLeave);
		window.removeEventListener('pointerdown', onPointerDown);
		window.removeEventListener('touchstart', onTouchStart);
		window.removeEventListener('touchmove', onTouchMove);
		window.removeEventListener('touchend', onTouchEnd);
		window.removeEventListener('touchcancel', onTouchEnd);
		canvas.removeEventListener('webglcontextlost', onContextLost);
		canvas.removeEventListener('webglcontextrestored', onContextRestored);
		if (vbo) gl.deleteBuffer(vbo);
		if (program) gl.deleteProgram(program);
		gl.getExtension('WEBGL_lose_context')?.loseContext();
	};
}
