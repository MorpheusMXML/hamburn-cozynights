/**
 * Every ticket with everything attached: the guest list of the admin area
 * (/admin/guests). Shared by the server (`$lib/server/guests.ts` builds the
 * rows) and the browser (filters, counts, search, sorting), so both ends agree
 * on the shape.
 *
 * A row shows a ticket the way the check-in desk does: holder name, burner
 * name, e-mail and ticket code masked (a code is a credential). Whether the
 * ticket holds a spot, was checked in, has a special-needs request, got its
 * e-mails, linked Telegram or added the pass to a wallet is a fact each — what
 * a guest wrote in a request, a pass serial or a chat id never shows here.
 */
import type { BookingPhase } from '$lib/booking-phase';
import { foldText } from '$lib/bookings';

/** The spot a ticket holds, as the crew sees it at a glance. */
export interface GuestSpot {
	houseId: string;
	houseName: string;
	roomId: string;
	/** "Blue Room #2" */
	roomName: string;
	/** The spot's label, "B1". */
	label: string;
	/** When the spot got this ticket (ISO), '' when unknown. */
	bookedAt: string;
	/** The crew assigned it to an approved special-needs request. */
	viaRequest: boolean;
	/** A ♿ special-needs spot. */
	special: boolean;
}

/** The special-needs request of a ticket: only that there is one and where it stands. */
export type GuestRequestState = 'none' | 'pending' | 'approved' | 'declined';

/**
 * A wallet pass of a ticket: `current` when the pass in the wallet is the
 * ticket's pass, `voided` when the ticket got a new pass code since (a
 * hand-over) and `failing` when the wallet could not be told about the last
 * change. null: the guest never added the pass to that wallet.
 */
export type GuestWalletState = 'current' | 'voided' | 'failing' | null;

export interface GuestRow {
	/** The ticket's record id: the form value of Open ticket, never shown. */
	id: string;
	/** "HB•••01": enough to tell tickets apart, never enough to sign in. */
	ticket: string;
	/** The holder's name; '' when the ticket has none (or only "Ticket <code>"). */
	name: string;
	burnerName: string;
	/** "m•••@example.org", '' without an address. */
	email: string;
	hasEmail: boolean;
	/** The guest signed in with this ticket at least once. */
	signedIn: boolean;
	/** When the ticket was imported (ISO). */
	imported: string;
	/** When the ticket was passed on to somebody else (ISO), '' when never. */
	handedOverAt: string;
	spot: GuestSpot | null;
	/** The check-in at arrival, only ever with a spot. */
	checkIn: { at: string; by: string } | null;
	request: GuestRequestState;
	notify: {
		/** The address got at least one booking e-mail. */
		mailed: boolean;
		/** The masked address the last e-mail went to, '' when none went out. */
		mailedTo: string;
		/** A Telegram chat is linked. */
		telegram: boolean;
		/** A message waits to be sent (or retried). */
		queued: boolean;
		/** The last message could not be delivered and is not retried any more. */
		failed: boolean;
	};
	wallet: { apple: GuestWalletState; google: GuestWalletState };
}

export const GUEST_FILTERS = [
	{ key: 'all', label: 'All', title: 'Every ticket' },
	{ key: 'spot', label: 'With a spot', title: 'Tickets that hold a spot' },
	{ key: 'nospot', label: 'Without a spot', title: 'Tickets that hold no spot' },
	{ key: 'checkedin', label: 'Checked in', title: 'Guests the crew checked in at arrival' },
	{ key: 'noemail', label: 'No e-mail', title: 'Tickets without an e-mail address' },
	{
		key: 'request',
		label: '♿ Open request',
		title: 'Special-needs requests waiting for a decision'
	},
	{ key: 'telegram', label: 'Telegram', title: 'Tickets with a linked Telegram chat' },
	{ key: 'mailed', label: 'Got an e-mail', title: 'Tickets whose address got a booking e-mail' },
	{ key: 'wallet', label: 'Wallet pass', title: 'Tickets with the pass in Apple or Google Wallet' },
	{ key: 'handedover', label: 'Handed over', title: 'Tickets that were passed on to somebody else' }
] as const;
export type GuestFilter = (typeof GUEST_FILTERS)[number]['key'];

