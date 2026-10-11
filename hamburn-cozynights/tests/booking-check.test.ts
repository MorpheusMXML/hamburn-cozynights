// tests/booking-check.test.ts — the check before every booking: the bed made
// with the guest's own covers, the rules confirmed (src/lib/booking-check.ts).
// The booking actions that enforce it: tests/interactions.test.ts (room page)
// and tests/respin.test.ts (roulette).
import { describe, it, expect, beforeEach } from 'vitest';
import {
	BOOKING_CHECK_FIELDS,
	COVERS,
	CONFIRMED,
	CONFIRMED_FIELDS,
	SLEEPING_BAG_NOTE,
	bookingCheckPassed,
	carriedCheck,
	carryCheck,
	coversLeftText,
	dropResult,
	useUpCheck,
	wrongDropHint
} from '../src/lib/booking-check';
import { loadHookModule } from './hook-module';

function form(fields: Record<string, string>): FormData {
	const data = new FormData();
	for (const [key, value] of Object.entries(fields)) data.append(key, value);
	return data;
}

describe('the booking request', () => {
	it('passes only with both confirmations', () => {
		expect(bookingCheckPassed(form(CONFIRMED_FIELDS))).toBe(true);
		expect(bookingCheckPassed(form({}))).toBe(false);
		expect(bookingCheckPassed(form({ [BOOKING_CHECK_FIELDS.rules]: CONFIRMED }))).toBe(false);
		expect(bookingCheckPassed(form({ [BOOKING_CHECK_FIELDS.bedding]: CONFIRMED }))).toBe(false);
		// a box ticked by a browser without the page's script says "on", which is not a confirmation
		expect(
			bookingCheckPassed(
				form({ [BOOKING_CHECK_FIELDS.rules]: 'on', [BOOKING_CHECK_FIELDS.bedding]: 'on' })
			)
		).toBe(false);
	});
});

describe('making the bed', () => {
	const cover = (id: string) => COVERS.find((c) => c.id === id)!;

	it('brings exactly the three covers, each for the piece the hostel provides', () => {
		expect(COVERS.map((c) => [c.name, c.piece])).toEqual([
			['Bed sheet', 'mattress'],
			['Duvet cover', 'blanket'],
			['Pillowcase', 'pillow']
		]);
	});

	it('takes the sheet anywhere on the bed, the other covers only on their piece', () => {
		for (const piece of ['mattress', 'blanket', 'pillow'] as const) {
			expect(dropResult(cover('sheet'), piece)).toBe('fits');
		}
		expect(dropResult(cover('duvet'), 'blanket')).toBe('fits');
		expect(dropResult(cover('duvet'), 'pillow')).toBe('wrong');
		expect(dropResult(cover('duvet'), 'mattress')).toBe('wrong');
		expect(dropResult(cover('case'), 'pillow')).toBe('fits');
		expect(dropResult(cover('case'), 'blanket')).toBe('wrong');
		for (const c of COVERS) expect(dropResult(c, null)).toBe('off');
	});

	it('tells the guest where a cover goes instead', () => {
		expect(wrongDropHint(cover('case'), 'blanket')).toBe(
			"That's the blanket! The pillowcase goes on the pillow."
		);
		expect(wrongDropHint(cover('duvet'), 'pillow')).toBe(
			"That's the pillow! The duvet cover goes on the blanket."
		);
	});

	it('counts down to a made bed', () => {
		expect(coversLeftText(3)).toBe('3 covers to go');
		expect(coversLeftText(1)).toBe('1 cover to go');
		expect(coversLeftText(0)).toBe('Bed made!');
	});
});

describe('a check that no booking used yet', () => {
	beforeEach(() => useUpCheck());

	it('stays for the next attempt in the tab, and a booking uses it up', () => {
		expect(carriedCheck()).toEqual({ rules: false, bedding: false });
		carryCheck('bedding', true);
		carryCheck('rules', true);
		expect(carriedCheck()).toEqual({ rules: true, bedding: true });
		// the guest unticks the box again
		carryCheck('rules', false);
		expect(carriedCheck()).toEqual({ rules: false, bedding: true });
		useUpCheck();
		expect(carriedCheck()).toEqual({ rules: false, bedding: false });
	});

	it('hands out a copy, so a page cannot change it by accident', () => {
		carriedCheck().rules = true;
		expect(carriedCheck().rules).toBe(false);
	});
});

describe('the same rule everywhere', () => {
	// The booking window and the pass take it from src/lib/booking-check.ts; the
	// messages from pb_hooks/lib/texts.js. The defaults must name the same covers.
	const texts = loadHookModule('lib/texts.js');
	const defaultOf = (key: string) =>
		texts.TEXTS.find((entry: { key: string }) => entry.key === key).text as string;

	it('names every cover, the provided pillow and blanket, and the sleeping bag', () => {
		for (const key of ['mail.bedding', 'tg.bedding']) {
			const text = defaultOf(key).toLowerCase();
			for (const c of COVERS) expect(text, key).toContain(c.name.toLowerCase());
			expect(text, key).toContain('pillow and blanket are provided');
			expect(text, key).toContain('sleeping bag');
		}
		expect(SLEEPING_BAG_NOTE).toMatch(/instead of the duvet cover/);
	});
});
