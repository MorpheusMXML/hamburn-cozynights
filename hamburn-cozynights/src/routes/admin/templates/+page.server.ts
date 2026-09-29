// src/routes/admin/templates/+page.server.ts — export the camp layout, compare
// a layout file with the camp, apply it (docs/admin/templates.md). The
// comparison and the import are actions of the Control Center
// (/admin?/previewTemplate, /admin?/importTemplate).
import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getBookingSettings } from '$lib/server/settings';

export const load: PageServerLoad = async ({ locals }) => {
	// Runs in parallel with the layout load, so it guards itself too.
	if (!locals.admin) throw redirect(303, '/admin/login');
	const { phase, isLayoutLocked } = await getBookingSettings(locals.pb);
	return { phase, isLayoutLocked };
};
