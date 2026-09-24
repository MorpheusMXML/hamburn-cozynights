/**
 * The admin area's menu: which pages exist and how they are grouped. The
 * sidebar (wide screens) and the ☰ drawer (phones, tablets) both render this
 * list ($lib/components/admin/AdminNav.svelte), so they never disagree.
 *
 * Groups follow what the crew is doing: the overview first, then the camp
 * itself (built in Staging, locked while booking runs), then the guests, then
 * the crew's own tools.
 */
import type { BookingPhase } from '$lib/booking-phase';

export type NavBadge = 'requests' | 'bookings';

export interface NavItem {
	href: string;
	icon: string;
	label: string;
	/** The tooltip, and what a collapsed sidebar says instead of the label. */
	title: string;
	/** Other paths that belong to this entry (the house and room pages to "Map & houses"). */
	also?: readonly string[];
	badge?: NavBadge;
	/** Opens in a new tab (the admin guide). */
	external?: boolean;
}

export interface NavGroup {
	key: string;
	label: string;
	items: readonly NavItem[];
}

export const ADMIN_NAV: readonly NavGroup[] = [
	{
		key: 'overview',
		label: 'Overview',
		items: [
			{
				href: '/admin',
				icon: '📊',
				label: 'Control Center',
				title: 'Booking window, what needs attention, the live numbers'
			}
		]
	},
	{
		key: 'camp',
		label: 'Camp',
		items: [
			{
				href: '/admin/camp',
				icon: '🗺️',
				label: 'Map & houses',
				title: 'The camp map and the list of houses: add, move, rename; rooms and spots',
				also: ['/admin/house', '/admin/room']
			},
			{
				href: '/admin/templates',
				icon: '💾',
				label: 'Templates',
				title: 'Export the camp layout, compare a layout file, apply it'
			}
		]
	},
	{
		key: 'guests',
		label: 'Guests',
		items: [
			{
				href: '/admin/guests',
				icon: '👥',
				label: 'Guests',
				title: 'Every ticket with everything attached: spot, check-in, request, messages, wallet'
			},
			{
				href: '/admin/bookings',
				icon: '🛏️',
				label: 'Bookings',
				title: 'Who booked which spot, who is checked in, who is still to arrive',
				badge: 'bookings'
			},
			{
				href: '/admin/tickets',
				icon: '🎟️',
				label: 'Tickets',
				title: 'Find tickets, change e-mail addresses, load the ticket list'
			},
			{
				href: '/admin/requests',
				icon: '♿',
				label: 'Special needs',
				title: 'Special-needs requests',
				badge: 'requests'
			},
			{
				href: '/admin/check',
				icon: '🎫',
				label: 'Check-in desk',
				title: 'Check guests in with their booking pass'
			}
		]
	},
	{
		key: 'crew',
		label: 'Crew',
		items: [
			{
				href: '/admin/messages',
				icon: '✉️',
				label: 'Messages',
				title: 'Message texts: what guests get by e-mail, on Telegram and from the bot'
			},
			{
				href: '/admin/docs/',
				icon: '📖',
				label: 'Admin guide',
				title: 'The admin guide, in a new tab',
				external: true
			}
		]
	}
];

/** Whether `item` is the page at `pathname` (or one of the pages it stands for). */
export function isActive(item: Pick<NavItem, 'href' | 'also' | 'external'>, pathname: string) {
	if (item.external) return false;
	const path = pathname.replace(/\/+$/, '') || '/';
	const within = (base: string) => path === base || path.startsWith(`${base}/`);
	// The overview is only itself: every admin page lies "below" /admin.
	if (item.href === '/admin') return path === '/admin';
	return within(item.href) || (item.also ?? []).some(within);
}

/** The numbers next to the menu entries; 0 hides a badge. */
export interface NavCounts {
	/** Special-needs requests waiting for a decision. */
	openRequests: number;
	/** Spots with a guest's ticket. */
	booked: number;
	/** Booked guests not checked in yet. */
	arriving: number;
}

export interface BadgeView {
	value: number;
	/** Accent (something to do) or quiet (just a count). */
	tone: 'accent' | 'quiet';
	title: string;
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/**
 * What a badge says. Requests always count what waits for a decision. The
 * bookings badge follows the phase: after booking closed (arrival) it counts
 * who is still to come, before that just how many spots are booked.
 */
export function badgeFor(
	badge: NavBadge | undefined,
	counts: NavCounts,
	phase: BookingPhase
): BadgeView | null {
	if (badge === 'requests') {
		return counts.openRequests > 0
			? {
					value: counts.openRequests,
					tone: 'accent',
					title: `${plural(counts.openRequests, 'request waits', 'requests wait')} for a decision`
				}
			: null;
	}
	if (badge === 'bookings') {
		if (phase === 'closed' && counts.arriving > 0) {
			return {
				value: counts.arriving,
				tone: 'accent',
				title: `${plural(counts.arriving, 'booked guest is', 'booked guests are')} still to arrive`
			};
		}
		return counts.booked > 0
			? {
					value: counts.booked,
					tone: 'quiet',
					title: `${plural(counts.booked, 'spot is', 'spots are')} booked`
				}
			: null;
	}
	return null;
}
