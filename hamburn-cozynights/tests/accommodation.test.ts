// tests/accommodation.test.ts — the catalogue of kinds, bed types and features,
// what a spot inherits, and how a spot answers a ♿ request's needs
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
	BED_TYPES,
	FEATURES,
	HOUSE_KINDS,
	MATCHED_BY_HAND,
	NOT_UP_A_LADDER,
	RETIRED_FEATURES,
	ROOM_KINDS,
	SPOT_FILTERS,
	availableFilters,
	bedRulesOut,
	bedTypeMix,
	defaultRoomKind,
	detailsSummary,
	effectiveFeatures,
	factsOf,
	inheritedFeatures,
	offAllowed,
	overrideProblem,
	parseDetailsForm,
	parseSpotForm,
	readFeaturesOff,
	featureText,
	featuresFor,
	isFeature,
	matchNeeds,
	missingAtSpot,
	needCapacity,
	needFit,
	readFeatures,
	readFilters,
	roomWord,
	spotFacts,
	spotMatchesFilter,
	spotMatchesFilters,
	type Feature,
	type SpotFacts
} from '../src/lib/accommodation';
import { SPECIAL_NEEDS, type SpecialNeed } from '../src/lib/special-needs';
import { loadHookModule } from './hook-module';

// Each feature on the level that may carry it: a house one on the house, a room one on the room.
const facts = (bedType: string, features: Feature[] = []): SpotFacts =>
	spotFacts({ bedType, house: features, room: features });

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

	it('keeps the PocketBase migrations in step with it', () => {
		const listsIn = (file: string) => {
			const migration = readFileSync(file, 'utf8');
			return (name: string) =>
				(new RegExp(`const ${name} = \\[([^\\]]*)\\]`).exec(migration)?.[1] ?? '')
					.split(',')
					.map((value) => value.trim().replace(/^'|'$/g, ''))
					.filter(Boolean);
		};
		const values = (entries: { value: string }[]) => entries.map((entry) => entry.value);

		const first = listsIn('pb_migrations/1759900000_accommodation.js');
		expect(first('HOUSE_KINDS')).toEqual(values(HOUSE_KINDS));
		expect(first('ROOM_KINDS')).toEqual(values(ROOM_KINDS));
		expect(first('BED_TYPES')).toEqual(values(BED_TYPES));
		expect(first('HOUSE_FEATURES')).toEqual(values(featuresFor('house')));

		const overrides = listsIn('pb_migrations/1760100000_feature_overrides.js');
		expect(overrides('HOUSE_FEATURES')).toEqual(values(offAllowed('room')));

		// 1760200000 took the power socket out: its lists are what the database has now
		const latest = listsIn('pb_migrations/1760200000_no_power_socket.js');
		expect(latest('ROOM_FEATURES')).toEqual(values(featuresFor('room')));
		expect(latest('ABOVE_A_SPOT')).toEqual(values(offAllowed('spot')));
		// and what it dropped is exactly what the catalogue calls retired
		const dropped = first('ROOM_FEATURES').filter((v) => !latest('ROOM_FEATURES').includes(v));
		expect(dropped).toEqual([...RETIRED_FEATURES]);
		expect(first('BED_FEATURES')).toEqual([...RETIRED_FEATURES]);
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

	it('keeps the features and their rules PocketBase applies in step with it', () => {
		const beds = loadHookModule('lib/beds.js');
		expect(beds.FEATURES).toEqual(
			FEATURES.map(({ value, label, icon, levels, opposite }) => ({
				value,
				label,
				icon,
				levels,
				...(opposite ? { opposite } : {})
			}))
		);
		expect(beds.NOT_UP_A_LADDER).toEqual(NOT_UP_A_LADDER);
		expect(
			beds.effectiveFeatures(['wheelchair', 'unheated'], ['heated', 'quiet'], 'bunk_upper')
		).toEqual(
			effectiveFeatures({
				house: ['wheelchair', 'unheated'],
				room: ['heated', 'quiet'],
				bedType: 'bunk_upper'
			})
		);
		expect(beds.featureText(['heated', 'quiet'])).toBe(featureText(['heated', 'quiet']));
		// a stored value the catalogue dropped is no feature there either
		expect(beds.featureText(['power', 'quiet'])).toBe(featureText(['power', 'quiet']));
		expect(beds.offAllowed('room').map((f: { value: string }) => f.value)).toEqual(
			offAllowed('room').map((f) => f.value)
		);
		expect(beds.offAllowed('spot').map((f: { value: string }) => f.value)).toEqual(
			offAllowed('spot').map((f) => f.value)
		);
		expect(
			beds.effectiveFeatures(
				['heated', 'quiet'],
				['own_bathroom'],
				'single',
				['quiet'],
				['own_bathroom']
			)
		).toEqual(
			effectiveFeatures({
				house: ['heated', 'quiet'],
				room: ['own_bathroom'],
				roomOff: ['quiet'],
				spotOff: ['own_bathroom'],
				bedType: 'single'
			})
		);
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
		// own_bathroom is a room feature, toilets_inside a house one
		expect(readFeatures(['own_bathroom', 'toilets_inside'], 'house')).toEqual(['toilets_inside']);
		expect(readFeatures(['own_bathroom', 'toilets_inside'], 'room')).toEqual(['own_bathroom']);
	});

	it('knows the power socket no more: an old stored value is simply dropped', () => {
		expect(RETIRED_FEATURES).toEqual(['power']);
		expect(isFeature('power')).toBe(false);
		expect(FEATURES.some((feature) => (feature.value as string) === 'power')).toBe(false);
		expect(readFeatures(['power', 'quiet'], 'room')).toEqual(['quiet']);
		expect(readFeaturesOff(['power', 'quiet'], 'spot')).toEqual(['quiet']);
		expect(SPOT_FILTERS.some((filter) => (filter.value as string) === 'power')).toBe(false);
		// an old link with the 🔌 wish still works, without it
		expect(readFilters('power,quiet')).toEqual(['quiet']);
	});

	it('ignores anything that is not a feature', () => {
		expect(readFeatures(['sauna', 42, null, ''], 'house')).toEqual([]);
		expect(readFeatures('quiet', 'house')).toEqual(['quiet']);
		expect(readFeatures(undefined, 'house')).toEqual([]);
	});
});

