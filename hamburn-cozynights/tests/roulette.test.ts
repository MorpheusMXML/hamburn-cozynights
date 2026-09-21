// tests/roulette.test.ts — the rules of the Destiny Roulette's slot machine
// (src/lib/roulette.ts): a fair pick, reels that land where the pick says,
// a lever that changes the show but never the result, and reel motion that
// starts and ends where it should. The page and its server actions:
// tests/respin.test.ts, tests/integration/booking.test.ts, tests/smoke.
import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../src/lib/fx/fireworks';
import {
	BUTTON_PULL,
	IDLE_FACE,
	LAST_SLOW_DOWN_MS,
	REEL_SYMBOLS,
	ROWS_PER_SECOND,
	pickSpot,
	reelKeyframes,
	reelStrip,
	reelValue,
	reelValues,
	spinPlan,
	tickTimes,
	type RouletteSpot
} from '../src/lib/roulette';

const spot = (label: string, roomName = 'Dorm #4', houseName = 'Firework Villa'): RouletteSpot => ({
	id: `id-${label}`,
	label,
	roomId: 'room-1',
	roomName,
	houseName
});

/** The translateY percentage of a keyframe. */
const shift = (frame: Keyframe) =>
	Number(/translateY\((-?[\d.]+)%\)/.exec(String(frame.transform))![1]);

describe('roulette: the pick', () => {
	it('is fair: every free spot comes up about equally often', () => {
		const spots = ['A', 'B', 'C', 'D', 'E'].map((label) => spot(label));
		const rand = mulberry32(7);
		const counts = new Map<string, number>();
		for (let i = 0; i < 10_000; i++) {
			const pick = pickSpot(spots, rand)!;
			counts.set(pick.label, (counts.get(pick.label) ?? 0) + 1);
		}
		expect([...counts.keys()].sort()).toEqual(['A', 'B', 'C', 'D', 'E']);
		for (const count of counts.values()) {
			expect(count).toBeGreaterThan(1800);
			expect(count).toBeLessThan(2200);
		}
	});

	it('stays inside the list at the edges of the random source, and finds nothing in an empty camp', () => {
		const spots = [spot('A'), spot('B')];
		expect(pickSpot(spots, () => 0)?.label).toBe('A');
		expect(pickSpot(spots, () => 0.999999)?.label).toBe('B');
		expect(pickSpot([], () => 0.5)).toBeNull();
	});
});

describe('roulette: the reels', () => {
	it('show house, room and spot like the booking pass names them', () => {
		const s = spot('B2', 'Dorm #4', 'Firework Villa');
		expect([reelValue(s, 'house'), reelValue(s, 'room'), reelValue(s, 'spot')]).toEqual([
			'Firework Villa',
			'Dorm #4',
			'B2'
		]);
		expect(reelValue(spot('B2', '', ''), 'house')).toBe('Mystery House');
		expect(reelValues([spot('A'), spot('B'), spot('C', 'Loft #1')], 'room')).toEqual([
			'Dorm #4',
			'Loft #1'
		]);
	});

	it('land on the target: it is the first row, what the reel showed before is the last', () => {
		const strip = reelStrip(
			['Loft #1', 'Dorm #4', 'Barn #2'],
			'Dorm #4',
			20,
			mulberry32(3),
			'Barn #2'
		);
		expect(strip).toHaveLength(20);
		expect(strip[0]).toBe('Dorm #4');
		expect(strip[19]).toBe('Barn #2');
		// no double take: the row that passes right before the landing is something else
		expect(strip[1]).not.toBe('Dorm #4');
		for (const row of strip.slice(1, -1)) {
			expect(['Loft #1', 'Barn #2', ...REEL_SYMBOLS]).toContain(row);
		}
		expect(strip.slice(1, -1).some((row) => REEL_SYMBOLS.includes(row))).toBe(true);
	});

	it('spin symbols when the camp has only one value for a reel', () => {
		const strip = reelStrip(['Firework Villa'], 'Firework Villa', 10, mulberry32(5));
		expect(strip[0]).toBe('Firework Villa');
		expect(strip[9]).toBe(IDLE_FACE);
		for (const row of strip.slice(1, -1)) expect(REEL_SYMBOLS).toContain(row);
	});
});

describe('roulette: the lever', () => {
	it('stops the reels one after another, the last with a beat of suspense', () => {
		const { durations } = spinPlan(BUTTON_PULL);
		expect(durations).toHaveLength(3);
		expect(durations[1] - durations[0]).toBe(500);
		expect(durations[2] - durations[1]).toBeGreaterThan(500);
	});

	it('runs longer the harder it is pulled, within a few seconds', () => {
		const gentle = spinPlan(0);
		const full = spinPlan(1);
		expect(full.durations[0]).toBeGreaterThan(gentle.durations[0]);
		expect(full.rows[2]).toBeGreaterThan(gentle.rows[2]);
		expect(gentle.durations[0]).toBeGreaterThanOrEqual(1300);
		expect(full.durations[2]).toBeLessThanOrEqual(3300);
		// out of range and nonsense pull strengths are clamped, never break the show
		expect(spinPlan(5)).toEqual(full);
		expect(spinPlan(-1)).toEqual(gentle);
		expect(spinPlan(Number.NaN)).toEqual(spinPlan(BUTTON_PULL));
	});
});

describe('roulette: reel motion', () => {
	it('starts on the last row, winds up, lands past the first row and bounces back onto it', () => {
		const rows = 24;
		const frames = reelKeyframes(rows, 1800);
		const row = 100 / rows;
		expect(frames[0].offset).toBe(0);
		expect(frames.at(-1)!.offset).toBe(1);
		expect(shift(frames[0])).toBeCloseTo(-(rows - 1) * row, 3);
		expect(shift(frames.at(-1)!)).toBe(0);
		// the wind-up nudges it up (further negative), the overshoot past zero
		expect(shift(frames[1])).toBeLessThan(shift(frames[0]));
		expect(shift(frames.at(-2)!)).toBeGreaterThan(0);
		for (let i = 1; i < frames.length; i++) {
			expect(frames[i].offset!).toBeGreaterThanOrEqual(frames[i - 1].offset!);
		}
		// after the wind-up it only ever moves down until the overshoot
		for (let i = 2; i < frames.length - 1; i++) {
			expect(shift(frames[i])).toBeGreaterThan(shift(frames[i - 1]));
		}
	});

	it('runs at about ROWS_PER_SECOND at full speed, for every reel of a plan', () => {
		const plan = spinPlan(BUTTON_PULL);
		plan.durations.forEach((duration, reel) => {
			const slow = reel === 2 ? LAST_SLOW_DOWN_MS : undefined;
			const frames = reelKeyframes(plan.rows[reel], duration, slow);
			// the linear segment: frames[2] → frames[3]
			const rowsPassed = ((shift(frames[3]) - shift(frames[2])) / 100) * plan.rows[reel];
			const seconds = ((frames[3].offset! - frames[2].offset!) * duration) / 1000;
			expect(rowsPassed / seconds).toBeGreaterThan(ROWS_PER_SECOND * 0.85);
			expect(rowsPassed / seconds).toBeLessThan(ROWS_PER_SECOND * 1.15);
		});
	});
});

describe('roulette: the name roll', () => {
	it('clicks once per row, fast first and slower at the end', () => {
		const times = tickTimes(12, 900);
		expect(times).toHaveLength(12);
		expect(times.at(-1)).toBe(900);
		const gaps = times.slice(1).map((t, i) => t - times[i]);
		expect(gaps.at(-1)!).toBeGreaterThan(gaps[0]);
	});
});
