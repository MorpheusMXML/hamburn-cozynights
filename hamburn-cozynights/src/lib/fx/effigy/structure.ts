/**
 * Builds the timber structure of the effigy title: every letter stroke becomes
 * a truss (two rails, posts, diagonal braces), strokes that touch are bolted
 * together at shared joints, and each line of text stands on a wooden sill.
 *
 * Pure and deterministic (given the same `rand`), so it can be unit tested and
 * rebuilt whenever the canvas changes size. All output coordinates are CSS
 * pixels relative to the top-left corner of the layout box.
 */
import { GLYPH_STROKE, GLYPH_WIDTH, GLYPHS, hasGlyph, type Point, type Stroke } from './glyphs';

/** Gap between two letters of a word, in letter heights. */
export const LETTER_GAP = 0.13;
/** Space between the sill of one line and the letter tops of the next line. */
export const LINE_GAP = 0.5;
/** Height of the sill every line stands on. */
export const SILL_HEIGHT = 0.06;
/** How far the sill reaches beyond the first and last letter. */
export const SILL_OVERHANG = 0.12;
/** Width reserved for a space character. */
export const SPACE_WIDTH = 0.45;

export const DEFAULT_LINES: readonly string[] = ['HAMBURN', 'COZYNIGHTS'];

export type BeamKind = 'rail' | 'post' | 'brace' | 'sill';

export interface BeamDef {
	id: number;
	kind: BeamKind;
	/** Index into `letters`, or -1 for sill segments. */
	letter: number;
	line: number;
	ax: number;
	ay: number;
	bx: number;
	by: number;
	length: number;
	/** Drawn line width in px. */
	width: number;
	jointA: number;
	jointB: number;
	/** 0..1, varies the wood tone per beam. */
	shade: number;
}

export interface LetterDef {
	index: number;
	char: string;
	line: number;
	x: number;
	y: number;
	width: number;
	height: number;
	beams: number[];
}

export interface LineDef {
	index: number;
	text: string;
	/** Left and right end of the sill. */
	x0: number;
	x1: number;
	/** Cap line (top of the letters). */
	top: number;
	/** Top of the sill: letters stand on it and debris lands on it. */
	ground: number;
}

export interface EffigyStructure {
	/** Letter height in px. */
	scale: number;
	width: number;
	height: number;
	beams: BeamDef[];
	letters: LetterDef[];
	lines: LineDef[];
	jointCount: number;
	/** Beams that meet at each joint. */
	jointBeams: number[][];
	/** 1 where a joint rests on the ground (a letter's feet or the sill). */
	groundedJoints: Uint8Array;
}

/** Width of one line in letter heights. */
export function lineWidthUnits(text: string): number {
	let width = 0;
	let prevWasLetter = false;
	for (const char of text) {
		if (hasGlyph(char)) {
			if (prevWasLetter) width += LETTER_GAP;
			width += GLYPH_WIDTH;
			prevWasLetter = true;
		} else {
			width += SPACE_WIDTH;
			prevWasLetter = false;
		}
	}
	return width;
}

/** Size of the layout box in letter heights. */
export function layoutUnits(lines: readonly string[] = DEFAULT_LINES) {
	const width = Math.max(0, ...lines.map(lineWidthUnits)) + 2 * SILL_OVERHANG;
	const height = lines.length * (1 + SILL_HEIGHT) + Math.max(0, lines.length - 1) * LINE_GAP;
	return { width, height };
}

/** Width / height of the layout box; use it to reserve space before the canvas runs. */
export function effigyAspect(lines: readonly string[] = DEFAULT_LINES): number {
	const { width, height } = layoutUnits(lines);
	return width / height;
}

// --- Union-find over nodes --------------------------------------------------

class UnionFind {
	private parent: number[] = [];

	add(): number {
		this.parent.push(this.parent.length);
		return this.parent.length - 1;
	}

