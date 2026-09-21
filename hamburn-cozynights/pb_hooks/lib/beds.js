/// <reference path="../../pb_data/types.d.ts" />
//
// What kind of bed a spot is, for the messages PocketBase sends (notify.js).
// The catalogue itself lives in src/lib/accommodation.ts — the app, the layout
// templates and the ♿ picker read it there. PocketBase's JSVM can't import
// TypeScript, so the labels are repeated here and tests/accommodation.test.ts
// checks that both lists stay the same.
//
// A CommonJS module for PocketBase's JSVM, like texts.js.

const BED_TYPE_LABELS = {
	single: 'Single bed',
	bunk_lower: 'Lower bunk',
	bunk_upper: 'Upper bunk',
	double: 'Double bed (shared)',
	sofa: 'Sofa',
	mattress: 'Mattress',
	camp_bed: 'Camp bed'
};

/** The label of a stored bed type, or '' when a spot doesn't say. */
function bedTypeLabel(value) {
	return BED_TYPE_LABELS[value] || '';
}

module.exports = { BED_TYPE_LABELS: BED_TYPE_LABELS, bedTypeLabel: bedTypeLabel };
