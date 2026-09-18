// The pass's QR code as an image to save (a GIF saves to a phone's photos).
import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { formatPassCode, normalizePassInput } from '$lib/pass';
import { findPass, passQrGif, passUrl } from '$lib/server/pass';

export const GET: RequestHandler = async ({ params, locals, url }) => {
	const code = normalizePassInput(params.code);
	if (!code) throw error(404, 'Unknown pass.');
	const pass = await findPass(locals.adminPb, code).catch(() => null);
	if (!pass) throw error(404, 'Unknown pass.');

	return new Response(passQrGif(passUrl(url.origin, code)), {
		headers: {
			'content-type': 'image/gif',
			'content-disposition': `attachment; filename="cozynights-pass-${formatPassCode(code)}.gif"`,
			'cache-control': 'private, no-store',
			'referrer-policy': 'no-referrer',
			'x-robots-tag': 'noindex, nofollow'
		}
	});
};