export const GUEST_SORTS = [
	{ key: 'name', label: 'Guest name' },
	{ key: 'booked', label: 'Newest booking first' },
	{ key: 'imported', label: 'Newest ticket first' }
] as const;
export type GuestSort = (typeof GUEST_SORTS)[number]['key'];

export function isGuestFilter(value: unknown): value is GuestFilter {
	return GUEST_FILTERS.some((filter) => filter.key === value);
}
export function isGuestSort(value: unknown): value is GuestSort {
	return GUEST_SORTS.some((sort) => sort.key === value);
}

/**
 * What the list opens with, per phase. Live: the newest bookings first;
 * otherwise by name, the way the crew looks people up.
 */
export function defaultGuestView(phase: BookingPhase): { filter: GuestFilter; sort: GuestSort } {
	return { filter: 'all', sort: phase === 'live' ? 'booked' : 'name' };
}

/** "B1 · Blue Room #2 · Villa": where a guest sleeps, in one line. */
export function spotLabel(spot: Pick<GuestSpot, 'label' | 'roomName' | 'houseName'>): string {
	return [spot.label, spot.roomName, spot.houseName].filter(Boolean).join(' · ');
}

/** The guest's name for a list line: holder, else burner name, else the masked ticket. */
export function guestName(row: Pick<GuestRow, 'name' | 'burnerName' | 'ticket'>): string {
	return row.name || row.burnerName || `Ticket ${row.ticket}`;
}

/** The pass is in at least one wallet, current or not. */
export function hasWalletPass(row: Pick<GuestRow, 'wallet'>): boolean {
	return row.wallet.apple !== null || row.wallet.google !== null;
}

export function matchesGuestFilter(row: GuestRow, filter: GuestFilter): boolean {
	switch (filter) {
		case 'spot':
			return row.spot !== null;
		case 'nospot':
			return row.spot === null;
		case 'checkedin':
			return row.checkIn !== null;
		case 'noemail':
			return !row.hasEmail;
		case 'request':
			return row.request === 'pending';
		case 'telegram':
			return row.notify.telegram;
		case 'mailed':
			return row.notify.mailed;
		case 'wallet':
			return hasWalletPass(row);
		case 'handedover':
			return !!row.handedOverAt;
		default:
			return true;
	}
}

/**
 * Every word of the search appears in the guest's names or the place. Never
 * the e-mail address or the ticket code: both are masked in the rows, and a
 * search box that finds a code would be a way to guess one.
 */
export function matchesGuestSearch(row: GuestRow, search: string): boolean {
	const words = foldText(search).split(/\s+/).filter(Boolean);
	if (words.length === 0) return true;
	const haystack = foldText(
		[row.name, row.burnerName, row.spot?.label, row.spot?.roomName, row.spot?.houseName]
			.filter(Boolean)
			.join(' ')
	);
	return words.every((word) => haystack.includes(word));
}

const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

/** Named guests first (by name), then the tickets that only have a code. */
function byName(a: GuestRow, b: GuestRow): number {
	const aNamed = !!(a.name || a.burnerName);
	const bNamed = !!(b.name || b.burnerName);
	return (
		Number(!aNamed) - Number(!bNamed) ||
		collator.compare(guestName(a), guestName(b)) ||
		collator.compare(a.id, b.id)
	);
}

/** Newest first; rows without a stamp at the end. */
function byStampDesc(a: string, b: string): number {
	if (a === b) return 0;
	if (!a) return 1;
	if (!b) return -1;
	return a < b ? 1 : -1;
}

export function sortGuests(rows: GuestRow[], sort: GuestSort): GuestRow[] {
	const sorted = [...rows];
	if (sort === 'booked') {
		sorted.sort(
			(a, b) => byStampDesc(a.spot?.bookedAt ?? '', b.spot?.bookedAt ?? '') || byName(a, b)
		);
	} else if (sort === 'imported') {
		sorted.sort((a, b) => byStampDesc(a.imported, b.imported) || byName(a, b));
	} else {
		sorted.sort(byName);
	}
	return sorted;
}

