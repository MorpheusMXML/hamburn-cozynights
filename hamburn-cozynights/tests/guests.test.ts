// tests/guests.test.ts — every ticket with everything attached, as the admin
// area shows it (/admin/guests): the rows joined from tickets, spots, notify
// records, special-needs requests and wallet passes (masked like at the
// check-in desk), the list's filters, counts, search and sorting, the tile
// colours, the endpoint's guard, and where the menu and the Intel panel link.
import { describe, it, expect } from 'vitest';
import { vi } from 'vitest';

vi.mock('$env/dynamic/private', () => ({
	env: {
		ENCRYPTION_KEY: '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff',
		PB_ADMIN_EMAIL: 'admin@test.com',
		PB_ADMIN_PASSWORD: 'password'
	}
}));

import { describeGuests, type GuestRecords } from '../src/lib/server/guests';
import { encrypt } from '../src/lib/server/crypto';
import {
	countGuests,
	defaultGuestView,
	guestName,
	guestRowState,
	guestTileState,
	GUEST_FILTERS,
	GUEST_TILES,
	matchesGuestFilter,
	matchesGuestSearch,
	sortGuests,
	spotLabel,
	visibleGuests,
	type GuestRow
} from '../src/lib/guests';
import { ADMIN_NAV } from '../src/lib/admin-nav';
import { attentionItems } from '../src/lib/intel';
import type { LiveStats } from '../src/lib/live-stats';
import { GET as guestsEndpoint } from '../src/routes/admin/api/guests/+server';

const records: GuestRecords = {
	houses: [
		{ id: 'h1', name: 'Wälderhaus' },
		{ id: 'h2', name: 'Villa' }
	],
	rooms: [
		{ id: 'r1', house: 'h1', name: 'Blue Room', room_number: 2 },
		{ id: 'r3', house: 'h2', name: 'Salon', room_number: 1 }
	],
	orders: [
		{
			id: 'o1',
			order_number: 'HB-1001',
			order_hash: 'hash',
			customer_name: 'Mia Muster',
			email: 'mia@example.org',
			burner_name: encrypt('Sparkle'),
			pass_code: 'PASS1',
			handed_over_at: '',
			created: '2026-09-01 08:00:00.000Z'
		},
		{
			id: 'o2',
			order_number: 'HB-1002',
			order_hash: '',
			// The CLI's default name: never shown as a name, it carries the code.
			customer_name: 'Ticket HB-1002',
			email: '',
			burner_name: '',
			pass_code: '',
			handed_over_at: '',
			created: '2026-09-02 08:00:00.000Z'
		},
		{
			id: 'o3',
			order_number: 'HB-1003',
			order_hash: 'hash',
			customer_name: 'Zoe',
			email: 'zoe@x.de',
			burner_name: '',
			pass_code: 'PASS3',
			handed_over_at: '2026-09-10 08:00:00.000Z',
			created: '2026-09-03 08:00:00.000Z'
		},
		// Not a ticket: no code (a record the import left half-made).
		{
			id: 'o4',
			order_number: '',
			order_hash: '',
			customer_name: 'Nobody',
			email: '',
			burner_name: '',
			pass_code: '',
			handed_over_at: '',
			created: '2026-09-04 08:00:00.000Z'
		}
		// `created` is PocketBase's branded auto date; a fixture only has strings.
	] as unknown as GuestRecords['orders'],
	beds: [
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
		// ♿, assigned to an approved request.
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
		}
	],
	assigned: new Map([['b5', 'o3']]),
	notify: [
		{
			order: 'o1',
			mail_sent: '2026-09-21 10:00:05.000Z',
			mail_to: 'mia@example.org',
			tg_chat: '12345',
			due: '',
			attempts: 0
		},
		// Retried and given up: due cleared, attempts kept.
		{ order: 'o3', mail_sent: '', mail_to: '', tg_chat: '', due: '', attempts: 3 }
	],
	requests: [
		// An old declined request and a new pending one: pending wins.
		{ order: 'o2', status: 'declined', bed: '' },
		{ order: 'o2', status: 'pending', bed: '' },
		{ order: 'o3', status: 'approved', bed: 'b5' }
	] as GuestRecords['requests'],
	passes: [
		{ order: 'o1', platform: 'apple', serial: 'PASS1', attempts: 0 },
		// The pass from before the hand-over, and the current one that fails to update.
		{ order: 'o3', platform: 'apple', serial: 'OLD', attempts: 0 },
		{ order: 'o3', platform: 'apple', serial: 'PASS3', attempts: 2 },
		{ order: 'o3', platform: 'google', serial: 'OLD', attempts: 0 },
		// A pass whose ticket is gone.
		{ order: '', platform: 'google', serial: 'GONE', attempts: 0 }
	] as GuestRecords['passes']
};

