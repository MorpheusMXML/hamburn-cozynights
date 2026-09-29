/**
 * Guest pages show a moment in time: the phase, the spots, the countdown. A
 * tab that sits in the background — a phone that keeps it for days — misses
 * every switch it has no countdown for (a superuser's "switch right now", a
 * timer armed after the page loaded), and would still say BOOKING CLOSED while
 * booking is open again.
 *
 * So the page asks the server again when the guest comes back to it: after it
 * was hidden for a while, and whenever the browser restores it from the
 * back-forward cache. Nothing happens while the tab is in front, and a short
 * look at another tab doesn't cost a request either.
 */
import { invalidateAll } from '$app/navigation';

/** Hidden for less than this: the page is still fresh enough. */
const MIN_HIDDEN_MS = 30_000;

/**
 * Starts listening. Returns the function that stops it again — call it from
 * `onMount`'s cleanup.
 */
export function refreshOnReturn(minHiddenMs = MIN_HIDDEN_MS): () => void {
	if (typeof document === 'undefined') return () => {};

	let hiddenAt = document.visibilityState === 'hidden' ? Date.now() : 0;

	const onVisibility = () => {
		if (document.visibilityState === 'hidden') {
			hiddenAt = Date.now();
			return;
		}
		const away = hiddenAt ? Date.now() - hiddenAt : 0;
		hiddenAt = 0;
		if (away >= minHiddenMs) invalidateAll();
	};

	// Restored from the back-forward cache: the page is as old as the visit.
	const onPageShow = (event: PageTransitionEvent) => {
		if (event.persisted) {
			hiddenAt = 0;
			invalidateAll();
		}
	};

	document.addEventListener('visibilitychange', onVisibility);
	window.addEventListener('pageshow', onPageShow);
	return () => {
		document.removeEventListener('visibilitychange', onVisibility);
		window.removeEventListener('pageshow', onPageShow);
	};
}
