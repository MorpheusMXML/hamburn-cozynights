// tests/quick-views.test.ts — the quick views on the Control Center: every
// count links to the filtered list, colours only when there is something.
import { describe, it, expect } from 'vitest';
import { quickViews } from '../src/lib/quick-views';
import type { LiveStats, OpsStats } from '../src/lib/live-stats';

const ops = (tickets: Partial<OpsStats['tickets']> = {}, pending = 0): OpsStats => ({
	tickets: { total: 20, withEmail: 18, telegram: 3, mailed: 5, ...tickets },
	requests: { pending, approved: 0, declined: 0 },
	messages: { mailOn: true, telegramOn: true, queued: 0, retrying: 0, failed: 0 },
	crew: { admins: 2, accessRequests: 0, alertsQueued: 0, alertsFailed: 0, alertsFailing: 0 }
});

const stats = (overrides: Partial<LiveStats> = {}) => ({
	spots: {
		total: 30,
		occupied: 12,
		free: 18,
		checkedIn: 4,
		booked: 10,
		locked: 0,
		special: 0,
		deactivated: 0
	},
	ticketsWithSpot: 10,
	ops: ops(),
	...overrides
});

const view = (groups: ReturnType<typeof quickViews>, group: string, key: string) =>
	groups.find((entry) => entry.key === group)?.views.find((entry) => entry.key === key);

describe('quickViews', () => {
	it('counts bookings from the bookings list and links each one to its filter', () => {
		const groups = quickViews(
			stats(),
			{ booked: 9, checkedIn: 3, arriving: 6, crew: 2, viaRequest: 1 },
			'live'
		);
		expect(groups[0].views.map((entry) => [entry.key, entry.value, entry.href])).toEqual([
			['booked', 9, '/admin/bookings?show=all'],
			['arriving', 6, '/admin/bookings?show=arriving'],
			['checkedin', 3, '/admin/bookings?show=checkedin'],
			['crew', 3, '/admin/bookings?show=crew']
		]);
	});

	it('falls back to the snapshot without the bookings list', () => {
		const groups = quickViews(stats(), null, 'live');
		expect(view(groups, 'bookings', 'booked')?.value).toBe(10);
		expect(view(groups, 'bookings', 'arriving')?.value).toBe(6);
		expect(view(groups, 'bookings', 'crew')?.value).toBe(2);
	});

	it('counts the tickets and what is missing on them', () => {
		const groups = quickViews(stats({ ops: ops({}, 2) }), null, 'live');
		expect(view(groups, 'tickets', 'all')?.value).toBe(20);
		expect(view(groups, 'tickets', 'nospot')).toMatchObject({
			value: 10,
			href: '/admin/guests?show=nospot',
			state: 'idle'
		});
		expect(view(groups, 'tickets', 'noemail')).toMatchObject({ value: 2, state: 'danger' });
		expect(view(groups, 'tickets', 'requests')).toMatchObject({
			value: 2,
			href: '/admin/requests',
			state: 'special'
		});
		// No number in the snapshot: a plain link.
		expect(view(groups, 'tickets', 'handedover')?.value).toBeUndefined();
	});

	it('warns about tickets without a spot and arrivals once booking closed', () => {
		const groups = quickViews(stats(), null, 'closed');
		expect(view(groups, 'tickets', 'nospot')?.state).toBe('warning');
		expect(view(groups, 'bookings', 'arriving')?.state).toBe('filling');
	});

	it('stays grey where there is nothing, and says "unknown" when PocketBase could not answer', () => {
		const groups = quickViews(stats({ ops: ops({ withEmail: 20 }) }), null, 'live');
		expect(view(groups, 'tickets', 'noemail')).toMatchObject({ value: 0, state: 'idle' });
		expect(view(groups, 'tickets', 'requests')?.state).toBe('idle');

		const blind = quickViews(stats({ ops: null }), null, 'live');
		expect(view(blind, 'tickets', 'all')?.value).toBeNull();
		expect(view(blind, 'tickets', 'nospot')?.value).toBeNull();
		expect(view(blind, 'tickets', 'noemail')?.value).toBeNull();
	});
});
