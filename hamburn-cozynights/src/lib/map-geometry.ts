// src/lib/map-geometry.ts
/**
 * Coordinate space of the camp map. House positions (`houses.x` / `houses.y`)
 * and layout templates use these units; the map image is drawn over exactly
 * this area, whatever size the map has on screen.
 */
export const MAP_WIDTH = 1000;
export const MAP_HEIGHT = 700;
/**
 * The map picture, drawn over the whole coordinate space. A new year's map
 * gets a new file name, since browsers may keep the old picture under the old
 * one: see docs/develop/index.md, "The map image".
 */
export const MAP_IMAGE = '/lageplan-brahmsee-2026.jpg';

/** Two pins closer than this (in map units) can't be told apart or tapped. */
export const MIN_HOUSE_DISTANCE = 25;

export interface MapPoint {
	x: number;
	y: number;
}

/** The part of a DOMMatrix / SVGMatrix needed to map screen to SVG coordinates. */
export interface ScreenMatrix {
	a: number;
	b: number;
	c: number;
	d: number;
	e: number;
	f: number;
}

/**
 * Converts a pointer position (clientX / clientY) into map units, given the
 * SVG's `getScreenCTM()`. Inverting the whole matrix keeps this correct when
 * the map is scaled, letterboxed, scrolled or the page is zoomed.
 */
export function screenToMap(clientX: number, clientY: number, ctm: ScreenMatrix): MapPoint | null {
	const det = ctm.a * ctm.d - ctm.b * ctm.c;
	if (!Number.isFinite(det) || det === 0) return null;
	const dx = clientX - ctm.e;
	const dy = clientY - ctm.f;
	return {
		x: (ctm.d * dx - ctm.c * dy) / det,
		y: (ctm.a * dy - ctm.b * dx) / det
	};
}

/** Rounds to whole map units and keeps the point on the map. */
export function clampToMap(point: MapPoint): MapPoint {
	return {
		x: Math.min(MAP_WIDTH, Math.max(0, Math.round(point.x))),
		y: Math.min(MAP_HEIGHT, Math.max(0, Math.round(point.y)))
	};
}

/** True when `point` would sit on top of another house's pin. */
export function isTooCloseToOtherHouse(
	houses: ReadonlyArray<{ id: string; x: number; y: number }>,
	movingHouseId: string | null,
	point: MapPoint,
	minDistance = MIN_HOUSE_DISTANCE
): boolean {
	return houses.some(
		(house) =>
			house.id !== movingHouseId && Math.hypot(house.x - point.x, house.y - point.y) < minDistance
	);
}

/**
 * Parses a coordinate that arrives as form data or from a template file.
 * Returns null unless it is a finite number inside `[0, max]`.
 */
export function parseMapCoordinate(value: unknown, max: number): number | null {
	if (typeof value === 'string' && value.trim() === '') return null;
	if (typeof value !== 'number' && typeof value !== 'string') return null;
	const parsed = typeof value === 'number' ? value : Number(value);
	if (!Number.isFinite(parsed) || parsed < 0 || parsed > max) return null;
	return Math.round(parsed);
}
