// src/routes/admin/requests/+page.server.ts
import { error, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { BedUnavailableError, ReleaseFailedError } from '$lib/server/booking';
import { getBookingSettings } from '$lib/server/settings';
import { needCapacity } from '$lib/accommodation';
import {
	assignSpot,
	decideRequest,
	listAssignableSpots,
	listRequests,
	listSpecialSpots,
	releaseSpot,
	RequestError,
	setRequestsOpen
} from '$lib/server/special-requests';
import { assignGroup, decideGroup, listGroups, removeFromGroup } from '$lib/server/request-groups';

export const load: PageServerLoad = async ({ locals, setHeaders }) => {
	// Runs in parallel with the layout load, so it guards itself too.
	if (!locals.admin) throw error(403, 'Unauthorized');
	// What guests wrote about their needs: never keep it in a cache.
	setHeaders({ 'cache-control': 'no-store' });

	try {
		const [requests, spots, settings, groups, specialSpots] = await Promise.all([
			listRequests(locals.adminPb),
			listAssignableSpots(locals.adminPb),
			getBookingSettings(locals.pb),
			listGroups(locals.adminPb),
			// Every ♿ spot with its state: why one is missing from the picker.
			listSpecialSpots(locals.adminPb)
		]);
		// What the requests that still wait for a spot need, against the free spots
		// that fit: the crew sees early when it has to free or mark more.
		const open = requests.filter(
			(request) =>
				request.status === 'pending' || (request.status === 'approved' && !request.spot?.assigned)
		);
		return {
			requests,
			spots,
			capacity: needCapacity(open, spots),
			groups,
			specialSpots,
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

/**
 * Runs one admin step on a request or a group and turns expected refusals
 * into messages. What the step returns goes to the page with the success.
 */
async function step<T extends object>(what: string, fn: () => Promise<T | void>) {
	try {
		const result = await fn();
		return { success: true as const, ...(result ?? {}) };
	} catch (err) {
		if (err instanceof RequestError) return fail(err.status, { error: err.message });
		if (err instanceof BedUnavailableError) {
			return fail(409, { error: `${err.message} Pick another spot.` });
		}
		if (err instanceof ReleaseFailedError) return fail(409, { error: err.message });
		if ((err as { status?: number })?.status === 404) {
			return fail(409, { error: "Something here doesn't exist anymore. Reload the page." });
		}
		console.error(`[Admin:Requests] ${what} failed:`, (err as Error)?.message);
		return fail(500, { error: 'The server could not save this. Reload the page and try again.' });
	}
}

const NO_GROUP = 'No group was selected. Reload the page.';
const PICK_FIELD = /^bed_([a-z0-9]{15})$/;

/**
 * The planner's rows: request id → bed id ('' = keep as is), from the fields
 * bed_<request id>. Null when a field looks forged: a bed_ name without a
 * record id, or a value that is neither a record id nor empty.
 */
function readPicks(form: FormData): { requestId: string; bedId: string }[] | null {
	const picks: { requestId: string; bedId: string }[] = [];
	for (const [key, value] of form.entries()) {
		if (!key.startsWith('bed_')) continue;
		const requestId = PICK_FIELD.exec(key)?.[1];
		if (!requestId || typeof value !== 'string') return null;
		if (value !== '' && !RECORD_ID.test(value)) return null;
		picks.push({ requestId, bedId: value });
	}
	return picks;
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
	},

	/** Approves every waiting request of a group; decided ones stay as they are. */
	approveGroup: async ({ request, locals }) => {
		const admin = locals.admin;
		if (!admin) return fail(403, { error: 'Only admins can decide on requests.' });
		const id = recordId(await request.formData(), 'id');
		if (!id) return fail(400, { error: NO_GROUP });
		return step('approve group', async () => {
			const { changed } = await decideGroup(locals.adminPb, admin, id, 'approved');
			return { changed };
		});
	},

	/** Declines a group's requests, except those with a spot the crew booked. */
	declineGroup: async ({ request, locals }) => {
		const admin = locals.admin;
		if (!admin) return fail(403, { error: 'Only admins can decide on requests.' });
		const id = recordId(await request.formData(), 'id');
		if (!id) return fail(400, { error: NO_GROUP });
		return step('decline group', () => decideGroup(locals.adminPb, admin, id, 'declined'));
	},

	/**
	 * Books the picked spots for a group's members (fields bed_<request id>,
	 * '' = keep as is), also while booking is closed. Books what works: when
	 * one member's booking fails on the way, the others stay booked and the
	 * page gets a warning that names who wasn't booked and why.
	 */
	assignGroup: async ({ request, locals }) => {
		const admin = locals.admin;
		if (!admin) return fail(403, { error: 'Only admins can assign spots.' });
		const form = await request.formData();
		const id = recordId(form, 'id');
		if (!id) return fail(400, { error: NO_GROUP });
		const picks = readPicks(form);
		if (!picks) return fail(400, { error: 'No request was selected. Reload the page.' });
		return step('assign group', async () => {
			const outcome = await assignGroup(locals.adminPb, admin, id, picks);
			if (outcome.failed.length === 0) return outcome;
			const tried = outcome.booked + outcome.failed.length;
			const notBooked = outcome.failed
				.map((failure) => `${failure.name}: ${failure.message}`)
				.join(' ');
			return {
				...outcome,
				warning: `${outcome.booked} of ${tried} spots booked. Not booked: ${notBooked}`
			};
		});
	},

	/** Takes a request out of its group; the request itself stays as it is. */
	removeFromGroup: async ({ request, locals }) => {
		const admin = locals.admin;
		if (!admin) return fail(403, { error: 'Only admins can decide on requests.' });
		const id = recordId(await request.formData(), 'id');
		if (!id) return fail(400, { error: 'No request was selected. Reload the page.' });
		return step('take out of group', () => removeFromGroup(locals.adminPb, admin, id));
	}
};