export interface GuestCounts {
	tickets: number;
	withSpot: number;
	withoutSpot: number;
	checkedIn: number;
	noEmail: number;
	/** Special-needs requests waiting for a decision. */
	openRequests: number;
	telegram: number;
	mailed: number;
	/** The pass is in at least one wallet. */
	wallet: number;
	handedOver: number;
}

export function countGuests(rows: GuestRow[]): GuestCounts {
	const counts: GuestCounts = {
		tickets: 0,
		withSpot: 0,
		withoutSpot: 0,
		checkedIn: 0,
		noEmail: 0,
		openRequests: 0,
		telegram: 0,
		mailed: 0,
		wallet: 0,
		handedOver: 0
	};
	for (const row of rows) {
		counts.tickets++;
		if (row.spot) counts.withSpot++;
		else counts.withoutSpot++;
		if (row.checkIn) counts.checkedIn++;
		if (!row.hasEmail) counts.noEmail++;
		if (row.request === 'pending') counts.openRequests++;
		if (row.notify.telegram) counts.telegram++;
		if (row.notify.mailed) counts.mailed++;
		if (hasWalletPass(row)) counts.wallet++;
		if (row.handedOverAt) counts.handedOver++;
	}
	return counts;
}

/** The count tiles above the list: each one toggles the filter of the same key. */
export const GUEST_TILES = [
	{ key: 'all', label: 'tickets', value: (c: GuestCounts) => c.tickets },
	{ key: 'spot', label: 'with a spot', value: (c: GuestCounts) => c.withSpot },
	{ key: 'nospot', label: 'without a spot', value: (c: GuestCounts) => c.withoutSpot },
	{ key: 'checkedin', label: 'checked in', value: (c: GuestCounts) => c.checkedIn },
	{ key: 'noemail', label: 'no e-mail', value: (c: GuestCounts) => c.noEmail },
	{ key: 'request', label: '♿ open requests', value: (c: GuestCounts) => c.openRequests },
	{ key: 'telegram', label: 'Telegram', value: (c: GuestCounts) => c.telegram },
	{ key: 'wallet', label: 'wallet pass', value: (c: GuestCounts) => c.wallet }
] as const satisfies readonly {
	key: GuestFilter;
	label: string;
	value: (c: GuestCounts) => number;
}[];

/**
 * The colour of a tile (src/routes/state.css): status colours mean the same
 * everywhere — red for booked (the bookings page paints a booked spot red,
 * so a ticket that holds one is red here too), turquoise for checked in, red
 * (danger) for a missing address, pink for ♿ only. A ticket without a spot
 * is a fact while booking runs (grey) and a warning once it closed (orange —
 * never the red of the booked ones, which would say the opposite).
 */
export function guestTileState(key: GuestFilter, phase: BookingPhase): string {
	switch (key) {
		case 'spot':
			return 'full';
		case 'nospot':
			return phase === 'closed' ? 'warning' : 'idle';
		case 'checkedin':
			return 'checked-in';
		case 'noemail':
			return 'danger';
		case 'request':
			return 'special';
		default:
			return 'idle';
	}
}

/** The colour of a row: checked in, holds a spot, or holds none (see guestTileState). */
export function guestRowState(
	row: Pick<GuestRow, 'spot' | 'checkIn'>,
	phase: BookingPhase
): string {
	if (row.checkIn) return 'checked-in';
	if (row.spot) return 'full';
	return phase === 'closed' ? 'warning' : 'idle';
}

/** Filter, search and sort in one go: what the list shows. */
export function visibleGuests(
	rows: GuestRow[],
	view: { houseId?: string; filter: GuestFilter; sort: GuestSort; search?: string }
): GuestRow[] {
	return sortGuests(
		rows.filter(
			(row) =>
				(!view.houseId || row.spot?.houseId === view.houseId) &&
				matchesGuestFilter(row, view.filter) &&
				matchesGuestSearch(row, view.search ?? '')
		),
		view.sort
	);
}
