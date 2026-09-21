// hamburn-cozynights/tests/burner-names.test.ts
import { describe, expect, it } from 'vitest';
import { BURNER_NAMES, randomBurnerName } from '../src/lib/burner-names';
import { randomBurnerName as serverRandomBurnerName } from '../src/lib/server/booking';

describe('burner names', () => {
	it('is one list without duplicates, sorted so additions are easy to review', () => {
		expect(BURNER_NAMES.length).toBeGreaterThan(20);
		expect(new Set(BURNER_NAMES).size).toBe(BURNER_NAMES.length);
		const sorted = [...BURNER_NAMES].sort((a, b) => a.localeCompare(b, 'en'));
		expect(BURNER_NAMES).toEqual(sorted);
	});

	it('gives "Name #NNN" from the list, for the server and the slot machine alike', () => {
		for (let i = 0; i < 50; i++) {
			const name = i % 2 ? randomBurnerName() : serverRandomBurnerName();
			const m = /^(.+) #(\d{3})$/.exec(name);
			expect(m, name).not.toBeNull();
			expect(BURNER_NAMES).toContain(m![1]);
			expect(Number(m![2])).toBeGreaterThanOrEqual(100);
		}
		// The slot machine tags the name it stopped on.
		expect(randomBurnerName('Cosmic Coyote')).toMatch(/^Cosmic Coyote #\d{3}$/);
	});
});
