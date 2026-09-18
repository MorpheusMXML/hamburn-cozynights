// src/routes/admin/requests/+page.server.ts
import { error, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { BedUnavailableError } from '$lib/server/booking';
import { getBookingSettings } from '$lib/server/settings';
import {
	assignSpot,
	decideRequest,
	listAssignableSpots,
	listRequests,
	releaseSpot,
	RequestError,
	setRequestsOpen
} from '$lib/server/special-requests';

export const load: PageServerLoad = async ({ locals }) => {
	// Runs in parallel with the layout load, so it guards itself too.
	if (!locals.admin) throw error(403, 'Unauthorized');

	try {
		const [requests, spots, settings] = await Promise.all([
			listRequests(locals.adminPb),
			listAssignableSpots(locals.adminPb),
			getBookingSettings(locals.pb)
		]);
		return {
			requests,
			spots,
			requestsOpen: settings.requestsOpen,
			isBookingActive: settings.isBookingActive
		};
	} catch (err) {
		console.error('[Admin:Requests] Load failed:', (err as Error)?.message);
		throw error(503, 'The requests could not be loaded. Reload the page in a minute.');
	}
};

const RECORD_ID = /^[a-z0-9]{15}$/;

function recordId(form: FormData, field: string): string {
	const value = form.get(field);
	return typeof value === 'string' && RECORD_ID.test(value) ? value : '';
}

/** Runs one admin step on a request and turns expected refusals into messages. */
async function step(what: string, fn: () => Promise<void>) {
	try {
		await fn();
		return { success: true };
	} catch (err) {
		if (err instanceof RequestError) return fail(err.status, { error: err.message });
		if (err instanceof BedUnavailableError) {
			return fail(409, { error: `${err.message} Pick another spot.` });
		}
		if ((err as { status?: number })?.status === 404) {
			return fail(409, { error: "This spot doesn't exist anymore. Reload the page." });
		}
		console.error(`[Admin:Requests] ${what} failed:`, (err as Error)?.message);
		return fail(500, { error: 'The server could not save this. Reload the page and try again.' });
	}
}

export const actions: Actions = {
	toggleRequests: async ({ request, locals }) => {
		if (!locals.admin) return fail(403, { error: 'Only admins can open or close requests.' });
		const open = (await request.formData()).get('open') === 'true';
		try {
			await setRequestsOpen(locals.pb, open);
			console.log(`[Admin:Requests] ${locals.admin.email} ${open ? 'opened' : 'closed'} requests.`);
			return { success: true, requestsOpen: open };
		} catch (err) {
			console.error('[Admin:Requests] Switch failed:', (err as Error)?.message);
			return fail(500, { error: 'The switch could not be saved. Reload the page and try again.' });
		}
	},

	approve: async ({ request, locals }) => {
		const admin = locals.admin;
		if (!admin) return fail(403, { error: 'Only admins can decide on requests.' });
		const id = recordId(await request.formData(), 'id');
		if (!id) return fail(400, { error: 'No request was selected. Reload the page.' });
		return step('approve', () => decideRequest(locals.adminPb, admin, id, 'approved'));
	},

	decline: async ({ request, locals }) => {
		const admin = locals.admin;
		if (!admin) return fail(403, { error: 'Only admins can decide on requests.' });
		const id = recordId(await request.formData(), 'id');
		if (!id) return fail(400, { error: 'No request was selected. Reload the page.' });
		return step('decline', () => decideRequest(locals.adminPb, admin, id, 'declined'));
	},

	/** Books a spot for the request's ticket — also while booking is closed. */
	assign: async ({ request, locals }) => {
		const admin = locals.admin;
		if (!admin) return fail(403, { error: 'Only admins can assign spots.' });
		const form = await request.formData();
		const id = recordId(form, 'id');
		const bedId = recordId(form, 'bedId');
		if (!id) return fail(400, { error: 'No request was selected. Reload the page.' });
		if (!bedId) return fail(400, { error: 'Pick a spot from the list first.' });
		return step('assign', () => assignSpot(locals.adminPb, admin, id, bedId));
	},

	release: async ({ request, locals }) => {
		const admin = locals.admin;
		if (!admin) return fail(403, { error: 'Only admins can release spots.' });
		const id = recordId(await request.formData(), 'id');
		if (!id) return fail(400, { error: 'No request was selected. Reload the page.' });
		return step('release', () => releaseSpot(locals.adminPb, admin, id));
	}
};
