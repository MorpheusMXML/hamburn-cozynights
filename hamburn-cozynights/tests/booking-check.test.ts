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
	PICK_FIRST,
	SLEEPING_BAG_NOTE,
	bookingCheckPassed,
	carriedCheck,
	carryCheck,
	coversLeftText,
	dropResult,
	pickedHint,
	placedHint,
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

	// Max's "idiot check": every cover only on its own piece, the sheet too.
	it('takes every cover only on its own piece', () => {
		const pieces = ['mattress', 'blanket', 'pillow'] as const;
		for (const c of COVERS) {
			for (const piece of pieces) {
				expect(dropResult(c, piece), `${c.name} on the ${piece}`).toBe(
					piece === c.piece ? 'fits' : 'wrong'
				);
			}
			expect(dropResult(c, null)).toBe('off');
		}
		expect(dropResult(cover('sheet'), 'blanket')).toBe('wrong');
		expect(dropResult(cover('sheet'), 'pillow')).toBe('wrong');
	});

	it('tells the guest where a cover goes instead', () => {
		expect(wrongDropHint(cover('case'), 'blanket')).toBe(
			"That's the blanket! The pillowcase goes on the pillow."
		);
		expect(wrongDropHint(cover('duvet'), 'pillow')).toBe(
			"That's the pillow! The duvet cover goes on the blanket."
		);
		expect(wrongDropHint(cover('sheet'), 'blanket')).toBe(
			"That's the blanket! The bed sheet goes on the mattress."
		);
	});

	it('asks where a cover in hand goes, and repeats where it went', () => {
		expect(pickedHint(cover('case'))).toBe(
			'Where does the pillowcase go? Tap its place on the bed.'
		);
		expect(PICK_FIRST).toMatch(/Pick a cover from your bag first/);
		expect(placedHint(cover('sheet'), 2)).toBe('Bed sheet on the mattress ✓ · 2 covers to go');
		expect(placedHint(cover('duvet'), 1)).toBe('Duvet cover on the blanket ✓ · 1 cover to go');
		expect(placedHint(cover('case'), 0)).toBe('Pillowcase on the pillow ✓');
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