describe('what a spot inherits', () => {
	it('adds up house and room', () => {
		expect(
			effectiveFeatures({ house: ['toilets_inside', 'heated'], room: ['ground_floor'] })
		).toEqual(['ground_floor', 'toilets_inside', 'heated']);
	});

	it('lets the closer level win when two say the opposite', () => {
		expect(effectiveFeatures({ house: ['unheated'], room: ['heated'] })).toEqual(['heated']);
		expect(effectiveFeatures({ house: ['heated'], room: ['unheated'] })).toEqual(['unheated']);
	});

	it('drops what a level may not set', () => {
		expect(effectiveFeatures({ house: ['own_bathroom'], room: ['toilets_inside'] })).toEqual([]);
	});

	it('lets a room or spot switch an inherited feature off, before its own features count', () => {
		// a cold room in a heated, quiet house
		expect(effectiveFeatures({ house: ['heated', 'quiet'], roomOff: ['heated'] })).toEqual([
			'quiet'
		]);
		// the room may still claim it back itself (no clash, the form refuses that pair)
		expect(
			effectiveFeatures({ house: ['heated'], roomOff: ['heated'], room: ['own_bathroom'] })
		).toEqual(['own_bathroom']);
		// a spot without the bathroom its room has, and without the house's quiet
		expect(
			effectiveFeatures({
				house: ['quiet'],
				room: ['own_bathroom'],
				spotOff: ['own_bathroom', 'quiet']
			})
		).toEqual([]);
		// an off list only knows what the level may inherit; nonsense is ignored
		expect(effectiveFeatures({ house: ['quiet'], roomOff: ['own_bathroom', 'nonsense'] })).toEqual([
			'quiet'
		]);
		// PocketBase's single-value shape works too
		expect(effectiveFeatures({ house: ['quiet'], roomOff: 'quiet' })).toEqual([]);
	});

	it('names what a room or spot may switch off, and what it inherits', () => {
		expect(offAllowed('room').map((f) => f.value)).toEqual(
			featuresFor('house').map((f) => f.value)
		);
		expect(offAllowed('spot').map((f) => f.value)).toEqual([
			'wheelchair',
			'ground_floor',
			'toilets_inside',
			'own_bathroom',
			'heated',
			'unheated',
			'quiet'
		]);
		expect(readFeaturesOff(['own_bathroom', 'quiet', 'quiet'], 'room')).toEqual(['quiet']);
		expect(readFeaturesOff(['quiet', 'own_bathroom'], 'spot')).toEqual(['own_bathroom', 'quiet']);
		expect(inheritedFeatures('room', { house: ['heated', 'quiet'] })).toEqual(['heated', 'quiet']);
		expect(
			inheritedFeatures('spot', {
				house: ['heated', 'quiet'],
				room: ['own_bathroom'],
				roomOff: ['quiet']
			})
		).toEqual(['own_bathroom', 'heated']);
		expect(overrideProblem(['heated'], ['heated'])).toMatch(/switched off here and ticked here/);
		expect(overrideProblem(['heated'], ['quiet'])).toBe('');
	});

	it('reads overrides from a form only for a superuser, and refuses a clash', () => {
		const form = new FormData();
		form.append('kind', 'room');
		form.append('features', 'own_bathroom');
		form.append('features_off', 'heated');
		form.append('features_off', 'own_bathroom'); // not a house feature: ignored
		// an admin's form never carries features_off
		const admin = parseDetailsForm(form, 'room');
		expect(admin.ok).toBe(true);
		expect('features_off' in admin.value).toBe(false);
		// a superuser's does
		const su = parseDetailsForm(form, 'room', { canOverride: true });
		expect(su.ok).toBe(true);
		expect(su.value.features_off).toEqual(['heated']);
		// a house has nothing above it
		expect('features_off' in parseDetailsForm(form, 'house', { canOverride: true }).value).toBe(
			false
		);
		// switched off and ticked at once is refused
		form.append('features', 'heated');
		const clash = parseDetailsForm(form, 'room', { canOverride: true });
		expect(clash.ok).toBe(false);
		if (!clash.ok) expect(clash.error).toMatch(/Heated.*switched off/);

		const spot = new FormData();
		spot.append('bed_type', 'single');
		spot.append('features_off', 'quiet');
		spot.append('features_off', 'own_bathroom');
		spot.append('features_off', 'power'); // dropped from the catalogue: ignored
		const adminSpot = parseSpotForm(spot);
		expect(adminSpot.ok).toBe(true);
		if (adminSpot.ok) expect('features_off' in adminSpot.value).toBe(false);
		const suSpot = parseSpotForm(spot, { canOverride: true });
		expect(suSpot.ok).toBe(true);
		if (suSpot.ok) expect(suSpot.value.features_off).toEqual(['own_bathroom', 'quiet']);
		// a spot has no features of its own: a stray field is not read at all
		spot.append('features', 'quiet');
		const stray = parseSpotForm(spot, { canOverride: true });
		expect(stray).toEqual({
			ok: true,
			value: { bed_type: 'single', features_off: ['own_bathroom', 'quiet'] }
		});
	});

	it('never calls an upper bunk wheelchair accessible, however accessible its room is', () => {
		const around = { house: ['wheelchair', 'heated'], room: ['ground_floor'] };
		expect(effectiveFeatures({ ...around, bedType: 'bunk_upper' })).toEqual([
			'ground_floor',
			'heated'
		]);
		// the lower bunk and every other bed keep the room's accessibility
		expect(effectiveFeatures({ ...around, bedType: 'bunk_lower' })).toContain('wheelchair');
		expect(effectiveFeatures({ ...around, bedType: 'single' })).toContain('wheelchair');
		expect(effectiveFeatures({ ...around })).toContain('wheelchair');
		// the same when the sum was made elsewhere (the ♿ picker's list)
		expect(factsOf('bunk_upper', ['wheelchair', 'quiet']).features).toEqual(['quiet']);
		expect(factsOf('bunk_lower', ['wheelchair', 'quiet']).features).toEqual([
			'wheelchair',
			'quiet'
		]);
		// the rule and what it takes away from a spot the room describes
		expect(bedRulesOut('bunk_upper')).toEqual(['wheelchair']);
		expect(bedRulesOut('bunk_lower')).toEqual([]);
		expect(bedRulesOut('')).toEqual([]);
		expect(missingAtSpot({ house: ['wheelchair', 'heated'], bedType: 'bunk_upper' })).toEqual([
			'wheelchair'
		]);
		expect(missingAtSpot({ house: ['wheelchair', 'heated'], bedType: 'bunk_lower' })).toEqual([]);
		// together with what a superuser switched off, in catalogue order
		expect(
			missingAtSpot({
				house: ['heated'],
				room: ['wheelchair', 'quiet'],
				spotOff: ['quiet'],
				bedType: 'bunk_upper'
			})
		).toEqual(['wheelchair', 'quiet']);
		expect(missingAtSpot({ house: ['heated'], spotOff: ['heated'], bedType: 'single' })).toEqual([
			'heated'
		]);
	});

	it('never calls an upper bunk step-free, not even on the ground floor', () => {
		const upper = (room: Feature[]) => spotFacts({ bedType: 'bunk_upper', room });
		for (const room of [['wheelchair'], ['ground_floor'], ['wheelchair', 'ground_floor']]) {
			expect(needFit('step_free', upper(room as Feature[]))).toBe('conflict');
			expect(spotMatchesFilter('step_free', upper(room as Feature[]))).toBe(false);
		}
		// it still stands on the ground floor: that is a fact about its room
		expect(upper(['ground_floor']).features).toEqual(['ground_floor']);
		// a lower bunk there is step-free, and so is a bed nobody described
		for (const bedType of ['bunk_lower', '']) {
			const spot = spotFacts({ bedType, room: ['ground_floor'] });
			expect(needFit('step_free', spot)).toBe('fits');
			expect(spotMatchesFilter('step_free', spot)).toBe(true);
		}
		// an upper bunk the room says nothing about is still a clear no
		expect(needFit('step_free', facts('bunk_upper'))).toBe('conflict');
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
		expect(needFit('near_toilet', facts('', ['toilets_inside']))).toBe('fits');
	});

	it('leaves a power socket and "something else" to the crew', () => {
		expect(MATCHED_BY_HAND).toEqual(['power', 'other']);
		// nobody knows where the sockets are: no spot fits, none conflicts
		const everything = facts('single', ['wheelchair', 'own_bathroom', 'heated', 'quiet']);
		expect(needFit('power', everything)).toBe('unknown');
		// what the guest wrote themselves is for a human to read
		expect(needFit('other', facts('bunk_lower', ['quiet']))).toBe('unknown');
	});

	it('scores a spot by what it answers, and a conflict costs a point', () => {
		const needs: SpecialNeed[] = ['lower_bunk', 'step_free', 'quiet'];
		const good = matchNeeds(needs, facts('bunk_lower', ['ground_floor', 'quiet']));
		expect(good.fits).toEqual(needs);
		expect(good.score).toBe(3);

		// an upper bunk is neither a lower bunk nor step-free
		const bad = matchNeeds(needs, facts('bunk_upper'));
		expect(bad.conflicts).toEqual(['lower_bunk', 'step_free']);
		expect(bad.unknown).toEqual(['quiet']);
		expect(bad.score).toBe(-2);
	});

	it('counts free fitting spots per need, but not the needs the crew matches by hand', () => {
		const open = [
			{ needs: ['step_free', 'power'] as SpecialNeed[] },
			{ needs: ['step_free', 'other'] as SpecialNeed[] }
		];
		// a hut on the ground floor: two lower bunks, two upper ones
		const hut = ['bunk_lower', 'bunk_lower', 'bunk_upper', 'bunk_upper'].map((bedType) => ({
			bedType,
			features: ['ground_floor']
		}));
		expect(needCapacity(open, hut)).toEqual([
			{ need: 'step_free', label: expect.any(String), asked: 2, fitting: 2, short: false }
		]);
		expect(needCapacity(open, hut.slice(1))).toEqual([
			{ need: 'step_free', label: expect.any(String), asked: 2, fitting: 1, short: true }
		]);
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
		const spot = facts('bunk_lower', ['quiet', 'heated']);
		expect(spotMatchesFilters(['no_ladder', 'quiet', 'heated'], spot)).toBe(true);
		expect(spotMatchesFilters(['no_ladder', 'step_free'], spot)).toBe(false);
		expect(spotMatchesFilters([], facts(''))).toBe(true);
	});

	it('offers only the wishes some spot answers, in the catalogue order', () => {
		// a heated, quiet hut with a lower bunk, and an upper bunk nobody described
		const spots = [facts('bunk_lower', ['heated', 'quiet']), facts('bunk_upper')];
		expect(availableFilters(spots)).toEqual(['no_ladder', 'heated', 'quiet']);
		// the order is the catalogue's, whatever the spots' order
		expect(availableFilters([...spots].reverse())).toEqual(['no_ladder', 'heated', 'quiet']);
		// a camp nobody described offers nothing; an empty camp neither
		expect(availableFilters([facts(''), facts('bunk_upper')])).toEqual([]);
		expect(availableFilters([])).toEqual([]);
		// every filter, once some spot answers it
		expect(
			availableFilters([facts('single', ['wheelchair', 'own_bathroom', 'heated', 'quiet'])])
		).toEqual(SPOT_FILTERS.map((filter) => filter.value));
		// upper bunks on the ground floor offer no "Step-free"
		expect(availableFilters([facts('bunk_upper', ['ground_floor'])])).toEqual([]);
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
	it('writes a list of features as words with their icons', () => {
		expect(featureText(['heated', 'quiet'])).toBe('🔥 Heated · 🤫 Quiet zone');
		expect(featureText(['nonsense', 'quiet'])).toBe('🤫 Quiet zone');
		expect(featureText(['power'])).toBe('');
		expect(featureText([])).toBe('');
		expect(featureText(undefined)).toBe('');
	});

	it('counts the beds of a room', () => {
		expect(bedTypeMix(['bunk_lower', 'bunk_lower', 'bunk_upper'])).toBe(
			'2 × lower bunk · 1 × upper bunk'
		);
		expect(bedTypeMix(['bunk_lower', '', undefined])).toBe('1 × lower bunk · 2 not specified');
		expect(bedTypeMix(['', ''])).toBe('');
	});

	it('folds the details of a house or room into one line', () => {
		expect(detailsSummary('house', 'hut_group', ['heated', 'wheelchair'], 'By the lake')).toBe(
			'🛖 Hut group · ♿ 🔥 · description'
		);
		// a room-only feature on a house is dropped, blank text is no description
		expect(detailsSummary('house', '', ['own_bathroom'], '  ')).toBe('');
		expect(detailsSummary('room', 'tent', [], '')).toBe('⛺ Tent');
	});
});
