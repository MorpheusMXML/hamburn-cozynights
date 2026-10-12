// src/lib/spot-hold-request.ts — the room page's and the roulette's requests
// for a spot hold ($lib/spot-hold, $lib/server/spot-hold-actions).
import { deserialize } from '$app/forms';
import type { ActionResult } from '@sveltejs/kit';
import { holdActionUrl, type HoldPage } from '$lib/spot-hold';

/**
 * Sends the holdSpot or dropHold action of `page` (the page that holds the
 * spot, never the URL the browser shows: leaving by a link moves that on
 * before the page lets go). `keepalive` lets a dropHold finish while the page
 * goes away. Resolves null when the server could not be reached.
 */
export async function holdRequest(
	page: HoldPage,
	action: 'holdSpot' | 'dropHold',
	bedId: string,
	keepalive = false
): Promise<ActionResult | null> {
	const body = new FormData();
	body.set('bedId', bedId);
	try {
		const response = await fetch(holdActionUrl(page, action), {
			method: 'POST',
			body,
			keepalive,
			cache: 'no-store',
			headers: { accept: 'application/json', 'x-sveltekit-action': 'true' }
		});
		return deserialize(await response.text());
	} catch {
		return null;
	}
}
