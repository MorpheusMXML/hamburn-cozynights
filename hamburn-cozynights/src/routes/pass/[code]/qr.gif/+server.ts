// The pass's QR code as an image to save (a GIF saves to a phone's photos).
import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { formatPassCode, normalizePassInput } from '$lib/pass';
import { findPass, passQrGif, passUrl, unknownPassCodes } from '$lib/server/pass';

export const GET: RequestHandler = async ({ params, locals, url, getClientAddress }) => {
	const code = normalizePassInput(params.code);
	if (!code) throw error(404, 'Unknown pass.');

	// Same limit as the pass page: this image must not become the cheap way
	// to probe for codes.
	let client = 'unknown';
	try {
		client = getClientAddress();
	} catch {
		/* no address header (e.g. a direct local request) */
	}
	if (!locals.admin && unknownPassCodes.isBlocked(client)) {
		throw error(429, 'Too many unknown passes from your connection. Please wait a few minutes.');
	}

	const pass = await findPass(locals.adminPb, code).catch(() => null);
	if (!pass) {
		unknownPassCodes.recordFailure(client);
		throw error(404, 'Unknown pass.');
	}

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
