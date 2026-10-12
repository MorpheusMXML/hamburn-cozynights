// src/lib/waiting.ts
/**
 * What a guest is waiting for right now, for the wait veil
 * ({@link WaitVeil}, mounted once in the root layout).
 *
 * At the opening of booking a few hundred guests arrive in the same minute,
 * and a click can take several seconds (opening load test: up to 12 s). Without
 * a sign the page looks frozen, so people tap again or reload. The veil appears
 * only when something takes longer than {@link SHOW_AFTER_MS}, so a normal day
 * never sees it.
 *
 * Two sources: a form the guest sent (`startWait`/`waitWhile` in its enhance
 * callback: sign-in, booking, release) and a page change of the guest pages
 * (SvelteKit's `navigating`). Background requests (the spot hold, the holds
 * refresh, a refresh on return to the tab) never start a wait.
 */
import { writable } from 'svelte/store';

export type WaitKind = 'sign-in' | 'booking' | 'releasing' | 'opening' | 'loading';

export interface WaitText {
	title: string;
	body: string;
	/** The line about reloading. */
	note: string;
	/**
	 * The guest sent something: a reload doesn't stop it and doesn't make it
	 * faster, so the note asks them to stay. Otherwise it only says there's no
	 * need to.
	 */
	stay: boolean;
}

const PROCESSING = 'Please allow us some time, we are processing your request.';
const STAY = 'Please don’t reload or close this page. Your request is already on its way.';

export const WAIT_TEXTS: Record<WaitKind, WaitText> = {
	'sign-in': { title: 'Checking your ticket', body: PROCESSING, note: STAY, stay: true },
	booking: { title: 'Saving your spot', body: PROCESSING, note: STAY, stay: true },
	releasing: { title: 'Releasing your spot', body: PROCESSING, note: STAY, stay: true },
	opening: {
		title: 'Booking is opening',
		body: 'Everyone is arriving at once. Please allow us some time, we are getting the camp ready for you.',
		note: 'No need to reload. This page updates by itself.',
		stay: false
	},
	loading: {
		title: 'On our way',
		body: 'Please allow us a moment, we are loading the page.',
		note: 'No need to reload. It’s on its way.',
		stay: false
	}
};

/** Shown under the text once a wait has gone on this long. */
export const STILL_TEXT = 'Still working on it. Thanks for your patience!';

/** Anything quicker shows nothing. */
export const SHOW_AFTER_MS = 800;
/** From here on the veil adds {@link STILL_TEXT}. */
export const STILL_AFTER_MS = 15_000;
/**
 * A gap this short between two waits (a sign-in that answers with a redirect
 * to the map) keeps the veil up instead of letting it blink.
 */
export const HIDE_GRACE_MS = 200;
/**
 * A wait nobody ended (a request the browser never answered) ends by itself:
 * nginx gives up after 60 s, so the page has its answer long before.
 */
export const MAX_WAIT_MS = 90_000;

interface Wait {
	id: number;
	kind: WaitKind;
}

/** The waits of forms that were sent and have no answer yet, oldest first. */
export const waits = writable<Wait[]>([]);

let lastId = 0;

/** A form was sent. Call the returned function when its answer is there (more calls do nothing). */
export function startWait(kind: WaitKind): () => void {
	const id = ++lastId;
	waits.update((list) => [...list, { id, kind }]);
	let ended = false;
	const end = () => {
		if (ended) return;
		ended = true;
		clearTimeout(timer);
		waits.update((list) => list.filter((wait) => wait.id !== id));
	};
	const timer = setTimeout(end, MAX_WAIT_MS);
	return end;
}

/** Waits for the promise (a page refresh at the opening), then ends the wait. */
export function waitWhile<T>(kind: WaitKind, work: Promise<T>): Promise<T> {
	const end = startWait(kind);
	return work.finally(end);
}

/** Pages with their own working signs: the crew's, the API, sign-in redirects, the guides. */
const NOT_A_GUEST_PAGE = /^\/(admin|api|auth|docs)(\/|$)/;

export interface PageChange {
	from?: URL | null;
	to: URL;
	/** A full page load (another site, a guide): the browser shows its own sign. */
	willUnload?: boolean;
}

/**
 * What the veil says, or null for no veil. A sent form wins (the newest one);
 * a page change counts only between guest pages, and only when the page
 * itself changes: a filter in the address doesn't cover the page.
 */
export function waitKind(sent: Wait[], change: PageChange | null): WaitKind | null {
	if (sent.length > 0) return sent[sent.length - 1].kind;
	if (!change || change.willUnload) return null;
	if (NOT_A_GUEST_PAGE.test(change.to.pathname)) return null;
	if (change.from && change.from.pathname === change.to.pathname) return null;
	return 'loading';
}
