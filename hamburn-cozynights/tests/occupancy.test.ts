// tests/occupancy.test.ts — how spots are counted in the admin views and shown on the map
import { describe, it, expect, vi } from 'vitest';
import { countSpots, houseMarkerStatus, type SpotCounts } from '../src/lib/occupancy';
import { load as dashboardLoad } from '../src/routes/admin/+page.server';
import { load as houseAdminLoad } from '../src/routes/admin/house/[id]/+page.server';

// One room with a spot in every state.
const beds = [
	{ id: 'free', room: 'r1', enabled: true, occupied: false, is_locked: false },
	{ id: 'taken', room: 'r1', enabled: true, occupied: true, is_locked: false },
	{ id: 'locked', room: 'r1', enabled: true, occupied: false, is_locked: true },
	{ id: 'inactive', room: 'r1', enabled: false, occupied: false, is_locked: false },
	{ id: 'inactive-taken', room: 'r1', enabled: false, occupied: true, is_locked: false }
];

type Records = Record<string, { id: string; [field: string]: unknown }[]>;

/** PocketBase stand-in that answers every collection with fixed records. */
function makePb(records: Records) {
	return {
		filter: vi.fn((query: string) => query),
		collection: vi.fn((name: string) => ({
			getFullList: vi.fn(async () => records[name] ?? []),
			getOne: vi.fn(async (id: string) => {
				const record = (records[name] ?? []).find((r) => r.id === id);
				if (!record) throw { status: 404 };
				return record;
			})
		}))
	};
}

describe('countSpots', () => {
	it('ignores deactivated spots and does not count locked ones as free', () => {
		expect(countSpots(beds)).toEqual({ total: 3, occupied: 1, free: 1, checkedIn: 0 });
	});

	it('is empty for no spots', () => {
		expect(countSpots([])).toEqual({ total: 0, occupied: 0, free: 0, checkedIn: 0 });
	});

	it('counts checked-in guests among the booked spots', () => {
		const booked = { enabled: true, occupied: true, is_locked: false, order: 'o1' };
		expect(
			countSpots([
				{ ...booked, checked_in_at: '2026-09-19 12:00:00.000Z' },
				{ ...booked, order: 'o2', checked_in_at: '' },
				// a check-in without a booking doesn't exist (PocketBase drops it)
				{ ...booked, order: '', checked_in_at: '2026-09-19 12:00:00.000Z' },
				{ ...booked, order: 'o3', enabled: false, checked_in_at: '2026-09-19 12:00:00.000Z' }
			])
		).toEqual({ total: 3, occupied: 3, free: 0, checkedIn: 1 });
	});
});

describe('houseMarkerStatus', () => {
	it('does not show a house without active spots as fully booked', () => {
		expect(houseMarkerStatus({ totalBeds: 0, freeBeds: 0 })).toBe('empty');
	});

	it('is full only when no spot is left to book', () => {
		expect(houseMarkerStatus({ totalBeds: 3, freeBeds: 1 })).toBe('available');
		expect(houseMarkerStatus({ totalBeds: 3, freeBeds: 0 })).toBe('full');
	});
});

describe('admin occupancy numbers', () => {
	it('counts the same spots in the list view and on the house page', async () => {
		const pb = makePb({
			houses: [
				{ id: 'h1', name: 'Neon Cave', x: 100, y: 100 },
				{ id: 'h2', name: 'Empty Shell', x: 200, y: 200 }
			],
			rooms: [{ id: 'r1', name: 'Bunk Room', room_number: 1, house: 'h1' }],
			beds: beds.map((bed) => ({ ...bed, expand: { room: { id: 'r1', house: 'h1' } } }))
		});
		const locals = {
			pb,
			adminPb: pb,
			admin: {
				id: 'a1',
				email: 'crew@mauersegler.art',
				name: '',
				role: 'admin',
				isSuperuser: false
			}
		};

		const dashboard = (await dashboardLoad({ locals } as never)) as {
			houses: { name: string; totalBeds: number; occupiedBeds: number; freeBeds: number }[];
		};
		const housePage = (await houseAdminLoad({ params: { id: 'h1' }, locals } as never)) as {
			rooms: { stats: SpotCounts }[];
		};

		expect(dashboard.houses[0]).toMatchObject({
			name: 'Neon Cave',
			totalBeds: 3,
			occupiedBeds: 1,
			freeBeds: 1,
			occupancyRate: 33
		});
		expect(dashboard.houses[1]).toMatchObject({ totalBeds: 0, occupiedBeds: 0, freeBeds: 0 });
		expect(housePage.rooms[0].stats).toEqual({ total: 3, occupied: 1, free: 1, checkedIn: 0 });
	});
});
