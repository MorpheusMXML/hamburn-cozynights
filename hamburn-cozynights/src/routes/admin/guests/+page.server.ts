// src/routes/admin/guests/+page.server.ts — every ticket with everything
// attached: spot, check-in, special-needs request, messages, wallet passes.
//
// Guests are shown the way the check-in desk shows them: names, masked e-mail
// and ticket code ($lib/server/guests.ts). The page changes nothing; every
// action is a link to the page that does (ticket, room, requests).
import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { readGuests } from '$lib/server/guests';
import { getBookingSettings } from '$lib/server/settings';

export const load: PageServerLoad = async ({ locals, depends, setHeaders }) => {
	// Runs in parallel with the layout load, so it guards itself too.
	if (!locals.admin) throw redirect(303, '/admin/login');
	depends('app:guests');
	// Names of guests: never kept by a browser cache or a proxy.
	setHeaders({ 'cache-control': 'no-store, private' });

	const [guests, houses, { phase }] = await Promise.all([
		readGuests(locals.adminPb).catch((err) => {
			console.error('[Guests] Read failed:', (err as Error)?.message);
			return null;
		}),
		locals.pb
			.collection('houses')
			.getFullList({ fields: 'id,name', sort: 'name', requestKey: null })
			.catch(() => []),
		getBookingSettings(locals.pb)
	]);
	return {
		guests,
		houses: houses.map((house) => ({ id: house.id, name: house.name as string })),
		phase
	};
};