const rows = describeGuests(records);
const row = (id: string) => rows.find((entry) => entry.id === id)!;

describe('describeGuests', () => {
	it('makes one row per ticket, masked like at the check-in desk', () => {
		expect(rows.map((entry) => entry.id)).toEqual(['o1', 'o2', 'o3']);
		expect(row('o1')).toMatchObject({
			ticket: 'H•••',
			name: 'Mia Muster',
			burnerName: 'Sparkle',
			email: 'm•••@example.org',
			hasEmail: true,
			signedIn: true,
			imported: '2026-09-01 08:00:00.000Z',
			handedOverAt: ''
		});
		expect(JSON.stringify(rows)).not.toContain('HB-1001');
		expect(JSON.stringify(rows)).not.toContain('mia@example.org');
		expect(JSON.stringify(rows)).not.toContain('PASS1');
		expect(JSON.stringify(rows)).not.toContain('12345');
	});

	it('joins the spot and the check-in the way the bookings list does', () => {
		expect(row('o1').spot).toEqual({
			houseId: 'h1',
			houseName: 'Wälderhaus',
			roomId: 'r1',
			roomName: 'Blue Room #2',
			label: 'B1',
			bookedAt: '2026-09-21 10:00:00.000Z',
			viaRequest: false,
			special: false
		});
		expect(row('o1').checkIn).toEqual({
			at: '2026-09-21 18:30:00.000Z',
			by: 'crew@mauersegler.art'
		});
		expect(row('o3').spot).toMatchObject({ label: 'A1', viaRequest: true, special: true });
		expect(row('o3').checkIn).toBeNull();
		expect(row('o2').spot).toBeNull();
	});

	it('keeps a ticket without a holder name as its masked code', () => {
		expect(row('o2')).toMatchObject({ name: '', burnerName: '', email: '', hasEmail: false });
		expect(guestName(row('o2'))).toBe('Ticket H•••');
	});

	it('reads the request state only: pending beats an old decision', () => {
		expect(row('o1').request).toBe('none');
		expect(row('o2').request).toBe('pending');
		expect(row('o3').request).toBe('approved');
	});

	it('sums up the messages: mailed, Telegram, queued, failed', () => {
		expect(row('o1').notify).toEqual({
			mailed: true,
			mailedTo: 'm•••@example.org',
			telegram: true,
			queued: false,
			failed: false
		});
		expect(row('o2').notify).toEqual({
			mailed: false,
			mailedTo: '',
			telegram: false,
			queued: false,
			failed: false
		});
		expect(row('o3').notify).toMatchObject({ mailed: false, failed: true });
	});

	it('tells current, voided and failing wallet passes apart, never the serial', () => {
		expect(row('o1').wallet).toEqual({ apple: 'current', google: null });
		expect(row('o3').wallet).toEqual({ apple: 'failing', google: 'voided' });
		expect(row('o2').wallet).toEqual({ apple: null, google: null });
	});
});

