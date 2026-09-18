import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { exportTemplate } from '$lib/server/template';
import { stringifyTemplate } from '$lib/template';

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.admin) throw error(403, 'Unauthorized');

	let template;
	try {
		template = await exportTemplate(locals.pb);
	} catch (err) {
		console.error('[Export API] Failed:', err);
		throw error(500, 'The layout could not be read from the database. Try again.');
	}

	const day = new Date().toISOString().slice(0, 10);
	return new Response(stringifyTemplate(template), {
		headers: {
			'Content-Type': 'application/json',
			'Content-Disposition': `attachment; filename="cozynights-layout-${day}.json"`,
			'Cache-Control': 'no-store'
		}
	});
};
