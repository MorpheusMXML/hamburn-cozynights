import { fail } from '@sveltejs/kit';
import type { Actions } from './$types';
import { getBookingSettings } from '$lib/server/settings';

export const actions: Actions = {
	create: async ({ request, locals }) => {
		if (!locals.pb.authStore.model?.verified) {
			console.error('[Action] Unauthorized attempt to create house.');
			// This action is called two ways with two different failure-field
			// conventions: this page's own <form> reads `form?.message`, while
			// admin/+page.svelte's map-based "new house" flow calls it via
			// fetch/submitAction and reads `result.data?.error` (matching the
			// rest of that file's own actions in admin/+page.server.ts) — set
			// both so either caller shows the real reason.
			const reason = 'Only verified crew members can ignite new sanctuaries.';
			return fail(403, { message: reason, error: reason });
		}

		const { isBookingActive } = await getBookingSettings(locals.pb);
		if (isBookingActive) {
			console.warn('[Action] BLOCKED: cannot create a house during LIVE mode.');
			const reason = 'New sanctuaries cannot be ignited during Live Booking. Switch to Staging.';
			return fail(403, { message: reason, error: reason });
		}

		const data = await request.formData();
		const name = data.get('name') as string;
		const x = parseInt((data.get('x') as string) || '0');
		const y = parseInt((data.get('y') as string) || '0');
		const bedCount = parseInt((data.get('bedCount') as string) || '0');

		console.log(`[Action] Ignite House: "${name}" at (${x}, ${y}) with ${bedCount} initial spots.`);

		try {
			// 1. Create house
			const house = await locals.pb.collection('houses').create({
				name,
				x,
				y,
				occupied: false
			});

			// 2. Create initial room and beds if requested
			if (bedCount > 0) {
				const room = await locals.pb.collection('rooms').create({
					name: 'Main Module',
					room_number: 1,
					house: house.id,
					amount_beds: bedCount,
					occupied: false
				});

				for (let i = 1; i <= bedCount; i++) {
					await locals.pb.collection('beds').create({
						label: `B${i}`,
						room: room.id,
						occupied: false
					});
				}
				console.log(`[Action] House ${house.id}: Initial module and ${bedCount} spots deployed.`);
			}

			return { success: true };
		} catch (err) {
			console.error('[Action] House ignition failed:', err);
			const reason = 'Could not ignite house. The dust is too thick.';
			return fail(500, { message: reason, error: reason });
		}
	}
};
