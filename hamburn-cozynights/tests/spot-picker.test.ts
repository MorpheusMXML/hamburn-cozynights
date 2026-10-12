// tests/spot-picker.test.ts — the spot picker of the requests page
// (src/lib/spot-picker.ts, docs/admin/special-needs.md "Decide and book"):
// houses → rooms → cards, the search, the filters, how a spot answers a
// request, what a hand pick warns of, and the strip of best fits. The
// group's proposal itself:
// tests/request-groups.test.ts ("the group planner").
import { describe, it, expect } from 'vitest';
import {
	NO_FILTER,
	bestFits,
	buildPlaces,
	fitOf,
	isFiltered,
	matchesQuery,
	normalize,
	passes,
	pickNotes,
	unitSpots,
	type PickerFilter
} from '../src/lib/spot-picker';
import { needPill } from '../src/lib/need-pill';
import type { SpecialNeed, SpotInfo } from '../src/lib/special-needs';

const ROOMS: Record<
	string,
	{ room: string; house: string; houseId: string; houseKind?: string; roomFeatures?: string[] }
> = {
	r2: { room: 'Room 2', house: 'Wälderhaus', houseId: 'h1', houseKind: 'house' },
	r10: { room: 'Room 10', house: 'Wälderhaus', houseId: 'h1', houseKind: 'house' },
	hut: { room: 'Hut 1 #1', house: 'Brahmsee-Buden', houseId: 'h2', houseKind: 'hut_group' },
	lake: {
		room: 'Bay #3',
		house: 'Haus am See',
		houseId: 'h3',
		roomFeatures: ['toilets_inside', 'quiet']
	}
};

function spot(
	bedId: string,
	roomId: string,
	label: string,
	extra: Partial<SpotInfo> = {}
): SpotInfo {
	const { room, house, houseId, houseKind = '', roomFeatures = [] } = ROOMS[roomId];
	return {
		bedId,
		roomId,
		houseId,
		label: `${label} · ${room} · ${house}`,
		spot: label,
		room,
		house,
		special: false,
		locked: false,
		bedType: '',
		features: [],
		bunkPartner: '',
		houseKind,
		roomKind: '',
		roomFeatures,
		...extra
	};
}

const step = ['wheelchair', 'ground_floor', 'toilets_inside'];
// Wälderhaus: Room 2 with a bunk bed (both free) and a ♿ single, Room 10 with
// the lower half of a bunk free (its upper half is taken); a hut with a spot
// the crew locked 🔒 (B10); a quiet bay.
const SPOTS = [
	spot('w10a', 'r10', 'B1', { bedType: 'bunk_lower', bunkPartner: 'taken', features: step }),
	spot('w2up', 'r2', 'B2', { bedType: 'bunk_upper', bunkPartner: 'w2low', features: step }),
	spot('w2low', 'r2', 'B1', { bedType: 'bunk_lower', bunkPartner: 'w2up', features: step }),
	spot('w2sp', 'r2', 'B3', { bedType: 'single', special: true, features: step }),
	spot('hut1', 'hut', 'B1', { bedType: 'bunk_upper' }),
	spot('hut2', 'hut', 'B10', { bedType: 'bunk_lower', locked: true }),
	spot('hut3', 'hut', 'B2'),
	spot('bay1', 'lake', 'S1', { bedType: 'single', features: ['toilets_inside', 'quiet'] })
];

const filter = (extra: Partial<PickerFilter>): PickerFilter => ({ ...NO_FILTER, ...extra });

