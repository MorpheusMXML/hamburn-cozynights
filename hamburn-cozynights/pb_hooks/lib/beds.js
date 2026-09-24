/// <reference path="../../pb_data/types.d.ts" />
//
// What a spot is like, for the messages PocketBase sends (notify.js) and for
// the records API: the kind of bed, the features around it, and the two rules
// the app applies to them. The catalogue itself lives in
// src/lib/accommodation.ts — the app, the layout templates and the ♿ picker
// read it there. PocketBase's JSVM can't import TypeScript, so the labels are
// repeated here and tests/accommodation.test.ts checks that both stay the same.
//
// The rules (the same as in accommodation.ts):
// - Two features that say the opposite (heated / unheated) can't both be set
//   on one house or room: featureProblem() refuses such a write.
// - A spot's features are its own plus its room's and house's; the closer
//   level wins an argument, and a bed with a ladder is never wheelchair
//   accessible (NOT_UP_A_LADDER).
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

/** The bed types you need a ladder for. */
const LADDER_TYPES = ['bunk_upper'];

// In catalogue order: value → label, icon, the levels it may be set on, and
// the feature that says the opposite.
const FEATURES = [
	{ value: 'wheelchair', label: 'Wheelchair accessible', icon: '♿', levels: ['house', 'room'] },
	{ value: 'ground_floor', label: 'Ground floor', icon: '⬇️', levels: ['house', 'room'] },
	{ value: 'toilets_inside', label: 'Toilets + showers inside', icon: '🚻', levels: ['house'] },
	{ value: 'own_bathroom', label: 'Own bathroom', icon: '🛁', levels: ['room'] },
	{ value: 'heated', label: 'Heated', icon: '🔥', levels: ['house', 'room'], opposite: 'unheated' },
	{
		value: 'unheated',
		label: 'No heating',
		icon: '❄️',
		levels: ['house', 'room'],
		opposite: 'heated'
	},
	{ value: 'quiet', label: 'Quiet zone', icon: '🤫', levels: ['house', 'room'] },
	{ value: 'power', label: 'Power socket', icon: '🔌', levels: ['room', 'spot'] }
];

/** What a bed with a ladder can never be. */
const NOT_UP_A_LADDER = ['wheelchair'];

/** The label of a stored bed type, or '' when a spot doesn't say. */
function bedTypeLabel(value) {
	return BED_TYPE_LABELS[value] || '';
}

function featureEntry(value) {
	for (const entry of FEATURES) if (entry.value === value) return entry;
	return null;
}

/** A stored features value as a clean list: known ones of this level, no duplicates, catalogue order. */
function readFeatures(raw, level) {
	const values = Array.isArray(raw) ? raw : typeof raw === 'string' && raw ? [raw] : [];
	const chosen = {};
	for (const value of values) {
		const entry = featureEntry(value);
		if (entry && entry.levels.indexOf(level) >= 0) chosen[value] = true;
	}
	return FEATURES.filter((entry) => chosen[entry.value]).map((entry) => entry.value);
}

/**
 * Why a house or room record can't be written: two of its features say the
 * opposite of each other. Returns the reason, or '' when it is fine.
 */
function featureProblem(record, level) {
	const features = readFeatures(record.get('features'), level);
	for (const entry of FEATURES) {
		if (
			entry.opposite &&
			features.indexOf(entry.value) >= 0 &&
			features.indexOf(entry.opposite) >= 0
		) {
			const other = featureEntry(entry.opposite);
			return (
				'"' +
				entry.label +
				'" and "' +
				(other ? other.label : entry.opposite) +
				'" say the opposite of each other. Set only one of them.'
			);
		}
	}
	return '';
}

/**
 * What is true for one spot: house, room and spot features together, the
 * closer level winning an argument, and nothing a ladder rules out.
 */
function effectiveFeatures(house, room, spot, bedType) {
	const chosen = {};
	const levels = [
		readFeatures(house, 'house'),
		readFeatures(room, 'room'),
		readFeatures(spot, 'spot')
	];
	for (const features of levels) {
		for (const value of features) {
			const entry = featureEntry(value);
			if (entry && entry.opposite) delete chosen[entry.opposite];
			chosen[value] = true;
		}
	}
	if (LADDER_TYPES.indexOf(bedType) >= 0) {
		for (const value of NOT_UP_A_LADDER) delete chosen[value];
	}
	return FEATURES.filter((entry) => chosen[entry.value]).map((entry) => entry.value);
}

/** "🔥 Heated · 🔌 Power socket", or '' for none. */
function featureText(features) {
	return (features || [])
		.map((value) => featureEntry(value))
		.filter((entry) => !!entry)
		.map((entry) => entry.icon + ' ' + entry.label)
		.join(' · ');
}

/**
 * "Upper bunk · above B1": the bed type and, for a bunk bed, where the other
 * level is. Just the type when the partner is unknown; '' when nobody said.
 */
function bedRow(bedType, partnerLabel) {
	const label = bedTypeLabel(bedType);
	if (!label || !partnerLabel) return label;
	if (bedType === 'bunk_lower') return label + ' · below ' + partnerLabel;
	if (bedType === 'bunk_upper') return label + ' · above ' + partnerLabel;
	return label;
}

module.exports = {
	BED_TYPE_LABELS: BED_TYPE_LABELS,
	FEATURES: FEATURES,
	NOT_UP_A_LADDER: NOT_UP_A_LADDER,
	bedTypeLabel: bedTypeLabel,
	readFeatures: readFeatures,
	featureProblem: featureProblem,
	effectiveFeatures: effectiveFeatures,
	featureText: featureText,
	bedRow: bedRow
};
