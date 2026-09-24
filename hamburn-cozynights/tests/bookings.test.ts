// tests/bookings.test.ts — who booked which spot, as the admin area shows it
// (docs/admin/bookings.md): the rows built from beds and tickets (masked like
// at the check-in desk), the list's filters, search and sorting, the live
// feed that asks for names only when the numbers moved, and the admin menu
// with its badges. The reads against a real PocketBase are covered by
// tests/integration/bookings.test.ts.
import { describe, it, expect, vi } from 'vitest';

vi.mock('$env/dynamic/private', () => ({
	env: {
		ENCRYPTION_KEY: '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff',
		PB_ADMIN_EMAIL: 'admin@test.com',
		PB_ADMIN_PASSWORD: 'password'
	}
}));

import { describeBookings } from '../src/lib/server/bookings';
import { encrypt } from '../src/lib/server/crypto';
import {
	bookingState,
	bookingsByRoom,
	countBookings,
	defaultView,
	guestLabel,
	matchesSearch,
	placeLabel,
	sortBookings,
	visibleBookings,
	type BookingRow
} from '../src/lib/bookings';
import { ADMIN_NAV, badgeFor, isActive } from '../src/lib/admin-nav';
import { createBookingsFeed } from '../src/lib/live-bookings';
import { GET as bookingsEndpoint } from '../src/routes/admin/api/bookings/+server';

const houses = [
	{ id: 'h1', name: 'Wälderhaus' },
	{ id: 'h2', name: 'Villa' }
];
const rooms = [
	{ id: 'r1', house: 'h1', name: 'Blue Room', room_number: 2 },
	{ id: 'r2', house: 'h1', name: 'Attic', room_number: 10 },
	{ id: 'r3', house: 'h2', name: 'Salon', room_number: 1 }
];
const orders = [
	{
		id: 'o1',
		order_number: 'HB-1001',
		customer_name: 'Mia Muster',
		email: 'mia@example.org',
		burner_name: encrypt('Sparkle')
	},
	{
		id: 'o2',
		order_number: 'HB-1002',
		// The CLI's default name: never shown as a name, it carries the code.
		customer_name: 'Ticket HB-1002',
		email: '',
		burner_name: ''
	},
	{ id: 'o3', order_number: 'HB-1003', customer_name: 'Zoe', email: 'zoe@x.de', burner_name: '' }
];
const beds = [
	{
		id: 'b1',
		room: 'r1',
		label: 'B1',
		enabled: true,
		occupied: true,
		order: 'o1',
		booked_at: '2026-09-21 10:00:00.000Z',
		checked_in_at: '2026-09-21 18:30:00.000Z',
		checked_in_by: 'crew@mauersegler.art'
	},
	{
		id: 'b2',
		room: 'r1',
		label: 'B2',
		enabled: true,
		occupied: true,
		order: 'o2',
		booked_at: '2026-09-21 12:00:00.000Z',
		// A stale stamp without a ticket never counts (it can't happen, but).
		checked_in_at: ''
	},
	// Taken by the crew, no ticket.
	{ id: 'b3', room: 'r2', label: 'Top', enabled: true, occupied: true, order: '' },
	// Free: not a booking.
	{ id: 'b4', room: 'r2', label: 'Bottom', enabled: true, occupied: false, order: '' },
	// ♿, assigned to an approved request; the spot is locked for guests.
	{
		id: 'b5',
		room: 'r3',
		label: 'A1',
		enabled: true,
		is_locked: true,
		is_special: true,
		occupied: true,
		order: 'o3',
		booked_at: '2026-09-20 09:00:00.000Z'
	},
	// A spot of a room that is gone meanwhile.
	{ id: 'b6', room: 'gone', label: 'X', enabled: true, occupied: true, order: 'o1' }
];

const rows = describeBookings({
	houses,
	rooms,
	beds,
	orders,
	assigned: new Map([['b5', 'o3']])
});
const byId = (id: string) => rows.find((row) => row.bedId === id)!;

