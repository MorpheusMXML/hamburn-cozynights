/**
 * The quick views at the top of the Control Center: every list the crew
 * filters often, one click away and with its live count, so the bookings and
 * the tickets (the orders from pretix) are never hidden behind the menu.
 *
 * Each entry is a link into the page that shows the list, with the filter in
 * the address (?show=…), the same way the count tiles on those pages work.
 * Counts come from the live numbers; an entry whose number the snapshot does
 * not carry is a plain link.
 */
import type { BookingPhase } from '$lib/booking-phase';
import type { BookingCounts } from '$lib/bookings';
import { guestTileState } from '$lib/guests';
import type { Count, LiveStats } from '$lib/live-stats';
import { ticketsWithoutSpot } from '$lib/intel';

export interface QuickView {
	key: string;
	label: string;
	href: string;
	/** undefined: no count for this one; null: PocketBase could not answer. */
	value?: Count;
	/** The colour (src/routes/state.css); idle when there is nothing to say. */
	state: string;
	title: string;
}

export interface QuickGroup {
	key: string;
	icon: string;
	label: string;
	href: string;
	views: QuickView[];
}

const difference = (total: Count | undefined, part: Count | undefined): Count =>
	typeof total === 'number' && typeof part === 'number' ? Math.max(0, total - part) : null;

/**
 * The groups, in the order the page shows them. `bookings` are the counts of
 * the bookings list (they know the crew's own spots); without them the spot
 * numbers of the snapshot stand in.
 */
export function quickViews(
	stats: Pick<LiveStats, 'spots' | 'ops' | 'ticketsWithSpot'>,
	bookings: BookingCounts | null,
	phase: BookingPhase
): QuickGroup[] {
	const tickets = stats.ops?.tickets;
	const pending = stats.ops?.requests.pending;
	const booked = bookings?.booked ?? stats.spots.booked;
	const checkedIn = bookings?.checkedIn ?? stats.spots.checkedIn;
	const arriving = bookings?.arriving ?? Math.max(0, booked - checkedIn);
	const crew = bookings
		? bookings.crew + bookings.viaRequest
		: Math.max(0, stats.spots.occupied - stats.spots.booked);
	const noEmail = difference(tickets?.total, tickets?.withEmail);
	// Only red, orange or pink when there is something there.
	const lit = (value: Count | undefined, state: string) =>
		typeof value === 'number' && value > 0 ? state : 'idle';

	return [
		{
			key: 'bookings',
			icon: '🛏️',
			label: 'Bookings',
			href: '/admin/bookings',
			views: [
				{
					key: 'booked',
					label: 'booked',
					href: '/admin/bookings?show=all',
					value: booked,
					state: lit(booked, 'full'),
					title: 'Every booked spot, with the guest'
				},
				{
					key: 'arriving',
					label: 'still to arrive',
					href: '/admin/bookings?show=arriving',
					value: arriving,
					state: phase === 'closed' ? lit(arriving, 'filling') : 'idle',
					title: 'Booked with a ticket, not checked in yet'
				},
				{
					key: 'checkedin',
					label: 'checked in',
					href: '/admin/bookings?show=checkedin',
					value: checkedIn,
					state: lit(checkedIn, 'checked-in'),
					title: 'Guests the crew checked in at arrival'
				},
				{
					key: 'crew',
					label: 'held by the crew',
					href: '/admin/bookings?show=crew',
					value: crew,
					state: lit(crew, 'locked'),
					title: 'Spots the crew holds: taken without a ticket, or ♿ assigned'
				}
			]
		},
		{
			key: 'tickets',
			icon: '🎟️',
			label: 'Tickets & guests',
			href: '/admin/guests',
			views: [
				{
					key: 'all',
					label: 'tickets',
					href: '/admin/guests?show=all',
					value: tickets?.total ?? null,
					state: 'idle',
					title: 'Every ticket (order) with everything attached'
				},
				{
					key: 'nospot',
					label: 'without a spot',
					href: '/admin/guests?show=nospot',
					value: typeof tickets?.total === 'number' ? ticketsWithoutSpot(stats) : null,
					state: lit(
						typeof tickets?.total === 'number' ? ticketsWithoutSpot(stats) : null,
						guestTileState('nospot', phase)
					),
					title: 'Tickets that hold no spot'
				},
				{
					key: 'noemail',
					label: 'no e-mail',
					href: '/admin/guests?show=noemail',
					value: noEmail,
					state: lit(noEmail, guestTileState('noemail', phase)),
					title: 'Tickets without an e-mail address: they get no booking e-mails'
				},
				{
					key: 'requests',
					label: '♿ open requests',
					href: '/admin/requests',
					value: pending ?? null,
					state: lit(pending, guestTileState('request', phase)),
					title: 'Special-needs requests waiting for a decision'
				},
				{
					key: 'telegram',
					label: 'Telegram',
					href: '/admin/guests?show=telegram',
					value: tickets?.telegram ?? null,
					state: 'idle',
					title: 'Tickets with a linked Telegram chat'
				},
				{
					key: 'mailed',
					label: 'got an e-mail',
					href: '/admin/guests?show=mailed',
					value: tickets?.mailed ?? null,
					state: 'idle',
					title: 'Tickets whose address got a booking e-mail'
				},
				{
					key: 'wallet',
					label: 'Wallet pass',
					href: '/admin/guests?show=wallet',
					state: 'idle',
					title: 'Tickets with the pass in Apple or Google Wallet'
				},
				{
					key: 'handedover',
					label: 'Handed over',
					href: '/admin/guests?show=handedover',
					state: 'idle',
					title: 'Tickets that were passed on to somebody else'
				}
			]
		}
	];
}

/** The tools next to the lists: where the crew does things rather than looks. */
export const QUICK_TOOLS = [
	{
		href: '/admin/check',
		icon: '🎫',
		label: 'Check-in desk',
		title: 'Check guests in with their booking pass'
	},
	{
		href: '/admin/tickets',
		icon: '🔎',
		label: 'Find a ticket',
		title: 'Find a ticket, change its e-mail address, hand it over, load the ticket list'
	},
	{
		href: '/admin/requests',
		icon: '♿',
		label: 'Special needs',
		title: 'Decide special-needs requests'
	},
	{
		href: '/admin/messages',
		icon: '✉️',
		label: 'Message texts',
		title: 'What guests get by e-mail, on Telegram and from the bot'
	},
	{
		href: '/admin/camp',
		icon: '🗺️',
		label: 'Map & houses',
		title: 'The camp map and the houses'
	}
] as const;
