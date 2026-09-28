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

	it('refuses a room that switches a feature off and claims it at once', () => {
		expect(
			beds.featureProblem(record({ features: ['heated'], features_off: ['heated'] }), 'room')
		).toMatch(/"Heated" is switched off here and ticked here/);
		// switching off something else is fine, and a house has no off list
		expect(
			beds.featureProblem(record({ features: ['own_bathroom'], features_off: ['quiet'] }), 'room')
		).toBe('');
		expect(
			beds.featureProblem(record({ features: ['heated'], features_off: ['heated'] }), 'house')
		).toBe('');
	});

	it('lets every spot through: a spot has no features of its own to clash with', () => {
		// a leftover value from before the power socket went, or anything else
		expect(
			beds.featureProblem(record({ features: 'power', features_off: ['quiet', 'power'] }), 'spot')
		).toBe('');
		expect(beds.featureProblem(record({ features_off: ['heated', 'unheated'] }), 'spot')).toBe('');
		expect(beds.featureProblem(record({}), 'spot')).toBe('');
	});

	it('lets every other list through, including one that is empty or a single value', () => {
		expect(beds.featureProblem(record({ features: ['heated', 'quiet'] }), 'room')).toBe('');
		expect(beds.featureProblem(record({ features: 'unheated' }), 'house')).toBe('');
		expect(beds.featureProblem(record({ features: [] }), 'house')).toBe('');
		expect(beds.featureProblem(record({}), 'room')).toBe('');
		// a feature the level may not have is not the hook's business: it is ignored,
		// and so is one the catalogue has dropped (the power socket)
		expect(beds.featureProblem(record({ features: ['own_bathroom', 'heated'] }), 'house')).toBe('');
		expect(beds.featureProblem(record({ features: ['power', 'heated'] }), 'room')).toBe('');
	});
});

describe('who may change features_off on the records API', () => {
	const auth = (collection: string, role = '') => ({
		collection: () => ({ name: collection }),
		get: (key: string) => (key === 'role' ? role : '')
	});

	it('lets an unchanged list through, whoever writes', () => {
		expect(beds.overrideChangeProblem(auth('admins', 'admin'), ['quiet'], ['quiet'], 'room')).toBe(
			''
		);
		expect(beds.overrideChangeProblem(auth('admins', 'admin'), 'quiet', ['quiet'], 'spot')).toBe(
			''
		);
		expect(beds.overrideChangeProblem(auth('admins', 'admin'), [], undefined, 'room')).toBe('');
	});

	it('refuses an admin and lets superusers of both kinds change it', () => {
		const message = 'Only a superuser can switch an inherited feature off or on again.';
		expect(beds.overrideChangeProblem(auth('admins', 'admin'), [], ['quiet'], 'room')).toBe(
			message
		);
		expect(beds.overrideChangeProblem(auth('admins', 'admin'), ['quiet'], [], 'spot')).toBe(
			message
		);
		expect(beds.overrideChangeProblem(auth('admins', 'superuser'), [], ['quiet'], 'room')).toBe('');
		expect(beds.overrideChangeProblem(auth('_superusers'), [], ['quiet'], 'room')).toBe('');
		expect(beds.overrideChangeProblem(null, [], ['quiet'], 'room')).toBe('');
		// a house has no off list to guard
		expect(beds.overrideChangeProblem(auth('admins', 'admin'), [], ['quiet'], 'house')).toBe('');
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
			beds.effectiveFeatures(['unheated', 'wheelchair'], ['heated', 'own_bathroom'], 'single')
		).toEqual(['wheelchair', 'own_bathroom', 'heated']);
		expect(beds.effectiveFeatures(['wheelchair'], [], 'bunk_upper')).toEqual([]);
		expect(beds.effectiveFeatures(['wheelchair'], [], 'bunk_lower')).toEqual(['wheelchair']);
		// what the room or the spot switched off is gone
		expect(beds.effectiveFeatures(['heated', 'quiet'], [], 'single', ['heated'])).toEqual([
			'quiet'
		]);
		expect(
			beds.effectiveFeatures(['quiet'], ['own_bathroom'], 'single', [], ['own_bathroom', 'quiet'])
		).toEqual([]);
		// a power socket stored before it was dropped says nothing any more
		expect(beds.effectiveFeatures(['quiet'], ['power'], 'single')).toEqual(['quiet']);
		expect(beds.featureText(['heated', 'quiet'])).toBe('🔥 Heated · 🤫 Quiet zone');
		expect(beds.featureText(['power'])).toBe('');
		expect(beds.featureText([])).toBe('');
	});
});
