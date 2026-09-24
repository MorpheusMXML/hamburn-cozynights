// The pass's QR code as a PNG. The Telegram bot sends it as a photo
// (pb_hooks/lib/notify.js): Telegram's servers fetch it from here, the same
// way a guest's phone opens the pass link that is already in the message.
import type { RequestHandler } from './$types';
import { formatPassCode } from '$lib/pass';
import { PASS_FILE_HEADERS, passQrPng, passUrl, requirePass } from '$lib/server/pass';

export const GET: RequestHandler = async (event) => {
	const { code } = await requirePass(event);
	return new Response(new Uint8Array(passQrPng(passUrl(event.url.origin, code))), {
		headers: {
			...PASS_FILE_HEADERS,
			'content-type': 'image/png',
			'content-disposition': `inline; filename="cozynights-pass-${formatPassCode(code)}.png"`
		}
	});
};
