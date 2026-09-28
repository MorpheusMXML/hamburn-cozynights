// tests/house-plan.test.ts — the house generator's size rows: totals, room
// numbers, spots and the checks the browser and the server share.
import { describe, expect, it } from 'vitest';
import {
	DEFAULT_SIZE,
	PLAN_LIMITS,
	appendPlan,
	defaultFirstNumber,
	formatSizes,
	nextBlock,
	nextSize,
	numberRanges,
	parseSizes,
	planProblem,
	planRooms,
	planSpots,
	planTotals,
	readPlanForm,
	suggestSize,
	type RoomPlan,
	type RoomSize
} from '../src/lib/house-plan';

const size = (rooms: number, beds: number, bunks = false): RoomSize => ({ rooms, beds, bunks });
const plan = (sizes: RoomSize[], floors = false, firstNumber: number | null = null): RoomPlan => ({
	sizes,
	floors,
	firstNumber
});
const numbers = (p: RoomPlan, existing: number[] = []) =>
	planRooms(p, existing).map((room) => room.number);

describe('house plan', () => {
	it('counts rooms, spots and bunk beds', () => {
		expect(planTotals([size(4, 6, true), size(6, 6), size(2, 8, true)])).toEqual({
			rooms: 12,
			spots: 24 + 36 + 16,
			bunkBeds: 12 + 8
		});
		// An odd bunk room: two bunk beds and one spot on its own.
		expect(planTotals([size(1, 5, true)]).bunkBeds).toBe(2);
		expect(planTotals([])).toEqual({ rooms: 0, spots: 0, bunkBeds: 0 });
	});

	it('numbers rooms straight through from 1', () => {
		expect(numbers(plan([size(4, 6), size(2, 8)]))).toEqual([1, 2, 3, 4, 5, 6]);
	});

	it('gives every size its own block of ten with floor blocks', () => {
		expect(numbers(plan([size(4, 6), size(6, 6), size(2, 8)], true))).toEqual([
			1, 2, 3, 4, 11, 12, 13, 14, 15, 16, 21, 22
		]);
		// A size of more than ten rooms runs on, the next starts at the next free ten.
		expect(numbers(plan([size(12, 2), size(1, 2)], true)).slice(-2)).toEqual([12, 21]);
	});

	it('counts in blocks of a hundred from three-digit numbers on', () => {
		expect(numbers(plan([size(3, 2), size(2, 2)], true, 101))).toEqual([101, 102, 103, 201, 202]);
		expect(nextBlock(104, 100)).toBe(201);
		expect(nextBlock(10, 10)).toBe(11);
		expect(nextBlock(16, 10)).toBe(21);
	});

	it('continues after the rooms a house has, and skips numbers in use', () => {
		expect(defaultFirstNumber([], false)).toBe(1);
		expect(defaultFirstNumber([1, 2, 3, 4], false)).toBe(5);
		expect(defaultFirstNumber([1, 2, 3, 4], true)).toBe(11);
		expect(defaultFirstNumber([101, 102], true)).toBe(201);
		expect(numbers(plan([size(2, 4)]), [1, 2, 3, 4])).toEqual([5, 6]);
		expect(numbers(plan([size(2, 4)], true), [1, 2, 3, 4])).toEqual([11, 12]);
		// A typed first number that is taken moves on to the next free one.
		expect(numbers(plan([size(3, 4)], false, 3), [1, 2, 3, 5])).toEqual([4, 6, 7]);
	});

	it('writes numbers as runs', () => {
		expect(numberRanges([1, 2, 3, 4, 11, 12, 21])).toBe('#1–4 · #11–12 · #21');
		expect(numberRanges([7])).toBe('#7');
		expect(numberRanges([])).toBe('');
	});

	it('labels spots B1 … Bn and stacks them in pairs for bunk beds', () => {
		expect(planSpots(3, false)).toEqual([
			{ label: 'B1', bed_type: '', partner: null },
			{ label: 'B2', bed_type: '', partner: null },
			{ label: 'B3', bed_type: '', partner: null }
		]);
		expect(planSpots(5, true)).toEqual([
			{ label: 'B1', bed_type: 'bunk_lower', partner: 1 },
			{ label: 'B2', bed_type: 'bunk_upper', partner: 0 },
			{ label: 'B3', bed_type: 'bunk_lower', partner: 3 },
			{ label: 'B4', bed_type: 'bunk_upper', partner: 2 },
			// Nobody to stack with: on its own, no bed type (like SPOT TYPES).
			{ label: 'B5', bed_type: '', partner: null }
		]);
		expect(planSpots(1, true)).toEqual([{ label: 'B1', bed_type: '', partner: null }]);
	});

	it('suggests one more of the room a house has most of', () => {
		expect(suggestSize([])).toEqual(DEFAULT_SIZE);
		expect(
			suggestSize([
				{ spots: 8, bunks: true },
				{ spots: 8, bunks: true },
				{ spots: 4, bunks: false }
			])
		).toEqual({ rooms: 1, beds: 8, bunks: true });
		// Empty rooms don't count.
		expect(suggestSize([{ spots: 0, bunks: false }])).toEqual(DEFAULT_SIZE);
	});

	it('copies the row above for another size', () => {
		expect(nextSize([size(4, 6, true)])).toEqual(size(4, 6, true));
		expect(nextSize([])).toEqual(DEFAULT_SIZE);
	});

	describe('checks', () => {
		it('accepts a plain plan, and an empty one only where allowed', () => {
			expect(planProblem(plan([size(4, 6, true)]))).toBeNull();
			expect(planProblem(plan([]), { allowEmpty: true })).toBeNull();
			expect(planProblem(plan([]))?.message).toBe('Add at least one room size.');
			expect(planProblem(plan([]), { word: 'hut' })?.message).toBe('Add at least one hut size.');
		});

		it('points at the row and field that is out of range', () => {
			expect(planProblem(plan([size(1, 4), size(0, 4)]))).toMatchObject({ row: 1, field: 'rooms' });
			expect(planProblem(plan([size(1, 51)]))).toMatchObject({ row: 0, field: 'beds' });
			expect(planProblem(plan([size(1, NaN)]))).toMatchObject({ row: 0, field: 'beds' });
			expect(planProblem(plan([size(2.5, 4)]))).toMatchObject({ row: 0, field: 'rooms' });
		});

		it('keeps a house at 50 rooms, counting the ones it has', () => {
			expect(planProblem(plan([size(51, 1)]))?.field).toBe('rooms');
			expect(planProblem(plan([size(30, 1), size(21, 1)]))?.message).toMatch(
				/up to 50 rooms, this plan has 51/
			);
			const existing = Array.from({ length: 45 }, (_, i) => i + 1);
			expect(planProblem(plan([size(6, 2)]), { existing })?.message).toBe(
				'A house holds up to 50 rooms. This one has 45, so 5 more at most.'
			);
			expect(planProblem(plan([size(5, 2)]), { existing })).toBeNull();
		});

		it('builds at most 500 spots in one go', () => {
			expect(planProblem(plan([size(10, 50)]))).toBeNull();
			expect(planProblem(plan([size(11, 50)]))?.message).toBe(
				"That's 550 spots in one go; the generator makes at most 500. Split it into two steps."
			);
		});

		it('keeps room numbers between 1 and 9999', () => {
			expect(planProblem(plan([size(1, 2)], false, 0))?.field).toBe('firstNumber');
			expect(planProblem(plan([size(1, 2)], false, NaN))?.field).toBe('firstNumber');
			expect(planProblem(plan([size(2, 2)], false, 9999))?.message).toMatch(/up to #10000/);
			expect(planProblem(plan([size(1, 2), size(1, 2)], true, 9901))?.message).toMatch(
				/switch off floor blocks/
			);
			expect(planProblem(plan([size(1, 2)], false, 9999))).toBeNull();
		});

		it('allows at most ten sizes', () => {
			const sizes = Array.from({ length: PLAN_LIMITS.sizes + 1 }, () => size(1, 1));
			expect(planProblem(plan(sizes))?.message).toBe('Use at most 10 sizes in one go.');
		});
	});

	describe('form fields', () => {
		it('writes and reads the sizes', () => {
			const sizes = [size(4, 6, true), size(2, 8)];
			expect(formatSizes(sizes)).toBe('4x6b,2x8');
			expect(parseSizes('4x6b,2x8')).toEqual(sizes);
			expect(parseSizes(' 4 × 6 B , 2X8 ')).toEqual(sizes);
			expect(parseSizes('')).toEqual([]);
			expect(parseSizes('4x')).toBeNull();
			expect(parseSizes('4x6,')).toBeNull();
			expect(parseSizes('four by six')).toBeNull();
		});

		it('reads the whole plan from a form, as appendPlan writes it', () => {
			const written = appendPlan(new FormData(), plan([size(4, 6, true)], true, 101));
			expect(readPlanForm(written)).toEqual({
				ok: true,
				plan: plan([size(4, 6, true)], true, 101)
			});
			const plain = appendPlan(new FormData(), plan([size(1, 2)]));
			expect(readPlanForm(plain)).toEqual({ ok: true, plan: plan([size(1, 2)]) });
		});

		it('refuses fields it cannot read', () => {
			const bad = new FormData();
			bad.append('sizes', 'lots');
			expect(readPlanForm(bad)).toMatchObject({ ok: false });
			const badNumber = new FormData();
			badNumber.append('sizes', '1x2');
			badNumber.append('first_number', '1a');
			expect(readPlanForm(badNumber)).toEqual({
				ok: false,
				error: 'Room numbers run from 1 to 9999.'
			});
		});
	});
});
