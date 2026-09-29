// "Add to Google Wallet": writes the pass's object to Google Wallet as it is
// now, then sends the browser to Google's save page with a signed link that
// names it. Saving it again later (after a move) shows the current spot too.
import { error, redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { googleSaveUrl, writeGoogleObject } from '$lib/server/wallet/google';
import { noteHandout, prepareHandout } from '$lib/server/wallet/handout';

export const GET: RequestHandler = async (event) => {
	const handout = await prepareHandout(event, 'google');
	const google = handout.config.google!;
	try {
		await writeGoogleObject(google, handout.content, handout.config, handout.extras);
	} catch (err) {
		console.error('[Wallet] Google Wallet object not written:', (err as Error)?.message);
		throw error(
			503,
			'Google Wallet is not reachable right now. Please try again in a minute — your pass page works meanwhile.'
		);
	}
	await noteHandout(event.locals.adminPb, 'google', handout);
	throw redirect(303, googleSaveUrl(google, handout.config.origin, handout.content.serial));
};
