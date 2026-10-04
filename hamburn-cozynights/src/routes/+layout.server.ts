import type { LayoutServerLoad } from './$types';
import { getBookingSettings } from '$lib/server/settings';
import { findRequest } from '$lib/server/special-requests';
import { countIncoming } from '$lib/server/swaps';
import { showTopBar } from '$lib/booking-phase';

/**
 * What every page needs for the guest top bar (GuestTopBar in +layout.svelte):
 * the booking phase with its next switch, and — on the pages that carry the
 * bar, for a signed-in guest — whether special-needs requests are open and
 * whether this ticket sent one (the ♿ link), and during Live Booking how many
 * swap requests wait for this guest's answer (the 🔁 link). The ticket itself
 * was read once per request in hooks.server.ts; the lookups are small reads,
 * and they never keep a page from loading.
 *
 * The answer depends on the path even without the bar: hooks.server.ts reads
 * the ticket only on guest pages, so the booking pass and the crew's area say
 * signedIn: false. SvelteKit reuses a layout's data on a client-side
 * navigation unless the load used something that changed, so the path is read
 * on every request — not only for a ticket on a bar page. Otherwise Back from
 * the pass to the room page kept the pass's answer: no Sign out, no 🔁, no ♿.
 */
export const load: LayoutServerLoad = async ({ locals, url }) => {
	const barPage = showTopBar(url.pathname);
	const { phase, next, requestsOpen, swapsOff } = await getBookingSettings(locals.pb);
	const order = locals.order;
	const signedIn = !!locals.orderNumber;

	let specialNeeds: { open: boolean; requestSent: boolean } | null = null;
	if (order && barPage) {
		try {
			specialNeeds = {
				open: requestsOpen,
				requestSent: !!(await findRequest(locals.adminPb, order.id))
			};
		} catch (err) {
			console.error('[Layout] Special-needs request lookup failed:', (err as Error)?.message);
			specialNeeds = { open: requestsOpen, requestSent: false };
		}
	}

	let swaps: { incoming: number; off: boolean } | null = null;
	if (order && phase === 'live' && barPage) {
		const incoming = await countIncoming(locals.adminPb, order.id).catch((err) => {
			console.error('[Layout] Swap request lookup failed:', (err as Error)?.message);
			return 0;
		});
		swaps = { incoming, off: swapsOff };
	}

	return { booking: { phase, next }, signedIn, specialNeeds, swaps };
};
