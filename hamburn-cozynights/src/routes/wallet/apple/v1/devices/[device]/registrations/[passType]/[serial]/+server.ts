// Apple Wallet web service: a device starts (POST) or stops (DELETE)
// following a pass. The push token it sends is what the sync pushes to when
// the pass changes (src/lib/server/wallet/sync.ts).
import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { contentHash, loadContent } from '$lib/server/wallet/content';
import { getBookingSettings } from '$lib/server/settings';
import {
	findWalletPass,
	recordWalletPass,
	registerDevice,
	unregisterDevice
} from '$lib/server/wallet/store';
import {
	appleService,
	checkDevice,
	checkSerial,
	requireAppleAuth,
	status
} from '$lib/server/wallet/web-service';

export const POST: RequestHandler = async ({ params, request, locals }) => {
	const { config } = appleService(params.passType);
	const serial = checkSerial(params.serial);
	const device = checkDevice(params.device);
	requireAppleAuth(request, serial);

	let pushToken = '';
	try {
		const body = (await request.json()) as { pushToken?: unknown };
		pushToken = typeof body.pushToken === 'string' ? body.pushToken.trim() : '';
	} catch {
		/* checked below */
	}
	if (!/^[0-9A-Fa-f]{16,200}$/.test(pushToken)) throw error(400, 'pushToken missing.');

	let pass = await findWalletPass(locals.adminPb, 'apple', serial);
	if (!pass) {
		// A pass this server handed out before it kept records, or whose record
		// was lost: note it now. Its content isn't known to be on the device, so
		// the next sync pushes, and the device fetches the current pass.
		const content = await loadContent(locals.adminPb, serial, config.origin);
		const { telegramBot } = await getBookingSettings(locals.pb);
		const found = await locals.adminPb
			.collection('orders')
			.getFirstListItem(locals.adminPb.filter('pass_code = {:serial}', { serial }))
			.catch(() => null);
		pass = await recordWalletPass(locals.adminPb, {
			platform: 'apple',
			serial,
			order: found?.id ?? '',
			hash: contentHash(content, config, { telegram: !!telegramBot }),
			delivered: false
		});
	}
	const created = await registerDevice(locals.adminPb, pass.id, device, pushToken);
	return status(created ? 201 : 200);
};

export const DELETE: RequestHandler = async ({ params, request, locals }) => {
	appleService(params.passType);
	const serial = checkSerial(params.serial);
	const device = checkDevice(params.device);
	requireAppleAuth(request, serial);

	const pass = await findWalletPass(locals.adminPb, 'apple', serial);
	if (pass) await unregisterDevice(locals.adminPb, pass.id, device);
	return status(200);
};