describe('the spot picker lays out the camp', () => {
	it('as houses, rooms and cards in the natural order, with a bunk bed as one card', () => {
		const houses = buildPlaces(SPOTS, { r2: 6, r10: 5, hut: 10 });
		// the locked B10 counts for nothing: the hut has 2 free spots, not 3
		expect(houses.map((house) => [house.name, house.kind, house.free, house.special])).toEqual([
			['Brahmsee-Buden', 'hut_group', 2, 0],
			['Haus am See', '', 1, 0],
			['Wälderhaus', 'house', 4, 1]
		]);
		expect(houses[0].rooms.map((room) => [room.free, room.locked, room.size])).toEqual([
			[2, 1, 10]
		]);
		const walder = houses[2];
		// Room 2 before Room 10, and each room says how many of its spots are free
		expect(
			walder.rooms.map((room) => [room.name, room.free, room.size, room.special, room.locked])
		).toEqual([
			['Room 2', 3, 6, 1, 0],
			['Room 10', 1, 5, 0, 0]
		]);
		// the bunk bed of B1 + B2 is one card (upper level first), B3 stands alone;
		// Room 10's lower bunk is alone: its upper level is taken
		expect(walder.rooms[0].units.map((unit) => unitSpots(unit).map((s) => s.bedId))).toEqual([
			['w2up', 'w2low'],
			['w2sp']
		]);
		expect(walder.rooms[0].units[0].kind).toBe('bunk');
		expect(walder.rooms[1].units).toEqual([{ kind: 'single', spot: SPOTS[0] }]);
		// B2 before B10 in the hut; the locked spot still gets its card, marked
		expect(houses[0].rooms[0].units.map((unit) => unitSpots(unit)[0].spot)).toEqual([
			'B1',
			'B2',
			'B10'
		]);
	});

	it('counts the free spots of a room whose size it does not know, and takes the room’s features', () => {
		const [lake] = buildPlaces(SPOTS, {}).filter((house) => house.houseId === 'h3');
		expect(lake.rooms[0]).toMatchObject({
			size: 1,
			free: 1,
			features: ['toilets_inside', 'quiet']
		});
	});

	it('leaves out what the filter hides, but keeps counting every free spot', () => {
		const houses = buildPlaces(SPOTS, { r2: 6 }, (s) => s.bedId === 'w2low' || s.bedId === 'w2sp');
		expect(houses.map((house) => house.name)).toEqual(['Wälderhaus']);
		const [room] = houses[0].rooms;
		expect(room).toMatchObject({ name: 'Room 2', free: 3, size: 6 });
		// one level of the bunk bed shown: a card of its own
		expect(room.units.map((unit) => [unit.kind, unitSpots(unit).map((s) => s.bedId)])).toEqual([
			['single', ['w2low']],
			['single', ['w2sp']]
		]);
	});
});

describe('the spot picker search', () => {
	it('finds houses, rooms and spots without accents, case or extra spaces', () => {
		expect(normalize('  Wälder  Haus ')).toBe('walder haus');
		expect(normalize('Straße')).toBe('strasse');
		const bunk = SPOTS[2];
		expect(matchesQuery(bunk, 'walder')).toBe(true);
		expect(matchesQuery(bunk, 'WÄLDER room 2')).toBe(true);
		expect(matchesQuery(bunk, 'room 2 b1')).toBe(true);
		expect(matchesQuery(bunk, 'walder hut')).toBe(false);
		expect(matchesQuery(bunk, '   ')).toBe(true);
	});
});

describe('the spot picker filters', () => {
	const ids = (f: PickerFilter, needs: SpecialNeed[] = []) =>
		SPOTS.filter((s) => passes(s, f, needs)).map((s) => s.bedId);

	it('show everything without a filter', () => {
		expect(ids(NO_FILTER)).toHaveLength(SPOTS.length);
		expect(isFiltered(NO_FILTER)).toBe(false);
		expect(isFiltered(filter({ query: '  ' }))).toBe(false);
	});

	it('narrow down to a house, the ♿ spots, a search', () => {
		expect(ids(filter({ houseId: 'h2' }))).toEqual(['hut1', 'hut2', 'hut3']);
		expect(ids(filter({ special: true }))).toEqual(['w2sp']);
		expect(ids(filter({ query: 'bay' }))).toEqual(['bay1']);
		expect(isFiltered(filter({ houseId: 'h2' }))).toBe(true);
	});

	it('keep only spots that answer every wish, strictly like the map', () => {
		// no ladder: never an upper bunk, never a bed nobody described
		expect(ids(filter({ wishes: ['no_ladder'] }))).toEqual([
			'w10a',
			'w2low',
			'w2sp',
			'hut2',
			'bay1'
		]);
		expect(ids(filter({ wishes: ['no_ladder', 'quiet'] }))).toEqual(['bay1']);
		// step-free: the ladder is a step, even in a ♿ house
		expect(ids(filter({ wishes: ['step_free'] }))).toEqual(['w10a', 'w2low', 'w2sp']);
	});

	it('keep only the spots that answer everything the request asks for', () => {
		expect(ids(filter({ fitting: true }), ['lower_bunk', 'step_free'])).toEqual([
			'w10a',
			'w2low',
			'w2sp'
		]);
		// what only a person can match never counts as answered
		expect(ids(filter({ fitting: true }), ['own_room'])).toEqual([]);
	});
});

