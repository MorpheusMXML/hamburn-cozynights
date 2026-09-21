/**
 * Destiny Roulette (/random-bed): the rules of the neon slot machine.
 *
 * Which free spot it lands on (every one equally likely), what its three
 * reels show on the way (house, room, spot), when each reel stops after a
 * pull of the lever, and how a reel moves. Pure functions: the page only plays
 * them back, and tests/roulette.test.ts pins every rule. The lever is show:
 * how hard it is pulled changes how long the reels run, never where they land.
 */

/** A free spot as the roulette page gets it from the server. */
export interface RouletteSpot {
	id: string;
	label: string;
	roomId: string;
	/** "Dorm #4": the room as the booking pass names it. */
	roomName: string;
	houseName: string;
}

/** A source of random numbers in [0, 1): Math.random, or a seeded one in tests. */
export type Rand = () => number;

/** The reels, left to right (top to bottom on a phone). */
export const REELS = ['house', 'room', 'spot'] as const;
export type Reel = (typeof REELS)[number];

export const REEL_TITLES: Record<Reel, string> = { house: 'House', room: 'Room', spot: 'Spot' };

/** What an idle reel shows before the first pull. */
export const IDLE_FACE = '???';

/**
 * Between the names a spinning reel shows symbols, like the cherries and bells
 * of a real machine. Emoji every phone has had for years (no tofu boxes).
 */
export const REEL_SYMBOLS: readonly string[] = ['🔥', '🌵', '✨', '🎪', '🌙', '🦄', '⛺', '💫'];

/** A pull shorter than this share of the lever's travel springs back without a spin. */
export const LEVER_TRIGGER = 0.35;
/** How hard the SPIN button pulls: a firm, ordinary pull. */
export const BUTTON_PULL = 0.6;

/** Rows a reel passes per second at full speed: a blur, but still a reel. */
export const ROWS_PER_SECOND = 22;

/** The phases of one reel's run, in ms. */
export const WIND_UP_MS = 120;
export const SPEED_UP_MS = 200;
export const BOUNCE_MS = 170;
/** The slow-down of the first two reels; the last one takes longer (suspense). */
export const SLOW_DOWN_MS = 650;
export const LAST_SLOW_DOWN_MS = 950;

/** How far a reel nudges up before it runs, and how far past its row it lands, in rows. */
const WIND_UP_ROWS = 0.15;
const OVERSHOOT_ROWS = 0.22;

/** One free spot, every one equally likely. */
export function pickSpot<T>(spots: readonly T[], rand: Rand = Math.random): T | null {
	if (spots.length === 0) return null;
	return spots[Math.min(spots.length - 1, Math.floor(rand() * spots.length))];
}

/** What a reel shows for a spot. */
export function reelValue(spot: RouletteSpot, reel: Reel): string {
	if (reel === 'house') return spot.houseName || 'Mystery House';
	if (reel === 'room') return spot.roomName || 'Room';
	return spot.label;
}

/** The different values a reel can show among the free spots. */
export function reelValues(spots: readonly RouletteSpot[], reel: Reel): string[] {
	return [...new Set(spots.map((spot) => reelValue(spot, reel)))];
}

/**
 * A reel's strip for one run, top to bottom, `rows` long. The strip scrolls
 * down, so the viewer first sees its last row (`start`: what the reel showed
 * before the pull, so nothing jumps) and last the first one (`target`: where
 * it lands). In between: the reel's other values among the free spots, with a
 * symbol in every third row. The row just before the target is never the
 * target itself, so the landing is not a double take.
 */
export function reelStrip(
	values: readonly string[],
	target: string,
	rows: number,
	rand: Rand = Math.random,
	start: string = IDLE_FACE
): string[] {
	const length = Math.max(3, Math.round(rows));
	const others = values.filter((value) => value !== target);
	const strip: string[] = [target];
	for (let i = 1; i < length - 1; i++) {
		const pool = i % 3 === 0 || others.length === 0 ? REEL_SYMBOLS : others;
		strip.push(pool[Math.min(pool.length - 1, Math.floor(rand() * pool.length))]);
	}
	strip.push(start);
	return strip;
}