	find(i: number): number {
		let root = i;
		while (this.parent[root] !== root) root = this.parent[root];
		while (this.parent[i] !== root) {
			const next = this.parent[i];
			this.parent[i] = root;
			i = next;
		}
		return root;
	}

	union(a: number, b: number) {
		const ra = this.find(a);
		const rb = this.find(b);
		if (ra !== rb) this.parent[rb] = ra;
	}
}

// --- Polyline helpers (unit coordinates) ------------------------------------

interface Segment {
	ax: number;
	ay: number;
	bx: number;
	by: number;
	length: number;
	/** Unit direction. */
	dx: number;
	dy: number;
	/** Unit normal (left of the direction). */
	nx: number;
	ny: number;
	/** Arc length at the segment start. */
	start: number;
}

function segmentsOf(stroke: Stroke): Segment[] {
	const pts = stroke.closed ? [...stroke.points, stroke.points[0]] : stroke.points;
	const segs: Segment[] = [];
	let start = 0;
	for (let i = 0; i < pts.length - 1; i++) {
		const [ax, ay] = pts[i];
		const [bx, by] = pts[i + 1];
		const length = Math.hypot(bx - ax, by - ay);
		if (length < 1e-9) continue;
		const dx = (bx - ax) / length;
		const dy = (by - ay) / length;
		segs.push({ ax, ay, bx, by, length, dx, dy, nx: -dy, ny: dx, start });
		start += length;
	}
	return segs;
}

/** Closest point on a polyline: arc length and distance. */
function closestOnPolyline(segs: Segment[], px: number, py: number) {
	let best = { s: 0, dist: Infinity };
	for (const seg of segs) {
		const t = Math.max(0, Math.min(seg.length, (px - seg.ax) * seg.dx + (py - seg.ay) * seg.dy));
		const cx = seg.ax + seg.dx * t;
		const cy = seg.ay + seg.dy * t;
		const dist = Math.hypot(px - cx, py - cy);
		if (dist < best.dist) best = { s: seg.start + t, dist };
	}
	return best;
}

interface Station {
	s: number;
	/** Rail nodes in unit coordinates: left (+normal) and right (-normal). */
	lx: number;
	ly: number;
	rx: number;
	ry: number;
}

/**
 * Stations along a stroke: every vertex, evenly spaced points in between
 * (about `pitch` apart) and the extra arc lengths where other strokes attach.
 */
function stationsOf(
	stroke: Stroke,
	segs: Segment[],
	half: number,
	pitch: number,
	extras: number[]
): Station[] {
	const closed = !!stroke.closed;
	const total = segs.length ? segs[segs.length - 1].start + segs[segs.length - 1].length : 0;

	// Arc lengths: vertices are fixed, regular stations may be snapped to an extra.
	const vertexS = segs.map((seg) => seg.start);
	if (!closed) vertexS.push(total);
	const regular: number[] = [];
	for (const seg of segs) {
		const n = Math.max(1, Math.round(seg.length / pitch));
		for (let j = 1; j < n; j++) regular.push(seg.start + (seg.length * j) / n);
	}
	for (const e of extras) {
		if (vertexS.some((v) => Math.abs(v - e) < pitch * 0.3)) continue;
		let nearest = -1;
		let nearestDist = pitch * 0.3;
		for (let i = 0; i < regular.length; i++) {
			const d = Math.abs(regular[i] - e);
			if (d < nearestDist) {
				nearest = i;
				nearestDist = d;
			}
		}
		if (nearest >= 0) regular[nearest] = e;
		else regular.push(e);
	}
	const all = [
		...vertexS.map((s) => ({ s, vertex: true })),
		...regular.map((s) => ({ s, vertex: false }))
	];
	all.sort((a, b) => a.s - b.s);

	const segAt = (s: number) => {
		for (let i = segs.length - 1; i >= 0; i--) if (s >= segs[i].start - 1e-9) return i;
		return 0;
	};

	return all.map(({ s, vertex }) => {
		const i = segAt(s);
		const seg = segs[i];
		const t = Math.min(seg.length, Math.max(0, s - seg.start));
		const cx = seg.ax + seg.dx * t;
		const cy = seg.ay + seg.dy * t;
		let ox = seg.nx * half;
		let oy = seg.ny * half;
		const atStart = vertex && t < 1e-9;
		const hasPrev = i > 0 || closed;
		if (atStart && hasPrev) {
			// Miter between the previous and this segment, clamped at sharp corners.
			const prev = segs[(i - 1 + segs.length) % segs.length];
			let mx = prev.nx + seg.nx;
			let my = prev.ny + seg.ny;
			const ml = Math.hypot(mx, my);
			if (ml > 1e-6) {
				mx /= ml;
				my /= ml;
				const cos = mx * seg.nx + my * seg.ny;
				const len = Math.min(half / Math.max(cos, 1e-3), half * 2);
				ox = mx * len;
				oy = my * len;
			}
		}
		return { s, lx: cx + ox, ly: cy + oy, rx: cx - ox, ry: cy - oy };
	});
}

