// src/routes/admin/messages/+page.server.ts
import { error, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import {
	listMessageTexts,
	MessageTextError,
	resetMessageText,
	saveMessageText
} from '$lib/server/message-texts';

export const load: PageServerLoad = async ({ locals }) => {
	// Runs in parallel with the layout load, so it guards itself too.
	if (!locals.admin) throw error(403, 'Unauthorized');
	try {
		return await listMessageTexts(locals.adminPb);
	} catch (err) {
		console.error('[Admin:Messages] Load failed:', (err as Error)?.message);
		throw error(503, 'The message texts could not be loaded. Reload the page in a minute.');
	}
};

function keyOf(form: FormData): string {
	const value = form.get('key');
	return typeof value === 'string' ? value : '';
}

/** Runs one change and turns expected refusals into messages. */
async function step<T>(what: string, fn: () => Promise<T>) {
	try {
		return { success: true, ...(await fn()) };
	} catch (err) {
		if (err instanceof MessageTextError) return fail(err.status, { error: err.message });
		if ((err as { status?: number })?.status === 404) {
			return fail(409, { error: 'This text was changed meanwhile. Reload the page.' });
		}
		console.error(`[Admin:Messages] ${what} failed:`, (err as Error)?.message);
		return fail(500, { error: 'The server could not save this. Reload the page and try again.' });
	}
}

export const actions: Actions = {
	save: async ({ request, locals }) => {
		const admin = locals.admin;
		if (!admin) return fail(403, { error: 'Only admins can change message texts.' });
		const form = await request.formData();
		const key = keyOf(form);
		return step('save', async () => {
			const text = await saveMessageText(locals.adminPb, admin, key, form.get('text'));
			console.log(`[Admin:Messages] ${admin.email} changed ${key}.`);
			return { key, text };
		});
	},

	reset: async ({ request, locals }) => {
		const admin = locals.admin;
		if (!admin) return fail(403, { error: 'Only admins can change message texts.' });
		const key = keyOf(await request.formData());
		return step('reset', async () => {
			const removed = await resetMessageText(locals.adminPb, admin, key);
			if (removed) console.log(`[Admin:Messages] ${admin.email} reset ${key}.`);
			return { key, removed };
		});
	}
};
