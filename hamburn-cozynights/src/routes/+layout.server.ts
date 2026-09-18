import type { LayoutServerLoad } from './$types';
import { getBookingSettings } from '$lib/server/settings';

/** Every page shows the booking countdown on top (BookingCountdownBar in +layout.svelte). */
export const load: LayoutServerLoad = async ({ locals }) => {
	const { phase, next } = await getBookingSettings(locals.pb);
	return { booking: { phase, next } };
};
