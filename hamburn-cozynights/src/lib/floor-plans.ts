// src/lib/floor-plans.ts
/**
 * Floor plans of a house: pictures that ship with the app under
 * static/floorplans/ and are named by the house's `floor_plans` field. A
 * layout template sets them (docs/admin/templates.md); guests open them from
 * a quiet button on the house page and on every room page of that house.
 *
 * Only pictures of the app itself are allowed — a path under /floorplans/ —
 * so a template can't make a guest's browser load something from elsewhere.
 * Pure code, shared by the template reader, the pages and the unit tests.
 */

export interface FloorPlan {
	/** "/floorplans/<name>.webp": a file in static/floorplans/. */
	image: string;
	/** What the picture shows, e.g. "Upper floor"; may be empty. */
	caption: string;
}

export const FLOOR_PLANS_MAX = 4;
export const FLOOR_PLAN_CAPTION_MAX = 80;

const IMAGE_PATH = /^\/floorplans\/[a-z0-9][a-z0-9_-]{0,79}(\.[a-z0-9_-]+)*\.(webp|png|jpe?g)$/;

/** True for a picture path the app serves itself, like "/floorplans/villa-2026.webp". */
export function isFloorPlanImage(value: unknown): value is string {
	return typeof value === 'string' && IMAGE_PATH.test(value);
}

/** A caption on one line, without surrounding spaces. */
export function cleanCaption(raw: unknown): string {
	return typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim() : '';
}

/**
 * The plans as stored on a house, for showing them: entries that are not a
 * plan are skipped, a long caption is cut, at most FLOOR_PLANS_MAX are kept.
 * Never throws; anything that is not a list reads as no plans.
 */
export function readFloorPlans(raw: unknown): FloorPlan[] {
	if (!Array.isArray(raw)) return [];
	const plans: FloorPlan[] = [];
	for (const entry of raw) {
		if (typeof entry !== 'object' || entry === null) continue;
		const { image, caption } = entry as Record<string, unknown>;
		if (!isFloorPlanImage(image)) continue;
		plans.push({ image, caption: cleanCaption(caption).slice(0, FLOOR_PLAN_CAPTION_MAX) });
		if (plans.length === FLOOR_PLANS_MAX) break;
	}
	return plans;
}
