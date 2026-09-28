// tests/place-names.test.ts — the funny names the house generator rolls.
import { describe, expect, it } from 'vitest';
import { PLACE_WORDS, rollHouseName, rollRoomNames } from '../src/lib/place-names';
import { HOUSE_KINDS, ROOM_KINDS } from '../src/lib/accommodation';
import { TEMPLATE_LIMITS } from '../src/lib/template';

/** A repeatable Math.random stand-in (mulberry32). */
function seeded(seed: number) {
	let a = seed;
	return () => {
		a |= 0;
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

const lastWord = (name: string, places: readonly string[]) =>
	places.find((place) => name.endsWith(` ${place}`));

describe('place names', () => {
	it('has words for every house and room kind of the catalogue', () => {
		for (const kind of HOUSE_KINDS)
			expect(PLACE_WORDS.houses[kind.value].length).toBeGreaterThan(4);
		for (const kind of ROOM_KINDS) expect(PLACE_WORDS.rooms[kind.value].length).toBeGreaterThan(4);
	});

	it('never repeats a word inside one list', () => {
		const lists = [
			PLACE_WORDS.adjectives,
			PLACE_WORDS.creatures,
			...Object.values(PLACE_WORDS.rooms),
			...Object.values(PLACE_WORDS.houses)
		];
		for (const list of lists) expect(new Set(list).size).toBe(list.length);
	});

	it('rolls room names that end in a word of their kind', () => {
		const random = seeded(7);
		for (const kind of ROOM_KINDS) {
			for (const name of rollRoomNames(20, kind.value, [], random)) {
				expect(lastWord(name, PLACE_WORDS.rooms[kind.value]), name).toBeTruthy();
				expect(name.split(' ').length).toBeGreaterThanOrEqual(2);
			}
		}
		// No kind: ordinary rooms.
		for (const name of rollRoomNames(10, '', [], random)) {
			expect(lastWord(name, PLACE_WORDS.rooms.room), name).toBeTruthy();
		}
	});

	it('rolls house names that end in a word of their kind', () => {
		const random = seeded(11);
		for (const kind of HOUSE_KINDS) {
			for (let i = 0; i < 20; i++) {
				const name = rollHouseName(kind.value, [], random);
				expect(lastWord(name, PLACE_WORDS.houses[kind.value]), name).toBeTruthy();
			}
		}
		expect(lastWord(rollHouseName('', [], random), PLACE_WORDS.houses.house)).toBeTruthy();
	});

	it('mostly alliterates', () => {
		const random = seeded(3);
		const names = rollRoomNames(200, 'room', [], random);
		const alike = names.filter((name) => {
			const words = name.split(' ');
			return words[0][0] === words[words.length - 1][0];
		});
		expect(alike.length).toBeGreaterThan(names.length / 2);
	});

	it('gives every room of one roll its own name, none of the taken ones, whatever the case', () => {
		const taken = ['Glitter Grotto', 'disco den'];
		const names = rollRoomNames(50, 'room', taken, seeded(5));
		expect(names).toHaveLength(50);
		const lower = names.map((name) => name.toLowerCase());
		expect(new Set(lower).size).toBe(50);
		expect(lower).not.toContain('glitter grotto');
		expect(lower).not.toContain('disco den');
	});

	it('uses every place word once before it repeats one', () => {
		const places = PLACE_WORDS.rooms.hut;
		const names = rollRoomNames(places.length, 'hut', [], seeded(21));
		const words = names.map((name) => lastWord(name, places));
		expect(new Set(words).size).toBe(places.length);
	});

	it('numbers a name when every roll is taken', () => {
		// A die that always shows the same face rolls the same name forever.
		const stuck = () => 0;
		const [first] = rollRoomNames(1, 'hut', [], stuck);
		const [second] = rollRoomNames(1, 'hut', [first], stuck);
		const [third] = rollRoomNames(1, 'hut', [first, second], stuck);
		expect(second).toBe(`${first} 2`);
		expect(third).toBe(`${first} 3`);
		expect(rollHouseName('house', [rollHouseName('house', [], stuck)], stuck)).toMatch(/ 2$/);
	});

	it('stays within the name limits of the layout', () => {
		const random = seeded(13);
		for (let i = 0; i < 300; i++) {
			expect(rollHouseName('house', [], random).length).toBeLessThanOrEqual(
				TEMPLATE_LIMITS.houseNameLength
			);
		}
		for (const name of rollRoomNames(300, 'tent', [], random)) {
			expect(name.length).toBeLessThanOrEqual(TEMPLATE_LIMITS.roomNameLength);
		}
	});
});
