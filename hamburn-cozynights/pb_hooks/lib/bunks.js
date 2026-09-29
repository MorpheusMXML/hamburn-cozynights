/// <reference path="../../pb_data/types.d.ts" />
//
// Bunk beds on the records API: `beds.bunk_partner` must point both ways and
// stay inside one room (src/lib/bunks.ts explains the model). The app writes
// both spots of a bunk bed together; this keeps them in step when a spot is
// written on its own — the dashboard, a template import, a script — or
// deleted. Every write here is a no-op when the two sides agree already, so
// the hooks it triggers on the partner stop by themselves.
//
// A CommonJS module for PocketBase's JSVM, required by cozy_bunks.pb.js;
// tests/bunk-hook.test.ts drives it with a fake app.

const BUNK_TYPES = ['bunk_lower', 'bunk_upper'];

function partnerOf(record) {
	const value = record.get('bunk_partner');
	return typeof value === 'string' ? value : '';
}

/** A spot that stands alone again: no partner, and no bunk level either. */
function standAlone(record) {
	let changed = false;
	if (partnerOf(record) !== '') {
		record.set('bunk_partner', '');
		changed = true;
	}
	if (BUNK_TYPES.indexOf(record.get('bed_type')) >= 0) {
		record.set('bed_type', '');
		changed = true;
	}
	return changed;
}

/**
 * Before a spot is written through the API: a partner must be another spot
 * of the same room. Returns the reason to refuse, or ''.
 */
function requestProblem(app, record) {
	const partner = partnerOf(record);
	if (!partner) return '';
	if (partner === record.id) return 'A spot cannot be its own bunk partner.';
	let other;
	try {
		other = app.findRecordById('beds', partner);
	} catch (err) {
		return 'The bunk partner does not exist.';
	}
	if (other.get('room') !== record.get('room')) {
		return 'The two spots of a bunk bed must be in the same room.';
	}
	return '';
}

/**
 * After a spot was written: the spot it names points back, the spot that
 * used to name it lets go. Returns how many other spots were written.
 */
function afterWrite(app, record) {
	const id = record.id;
	const partner = partnerOf(record);
	let writes = 0;

	// Whoever still points at this spot without being its partner was its
	// partner before this write (or never agreed): a single spot again.
	const stale = app.findRecordsByFilter(
		'beds',
		'bunk_partner = {:id} && id != {:partner}',
		'',
		0,
		0,
		{ id: id, partner: partner || '-' }
	);
	for (const other of stale) {
		if (standAlone(other)) {
			app.save(other);
			writes += 1;
		}
	}

	if (!partner) return writes;

	let other = null;
	try {
		other = app.findRecordById('beds', partner);
	} catch (err) {
		other = null;
	}
	if (!other || other.get('room') !== record.get('room')) {
		// The partner is gone or in another room: this spot stands alone.
		if (standAlone(record)) {
			app.save(record);
			writes += 1;
		}
		return writes;
	}
	if (partnerOf(other) !== id) {
		other.set('bunk_partner', id);
		app.save(other);
		writes += 1;
	}
	return writes;
}

/** After a spot was deleted: its partner stands alone. */
function afterDelete(app, record) {
	const partner = partnerOf(record);
	if (!partner) return 0;
	let other = null;
	try {
		other = app.findRecordById('beds', partner);
	} catch (err) {
		return 0;
	}
	if (partnerOf(other) !== record.id && partnerOf(other) !== '') return 0;
	if (standAlone(other)) {
		app.save(other);
		return 1;
	}
	return 0;
}

module.exports = {
	requestProblem: requestProblem,
	afterWrite: afterWrite,
	afterDelete: afterDelete
};
