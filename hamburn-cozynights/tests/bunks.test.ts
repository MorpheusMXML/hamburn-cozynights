// tests/bunks.test.ts — bunk beds: two spots stacked into one bed.
import { describe, expect, it } from 'vitest';
import {
	arePaired,
	bunkNote,
	bunkOf,
	groupBunks,
	levelOf,
	partnerOf,
	stackCandidates,
	stackProblem,
	stackWrites,
	unstackWrite
} from '$lib/bunks';

const spot = (
	id: string,
	extra: Partial<{ label: string; bed_type: string; bunk_partner: string }> = {}
) => ({
	id,
	label: extra.label ?? id.toUpperCase(),
	bed_type: extra.bed_type ?? '',
	bunk_partner: extra.bunk_partner ?? ''
});

const room = () => [
	spot('b1', { bed_type: 'bunk_lower', bunk_partner: 'b2' }),
	spot('b2', { bed_type: 'bunk_upper', bunk_partner: 'b1' }),
	spot('b3', { bed_type: 'single' }),
	spot('b4')
];

describe('grouping the spots of a room into cards', () => {
	it('shows a paired lower and upper bunk as one bunk bed, where the first spot was', () => {
		const units = groupBunks(room());
		expect(units.map((unit) => unit.kind)).toEqual(['bunk', 'single', 'single']);
		const bunk = units[0];
		if (bunk.kind !== 'bunk') throw new Error('expected a bunk');
		expect(bunk.lower.id).toBe('b1');
		expect(bunk.upper.id).toBe('b2');
	});

	it('takes the order of the list when the pair does not say which level is which', () => {
		const units = groupBunks([spot('x', { bunk_partner: 'y' }), spot('y', { bunk_partner: 'x' })]);
		expect(units).toHaveLength(1);
		if (units[0].kind !== 'bunk') throw new Error('expected a bunk');
		expect(units[0].lower.id).toBe('x');
		expect(units[0].upper.id).toBe('y');
	});

	it('sorts the levels by bed type even when the upper bunk comes first', () => {
		const units = groupBunks([
			spot('u', { bed_type: 'bunk_upper', bunk_partner: 'l' }),
			spot('l', { bed_type: 'bunk_lower', bunk_partner: 'u' })
		]);
		if (units[0].kind !== 'bunk') throw new Error('expected a bunk');
		expect(units[0].lower.id).toBe('l');
		expect(units[0].upper.id).toBe('u');
	});

	it('treats a half-written pairing as two single spots', () => {
		// b2 points at b1, but b1 points nowhere (or at a third spot).
		const units = groupBunks([spot('b1'), spot('b2', { bunk_partner: 'b1' })]);
		expect(units.map((unit) => unit.kind)).toEqual(['single', 'single']);
		const gone = groupBunks([spot('b2', { bunk_partner: 'nope' })]);
		expect(gone[0].kind).toBe('single');
		expect(arePaired(spot('a', { bunk_partner: 'a' }), spot('a'))).toBe(false);
	});

	it('finds the bunk bed, the partner and the note of a spot', () => {
		const spots = room();
		expect(bunkOf(spots, 'b2')?.lower.id).toBe('b1');
		expect(bunkOf(spots, 'b3')).toBeNull();
		expect(partnerOf(spots, 'b1')?.id).toBe('b2');
		expect(partnerOf(spots, 'b4')).toBeNull();
		expect(bunkNote(spots, 'b1')).toBe('below B2');
		expect(bunkNote(spots, 'b2')).toBe('above B1');
		expect(bunkNote(spots, 'b3')).toBe('');
		expect(levelOf(spots[1])).toBe('upper');
		expect(levelOf(spots[2])).toBeNull();
	});
});

describe('stacking and unstacking', () => {
	it('allows two free-standing spots of the room and nothing else', () => {
		const spots = room();
		expect(stackProblem(spots, 'b3', 'b4')).toBe('');
		expect(stackProblem(spots, 'b3', 'b3')).toMatch(/itself/);
		expect(stackProblem(spots, 'b3', 'zz')).toMatch(/not in this room/);
		expect(stackProblem(spots, 'b1', 'b3')).toMatch(/"B1" is part of a bunk bed already/);
		expect(stackProblem(spots, 'b3', 'b2')).toMatch(/"B2" is part of a bunk bed already/);
		expect(stackCandidates(spots, 'b3').map((s) => s.id)).toEqual(['b4']);
		expect(stackCandidates(spots, 'b1')).toEqual([]);
	});

	it('writes the pairing on both spots with their levels', () => {
		expect(stackWrites('b3', 'b4')).toEqual({
			lower: { id: 'b3', bunk_partner: 'b4', bed_type: 'bunk_lower' },
			upper: { id: 'b4', bunk_partner: 'b3', bed_type: 'bunk_upper' }
		});
	});

	it('clears the pairing and a bunk bed type, but keeps any other bed type', () => {
		expect(unstackWrite(spot('b1', { bed_type: 'bunk_lower', bunk_partner: 'b2' }))).toEqual({
			id: 'b1',
			bunk_partner: '',
			bed_type: ''
		});
		expect(unstackWrite(spot('b3', { bed_type: 'single', bunk_partner: 'b4' }))).toEqual({
			id: 'b3',
			bunk_partner: ''
		});
	});
});