// --- Builder -----------------------------------------------------------------

interface NodeRec {
	x: number;
	y: number;
}

export interface BuildOptions {
	/** Random source for wood tones. */
	rand?: () => number;
}

/**
 * Build the structure for `lines` with letters `scale` px tall. The layout box
 * is `layoutUnits(lines)` times `scale` px.
 */
export function buildStructure(
	lines: readonly string[],
	scale: number,
	{ rand = Math.random }: BuildOptions = {}
): EffigyStructure {
	const units = layoutUnits(lines);
	const width = units.width * scale;
	const height = units.height * scale;

	const nodes: NodeRec[] = [];
	const uf = new UnionFind();
	const addNode = (x: number, y: number) => {
		nodes.push({ x, y });
		return uf.add();
	};

	interface RawBeam {
		kind: BeamKind;
		letter: number;
		line: number;
		a: number;
		b: number;
		width: number;
	}
	const raw: RawBeam[] = [];

	const railWidth = Math.max(1.6, 0.03 * scale);
	const postWidth = Math.max(1.2, 0.022 * scale);
	const braceWidth = Math.max(1, 0.017 * scale);
	const crossBraces = scale >= 64;

	const letters: LetterDef[] = [];
	const lineDefs: LineDef[] = [];

	lines.forEach((text, lineIndex) => {
		const top = lineIndex * (1 + SILL_HEIGHT + LINE_GAP) * scale;
		const lineWidth = lineWidthUnits(text) * scale;
		let cursor = (width - lineWidth) / 2;
		const lineStart = cursor;
		let prevWasLetter = false;

		for (const char of text) {
			if (!hasGlyph(char)) {
				cursor += SPACE_WIDTH * scale;
				prevWasLetter = false;
				continue;
			}
			if (prevWasLetter) cursor += LETTER_GAP * scale;
			const letterIndex = letters.length;
			const letter: LetterDef = {
				index: letterIndex,
				char,
				line: lineIndex,
				x: cursor,
				y: top,
				width: GLYPH_WIDTH * scale,
				height: scale,
				beams: []
			};
			letters.push(letter);
			const ox = cursor;
			const toPx = (u: number, v: number): [number, number] => [ox + u * scale, top + v * scale];

			const strokes = GLYPHS[char];
			const segs = strokes.map(segmentsOf);

			// Where do the ends of other strokes rest on this stroke?
			interface Attachment {
				from: number;
				fromEnd: 0 | 1;
				fromSide: 0 | 1;
				to: number;
				s: number;
				qx: number;
				qy: number;
			}
			const attachments: Attachment[] = [];
			strokes.forEach((a, ai) => {
				if (a.closed || !segs[ai].length) return;
				const half = (a.thickness ?? GLYPH_STROKE) / 2;
				const ends: [0 | 1, Point, Segment][] = [
					[0, a.points[0], segs[ai][0]],
					[1, a.points[a.points.length - 1], segs[ai][segs[ai].length - 1]]
				];
				for (const [end, [ex, ey], seg] of ends) {
					for (const side of [0, 1] as const) {
						const sign = side === 0 ? 1 : -1;
						const qx = ex + seg.nx * half * sign;
						const qy = ey + seg.ny * half * sign;
						strokes.forEach((b, bi) => {
							if (bi === ai) return;
							const bHalf = (b.thickness ?? GLYPH_STROKE) / 2;
							const hit = closestOnPolyline(segs[bi], qx, qy);
							if (hit.dist <= bHalf * 1.6) {
								attachments.push({
									from: ai,
									fromEnd: end,
									fromSide: side,
									to: bi,
									s: hit.s,
									qx,
									qy
								});
							}
						});
					}
				}
			});

			// Trusses.
			const strokeNodes: { l: number[]; r: number[] }[] = [];
			strokes.forEach((st, si) => {
				const thickness = st.thickness ?? GLYPH_STROKE;
				const pitch = Math.max(thickness * 1.2, 7 / scale);
				const extras = attachments.filter((at) => at.to === si).map((at) => at.s);
				const stations = stationsOf(st, segs[si], thickness / 2, pitch, extras);
				const l = stations.map((p) => addNode(...toPx(p.lx, p.ly)));
				const r = stations.map((p) => addNode(...toPx(p.rx, p.ry)));
				strokeNodes.push({ l, r });

				const push = (kind: BeamKind, a: number, b: number, w: number) => {
					raw.push({ kind, letter: letterIndex, line: lineIndex, a, b, width: w });
				};
				const n = stations.length;
				const panels = st.closed ? n : n - 1;
				for (let i = 0; i < n; i++) push('post', l[i], r[i], postWidth);
				for (let i = 0; i < panels; i++) {
					const j = (i + 1) % n;
					push('rail', l[i], l[j], railWidth);
					push('rail', r[i], r[j], railWidth);
					if (crossBraces || i % 2 === 0) push('brace', l[i], r[j], braceWidth);
					if (crossBraces || i % 2 === 1) push('brace', r[i], l[j], braceWidth);
				}
			});

			// Bolt attached ends to the nearest rail node at the attachment.
			for (const at of attachments) {
				const fromNodes = strokeNodes[at.from];
				const idx = at.fromEnd === 0 ? 0 : fromNodes.l.length - 1;
				const fromNode = at.fromSide === 0 ? fromNodes.l[idx] : fromNodes.r[idx];
				const target = strokeNodes[at.to];
				const [qx, qy] = toPx(at.qx, at.qy);
				let best = -1;
				let bestDist = Infinity;
				for (const candidate of [...target.l, ...target.r]) {
					const d = Math.hypot(nodes[candidate].x - qx, nodes[candidate].y - qy);
					if (d < bestDist) {
						best = candidate;
						bestDist = d;
					}
				}
				if (best >= 0 && bestDist <= GLYPH_STROKE * scale) uf.union(fromNode, best);
			}

			cursor += GLYPH_WIDTH * scale;
			prevWasLetter = true;
		}

		// The sill: a row of short planks the whole line stands on.
		const x0 = lineStart - SILL_OVERHANG * scale;
		const x1 = lineStart + lineWidth + SILL_OVERHANG * scale;
		const ground = top + scale;
		const sillY = ground + (SILL_HEIGHT * scale) / 2;
		const pieces = Math.max(1, Math.round((x1 - x0) / (0.34 * scale)));
		let prev = addNode(x0, sillY);
		for (let i = 1; i <= pieces; i++) {
			const next = addNode(x0 + ((x1 - x0) * i) / pieces, sillY);
			raw.push({
				kind: 'sill',
				letter: -1,
				line: lineIndex,
				a: prev,
				b: next,
				width: SILL_HEIGHT * scale
			});
			prev = next;
		}
		lineDefs.push({ index: lineIndex, text, x0, x1, top, ground });
	});

	// Coincident nodes of different strokes are one joint as well.
	const eps = Math.max(0.5, 0.02 * scale);
	const grid = new Map<string, number[]>();
	const key = (x: number, y: number) => `${Math.floor(x / eps)},${Math.floor(y / eps)}`;
	nodes.forEach((node, i) => {
		const gx = Math.floor(node.x / eps);
		const gy = Math.floor(node.y / eps);
		for (let dx = -1; dx <= 1; dx++) {
			for (let dy = -1; dy <= 1; dy++) {
				for (const j of grid.get(`${gx + dx},${gy + dy}`) ?? []) {
					if (Math.hypot(nodes[j].x - node.x, nodes[j].y - node.y) <= eps) uf.union(i, j);
				}
			}
		}
		const k = key(node.x, node.y);
		const bucket = grid.get(k);
		if (bucket) bucket.push(i);
		else grid.set(k, [i]);
	});

	// Joints: one id per union-find root.
	const jointOf = new Map<number, number>();
	const joint = (node: number) => {
		const root = uf.find(node);
		let id = jointOf.get(root);
		if (id === undefined) {
			id = jointOf.size;
			jointOf.set(root, id);
		}
		return id;
	};

	const beams: BeamDef[] = [];
	for (const rb of raw) {
		const a = nodes[rb.a];
		const b = nodes[rb.b];
		const length = Math.hypot(b.x - a.x, b.y - a.y);
		if (length < 0.5) continue;
		const beam: BeamDef = {
			id: beams.length,
			kind: rb.kind,
			letter: rb.letter,
			line: rb.line,
			ax: a.x,
			ay: a.y,
			bx: b.x,
			by: b.y,
			length,
			width: rb.width,
			jointA: joint(rb.a),
			jointB: joint(rb.b),
			shade: rand()
		};
		beams.push(beam);
		if (beam.letter >= 0) letters[beam.letter].beams.push(beam.id);
	}

	const jointCount = jointOf.size;
	const jointBeams: number[][] = Array.from({ length: jointCount }, () => []);
	for (const beam of beams) {
		jointBeams[beam.jointA].push(beam.id);
		if (beam.jointB !== beam.jointA) jointBeams[beam.jointB].push(beam.id);
	}

	const groundedJoints = new Uint8Array(jointCount);
	const groundTolerance = 0.02 * scale;
	nodes.forEach((node, i) => {
		const root = uf.find(i);
		const id = jointOf.get(root);
		if (id === undefined) return;
		const line = lineDefs.find(
			(l) => node.y <= l.ground + SILL_HEIGHT * scale + 1 && node.y >= l.top - 1
		);
		if (line && node.y >= line.ground - groundTolerance) groundedJoints[id] = 1;
	});

	return {
		scale,
		width,
		height,
		beams,
		letters,
		lines: lineDefs,
		jointCount,
		jointBeams,
		groundedJoints
	};
}

/**
 * Mark the joints that still connect to the ground through standing beams.
 * `standing[i]` is 1 for every beam that is still part of the structure.
 * Returns the number of supported joints.
 */
export function computeSupport(
	structure: EffigyStructure,
	standing: Uint8Array,
	supported: Uint8Array,
	queue: Int32Array = new Int32Array(structure.jointCount)
): number {
	supported.fill(0);
	let head = 0;
	let tail = 0;
	for (let j = 0; j < structure.jointCount; j++) {
		if (structure.groundedJoints[j]) {
			supported[j] = 1;
			queue[tail++] = j;
		}
	}
	while (head < tail) {
		const j = queue[head++];
		for (const id of structure.jointBeams[j]) {
			if (!standing[id]) continue;
			const beam = structure.beams[id];
			const other = beam.jointA === j ? beam.jointB : beam.jointA;
			if (!supported[other]) {
				supported[other] = 1;
				queue[tail++] = other;
			}
		}
	}
	return tail;
}
