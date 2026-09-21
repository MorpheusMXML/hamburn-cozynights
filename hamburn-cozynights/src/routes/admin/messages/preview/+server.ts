// src/routes/admin/messages/preview/+server.ts
//
// Sample messages for the editor on /admin/messages, rendered by PocketBase
// with the texts as they are typed (JSON body { texts: { key: text } }).
import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { cleanMessageText, isMessageTextKey, MESSAGE_TEXT_MAX } from '$lib/message-texts';
import { previewMessageTexts } from '$lib/server/message-texts';

/** More keys than the catalogue has: not a request from the page. */
const MAX_KEYS = 200;

export const POST: RequestHandler = async ({ locals, request }) => {
	// hooks.server.ts refuses this without a session; an endpoint has no layout,
	// so it checks again.
	if (!locals.admin) throw error(403, 'Unauthorized');

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		throw error(400, 'Send the texts as JSON.');
	}
	const given = (body as { texts?: unknown } | null)?.texts;
	const texts: Record<string, string> = {};
	if (given && typeof given === 'object') {
		for (const [key, value] of Object.entries(given as Record<string, unknown>)) {
			if (!isMessageTextKey(key) || typeof value !== 'string') continue;
			if (Object.keys(texts).length >= MAX_KEYS) throw error(400, 'Too many texts.');
			// An overlong text previews clipped, like the page refuses to save it.
			texts[key] = cleanMessageText(value).slice(0, MESSAGE_TEXT_MAX);
		}
	}

	try {
		return json(await previewMessageTexts(locals.adminPb, texts));
	} catch (err) {
		console.error('[Admin:Messages] Preview failed:', (err as Error)?.message);
		throw error(503, 'The preview could not be rendered. Try again in a minute.');
	}
};
