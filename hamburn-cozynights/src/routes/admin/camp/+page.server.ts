// src/routes/admin/camp/+page.server.ts — the camp editor: the map and the
// list of houses (docs/admin/camp-layout.md). Its writes are actions of the
// Control Center (/admin?/updateHouseCoords, …/renameHouse, …/deleteHouse),
// where they lived before the pages were split.
import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { readCamp } from '$lib/server/camp';
import { readBookings } from '$lib/server/bookings';

export const load: PageServerLoad = async ({ locals }) => {
	// Runs in parallel with the layout load, so it guards itself too.
	if (!locals.admin) throw redirect(303, '/admin/login');

	const [camp, bookings] = await Promise.all([
		readCamp(locals),
		// Who is booked where, for the house sidebar next to the map.
		readBookings(locals.adminPb).catch((err) => {
			console.error('[Camp] Bookings could not be read:', (err as Error)?.message);
			return null;
		})
	]);
	const { settings } = camp;
	return {
		houses: camp.houses,
		sanityWarnings: camp.sanityWarnings,
		stats: camp.stats,
		bookings,
		phase: settings.phase,
		isLayoutLocked: settings.isLayoutLocked
	};
};
