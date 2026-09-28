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
 */
export const load: LayoutServerLoad = async ({ locals, url }) => {
	const { phase, next, requestsOpen, swapsOff } = await getBookingSettings(locals.pb);
	const order = locals.order;
	const signedIn = !!locals.orderNumber;

	let specialNeeds: { open: boolean; requestSent: boolean } | null = null;
	if (order && showTopBar(url.pathname)) {
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
	if (order && phase === 'live' && showTopBar(url.pathname)) {
		const incoming = await countIncoming(locals.adminPb, order.id).catch((err) => {
			console.error('[Layout] Swap request lookup failed:', (err as Error)?.message);
			return 0;
		});
		swaps = { incoming, off: swapsOff };
	}

	return { booking: { phase, next }, signedIn, specialNeeds, swaps };
};
