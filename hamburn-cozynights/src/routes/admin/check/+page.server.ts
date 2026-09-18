// src/routes/admin/check/+page.server.ts — check booking passes at arrival
// (docs/admin/passes.md). Type a code, let a USB scanner type the QR link, or
// scan with the camera; a phone's own camera app works as well: it opens
// /pass/<code>, which shows signed-in admins the same result.
import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { formatPassCode, normalizePassInput, type PassCheckResult } from '$lib/pass';
import { findPass } from '$lib/server/pass';
import { maskEmail } from '$lib/server/notifications';

export const load: PageServerLoad = async ({ locals }) => {
	// Runs in parallel with the layout load, so it guards itself too.
	if (!locals.admin) throw redirect(303, '/admin/login');
	return {};
};

export const actions: Actions = {
	check: async ({ request, locals }) => {
		if (!locals.admin) return fail(403, { error: 'Only admins can check passes.' });

		const input = (await request.formData()).get('code');
		const code = normalizePassInput(input);
		if (!code) {
			return fail(400, {
				input: typeof input === 'string' ? input.slice(0, 200) : '',
				error: "That isn't a pass code. Codes look like 7F3K-9QXM-2CWD."
			});
		}

		let pass;
		try {
			pass = await findPass(locals.adminPb, code);
		} catch (err) {
			console.error('[PassCheck] Lookup failed:', (err as Error)?.message);
			return fail(503, { error: 'The booking system is not reachable right now. Try again.' });
		}

		const checkedAt = new Date().toISOString();
		if (!pass) {
			const unknown: PassCheckResult = { status: 'unknown', code: formatPassCode(code), checkedAt };
			return { result: unknown };
		}

		const spot = pass.spot;
		let warning = '';
		if (spot && !spot.enabled) warning = 'This spot is deactivated. The booking still stands.';
		else if (spot?.locked) warning = 'This spot is locked for guests. The booking still stands.';

		const result: PassCheckResult = {
			status: spot ? 'valid' : 'nospot',
			code: formatPassCode(code),
			checkedAt,
			ticketName: pass.order.customer_name,
			email: maskEmail(pass.order.email),
			spot: spot
				? { house: spot.house, room: spot.room, spot: spot.spot, roomId: spot.roomId }
				: null,
			burnerName: spot ? pass.burnerName : '',
			warning
		};
		return { result };
	}
};
