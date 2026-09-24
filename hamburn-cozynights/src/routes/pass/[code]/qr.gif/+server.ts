// The pass's QR code as an image to save (a GIF saves to a phone's photos).
import type { RequestHandler } from './$types';
import { formatPassCode } from '$lib/pass';
import { PASS_FILE_HEADERS, passQrGif, passUrl, requirePass } from '$lib/server/pass';

export const GET: RequestHandler = async (event) => {
	const { code } = await requirePass(event);
	return new Response(passQrGif(passUrl(event.url.origin, code)), {
		headers: {
			...PASS_FILE_HEADERS,
			'content-type': 'image/gif',
			'content-disposition': `attachment; filename="cozynights-pass-${formatPassCode(code)}.gif"`
		}
	});
};
