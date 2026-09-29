// Apple Wallet web service: the pass as it is now, for a device that was told
// it changed (or refreshes it by hand). 304 when it hasn't changed since the
// device's copy.
import type { RequestHandler } from './$types';
import { buildApplePass, PKPASS_TYPE } from '$lib/server/wallet/apple';
import { contentHash, loadContent } from '$lib/server/wallet/content';
import { getBookingSettings } from '$lib/server/settings';
import { findWalletPass } from '$lib/server/wallet/store';
import {
	appleService,
	checkSerial,
	requireAppleAuth,
	status
} from '$lib/server/wallet/web-service';

export const GET: RequestHandler = async ({ params, request, locals }) => {
	const { config, apple } = appleService(params.passType);
	const serial = checkSerial(params.serial);
	requireAppleAuth(request, serial);

	const [content, record, settings] = await Promise.all([
		loadContent(locals.adminPb, serial, config.origin),
		findWalletPass(locals.adminPb, 'apple', serial),
		getBookingSettings(locals.pb)
	]);
	const extras = { telegram: !!settings.telegramBot };

	// The record's date only counts while it describes this content; right
	// after a change (before the next sync) the pass is simply new.
	const recorded =
		record && record.hash === contentHash(content, config, extras) && record.changed_at
			? Date.parse(record.changed_at.replace(' ', 'T'))
			: NaN;
	const modified = isNaN(recorded) ? Date.now() : recorded;
	const since = Date.parse(request.headers.get('if-modified-since') || '');
	// HTTP dates have whole seconds
	if (!isNaN(since) && Math.floor(modified / 1000) * 1000 <= since) {
		return status(304, { 'last-modified': new Date(modified).toUTCString() });
	}

	return new Response(new Uint8Array(buildApplePass(content, config, apple, extras)), {
		headers: {
			'content-type': PKPASS_TYPE,
			'last-modified': new Date(modified).toUTCString(),
			'cache-control': 'no-store'
		}
	});
};
