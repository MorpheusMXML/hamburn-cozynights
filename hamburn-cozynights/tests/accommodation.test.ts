// tests/accommodation.test.ts — the catalogue of kinds, bed types and features,
// what a spot inherits, and how a spot answers a ♿ request's needs
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
	BED_TYPES,
	FEATURES,
	HOUSE_KINDS,
	ROOM_KINDS,
	SPOT_FILTERS,
	bedTypeMix,
	defaultRoomKind,
	effectiveFeatures,
	featuresFor,
	isFeature,
	matchNeeds,
	needFit,
	readFeatures,
	readFilters,
	roomWord,
	spotFacts,
	spotMatchesFilter,
	spotMatchesFilters,
	spotSummary,
	type Feature,
	type SpotFacts
} from '../src/lib/accommodation';
import { SPECIAL_NEEDS, type SpecialNeed } from '../src/lib/special-needs';

const facts = (bedType: string, features: Feature[] = []): SpotFacts =>
	spotFacts({ bedType, spot: features.filter((f) => isFeature(f, 'spot')), room: features });

describe('the catalogue', () => {
	it('has unique values everywhere', () => {
		for (const list of [HOUSE_KINDS, ROOM_KINDS, BED_TYPES, FEATURES, SPOT_FILTERS]) {
			const values = list.map((entry) => entry.value);
			expect(new Set(values).size).toBe(values.length);
		}
	});

	it('gives every entry a label and an icon', () => {
		for (const list of [HOUSE_KINDS, ROOM_KINDS, BED_TYPES, FEATURES, SPOT_FILTERS]) {
			for (const entry of list) {
				expect(entry.label.length).toBeGreaterThan(0);
				expect(entry.icon.length).toBeGreaterThan(0);
			}
		}
	});

	it('says only the upper bunk needs a ladder', () => {
		const withLadder = BED_TYPES.filter((type) => type.ladder).map((type) => type.value);
		expect(withLadder).toEqual(['bunk_upper']);
	});

	it('keeps the PocketBase migration in step with it', () => {
		const migration = readFileSync('pb_migrations/1759900000_accommodation.js', 'utf8');
		const list = (name: string) =>
			(new RegExp(`const ${name} = \\[([^\\]]*)\\]`).exec(migration)?.[1] ?? '')
				.split(',')
				.map((value) => value.trim().replace(/^'|'$/g, ''))
				.filter(Boolean);

		expect(list('HOUSE_KINDS')).toEqual(HOUSE_KINDS.map((kind) => kind.value));
		expect(list('ROOM_KINDS')).toEqual(ROOM_KINDS.map((kind) => kind.value));
		expect(list('BED_TYPES')).toEqual(BED_TYPES.map((type) => type.value));
		expect(list('HOUSE_FEATURES')).toEqual(featuresFor('house').map((f) => f.value));
		expect(list('ROOM_FEATURES')).toEqual(featuresFor('room').map((f) => f.value));
		expect(list('BED_FEATURES')).toEqual(featuresFor('spot').map((f) => f.value));
	});

	it('keeps the labels PocketBase sends in step with it', () => {
		const hook = readFileSync('pb_hooks/lib/beds.js', 'utf8');
		for (const type of BED_TYPES) {
			expect(hook).toContain(`${type.value}: '${type.label}'`);
		}
		// no bed type in the hook that the catalogue doesn't know
		const inHook = [...hook.matchAll(/^\t(\w+): '/gm)].map((match) => match[1]);
		expect(inHook.sort()).toEqual(BED_TYPES.map((type) => type.value).sort());
	});

	it('calls a room of a hut group a hut', () => {
		expect(roomWord('hut_group')).toBe('hut');
		expect(roomWord('hut_group', true)).toBe('huts');
		expect(defaultRoomKind('hut_group')).toBe('hut');
		expect(roomWord('')).toBe('room');
		expect(defaultRoomKind(undefined)).toBe('room');
	});
});

describe('reading features', () => {
	it('keeps only what the level allows, without duplicates, in catalogue order', () => {
		expect(readFeatures(['quiet', 'wheelchair', 'quiet'], 'house')).toEqual([
			'wheelchair',
			'quiet'
		]);
		// own_bathroom is a room feature, power belongs to rooms and spots
		expect(readFeatures(['own_bathroom', 'power'], 'house')).toEqual([]);
		expect(readFeatures(['own_bathroom', 'power'], 'room')).toEqual(['own_bathroom', 'power']);
		expect(readFeatures(['own_bathroom', 'power'], 'spot')).toEqual(['power']);
	});

	it('ignores anything that is not a feature', () => {
		expect(readFeatures(['sauna', 42, null, ''], 'house')).toEqual([]);
		expect(readFeatures('quiet', 'house')).toEqual(['quiet']);
		expect(readFeatures(undefined, 'house')).toEqual([]);
	});
});

describe('what a spot inherits', () => {
	it('adds up house, room and spot', () => {
		expect(
			effectiveFeatures({
				house: ['toilets_inside', 'heated'],
				room: ['ground_floor'],
				spot: ['power']
			})
		).toEqual(['ground_floor', 'toilets_inside', 'heated', 'power']);
	});

	it('lets the closer level win when two say the opposite', () => {
		expect(effectiveFeatures({ house: ['unheated'], room: ['heated'] })).toEqual(['heated']);
		expect(effectiveFeatures({ house: ['heated'], room: ['unheated'] })).toEqual(['unheated']);
	});

	it('drops what a level may not set', () => {
		expect(effectiveFeatures({ house: ['own_bathroom'], spot: ['quiet'] })).toEqual([]);
	});
});

describe('how a spot answers a need', () => {
	it('fits a lower bunk with every bed but the upper one', () => {
		expect(needFit('lower_bunk', facts('bunk_lower'))).toBe('fits');
		expect(needFit('lower_bunk', facts('sofa'))).toBe('fits');
		expect(needFit('lower_bunk', facts('bunk_upper'))).toBe('conflict');
	});

	it('never guesses when nobody filled the detail in', () => {
		for (const need of SPECIAL_NEEDS) {
			expect(needFit(need.value, facts(''))).toBe('unknown');
		}
	});

	it('reads the features behind the other needs', () => {
		expect(needFit('step_free', facts('', ['ground_floor']))).toBe('fits');
		expect(needFit('step_free', facts('', ['wheelchair']))).toBe('fits');
		expect(needFit('near_toilet', facts('', ['own_bathroom']))).toBe('fits');
		expect(needFit('quiet', facts('', ['quiet']))).toBe('fits');
		expect(needFit('power', facts('', ['power']))).toBe('fits');
		// what the guest wrote themselves is for a human to read
		expect(needFit('other', facts('bunk_lower', ['quiet']))).toBe('unknown');
	});

	it('scores a spot by what it answers, and a conflict costs a point', () => {
		const needs: SpecialNeed[] = ['lower_bunk', 'step_free', 'quiet'];
		const good = matchNeeds(needs, facts('bunk_lower', ['ground_floor', 'quiet']));
		expect(good.fits).toEqual(needs);
		expect(good.score).toBe(3);

		const bad = matchNeeds(needs, facts('bunk_upper'));
		expect(bad.conflicts).toEqual(['lower_bunk']);
		expect(bad.unknown).toEqual(['step_free', 'quiet']);
		expect(bad.score).toBe(-1);
	});
});

describe('wishes on the map and at the roulette', () => {
	it('reads them from a URL or a form, known ones only', () => {
		expect(readFilters('quiet,no_ladder,sauna')).toEqual(['no_ladder', 'quiet']);
		expect(readFilters(['heated', 'heated'])).toEqual(['heated']);
		expect(readFilters(undefined)).toEqual([]);
	});

	it('leaves out spots nobody filled in, rather than promising too much', () => {
		expect(spotMatchesFilter('no_ladder', facts(''))).toBe(false);
		expect(spotMatchesFilter('no_ladder', facts('bunk_lower'))).toBe(true);
		expect(spotMatchesFilter('no_ladder', facts('bunk_upper'))).toBe(false);
		expect(spotMatchesFilter('heated', facts('', ['heated']))).toBe(true);
		expect(spotMatchesFilter('heated', facts('', ['unheated']))).toBe(false);
	});

	it('asks for all wishes at once', () => {
		const spot = facts('bunk_lower', ['quiet', 'power']);
		expect(spotMatchesFilters(['no_ladder', 'quiet', 'power'], spot)).toBe(true);
		expect(spotMatchesFilters(['no_ladder', 'step_free'], spot)).toBe(false);
		expect(spotMatchesFilters([], facts(''))).toBe(true);
	});

	it('answers a need with the filter that stands for it', () => {
		for (const filter of SPOT_FILTERS) {
			if (!filter.need) continue;
			const fitting = SPECIAL_NEEDS.some((need) => need.value === filter.need);
			expect(fitting).toBe(true);
		}
	});
});

describe('summaries', () => {
	it('names the bed type and the features of the spot itself', () => {
		expect(spotSummary(facts('bunk_lower'), [])).toBe('Lower bunk');
		expect(spotSummary(facts('bunk_lower', ['power']), ['power'])).toBe(
			'Lower bunk · Power socket'
		);
		expect(spotSummary(facts(''), [])).toBe('');
	});

	it('counts the beds of a room', () => {
		expect(bedTypeMix(['bunk_lower', 'bunk_lower', 'bunk_upper'])).toBe(
			'2 × lower bunk · 1 × upper bunk'
		);
		expect(bedTypeMix(['bunk_lower', '', undefined])).toBe('1 × lower bunk · 2 not specified');
		expect(bedTypeMix(['', ''])).toBe('');
	});
});
