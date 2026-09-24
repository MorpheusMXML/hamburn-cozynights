/**
 * Who sleeps where: the bookings list of the admin area (/admin/bookings) and
 * the booking lines on the room, house and map pages. Shared by the server
 * (`$lib/server/bookings.ts` builds the rows) and the browser (filters,
 * search, sorting), so both ends agree on the shape.
 *
 * A row shows a guest the way the check-in desk does: holder name, burner
 * name, e-mail and ticket code masked. The full ticket is one click away in
 * /admin/tickets. What a guest wrote in a special-needs request never shows
 * here, only that the spot was assigned through one.
 */
import type { BookingPhase } from '$lib/booking-phase';

/** The ticket on a spot, as the crew sees it at a glance. */
export interface BookingGuest {
	/** The ticket's record id: the form value of Check in and Open ticket, never shown. */
	orderId: string;
	/** The holder's name; '' when the ticket has none (or only "Ticket <code>"). */
	name: string;
	burnerName: string;
	/** "m•••@example.org" */
	email: string;
	/** "H•••": enough to tell tickets apart, never enough to sign in. */
	ticket: string;
}

/** One booked spot: a guest's ticket, or taken by the crew without one. */
export interface BookingRow {
	bedId: string;
	spot: string;
	roomId: string;
	/** "Blue Room #2" */
	room: string;
	/** Rooms sort by their number, like on the house page. */
	roomNumber: number;
	houseId: string;
	house: string;
	/** Deactivated or locked spots can still hold a booking; the list says so. */
	enabled: boolean;
	locked: boolean;
	/** A ♿ special-needs spot. */
	special: boolean;
	/** The crew assigned it to an approved special-needs request. */
	viaRequest: boolean;
	/** null: the crew marked the spot taken without a ticket. */
	guest: BookingGuest | null;
	/** When the spot got this ticket (ISO), '' when unknown or crew-taken. */
	bookedAt: string;
	/** The check-in at arrival, only ever with a ticket. */
	checkIn: { at: string; by: string } | null;
}

export type BookingState = 'crew' | 'booked' | 'checkedin';

/** Crew-taken, booked and waiting for its guest, or checked in. */
export function bookingState(row: Pick<BookingRow, 'guest' | 'checkIn'>): BookingState {
	if (!row.guest) return 'crew';
	return row.checkIn ? 'checkedin' : 'booked';
}

/** "B1 · Blue Room #2 · Villa": where a booking is, in one line. */
export function placeLabel(row: Pick<BookingRow, 'spot' | 'room' | 'house'>): string {
	return [row.spot, row.room, row.house].filter(Boolean).join(' · ');
}

/** The guest's name for a list line: holder, else burner name, else the masked ticket. */
export function guestLabel(guest: BookingGuest | null): string {
	if (!guest) return 'Crew reservation';
	return guest.name || guest.burnerName || `Ticket ${guest.ticket}`;
}

export const BOOKING_FILTERS = [
	{ key: 'all', label: 'All', title: 'Every booked spot' },
	{ key: 'arriving', label: 'Still to arrive', title: 'Booked with a ticket, not checked in yet' },
	{ key: 'checkedin', label: 'Checked in', title: 'Guests the crew checked in at arrival' },
	{
		key: 'crew',
		label: 'Crew',
		title: 'Spots the crew holds: taken without a ticket, or ♿ assigned'
	}
] as const;
export type BookingFilter = (typeof BOOKING_FILTERS)[number]['key'];

export const BOOKING_SORTS = [
	{ key: 'place', label: 'House · room · spot' },
	{ key: 'newest', label: 'Newest booking first' },
	{ key: 'checkin', label: 'Latest check-in first' },
	{ key: 'guest', label: 'Guest name' }
] as const;
export type BookingSort = (typeof BOOKING_SORTS)[number]['key'];

export function isBookingFilter(value: unknown): value is BookingFilter {
	return BOOKING_FILTERS.some((filter) => filter.key === value);
}
export function isBookingSort(value: unknown): value is BookingSort {
	return BOOKING_SORTS.some((sort) => sort.key === value);
}

/**
 * What the list opens with, per phase. Staging: nothing is booked by guests
 * yet, so the crew's own holds come first; Live: the newest bookings; Closed
 * (arrival): who is still to come.
 */
export function defaultView(phase: BookingPhase): { filter: BookingFilter; sort: BookingSort } {
	if (phase === 'live') return { filter: 'all', sort: 'newest' };
	if (phase === 'closed') return { filter: 'arriving', sort: 'place' };
	return { filter: 'all', sort: 'place' };
}

