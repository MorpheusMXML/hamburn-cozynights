// hamburn-cozynights/tests/burner-names.test.ts
import { describe, expect, it } from 'vitest';
import {
	BURNER_NAMES,
	BURNER_NAME_MAX,
	BURNER_SPICE,
	burnerNameBase,
	isRolledBurnerName,
	randomBurnerName
} from '../src/lib/burner-names';
import { randomBurnerName as serverRandomBurnerName } from '../src/lib/server/booking';

/** A predictable stand-in for Math.random: the given values, then their last one. */
const feed = (...values: number[]) => {
	let i = 0;
	return () => values[Math.min(i++, values.length - 1)];
};

describe('burner names', () => {
	it('is one list without duplicates, sorted so additions are easy to review', () => {
		expect(BURNER_NAMES.length).toBeGreaterThan(20);
		expect(new Set(BURNER_NAMES).size).toBe(BURNER_NAMES.length);
		const sorted = [...BURNER_NAMES].sort((a, b) => a.localeCompare(b, 'en'));
		expect(BURNER_NAMES).toEqual(sorted);
	});

	it('keeps the spice lists tidy too: sorted, no duplicates, nothing that ends up too long', () => {
		for (const list of [BURNER_SPICE.adjectives, BURNER_SPICE.creatures]) {
			expect(new Set(list).size).toBe(list.length);
			expect([...list]).toEqual([...list].sort((a, b) => a.localeCompare(b, 'en')));
		}
		expect(new Set(BURNER_SPICE.epithets).size).toBe(BURNER_SPICE.epithets.length);
		const longest = (list: readonly string[]) =>
			list.reduce((best, word) => (word.length > best.length ? word : best), '');
		const worst = `${longest(BURNER_SPICE.adjectives)} ${longest(BURNER_SPICE.creatures)}, ${longest(BURNER_SPICE.epithets)} #999`;
		expect(worst.length).toBeLessThanOrEqual(BURNER_NAME_MAX);
	});

	it('mixes a classic, an adjective + creature, or the same with an epithet', () => {
		// below 0.3 on the first draw: a classic
		expect(burnerNameBase(feed(0.1, 0))).toBe(BURNER_NAMES[0]);
		// adjective + creature, no epithet
		expect(burnerNameBase(feed(0.9, 0, 0, 0.9))).toBe(
			`${BURNER_SPICE.adjectives[0]} ${BURNER_SPICE.creatures[0]}`
		);
		// with an epithet: "of …" follows directly, a title comes after a comma
		expect(burnerNameBase(feed(0.9, 0, 0, 0.1, 0))).toBe(
			`${BURNER_SPICE.adjectives[0]} ${BURNER_SPICE.creatures[0]} ${BURNER_SPICE.epithets[0]}`
		);
		const title = BURNER_SPICE.epithets.findIndex((e) => !/^(of|from|the) /.test(e));
		expect(burnerNameBase(feed(0.9, 0, 0, 0.1, title / BURNER_SPICE.epithets.length))).toBe(
			`${BURNER_SPICE.adjectives[0]} ${BURNER_SPICE.creatures[0]}, ${BURNER_SPICE.epithets[title]}`
		);
	});

	it('gives "Name #NNN" from the same source, for the server and the slot machine alike', () => {
		const seen = new Set<string>();
		for (let i = 0; i < 300; i++) {
			const name = i % 2 ? randomBurnerName() : serverRandomBurnerName();
			const m = /^(.+) #(\d{3})$/.exec(name);
			expect(m, name).not.toBeNull();
			expect(isRolledBurnerName(m![1]), name).toBe(true);
			expect(Number(m![2])).toBeGreaterThanOrEqual(100);
			expect(name.length).toBeLessThanOrEqual(BURNER_NAME_MAX);
			seen.add(m![1]);
		}
		// the mix keeps a camp from getting the same name twice every few beds
		expect(seen.size).toBeGreaterThan(100);
		// The slot machine tags the name it stopped on.
		expect(randomBurnerName('Cosmic Coyote')).toMatch(/^Cosmic Coyote #\d{3}$/);
	});

	it('recognises what it rolls, and nothing else', () => {
		expect(isRolledBurnerName('Disco Druid')).toBe(true);
		expect(isRolledBurnerName('Dusty Unicorn')).toBe(true);
		expect(isRolledBurnerName('Dusty Unicorn of the Dust')).toBe(true);
		expect(isRolledBurnerName('Dusty Unicorn, Keeper of the Moop')).toBe(true);
		expect(isRolledBurnerName('Dusty Unicorn Keeper of the Moop')).toBe(false);
		expect(isRolledBurnerName('Unicorn Dusty')).toBe(false);
		expect(isRolledBurnerName('Alice')).toBe(false);
	});
});
