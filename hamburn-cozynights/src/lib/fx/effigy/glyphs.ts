/**
 * Letter skeletons for the effigy title.
 *
 * Every letter is a set of strokes: centerlines of timber trusses in a unit
 * box that is GLYPH_WIDTH wide and 1 tall (y points down, 1 is the baseline).
 * structure.ts turns each stroke into a truss of rails, posts and braces that
 * is GLYPH_STROKE thick. Round letters are drawn with chamfered corners, the
 * way you would build them from straight timber.
 *
 * Strokes that should hold each other up must touch: a stroke end resting on
 * the side of another stroke (or overlapping it) is bolted to it.
 */

export const GLYPH_WIDTH = 0.66;
/** Truss thickness (distance between the two rails) of a regular stroke. */
export const GLYPH_STROKE = 0.15;

export type Point = readonly [number, number];

export interface Stroke {
	points: readonly Point[];
	/** Truss thickness; defaults to GLYPH_STROKE. Diagonals are a bit thinner. */
	thickness?: number;
	/** Last point connects back to the first one. */
	closed?: boolean;
}

// Centerlines of the outer strokes: stems sit on the box edges, bars on the
// cap line and the baseline, so the trusses fill the box exactly.
const L = 0.075; // left stem
const R = 0.585; // right stem
const IL = 0.15; // inner rail of the left stem
const IR = 0.51; // inner rail of the right stem
const T = 0.075; // top bar
const B = 0.925; // bottom bar
const C = 0.33; // center line
const DIAG = 0.13;

const stroke = (points: Point[], thickness?: number, closed?: boolean): Stroke => ({
	points,
	thickness,
	closed
});

export const GLYPHS: Readonly<Record<string, readonly Stroke[]>> = {
	A: [
		stroke([
			[L, 1],
			[L, 0.215],
			[0.215, T],
			[0.445, T],
			[R, 0.215],
			[R, 1]
		]),
		stroke([
			[IL, 0.56],
			[IR, 0.56]
		])
	],
	B: [
		stroke([
			[L, 0],
			[L, 1]
		]),
		stroke([
			[IL, T],
			[0.43, T],
			[0.545, 0.19],
			[0.545, 0.36],
			[0.43, 0.5],
			[IL, 0.5]
		]),
		stroke([
			[0.43, 0.5],
			[R, 0.64],
			[R, 0.81],
			[0.47, B],
			[IL, B]
		])
	],
	C: [
		stroke([
			[R, 0.2],
			[0.46, T],
			[0.215, T],
			[L, 0.215],
			[L, 0.785],
			[0.215, B],
			[0.46, B],
			[R, 0.8]
		])
	],
	G: [
		stroke([
			[R, 0.2],
			[0.46, T],
			[0.215, T],
			[L, 0.215],
			[L, 0.785],
			[0.215, B],
			[0.46, B],
			[R, 0.785],
			[R, 0.5],
			[0.36, 0.5]
		])
	],
	H: [
		stroke([
			[L, 0],
			[L, 1]
		]),
		stroke([
			[R, 0],
			[R, 1]
		]),
		stroke([
			[IL, 0.5],
			[IR, 0.5]
		])
	],
	I: [
		stroke([
			[C, 0.15],
			[C, 0.85]
		]),
		stroke([
			[0.08, T],
			[0.58, T]
		]),
		stroke([
			[0.08, B],
			[0.58, B]
		])
	],
	M: [
		stroke([
			[L, 1],
			[L, 0]
		]),
		stroke([
			[R, 1],
			[R, 0]
		]),
		// A short flat at the bottom of the V keeps the corner joints sound.
		stroke(
			[
				[IL, 0.04],
				[0.295, 0.6],
				[0.365, 0.6],
				[IR, 0.04]
			],
			0.12
		)
	],
	N: [
		stroke([
			[L, 1],
			[L, 0]
		]),
		stroke([
			[R, 1],
			[R, 0]
		]),
		stroke(
			[
				[IL, 0.06],
				[IR, 0.94]
			],
			DIAG
		)
	],
	O: [
		stroke(
			[
				[0.215, T],
				[0.445, T],
				[R, 0.215],
				[R, 0.785],
				[0.445, B],
				[0.215, B],
				[L, 0.785],
				[L, 0.215]
			],
			undefined,
			true
		)
	],
	R: [
		stroke([
			[L, 0],
			[L, 1]
		]),
		stroke([
			[IL, T],
			[0.445, T],
			[R, 0.215],
			[R, 0.4],
			[0.445, 0.54],
			[IL, 0.54]
		]),
		stroke(
			[
				[0.34, 0.6],
				[R, 1]
			],
			DIAG
		)
	],
	S: [
		stroke([
			[R, 0.19],
			[0.47, T],
			[0.19, T],
			[L, 0.19],
			[L, 0.37],
			[0.19, 0.5],
			[0.47, 0.5],
			[R, 0.63],
			[R, 0.81],
			[0.47, B],
			[0.19, B],
			[L, 0.81]
		])
	],
	T: [
		stroke([
			[0, T],
			[GLYPH_WIDTH, T]
		]),
		stroke([
			[C, 0.15],
			[C, 1]
		])
	],
	U: [
		stroke([
			[L, 0],
			[L, 0.785],
			[0.215, B],
			[0.445, B],
			[R, 0.785],
			[R, 0]
		])
	],
	Y: [
		stroke([
			[L, 0],
			[L, 0.2],
			[C, 0.54]
		]),
		stroke([
			[R, 0],
			[R, 0.2],
			[C, 0.54]
		]),
		stroke([
			[C, 0.54],
			[C, 1]
		])
	],
	Z: [
		stroke([
			[0, T],
			[GLYPH_WIDTH, T]
		]),
		stroke(
			[
				[0.53, 0.15],
				[0.13, 0.85]
			],
			DIAG
		),
		stroke([
			[0, B],
			[GLYPH_WIDTH, B]
		])
	]
};

export function hasGlyph(char: string): boolean {
	return Object.prototype.hasOwnProperty.call(GLYPHS, char);
}
