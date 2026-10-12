// tests/fake-book.ts — what POST /api/cozy/book does in PocketBase
// (pb_hooks/lib/book.js), for the unit tests' stand-ins: the same checks in
// the same order, and the writes all at once or not at all. The real route
// against a real PocketBase: tests/integration/book.test.ts.
import { effectivePhase, windowFromRecord, type BookingPhase } from '../src/lib/booking-phase';

type Row = Record<string, any>;

export type FakeBookOutcome =
	| { ok: true }
	| {
			ok: false;
			reason: 'gone' | 'taken' | 'unavailable' | 'closed' | 'checked_in';
			phase?: BookingPhase;
	  };

/** Where the stand-in keeps its records. */
export interface BookTables {
	bed(id: string): Row | undefined;
	order(id: string): Row | undefined;
	bedsOf(orderId: string): Row[];
	/** The app_settings record; undefined when the camp has none. */
	settings(): Row | undefined;
}

export function fakeBook(t: BookTables, body: Row): FakeBookOutcome {
	const bed = t.bed(String(body.bed));
	const order = t.order(String(body.order));
	if (!bed || !order) return { ok: false, reason: 'gone' };

	const renaming = bed.order === body.order;
	if (!renaming) {
		if (bed.order || bed.occupied) return { ok: false, reason: 'taken' };
		if (
			bed.enabled === false ||
			(bed.is_locked && body.allowLocked !== true) ||
			(bed.is_special && body.allowSpecial !== true)
		) {
			return { ok: false, reason: 'unavailable' };
		}
		if (body.requireLive === true) {
			const phase = effectivePhase(windowFromRecord(t.settings()), Date.now());
			if (phase !== 'live') return { ok: false, reason: 'closed', phase };
		}
	}

	const previous = t.bedsOf(String(body.order)).filter((b) => b.id !== bed.id);
	const prevIn = previous.find((b) => !!b.checked_in_at);
	const arrived = prevIn
		? { checked_in_at: prevIn.checked_in_at, checked_in_by: prevIn.checked_in_by ?? '' }
		: null;
	if (arrived && body.allowCheckedIn !== true) return { ok: false, reason: 'checked_in' };

	for (const prev of previous) {
		Object.assign(prev, { order: '', occupied: false, checked_in_at: '', checked_in_by: '' });
	}
	if (!renaming) {
		Object.assign(bed, {
			order: body.order,
			occupied: true,
			...(arrived ?? {})
		});
	}
	order.burner_name = String(body.name ?? '');
	return { ok: true };
}

/** The error the PocketBase SDK throws for a 409 answer of the route. */
export function refusedBy(outcome: FakeBookOutcome): Error {
	return Object.assign(new Error('refused'), { status: 409, response: outcome });
}