describe('how a spot answers a request', () => {
	it('fits all only when every need the layout can answer is answered', () => {
		const low = SPOTS[2];
		expect(fitOf(['lower_bunk', 'step_free'], low).all).toBe(true);
		expect(fitOf(['lower_bunk', 'step_free', 'other'], low).all).toBe(true);
		expect(fitOf(['lower_bunk', 'quiet'], low).all).toBe(false);
		expect(fitOf(['own_room'], low).all).toBe(false);
		expect(fitOf(['lower_bunk'], SPOTS[1]).match.conflicts).toEqual(['lower_bunk']);
	});

	it('scores what a spot answers, ♿ or not: the ♿ spots come first elsewhere', () => {
		const special = SPOTS[3];
		expect(fitOf(['step_free'], special).score).toBe(1);
		expect(fitOf(['step_free'], SPOTS[2]).score).toBe(1);
		expect(fitOf(['own_room'], special).score).toBe(0);
		expect(fitOf(['lower_bunk'], SPOTS[1]).score).toBe(-1);
	});
});

describe('what a spot picked by hand warns of', () => {
	it('a spot the crew locked 🔒, and every need it clearly misses', () => {
		const lockedLower = SPOTS[5];
		expect(pickNotes(['lower_bunk'], lockedLower)).toEqual({ blocked: true, mismatches: [] });
		// an upper bunk misses both, each named once
		expect(pickNotes(['lower_bunk', 'step_free', 'lower_bunk'], SPOTS[1])).toEqual({
			blocked: false,
			mismatches: ['No ladder', 'Step-free']
		});
		// what the layout can't tell is no mismatch
		expect(pickNotes(['quiet', 'own_room', 'helper'], SPOTS[4])).toEqual({
			blocked: false,
			mismatches: []
		});
		expect(pickNotes([], SPOTS[3])).toEqual({ blocked: false, mismatches: [] });
	});
});

describe('the best fits', () => {
	it('come without a mismatch, the ♿ spots first, then the most needs answered', () => {
		// hut2 (a lower bunk) would fit too, but the crew locked it
		expect(bestFits(SPOTS, ['lower_bunk', 'step_free']).map((s) => s.bedId)).toEqual([
			'w2sp',
			'w2low',
			'w10a',
			'bay1'
		]);
		// the ♿ spot ahead of the bay, which answers both
		expect(bestFits(SPOTS, ['quiet', 'near_toilet']).map((s) => s.bedId)).toEqual([
			'w2sp',
			'bay1',
			'w2low',
			'w2up',
			'w10a'
		]);
		expect(bestFits(SPOTS, ['lower_bunk'], 2)).toHaveLength(2);
	});

	it('are the ♿ spots for every request: "something else", a helper, a project, a group only', () => {
		for (const needs of [['other'], ['helper'], ['own_room', 'close_together'], []] as const) {
			expect(bestFits(SPOTS, needs).map((s) => s.bedId)).toEqual(['w2sp']);
		}
		// but never a ♿ spot that clearly misses a need, nor one the crew locked
		const lockedSpecial = SPOTS.map((s) => (s.bedId === 'w2sp' ? { ...s, locked: true } : s));
		expect(bestFits(lockedSpecial, ['own_room'])).toEqual([]);
		const upperSpecial = SPOTS.map((s) =>
			s.bedId === 'w2sp' ? { ...s, bedType: 'bunk_upper' } : s
		);
		expect(bestFits(upperSpecial, ['lower_bunk']).map((s) => s.bedId)).toEqual([
			'bay1',
			'w2low',
			'w10a'
		]);
	});
});

describe('the need pills', () => {
	it('are pink for what a guest needs and outlined with an icon for a project or a helper', () => {
		expect(needPill('lower_bunk')).toEqual({
			text: 'A lower bunk or a bed without a ladder',
			neutral: false
		});
		expect(needPill('lower_bunk', true)).toEqual({ text: 'No ladder', neutral: false });
		expect(needPill('other', true)).toEqual({ text: 'Something else', neutral: false });
		expect(needPill('own_room')).toEqual({
			text: '🎨 A room for our art project or crew',
			neutral: true
		});
		expect(needPill('near_project')).toEqual({
			text: '📍 A bed close to our art piece or project',
			neutral: true
		});
		// a helper coming along is no health need either, nor are stable light conditions a project
		expect(needPill('helper')).toEqual({
			text: '🤝 I come as the helper of someone with a personal need',
			neutral: true
		});
		expect(needPill('stable_light')).toEqual({ text: 'Stable light conditions', neutral: false });
	});
});
