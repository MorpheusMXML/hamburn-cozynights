// Apple Wallet web service: which of the passes a device follows changed
// since the tag it got last time (passesUpdatedSince). 204: none.
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { passesOfDevice } from '$lib/server/wallet/store';
import { appleService, checkDevice, status } from '$lib/server/wallet/web-service';

export const GET: RequestHandler = async ({ params, url, locals }) => {
	appleService(params.passType);
	const device = checkDevice(params.device);
	const since = Number(url.searchParams.get('passesUpdatedSince') || 0) || 0;

	const { serials, lastUpdated } = await passesOfDevice(locals.adminPb, device, since);
	if (serials.length === 0) return status(204);
	return json(
		{ serialNumbers: serials, lastUpdated: String(lastUpdated) },
		{ headers: { 'cache-control': 'no-store' } }
	);
};
