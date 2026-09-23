// Apple Wallet web service: devices report problems with the web service
// here (a pass that didn't verify, a bad answer). Into the app log, short.
import type { RequestHandler } from './$types';
import { walletConfig } from '$lib/server/wallet/config';
import { status } from '$lib/server/wallet/web-service';

export const POST: RequestHandler = async ({ request }) => {
	if (!walletConfig().apple) return status(404);
	try {
		const body = (await request.json()) as { logs?: unknown };
		const logs = Array.isArray(body.logs) ? body.logs.slice(0, 10) : [];
		for (const line of logs) {
			// Apple's messages can carry the pass's URL; the token never.
			console.warn('[Wallet] Apple device:', String(line).replace(/\s+/g, ' ').slice(0, 300));
		}
	} catch {
		/* nothing readable to log */
	}
	return status(200);
};