describe('describeBookings', () => {
	it('lists every booked spot, the crew-taken one too, but no free spot and no orphan', () => {
		expect(rows.map((row) => row.bedId).sort()).toEqual(['b1', 'b2', 'b3', 'b5']);
	});

	it('shows a guest like the check-in desk: names, masked e-mail and ticket code', () => {
		const mia = byId('b1');
		expect(mia.guest).toEqual({
			orderId: 'o1',
			name: 'Mia Muster',
			burnerName: 'Sparkle',
			email: 'm•••@example.org',
			ticket: expect.stringMatching(/^H•+$/)
		});
		// Nothing of the full code or address anywhere in the row.
		expect(JSON.stringify(mia)).not.toContain('HB-1001');
		expect(JSON.stringify(mia)).not.toContain('mia@');
		expect(mia.checkIn).toEqual({ at: '2026-09-21 18:30:00.000Z', by: 'crew@mauersegler.art' });
		expect(placeLabel(mia)).toBe('B1 · Blue Room #2 · Wälderhaus');
	});

	it('never shows the default "Ticket <code>" name; the label falls back to the masked ticket', () => {
		const nameless = byId('b2');
		expect(nameless.guest?.name).toBe('');
		expect(guestLabel(nameless.guest)).toMatch(/^Ticket H•+$/);
		expect(JSON.stringify(nameless)).not.toContain('1002');
		expect(nameless.checkIn).toBeNull();
	});

	it('marks crew-taken spots and ♿ assignments', () => {
		expect(byId('b3').guest).toBeNull();
		expect(byId('b3').bookedAt).toBe('');
		expect(bookingState(byId('b3'))).toBe('crew');
		expect(guestLabel(null)).toBe('Crew reservation');
		expect(byId('b5')).toMatchObject({ viaRequest: true, special: true, locked: true });
	});
});

describe('the bookings list', () => {
	it('counts booked, checked in, still to arrive and crew', () => {
		expect(countBookings(rows)).toEqual({
			booked: 3,
			checkedIn: 1,
			arriving: 2,
			crew: 1,
			viaRequest: 1
		});
	});

	it('opens with what fits the phase', () => {
		expect(defaultView('staging')).toEqual({ filter: 'all', sort: 'place' });
		expect(defaultView('live')).toEqual({ filter: 'all', sort: 'newest' });
		expect(defaultView('closed')).toEqual({ filter: 'arriving', sort: 'place' });
	});

	it('filters by state and house', () => {
		const ids = (list: BookingRow[]) => list.map((row) => row.bedId);
		const view = (filter: 'all' | 'arriving' | 'checkedin' | 'crew', houseId = '') =>
			ids(visibleBookings(rows, { filter, sort: 'place', houseId }));
		expect(view('arriving')).toEqual(['b5', 'b2']);
		expect(view('checkedin')).toEqual(['b1']);
		expect(view('crew')).toEqual(['b5', 'b3']);
		expect(view('all', 'h1')).toEqual(['b1', 'b2', 'b3']);
	});

	it('searches names and places, accent-blind, every word', () => {
		expect(matchesSearch(byId('b1'), 'sparkle')).toBe(true);
		expect(matchesSearch(byId('b1'), 'walder blue')).toBe(true);
		expect(matchesSearch(byId('b1'), 'walder salon')).toBe(false);
		// The masked e-mail and ticket are not searchable: they would match everybody.
		expect(matchesSearch(byId('b1'), 'example')).toBe(false);
	});

	it('sorts by place (room number, not name), newest booking and latest check-in', () => {
		const ids = (sort: 'place' | 'newest' | 'checkin' | 'guest') =>
			sortBookings(rows, sort).map((row) => row.bedId);
		// Villa before Wälderhaus, room #2 before #10.
		expect(ids('place')).toEqual(['b5', 'b1', 'b2', 'b3']);
		expect(ids('newest')).toEqual(['b2', 'b1', 'b5', 'b3']);
		expect(ids('checkin')[0]).toBe('b1');
		// Crew reservations last when sorted by name.
		expect(ids('guest').at(-1)).toBe('b3');
	});

	it('groups a house room by room', () => {
		expect(
			bookingsByRoom(rows, 'h1').map((group) => [group.room, group.rows.map((r) => r.bedId)])
		).toEqual([
			['Blue Room #2', ['b1', 'b2']],
			['Attic #10', ['b3']]
		]);
	});
});

