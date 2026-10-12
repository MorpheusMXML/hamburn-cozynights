// src/lib/spot-hold.ts — spot holds as the pages show them. A guest who starts
// booking a free spot holds it for a few minutes ($lib/server/spot-holds);
// their booking window counts the minutes down, and everyone else sees the
// spot's card making its bed ("Bed being made…") until it is booked or free.
// The requests themselves: $lib/spot-hold-request.

/** How often an open room page asks which of its spots are being booked. */
export const HOLD_POLL_MS = 15_000;

/** What a held spot's card says under "Bed being made", one after the other. */
export const HELD_LINES = [
	'Someone is fluffing the pillow…',
	'A duvet cover is putting up a fight…',
	'Sheets are flying…',
	'Tucking in the corners…',
	'Hunting for the pillowcase…',
	'Smoothing out the wrinkles…'
] as const;

/** How long each line stays. */
const LINE_MS = 4_000;

/**
 * The line a held spot's card shows right now. It moves on every few
 * seconds, and every spot starts somewhere else, so two held spots side by
 * side don't say the same thing.
 */
export function heldLine(bedId: string, now: number): string {
	let seed = 0;
	for (const char of bedId) seed = (seed * 31 + char.charCodeAt(0)) % 997;
	return HELD_LINES[(seed + Math.floor(now / LINE_MS)) % HELD_LINES.length];
}

/** "9:41" — minutes and seconds left, never below 0:00. */
export function clock(ms: number): string {
	const seconds = Math.max(0, Math.ceil(ms / 1000));
	return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/** Under a held spot: when it is free again if its guest doesn't book. */
export function freeAgainText(ms: number): string {
	const minutes = Math.ceil(ms / 60_000);
	return minutes <= 1
		? 'Free again in a minute if they wander off'
		: `Free again in ${minutes} min if they wander off`;
}

/** Spot id → when its hold ends on this device's clock, from the milliseconds left. */
export function untilFrom(left: Record<string, number>, now = Date.now()): Record<string, number> {
	const until: Record<string, number> = {};
	for (const [bedId, ms] of Object.entries(left)) until[bedId] = now + ms;
	return until;
}

/**
 * Whether a hold the page knew about ended well before its time: its guest
 * booked the spot (or let go of it). Then the page reloads the room.
 */
export function endedEarly(
	before: Record<string, number>,
	after: Record<string, number>,
	now = Date.now()
): boolean {
	return Object.entries(before).some(([bedId, until]) => !(bedId in after) && until - now > 5_000);
}

/** A page with the hold actions: a room page or the roulette. */
export type HoldPage = `/room/${string}` | '/random-bed';

/**
 * Where a hold action of `page` is sent: always that page's own path. A
 * relative `?/dropHold` would go to whatever URL the browser shows, and after
 * a link was followed that is the next page already.
 */
export function holdActionUrl(page: HoldPage, action: 'holdSpot' | 'dropHold'): string {
	return `${page}?/${action}`;
}
