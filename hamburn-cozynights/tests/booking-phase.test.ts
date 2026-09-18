import { describe, it, expect } from 'vitest';
import {
	checkWindowEdit,
	effectivePhase,
	formatBerlin,
	formatDuration,
	materialize,
	nextTransition,
	saveTimesEdit,
	splitDuration,
	switchPhase,
	windowFromRecord,
	windowToRecord,
	type BookingWindow
} from '../src/lib/booking-phase';

const NOW = Date.parse('2026-09-18T12:00:00Z');
const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;
const at = (offset: number) => new Date(NOW + offset).toISOString();

const staging: BookingWindow = { basePhase: 'staging', opensAt: '', closesAt: '', paused: false };
const planned: BookingWindow = { ...staging, opensAt: at(2 * DAY), closesAt: at(5 * DAY) };

describe('effectivePhase', () => {
	it('follows the armed timer: staging, then live, then closed', () => {
		expect(effectivePhase(planned, NOW)).toBe('staging');
		expect(effectivePhase(planned, NOW + 2 * DAY)).toBe('live');
		expect(effectivePhase(planned, NOW + 5 * DAY)).toBe('closed');
	});

	it('ignores a paused timer and keeps the base phase', () => {
		const paused = { ...planned, paused: true };
		expect(effectivePhase(paused, NOW + 3 * DAY)).toBe('staging');
		expect(effectivePhase({ ...paused, basePhase: 'live' }, NOW + 6 * DAY)).toBe('live');
	});

	it('closes an opened-by-hand booking at the closing time', () => {
		const byHand = { ...staging, basePhase: 'live' as const, closesAt: at(DAY) };
		expect(effectivePhase(byHand, NOW)).toBe('live');
		expect(effectivePhase(byHand, NOW + DAY)).toBe('closed');
	});

	it('opens a closed booking again when a new window starts', () => {
		const again = { ...planned, basePhase: 'closed' as const };
		expect(effectivePhase(again, NOW)).toBe('closed');
		expect(effectivePhase(again, NOW + 3 * DAY)).toBe('live');
	});
});

describe('nextTransition', () => {
	it('names the opening first, then the closing', () => {
		expect(nextTransition(planned, NOW)).toEqual({ at: planned.opensAt, to: 'live' });
		expect(nextTransition(planned, NOW + 3 * DAY)).toEqual({ at: planned.closesAt, to: 'closed' });
		expect(nextTransition(planned, NOW + 6 * DAY)).toBeNull();
	});

	it('has nothing to announce while paused or without times', () => {
		expect(nextTransition({ ...planned, paused: true }, NOW)).toBeNull();
		expect(nextTransition(staging, NOW)).toBeNull();
	});

	it('announces the closing of a booking opened by hand', () => {
		const byHand = { ...staging, basePhase: 'live' as const, closesAt: at(DAY) };
		expect(nextTransition(byHand, NOW)).toEqual({ at: byHand.closesAt, to: 'closed' });
	});
});

describe('stored fields', () => {
	it('round-trip, and old records without the new fields mean staging or live', () => {
		expect(windowFromRecord(windowToRecord(planned))).toEqual(planned);
		expect(windowFromRecord({ is_booking_active: true })).toEqual({
			basePhase: 'live',
			opensAt: '',
			closesAt: '',
			paused: false
		});
		expect(windowFromRecord(null).basePhase).toBe('staging');
		expect(windowFromRecord({ booking_closed: true }).basePhase).toBe('closed');
	});

	it('materialize writes the reached phase without changing what anyone sees', () => {
		const live = materialize(planned, NOW + 3 * DAY);
		expect(live.basePhase).toBe('live');
		expect(effectivePhase({ ...live, paused: true }, NOW + 3 * DAY)).toBe('live');
	});
});

