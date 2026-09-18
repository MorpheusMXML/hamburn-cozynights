// src/routes/admin/tickets/+page.server.ts — the ticket roster in the admin
// area (docs/admin/tickets.md): find a ticket, change its address, hand it over
// to a new holder; superusers import the ticket shop's list after a review.
// Codes and addresses travel in POST bodies only, never in URLs (logs).
import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { logAdminEvent } from '$lib/server/admin-events';
import { maskEmail } from '$lib/server/notifications';
import {
	TicketError,
	changeTicket,
	importRoster,
	previewRoster,
	readRosterRows,
	searchTickets
} from '$lib/server/tickets';

const UNAVAILABLE =
	'The ticket list could not be read or written right now. Try again in a minute.';

export const load: PageServerLoad = async ({ locals }) => {
	// Runs in parallel with the layout load, so it guards itself too.
	if (!locals.admin) throw redirect(303, '/admin/login');
	return {};
};

/** The admin can fix it (TicketError), or the database had a problem. */
function refuse(err: unknown, context: string) {
	if (err instanceof TicketError) return fail(err.status, { error: err.message });
	console.error(`[Tickets] ${context} failed:`, err);
	return fail(503, { error: UNAVAILABLE });
}

function readKeys(value: FormDataEntryValue | null): string[] | null {
	try {
		const list = JSON.parse(String(value ?? '[]'));
		if (!Array.isArray(list)) return null;
		return list.filter((key): key is string => typeof key === 'string' && key.length <= 200);
	} catch {
		return null;
	}
}

export const actions: Actions = {
	search: async ({ locals, request }) => {
		if (!locals.admin) return fail(403, { error: 'Only admins can look up tickets.' });
		const form = await request.formData();
		try {
			return { search: await searchTickets(locals.adminPb, form.get('q')) };
		} catch (err) {
			return refuse(err, 'Search');
		}
	},

	update: async ({ locals, request }) => {
		if (!locals.admin) return fail(403, { error: 'Only admins can change tickets.' });
		const form = await request.formData();
		const id = String(form.get('id') ?? '');
		if (!id) return fail(400, { error: 'No ticket was chosen. Search again.' });

		try {
			const outcome = await changeTicket(locals.adminPb, id, {
				email: form.get('email'),
				name: form.get('name'),
				newHolder: form.get('newHolder') === '1'
			});
			const changed = outcome.emailChanged || outcome.nameChanged || outcome.newHolder;
			if (changed) {
				console.log(
					`[Tickets] ${locals.admin.email} changed ticket ${outcome.maskedCode}` +
						(outcome.newHolder ? ' (new holder)' : '')
				);
				// Masked: the audit log and the crew chat need no full address or code.
				await logAdminEvent(locals.adminPb, locals.admin, 'ticket_updated', id, {
					ticket: outcome.maskedCode,
					// Both masked addresses can look the same (max@… → mia@…): say it.
					emailChanged: outcome.emailChanged,
					emailFrom: maskEmail(outcome.emailBefore),
					emailTo: maskEmail(outcome.ticket.email),
					nameChanged: outcome.nameChanged,
					newHolder: outcome.newHolder,
					requestRemoved: outcome.requestRemoved,
					hasSpot: !!outcome.ticket.spot
				});
			}
			return { updated: { ...outcome, changed } };
		} catch (err) {
			return refuse(err, 'Update');
		}
	},

	previewRoster: async ({ locals, request }) => {
		if (!locals.admin?.isSuperuser) {
			return fail(403, { error: 'Only superusers can import the ticket list.' });
		}
		const form = await request.formData();
		try {
			const rows = readRosterRows(form.get('rows'));
			return { roster: await previewRoster(locals.adminPb, rows) };
		} catch (err) {
			return refuse(err, 'Roster preview');
		}
	},

	importRoster: async ({ locals, request }) => {
		if (!locals.admin?.isSuperuser) {
			return fail(403, { error: 'Only superusers can import the ticket list.' });
		}
		const form = await request.formData();
		const selected = readKeys(form.get('selected'));
		const newHolders = readKeys(form.get('newHolders'));
		if (!selected || !newHolders) {
			return fail(400, { error: 'The chosen tickets did not arrive. Check the file again.' });
		}
		if (selected.length === 0) {
			return fail(400, { error: 'Nothing is selected. Tick the tickets to import first.' });
		}

		try {
			const rows = readRosterRows(form.get('rows'));
			const outcome = await importRoster(locals.adminPb, rows, { selected, newHolders });
			console.log(
				`[Tickets] ${locals.admin.email} imported the ticket list: ${outcome.created} new, ${outcome.updated} updated, ${outcome.failed.length} failed.`
			);
			if (outcome.created + outcome.updated > 0) {
				await logAdminEvent(locals.adminPb, locals.admin, 'tickets_imported', '', {
					created: outcome.created,
					updated: outcome.updated,
					newHolders: outcome.newHolders,
					requestsRemoved: outcome.requestsRemoved,
					confirmations: outcome.confirmations,
					failed: outcome.failed.length
				});
			}
			return { imported: outcome };
		} catch (err) {
			return refuse(err, 'Roster import');
		}
	}
};