describe('filters, counts, search and sorting', () => {
	it('narrows to what a filter names', () => {
		const ids = (filter: (typeof GUEST_FILTERS)[number]['key']) =>
			rows.filter((entry) => matchesGuestFilter(entry, filter)).map((entry) => entry.id);
		expect(ids('all')).toEqual(['o1', 'o2', 'o3']);
		expect(ids('spot')).toEqual(['o1', 'o3']);
		expect(ids('nospot')).toEqual(['o2']);
		expect(ids('checkedin')).toEqual(['o1']);
		expect(ids('noemail')).toEqual(['o2']);
		expect(ids('request')).toEqual(['o2']);
		expect(ids('telegram')).toEqual(['o1']);
		expect(ids('mailed')).toEqual(['o1']);
		expect(ids('wallet')).toEqual(['o1', 'o3']);
		expect(ids('handedover')).toEqual(['o3']);
	});

	it('counts what the tiles show', () => {
		expect(countGuests(rows)).toEqual({
			tickets: 3,
			withSpot: 2,
			withoutSpot: 1,
			checkedIn: 1,
			noEmail: 1,
			openRequests: 1,
			telegram: 1,
			mailed: 1,
			wallet: 2,
			handedOver: 1
		});
		// Every tile is a filter of the same name.
		for (const tile of GUEST_TILES) {
			expect(GUEST_FILTERS.some((filter) => filter.key === tile.key)).toBe(true);
		}
	});

	it('searches names and places, never the address or the code', () => {
		expect(matchesGuestSearch(row('o1'), 'walder b1')).toBe(true);
		expect(matchesGuestSearch(row('o1'), 'sparkle')).toBe(true);
		expect(matchesGuestSearch(row('o1'), 'example.org')).toBe(false);
		expect(matchesGuestSearch(row('o1'), 'HB-1001')).toBe(false);
		expect(matchesGuestSearch(row('o1'), 'H•••')).toBe(false);
		expect(matchesGuestSearch(row('o2'), '')).toBe(true);
	});

	it('sorts by name (named guests first), newest booking, newest ticket', () => {
		const ids = (sorted: GuestRow[]) => sorted.map((entry) => entry.id);
		expect(ids(sortGuests(rows, 'name'))).toEqual(['o1', 'o3', 'o2']);
		expect(ids(sortGuests(rows, 'booked'))).toEqual(['o1', 'o3', 'o2']);
		expect(ids(sortGuests(rows, 'imported'))).toEqual(['o3', 'o2', 'o1']);
	});

	it('puts filter, house, search and sort together', () => {
		expect(
			visibleGuests(rows, { houseId: 'h2', filter: 'all', sort: 'name' }).map((e) => e.id)
		).toEqual(['o3']);
		expect(
			visibleGuests(rows, { filter: 'spot', sort: 'name', search: 'zoe' }).map((e) => e.id)
		).toEqual(['o3']);
		expect(spotLabel(row('o3').spot!)).toBe('A1 · Salon #1 · Villa');
	});

	it('opens with the newest bookings while booking is live, by name otherwise', () => {
		expect(defaultGuestView('live')).toEqual({ filter: 'all', sort: 'booked' });
		expect(defaultGuestView('staging')).toEqual({ filter: 'all', sort: 'name' });
		expect(defaultGuestView('closed')).toEqual({ filter: 'all', sort: 'name' });
	});

	it('colours the tiles and rows by the status rules: pink is ♿ only', () => {
		// Booked is red on every admin page (the bookings page paints a booked
		// spot red), so a ticket without a spot after closing is orange, not red.
		expect(guestTileState('spot', 'live')).toBe('full');
		expect(guestTileState('checkedin', 'closed')).toBe('checked-in');
		expect(guestTileState('nospot', 'live')).toBe('idle');
		expect(guestTileState('nospot', 'closed')).toBe('warning');
		expect(guestTileState('noemail', 'staging')).toBe('danger');
		expect(guestTileState('request', 'staging')).toBe('special');
		expect(guestTileState('telegram', 'live')).toBe('idle');
		expect(guestTileState('wallet', 'live')).toBe('idle');
		expect(guestTileState('all', 'live')).toBe('idle');
		expect(guestRowState(row('o1'), 'closed')).toBe('checked-in');
		expect(guestRowState(row('o3'), 'closed')).toBe('full');
		expect(guestRowState(row('o2'), 'live')).toBe('idle');
		expect(guestRowState(row('o2'), 'closed')).toBe('warning');
	});
});

describe('GET /admin/api/guests', () => {
	it('answers admins only', async () => {
		await expect(
			guestsEndpoint({
				locals: { admin: null, adminPb: {} },
				url: new URL('http://app/admin/api/guests'),
				setHeaders: () => {}
			} as never)
		).rejects.toMatchObject({ status: 403 });
	});
});

describe('where the guest list is linked', () => {
	it('is the first entry of the Guests group in the admin menu', () => {
		const guests = ADMIN_NAV.find((group) => group.key === 'guests')!;
		expect(guests.items[0]).toMatchObject({ href: '/admin/guests', label: 'Guests' });
	});

	it('is where the Intel panel sends the crew for tickets without a spot or an address', () => {
		const stats = {
			changedAt: '2026-09-21 10:00:00.000Z',
			spots: { total: 10, booked: 3, checkedIn: 0, free: 7, locked: 0, special: 0, deactivated: 0 },
			ticketsWithSpot: 3,
			houses: [],
			houseStates: { unconfigured: 0, open: 1, filling: 0, full: 0 },
			ops: {
				tickets: { total: 5, withEmail: 4 },
				messages: { mailOn: true, mailed: 0, queued: 0, retrying: 0, failed: 0, telegram: 0 },
				requests: { pending: 0, approved: 0, declined: 0 },
				crew: {
					alertsQueued: 0,
					alertsFailed: 0,
					alertsFailing: 0,
					alertsSent: 0,
					accessRequests: 0
				}
			}
		} as unknown as LiveStats;
		const hrefs = (phase: 'live' | 'closed') =>
			attentionItems(stats, phase).map((item) => [item.key, item.href]);
		expect(hrefs('closed')).toContainEqual(['tickets-without-spot', '/admin/guests?show=nospot']);
		expect(hrefs('live')).toContainEqual(['tickets-to-book', '/admin/guests?show=nospot']);
		expect(hrefs('live')).toContainEqual(['tickets-no-email', '/admin/guests?show=noemail']);
	});
});