describe('switchPhase (superuser override)', () => {
	it('opens now and drops the pointless planned opening, keeping the closing time', () => {
		const next = switchPhase(planned, 'live', NOW);
		expect(effectivePhase(next, NOW)).toBe('live');
		expect(next.opensAt).toBe('');
		expect(next.closesAt).toBe(planned.closesAt);
		expect(nextTransition(next, NOW)).toEqual({ at: planned.closesAt, to: 'closed' });
	});

	it('reopens a closed window without a closing time', () => {
		const next = switchPhase(planned, 'live', NOW + 6 * DAY);
		expect(effectivePhase(next, NOW + 6 * DAY)).toBe('live');
		expect(next.closesAt).toBe('');
	});

	it('closes now: drops the closing time and pauses what would reopen booking', () => {
		const next = switchPhase(planned, 'closed', NOW + 3 * DAY);
		expect(effectivePhase(next, NOW + 3 * DAY)).toBe('closed');
		expect(next.paused).toBe(true);
		expect(next.opensAt).toBe(planned.opensAt);
		expect(next.closesAt).toBe('');

		const byHand = { ...staging, basePhase: 'live' as const, closesAt: at(DAY) };
		const closed = switchPhase(byHand, 'closed', NOW);
		expect(closed).toEqual({ ...byHand, basePhase: 'closed', closesAt: '' });
	});

	it('closes now but keeps a window planned for later', () => {
		const next = switchPhase(planned, 'closed', NOW);
		expect(effectivePhase(next, NOW)).toBe('closed');
		expect(next).toEqual({ ...planned, basePhase: 'closed' });
		expect(nextTransition(next, NOW)).toEqual({ at: planned.opensAt, to: 'live' });
	});

	it('back to staging: nothing switches by itself unless a later window is planned', () => {
		const byHand = { ...staging, basePhase: 'live' as const, closesAt: at(DAY) };
		const next = switchPhase(byHand, 'staging', NOW);
		expect(effectivePhase(next, NOW)).toBe('staging');
		expect(next.paused).toBe(true);
		expect(nextTransition(next, NOW)).toBeNull();
	});

	it('goes back to staging and keeps a future window armed', () => {
		const closedByHand = { ...planned, basePhase: 'closed' as const };
		const next = switchPhase(closedByHand, 'staging', NOW);
		expect(effectivePhase(next, NOW)).toBe('staging');
		expect(next.paused).toBe(false);

		const afterWindow = switchPhase(planned, 'staging', NOW + 6 * DAY);
		expect(effectivePhase(afterWindow, NOW + 6 * DAY)).toBe('staging');
		expect(afterWindow.paused).toBe(true);
	});
});