export function matchesFilter(row: BookingRow, filter: BookingFilter): boolean {
	const state = bookingState(row);
	if (filter === 'arriving') return state === 'booked';
	if (filter === 'checkedin') return state === 'checkedin';
	if (filter === 'crew') return state === 'crew' || row.viaRequest;
	return true;
}

/** Lower case without accents: "Wälderhaus" is found by "walder". */
export function foldText(text: string): string {
	return text
		.normalize('NFD')
		.replace(/\p{Diacritic}/gu, '')
		.toLowerCase();
}

/** Every word of the search appears in the guest's names or the place. */
export function matchesSearch(row: BookingRow, search: string): boolean {
	const words = foldText(search).split(/\s+/).filter(Boolean);
	if (words.length === 0) return true;
	const haystack = foldText(
		[row.guest?.name, row.guest?.burnerName, row.spot, row.room, row.house]
			.filter(Boolean)
			.join(' ')
	);
	return words.every((word) => haystack.includes(word));
}

const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

function byPlace(a: BookingRow, b: BookingRow): number {
	return (
		collator.compare(a.house, b.house) ||
		a.roomNumber - b.roomNumber ||
		collator.compare(a.room, b.room) ||
		collator.compare(a.spot, b.spot)
	);
}

/** Newest first; rows without a stamp at the end, in place order. */
function byStampDesc(a: string, b: string): number {
	if (a === b) return 0;
	if (!a) return 1;
	if (!b) return -1;
	return a < b ? 1 : -1;
}

export function sortBookings(rows: BookingRow[], sort: BookingSort): BookingRow[] {
	const sorted = [...rows];
	if (sort === 'newest') {
		sorted.sort((a, b) => byStampDesc(a.bookedAt, b.bookedAt) || byPlace(a, b));
	} else if (sort === 'checkin') {
		sorted.sort((a, b) => byStampDesc(a.checkIn?.at ?? '', b.checkIn?.at ?? '') || byPlace(a, b));
	} else if (sort === 'guest') {
		sorted.sort(
			(a, b) =>
				Number(!a.guest) - Number(!b.guest) ||
				collator.compare(guestLabel(a.guest), guestLabel(b.guest)) ||
				byPlace(a, b)
		);
	} else {
		sorted.sort(byPlace);
	}
	return sorted;
}

export interface BookingCounts {
	/** Spots with a guest's ticket. */
	booked: number;
	checkedIn: number;
	/** Booked with a ticket, not checked in yet. */
	arriving: number;
	/** Taken by the crew without a ticket. */
	crew: number;
	/** Assigned to approved special-needs requests. */
	viaRequest: number;
}

export function countBookings(rows: BookingRow[]): BookingCounts {
	const counts: BookingCounts = { booked: 0, checkedIn: 0, arriving: 0, crew: 0, viaRequest: 0 };
	for (const row of rows) {
		const state = bookingState(row);
		if (state === 'crew') counts.crew++;
		else {
			counts.booked++;
			if (state === 'checkedin') counts.checkedIn++;
			else counts.arriving++;
		}
		if (row.viaRequest) counts.viaRequest++;
	}
	return counts;
}

/** Filter, search and sort in one go: what the list shows. */
export function visibleBookings(
	rows: BookingRow[],
	view: { houseId?: string; filter: BookingFilter; sort: BookingSort; search?: string }
): BookingRow[] {
	return sortBookings(
		rows.filter(
			(row) =>
				(!view.houseId || row.houseId === view.houseId) &&
				matchesFilter(row, view.filter) &&
				matchesSearch(row, view.search ?? '')
		),
		view.sort
	);
}

/** The bookings of one room, keyed by spot: what the room and map pages look up. */
export function bookingsBySpot(rows: BookingRow[]): Record<string, BookingRow> {
	return Object.fromEntries(rows.map((row) => [row.bedId, row]));
}

/** The rows of one house, grouped by room in place order: the map sidebar and the house page. */
export function bookingsByRoom(
	rows: BookingRow[],
	houseId: string
): { roomId: string; room: string; rows: BookingRow[] }[] {
	const groups = new Map<string, { roomId: string; room: string; rows: BookingRow[] }>();
	for (const row of sortBookings(
		rows.filter((entry) => entry.houseId === houseId),
		'place'
	)) {
		let group = groups.get(row.roomId);
		if (!group) {
			group = { roomId: row.roomId, room: row.room, rows: [] };
			groups.set(row.roomId, group);
		}
		group.rows.push(row);
	}
	return [...groups.values()];
}
