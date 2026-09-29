// The booking pass as an Apple Wallet pass (.pkpass). Safari, Mail and the
// Files app on an iPhone, iPad or Mac offer "Add to Apple Wallet" for it.
import type { RequestHandler } from './$types';
import { PASS_FILE_HEADERS } from '$lib/server/pass';
import { buildApplePass, PKPASS_TYPE } from '$lib/server/wallet/apple';
import { noteHandout, prepareHandout } from '$lib/server/wallet/handout';

export const GET: RequestHandler = async (event) => {
	const handout = await prepareHandout(event, 'apple');
	const apple = handout.config.apple!;
	const pkpass = buildApplePass(handout.content, handout.config, apple, handout.extras);
	await noteHandout(event.locals.adminPb, 'apple', handout);
	return new Response(new Uint8Array(pkpass), {
		headers: {
			...PASS_FILE_HEADERS,
			'content-type': PKPASS_TYPE,
			'content-disposition': `attachment; filename="cozynights-pass-${handout.content.code}.pkpass"`,
			'last-modified': new Date().toUTCString()
		}
	});
};