describe('checkWindowEdit', () => {
	const admin = { isSuperuser: false, now: NOW };
	const superuser = { isSuperuser: true, now: NOW };
	const edit = (w: Partial<BookingWindow>) => ({
		opensAt: planned.opensAt,
		closesAt: planned.closesAt,
		paused: false,
		...w
	});

	it('lets an admin plan a window at least a day ahead and a day long', () => {
		expect(checkWindowEdit(staging, edit({}), admin).error).toBe('');
		expect(
			checkWindowEdit(staging, edit({ opensAt: at(DAY), closesAt: at(2 * DAY) }), admin).error
		).toBe('');
	});

	it('refuses an opening sooner than one day for admins, not for superusers', () => {
		const soon = edit({ opensAt: at(DAY - HOUR), closesAt: at(3 * DAY) });
		expect(checkWindowEdit(staging, soon, admin).error).toMatch(
			/at the earliest \(one day ahead\)/
		);
		expect(checkWindowEdit(staging, soon, superuser).error).toBe('');
	});

	it('refuses a window shorter than one day for admins', () => {
		const short = edit({ opensAt: at(2 * DAY), closesAt: at(2 * DAY + 20 * HOUR) });
		expect(checkWindowEdit(staging, short, admin).error).toMatch(/stay open for at least one day/);
		expect(checkWindowEdit(staging, short, superuser).error).toBe('');
	});

	it('refuses a closing time before the opening time for everyone', () => {
		const inverted = edit({ opensAt: at(3 * DAY), closesAt: at(2 * DAY) });
		expect(checkWindowEdit(staging, inverted, superuser).error).toMatch(/close after it opens/);
	});

	it('never lets an admin switch the phase right now', () => {
		const lateArm = { ...planned, paused: true };
		const now = { isSuperuser: false, now: NOW + 3 * DAY };
		expect(checkWindowEdit(lateArm, { ...lateArm, paused: false }, now).error).toMatch(
			/would open booking right now/
		);
		expect(
			checkWindowEdit(lateArm, { ...lateArm, paused: false }, { ...now, isSuperuser: true }).error
		).toBe('');
	});

	it('lets an admin pause a live window: booking stays open', () => {
		const check = checkWindowEdit(planned, edit({ paused: true }), {
			isSuperuser: false,
			now: NOW + 3 * DAY
		});
		expect(check.error).toBe('');
		expect(check.next.basePhase).toBe('live');
		expect(effectivePhase(check.next, NOW + 3 * DAY)).toBe('live');
	});

	it('lets an admin move the closing time while live, one day ahead at least', () => {
		const now = { isSuperuser: false, now: NOW + 3 * DAY };
		expect(
			checkWindowEdit(planned, edit({ closesAt: at(3 * DAY + 20 * HOUR) }), now).error
		).toMatch(/stay open for at least one day/);
		expect(checkWindowEdit(planned, edit({ closesAt: at(4 * DAY + HOUR) }), now).error).toBe('');
		expect(checkWindowEdit(planned, edit({ closesAt: at(8 * DAY) }), now).error).toBe('');
		// Closing sooner than a day is the superuser's call.
		expect(
			checkWindowEdit(planned, edit({ closesAt: at(3 * DAY + HOUR) }), {
				...now,
				isSuperuser: true
			}).error
		).toBe('');
	});

	it('does not re-check times an armed timer already had', () => {
		// The opening is only 20 hours away now; changing just the closing time is fine.
		const now = { isSuperuser: false, now: NOW + DAY + 4 * HOUR };
		expect(checkWindowEdit(planned, edit({ closesAt: at(6 * DAY) }), now).error).toBe('');
		// Re-arming a paused timer checks everything again.
		const paused = { ...planned, paused: true };
		expect(checkWindowEdit(paused, edit({}), now).error).toMatch(/at the earliest/);
	});

	it('lets an admin plan the next window after booking closed, staying closed until then', () => {
		const now = NOW + 6 * DAY;
		const next = { opensAt: at(8 * DAY), closesAt: at(10 * DAY), paused: false };
		const check = checkWindowEdit(planned, next, { isSuperuser: false, now });
		expect(check.error).toBe('');
		expect(check.phaseBefore).toBe('closed');
		expect(effectivePhase(check.next, now)).toBe('closed');
		expect(effectivePhase(check.next, NOW + 9 * DAY)).toBe('live');
	});

	it('lets anyone clear the window as long as the phase stays', () => {
		const empty = { opensAt: '', closesAt: '', paused: false };
		expect(checkWindowEdit(planned, empty, admin).error).toBe('');
		expect(checkWindowEdit(planned, empty, { ...admin, now: NOW + 3 * DAY }).next.basePhase).toBe(
			'live'
		);
	});
});

describe('saveTimesEdit', () => {
	it('starts a new window unarmed and keeps the state of an existing one', () => {
		expect(saveTimesEdit(staging, planned.opensAt, planned.closesAt).paused).toBe(true);
		expect(saveTimesEdit(planned, planned.opensAt, at(6 * DAY)).paused).toBe(false);
		expect(saveTimesEdit({ ...planned, paused: true }, planned.opensAt, at(6 * DAY)).paused).toBe(
			true
		);
		expect(saveTimesEdit(planned, '', '').paused).toBe(false);
	});
});

describe('formatting', () => {
	it('shows Berlin time with own English names', () => {
		expect(formatBerlin('2026-09-21T16:00:00.000Z')).toBe('Mon 21 Sep 2026 · 18:00');
		expect(formatBerlin('2026-12-24T17:30:00.000Z', { year: false })).toBe('Thu 24 Dec · 18:30');
		expect(formatBerlin('')).toBe('');
	});

	it('splits and words durations', () => {
		expect(splitDuration(DAY + 2 * HOUR + 61 * 1000)).toEqual({
			days: 1,
			hours: 2,
			minutes: 1,
			seconds: 1
		});
		expect(splitDuration(-5)).toEqual({ days: 0, hours: 0, minutes: 0, seconds: 0 });
		expect(formatDuration(6 * DAY + 5 * HOUR + 59 * 60 * 1000)).toBe('6 days 5 hours');
		expect(formatDuration(DAY)).toBe('1 day');
		expect(formatDuration(3 * HOUR + 20 * 60 * 1000)).toBe('3 hours 20 minutes');
		expect(formatDuration(30 * 1000)).toBe('1 minute');
	});
});