describe('the live feed', () => {
	const answer = (bookings: BookingRow[]) =>
		new Response(JSON.stringify({ bookings }), { status: 200 });

	it('asks for the rows only when the numbers changed', async () => {
		const fetcher = vi.fn(async () => answer(rows.slice(0, 1)));
		const feed = createBookingsFeed({
			initial: rows,
			changedAt: null,
			fetcher,
			scope: { house: 'h1' }
		});
		let state = { rows: [] as BookingRow[], failed: false };
		feed.subscribe((value) => (state = value));

		feed.follow({ changedAt: 'T1' }); // the first snapshot only sets the baseline
		feed.follow({ changedAt: 'T1' });
		expect(fetcher).not.toHaveBeenCalled();

		feed.follow({ changedAt: 'T2' });
		await vi.waitFor(() => expect(state.rows).toHaveLength(1));
		expect(fetcher).toHaveBeenCalledTimes(1);
		expect((fetcher.mock.calls[0] as unknown[])[0]).toBe('/admin/api/bookings?house=h1');
	});

	it('keeps the rows it has when a refetch fails, and a page load resets them', async () => {
		const fetcher = vi.fn(async () => new Response('', { status: 503 }));
		const feed = createBookingsFeed({ initial: rows, changedAt: 'T1', fetcher });
		let state = { rows: [] as BookingRow[], failed: false };
		feed.subscribe((value) => (state = value));
		feed.follow({ changedAt: 'T2' });
		await vi.waitFor(() => expect(state.failed).toBe(true));
		expect(state.rows).toBe(rows);

		feed.reset([], 'T3');
		expect(state).toEqual({ rows: [], failed: false });
		feed.follow({ changedAt: 'T3' });
		expect(fetcher).toHaveBeenCalledTimes(1);
	});
});

describe('GET /admin/api/bookings', () => {
	const call = (admin: unknown, search = '') =>
		bookingsEndpoint({
			locals: { admin, adminPb: {} },
			url: new URL(`http://app/admin/api/bookings${search}`),
			setHeaders: () => {}
		} as never);

	it('answers admins only', async () => {
		await expect(call(null)).rejects.toMatchObject({ status: 403 });
	});

	it('refuses anything that is not a record id', async () => {
		await expect(call({ email: 'a@b' }, '?house=%22%20||%20id%20!=%20%22')).rejects.toMatchObject({
			status: 400
		});
	});
});

describe('the admin menu', () => {
	it('knows every admin page once, grouped overview · camp · guests · crew', () => {
		expect(ADMIN_NAV.map((group) => group.key)).toEqual(['overview', 'camp', 'guests', 'crew']);
		const hrefs = ADMIN_NAV.flatMap((group) => group.items.map((item) => item.href));
		expect(new Set(hrefs).size).toBe(hrefs.length);
		expect(hrefs).toEqual(
			expect.arrayContaining([
				'/admin',
				'/admin/camp',
				'/admin/templates',
				'/admin/bookings',
				'/admin/tickets',
				'/admin/requests',
				'/admin/check',
				'/admin/messages'
			])
		);
	});

	it('marks the page you are on; house and room pages belong to the map', () => {
		const item = (href: string) =>
			ADMIN_NAV.flatMap((group) => group.items).find((entry) => entry.href === href)!;
		expect(isActive(item('/admin'), '/admin')).toBe(true);
		expect(isActive(item('/admin'), '/admin/tickets')).toBe(false);
		expect(isActive(item('/admin/camp'), '/admin/house/abc')).toBe(true);
		expect(isActive(item('/admin/camp'), '/admin/room/abc')).toBe(true);
		expect(isActive(item('/admin/bookings'), '/admin/bookings/')).toBe(true);
		expect(isActive(item('/admin/check'), '/admin/checkpoint')).toBe(false);
		expect(isActive(item('/admin/docs/'), '/admin/docs/')).toBe(false);
	});

	it('badges: requests waiting; bookings by phase', () => {
		const counts = { openRequests: 2, booked: 12, arriving: 5 };
		expect(badgeFor('requests', counts, 'live')).toMatchObject({ value: 2, tone: 'accent' });
		expect(badgeFor('requests', { ...counts, openRequests: 0 }, 'live')).toBeNull();
		expect(badgeFor('bookings', counts, 'live')).toMatchObject({ value: 12, tone: 'quiet' });
		expect(badgeFor('bookings', counts, 'closed')).toMatchObject({
			value: 5,
			tone: 'accent',
			title: '5 booked guests are still to arrive'
		});
		expect(badgeFor('bookings', { openRequests: 0, booked: 0, arriving: 0 }, 'staging')).toBeNull();
		expect(badgeFor(undefined, counts, 'live')).toBeNull();
	});
});
