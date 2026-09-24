// tests/feature-hook.test.ts — the PocketBase side of the feature rules
// (pb_hooks/lib/beds.js): a house or room can't be heated and unheated at
// once, whatever wrote it; and what a spot's message says about its bed.
import { describe, expect, it } from 'vitest';
import { loadHookModule } from './hook-module';

const beds = loadHookModule('lib/beds.js');

/** A record like the JSVM's: get() over a plain row. */
const record = (row: Record<string, unknown>) => ({ get: (key: string) => row[key] });

describe('features on the records API', () => {
	it('refuses a house or room whose features say the opposite of each other', () => {
		expect(beds.featureProblem(record({ features: ['heated', 'unheated'] }), 'house')).toBe(
			'"Heated" and "No heating" say the opposite of each other. Set only one of them.'
		);
		expect(
			beds.featureProblem(record({ features: ['unheated', 'heated', 'quiet'] }), 'room')
		).toMatch(/say the opposite/);
	});

	it('refuses a room or spot that switches a feature off and claims it at once', () => {
		expect(
			beds.featureProblem(record({ features: ['heated'], features_off: ['heated'] }), 'room')
		).toMatch(/"Heated" is switched off here and ticked here/);
		expect(
			beds.featureProblem(record({ features: 'power', features_off: ['quiet', 'power'] }), 'spot')
		).toMatch(/"Power socket" is switched off/);
		// switching off something else is fine, and a house has no off list
		expect(
			beds.featureProblem(record({ features: ['power'], features_off: ['quiet'] }), 'spot')
		).toBe('');
		expect(
			beds.featureProblem(record({ features: ['heated'], features_off: ['heated'] }), 'house')
		).toBe('');
	});

	it('lets every other list through, including one that is empty or a single value', () => {
		expect(beds.featureProblem(record({ features: ['heated', 'quiet'] }), 'room')).toBe('');
		expect(beds.featureProblem(record({ features: 'unheated' }), 'house')).toBe('');
		expect(beds.featureProblem(record({ features: [] }), 'house')).toBe('');
		expect(beds.featureProblem(record({}), 'room')).toBe('');
		// a feature the level may not have is not the hook's business: it is ignored
		expect(beds.featureProblem(record({ features: ['power', 'heated'] }), 'house')).toBe('');
	});
});

describe('what a message says about the bed', () => {
	it('names the bed and, for a bunk bed, where the other level is', () => {
		expect(beds.bedRow('bunk_upper', 'B1')).toBe('Upper bunk · above B1');
		expect(beds.bedRow('bunk_lower', 'B2')).toBe('Lower bunk · below B2');
		expect(beds.bedRow('bunk_lower', '')).toBe('Lower bunk');
		expect(beds.bedRow('single', 'B2')).toBe('Single bed');
		expect(beds.bedRow('', 'B2')).toBe('');
		expect(beds.bedRow('nonsense', '')).toBe('');
	});

	it('sums up the features around a spot the way the app does, ladder rule included', () => {
		expect(
			beds.effectiveFeatures(['unheated', 'wheelchair'], ['heated'], ['power'], 'single')
		).toEqual(['wheelchair', 'heated', 'power']);
		expect(beds.effectiveFeatures(['wheelchair'], [], [], 'bunk_upper')).toEqual([]);
		expect(beds.effectiveFeatures(['wheelchair'], [], [], 'bunk_lower')).toEqual(['wheelchair']);
		// what a room or spot switched off is gone before its own features count
		expect(beds.effectiveFeatures(['heated', 'quiet'], [], [], 'single', ['heated'])).toEqual([
			'quiet'
		]);
		expect(
			beds.effectiveFeatures(['quiet'], ['power'], [], 'single', [], ['power', 'quiet'])
		).toEqual([]);
		expect(beds.featureText(['heated', 'power'])).toBe('🔥 Heated · 🔌 Power socket');
		expect(beds.featureText([])).toBe('');
	});
});
