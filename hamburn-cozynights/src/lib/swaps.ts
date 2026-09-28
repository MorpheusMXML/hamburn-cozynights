/**
 * Swap requests (docs/guide/booking.md "Swap spots", docs/admin/swaps.md):
 * during Live Booking a guest who holds a spot asks the guest of another,
 * taken spot to trade. Nothing moves until that guest says yes; then both
 * spots change hands at once (src/lib/server/swaps.ts, pb_hooks/lib/swap.js).
 *
 * The rules and the words for the pages and the server. Safe for the browser:
 * no secrets in here.
 */

/** Open requests a ticket may have at a time (Max's choice, 28 Sep). */
export const SWAP_OPEN_MAX = 3;
/** How long a request stays open without an answer: at least 72 h (Max's choice, 28 Sep). */
export const SWAP_HOURS = 72;
/** New requests a ticket may send within 24 hours, withdrawn ones included. */
export const SWAP_DAILY_MAX = 10;
/** The asker's note, at most this long. */
export const SWAP_NOTE_MAX = 140;

/** A reason to swap, one tap instead of typing (the chips of the swap sheet). */
export interface SwapVibe {
	value: string;
	icon: string;
	label: string;
}

/**
 * Friendly and light on purpose: nothing here asks for a reason from the
 * body. The note is free, but the page says a friendly word is enough.
 */
export const SWAP_VIBES: readonly SwapVibe[] = [
	{ value: 'crew', icon: '👯', label: 'My crew sleeps nearby' },
	{ value: 'quiet', icon: '🤫', label: 'Quiet corner, please' },
	{ value: 'early', icon: '🌅', label: 'Early bird' },
	{ value: 'night', icon: '🌙', label: 'Night owl' },
	{ value: 'bunk', icon: '🪜', label: 'The other bunk level' },
	{ value: 'nice', icon: '🎁', label: 'Just asking nicely' }
];

export function swapVibe(value: unknown): SwapVibe | undefined {
	return SWAP_VIBES.find((vibe) => vibe.value === value);
}

/**
 * What a request is:
 * - pending: waiting for the other guest
 * - accepted: they said yes, the spots are swapped
 * - declined: they said no
 * - withdrawn: the asker took it back
 * - expired: nobody answered in time
 * - void: it can't happen any more (`SwapEnd` says why)
 */
export type SwapStatus = 'pending' | 'accepted' | 'declined' | 'withdrawn' | 'expired' | 'void';

/**
 * Why a request ended without a yes or no (swap_requests.ended):
 * - swapped: another swap of one of the two went through first
 * - moved: the other spot changed hands
 * - yours_moved: the asker's own spot changed (booked, moved, released)
 * - yours_fixed: the asker's spot can't be swapped any more (checked in, picked by the crew)
 */
export type SwapEnd = 'swapped' | 'moved' | 'yours_moved' | 'yours_fixed' | '';

/**
 * Why nobody can ask or answer right now, while requests stay open:
 * 'closed' booking isn't open, 'off' the crew turned swaps off.
 */
export type SwapPause = '' | 'closed' | 'off';

/** A spot in a request, as the pages show it. */
export interface SwapSpot {
	bedId: string;
	roomId: string;
	/** The spot's own label, "B1". */
	spot: string;
	/** "Dorm #2" */
	room: string;
	house: string;
	/** "B1 · Dorm #2 · Villa" */
	label: string;
	/** "Lower bunk · below B2", '' when nobody wrote the bed down. */
	bed: string;
}

/** One request as a guest sees it, from their side: `mine` is their spot in it. */
export interface SwapView {
	id: string;
	/** in: addressed to this guest; out: this guest asked. */
	direction: 'in' | 'out';
	status: SwapStatus;
	ended: SwapEnd;
	/** The other guest's burner name ('' when they have none). */
	name: string;
	vibe: string;
	/** What the asker wrote ('' for none). */
	note: string;
	mine: SwapSpot;
	other: SwapSpot;
	createdAt: string;
	expiresAt: string;
	answeredAt: string;
}

/**
 * The note as it is stored and shown: one line, no stray whitespace, no
 * invisible characters, at most SWAP_NOTE_MAX characters.
 */
export function cleanSwapNote(raw: unknown): string {
	return (typeof raw === 'string' ? raw : '')
		.replace(/[\p{Cc}\p{Cf}]/gu, ' ')
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, SWAP_NOTE_MAX);
}

// Web addresses in any shape people type them: with a scheme, with www., or a
// bare name with a common ending (bit.ly, t.me, example.com/x).
const LINK =
	/(https?:\/\/|www\.|\b[a-z0-9-]+\.(com|de|net|org|io|me|ly|app|info|link|xyz|ru|co|to|gg|tv|eu|at|ch|nl|biz|site|online|shop|club|click|top)\b)/i;

/**
 * Why a note can't be sent, or '' when it can. Links are refused: the note
 * reaches a stranger through CozyNights, so it must never carry one.
 */
export function swapNoteProblem(note: string): string {
	if (note.length > SWAP_NOTE_MAX) return `Keep the note to ${SWAP_NOTE_MAX} characters.`;
	if (LINK.test(note)) return 'Links can’t go into a swap note. A friendly word is enough.';
	return '';
}

/** "2 d 5 h", "5 h 12 min", "12 min", "under a minute": the time a request has left. */
export function formatTimeLeft(ms: number): string {
	if (ms <= 0) return 'no time';
	const minutes = Math.floor(ms / 60_000);
	if (minutes < 1) return 'under a minute';
	const days = Math.floor(minutes / 1440);
	const hours = Math.floor((minutes % 1440) / 60);
	const mins = minutes % 60;
	if (days > 0) return hours > 0 ? `${days} d ${hours} h` : `${days} d`;
	if (hours > 0) return mins > 0 ? `${hours} h ${mins} min` : `${hours} h`;
	return `${mins} min`;
}

/** What an asker's request came to, in words (the /swaps page). */
export function outcomeText(view: Pick<SwapView, 'status' | 'ended'>): string {
	switch (view.status) {
		case 'accepted':
			return 'Swapped!';
		case 'declined':
			return 'No thanks — they keep their spot';
		case 'withdrawn':
			return 'You took it back';
		case 'expired':
			return 'No answer — it ran out';
		case 'void':
			return view.ended === 'swapped'
				? 'Another swap went through first'
				: view.ended === 'yours_moved'
					? 'Your spot changed, so it ended'
					: view.ended === 'yours_fixed'
						? 'Your spot can’t be swapped any more'
						: 'That spot changed hands';
		default:
			return 'Waiting for an answer';
	}
}

/** The words for a pause, or '' while swaps can happen. */
export function pauseText(pause: SwapPause): string {
	if (pause === 'off') return 'The crew paused swaps for a moment. Open requests wait.';
	if (pause === 'closed') return 'Booking is not open, so nobody can swap right now.';
	return '';
}