/** When the reels stop after a pull, and how long each one's strip is. */
export interface SpinPlan {
	/** Run time of each reel in ms, left to right: each stops after the one before. */
	durations: number[];
	/** How many rows each reel's strip has (rows passed + 1). */
	rows: number[];
}

/**
 * The first reel runs 1.3 s after a gentle pull and 2.1 s after a full one,
 * the second 0.5 s longer, the last one a beat more (it keeps the suspense).
 * Every reel runs at ROWS_PER_SECOND between speeding up and slowing down.
 */
export function spinPlan(strength: number): SpinPlan {
	const pull = Number.isFinite(strength) ? Math.min(1, Math.max(0, strength)) : BUTTON_PULL;
	const first = 1300 + pull * 800;
	const durations = [first, first + 500, first + 1150];
	const rows = durations.map((ms, reel) => {
		const slowDown = reel === durations.length - 1 ? LAST_SLOW_DOWN_MS : SLOW_DOWN_MS;
		// Full-speed time, counting speeding up and slowing down as half each.
		const cruise = ms - WIND_UP_MS - BOUNCE_MS - (SPEED_UP_MS + slowDown) / 2;
		return Math.max(8, Math.round((cruise / 1000) * ROWS_PER_SECOND) + 1);
	});
	return { durations, rows };
}

/**
 * How a reel's strip moves for the Web Animations API, in % of the strip's
 * own height (no measuring). It starts shifted up so its last row sits in the
 * window, nudges up a hair (the lever's jolt), speeds up, runs, slows down,
 * lands a little past its first row and bounces back onto it: the clunk.
 * Speeds match where the phases meet, so the motion never jerks.
 */
export function reelKeyframes(rows: number, duration: number, slowDown = SLOW_DOWN_MS): Keyframe[] {
	const length = Math.max(3, Math.round(rows));
	const row = 100 / length;
	const start = -(length - 1) * row;
	const wound = start - WIND_UP_ROWS * row;
	const past = OVERSHOOT_ROWS * row;
	const slow = Math.min(slowDown, duration * 0.45);
	const speedUp = Math.min(SPEED_UP_MS, duration * 0.15);
	const cruise = Math.max(1, duration - WIND_UP_MS - BOUNCE_MS - speedUp - slow);
	// distance = v·speedUp/2 + v·cruise + v·slow/2 (ease-in and ease-out quad halves)
	const speed = (past - wound) / (speedUp / 2 + cruise + slow / 2);
	const fast = wound + (speed * speedUp) / 2;
	const braking = fast + speed * cruise;
	const at = (ms: number) => Math.min(1, Math.max(0, ms / duration));
	const y = (percent: number) => `translateY(${percent.toFixed(4)}%)`;
	return [
		{ offset: 0, transform: y(start), easing: 'ease-out' },
		{
			offset: at(WIND_UP_MS),
			transform: y(wound),
			// ease-in quad: leaves at rest, arrives at full speed
			easing: 'cubic-bezier(0.55, 0.085, 0.68, 0.53)'
		},
		{ offset: at(WIND_UP_MS + speedUp), transform: y(fast), easing: 'linear' },
		{
			offset: at(WIND_UP_MS + speedUp + cruise),
			transform: y(braking),
			// ease-out quad: leaves at full speed, arrives at rest
			easing: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)'
		},
		{ offset: at(duration - BOUNCE_MS), transform: y(past), easing: 'ease-in-out' },
		{ offset: 1, transform: y(0) }
	];
}

/**
 * When the name roll (🎲 on the name plate) passes each of its rows, in ms:
 * one tick of the clicker per row, fast at first, slower at the end. The roll
 * eases out (quadratic), so row k of `rows` passes at t = 1 - √(1 - k/rows).
 */
export function tickTimes(rows: number, duration: number): number[] {
	const times: number[] = [];
	for (let k = 1; k <= rows; k++) {
		times.push(Math.round(duration * (1 - Math.sqrt(1 - k / rows))));
	}
	return times;
}
