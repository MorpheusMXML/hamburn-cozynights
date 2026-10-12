// src/lib/server/spot-holds.ts — a free spot a guest started booking is theirs
// for HOLD_MINUTES (Max, 12 Oct 2026): opening the booking window on the room
// page, or the roulette landing on a spot, holds it while the guest makes the
// bed, ticks the rules and picks a name. Nobody else can book it meanwhile;
// they see "Bed being made…" on its card instead. Then it is free again.
//
// The rules:
// - One hold per ticket: asking for another spot lets go of the first one,
//   also when the new one can't be held (taken, someone else's, spent).
// - One hold per spot: a spot someone holds can't be held by anyone else.
// - Ten minutes per spot and ticket, counted from the first tap: closing the
//   window lets go of the spot (others can book it), and opening it again
//   within those minutes picks the same clock up. Once they are over, the
//   ticket can't hold that spot again for another HOLD_MINUTES — it can still
//   book it if nobody else is faster — so tapping it again never keeps a spot
//   away from everybody else for good.
// - A hold ends when its ticket books (BookingService.bookBed), signs out,
//   or the crew releases every booking (back to Staging).
// - Only a guest's own booking waits for a hold; the crew books past it.
//
// Holds live in this process's memory, like the booking locks
// (src/lib/server/booking.ts): one app instance only, and a restart forgets
// them, which only means the spots are free for whoever is first again.
// Both ids are records the caller read from PocketBase, so the maps hold at
// most a few entries per ticket and forget them after 2 × HOLD_MINUTES.

export const HOLD_MINUTES = 10;
export const HOLD_MS = HOLD_MINUTES * 60_000;

/** What a guest is told when another ticket holds the spot. */
export const HELD_MESSAGE = 'Someone else is making this bed right now.';

export interface SpotHold {
	bedId: string;
	roomId: string;
	orderId: string;
	/**
	 * The ticket code's lookup hash ($lib/server/crypto createLookupHash): the
	 * room page's poll knows the guest by the signed cookie alone and finds
	 * their own hold by it, without asking PocketBase for the ticket.
	 */
	ticket: string;
	/** When the hold ends (ms since the epoch). */
	until: number;
}

/**
 * What placeHold did:
 * - held: the spot is held for the ticket until `hold.until` (new, or the
 *   clock of an earlier hold on the same spot picked up again)
 * - taken: another ticket holds it until `hold.until`
 * - spent: the ticket's ten minutes on this spot are over; it can hold it
 *   again from `again` on, and book it any time if nobody else is faster
 */
export type HoldOutcome =
	| { status: 'held'; hold: SpotHold }
	| { status: 'taken'; hold: SpotHold }
	| { status: 'spent'; again: number };

/** The ticket's hold, by ticket. Ended or expired holds are removed. */
const holds = new Map<string, SpotHold>();
/** When a ticket first held a spot (`order:bed`): the clock of that spot. */
const started = new Map<string, number>();

const startKey = (orderId: string, bedId: string) => `${orderId}:${bedId}`;

/** Forgets expired holds and clocks nobody can pick up again. */
function prune(now: number): void {
	for (const [orderId, hold] of holds) if (hold.until <= now) holds.delete(orderId);
	for (const [key, at] of started) if (at + 2 * HOLD_MS <= now) started.delete(key);
}

/** The running hold on a spot, or null. */
export function holdOn(bedId: string, now = Date.now()): SpotHold | null {
	for (const hold of holds.values()) {
		if (hold.bedId === bedId && hold.until > now) return hold;
	}
	return null;
}

/** A running hold on the spot by any ticket but this one, or null. */
export function heldByOther(bedId: string, orderId: string, now = Date.now()): SpotHold | null {
	const hold = holdOn(bedId, now);
	return hold && hold.orderId !== orderId ? hold : null;
}

/** The ticket's running hold, or null. */
export function holdOf(orderId: string, now = Date.now()): SpotHold | null {
	const hold = holds.get(orderId);
	return hold && hold.until > now ? hold : null;
}

/**
 * The running holds of other tickets on a room's spots, as milliseconds
 * left by spot id: what the room page shows as "Bed being made…". The
 * guest's own hold is left out, known by the ticket's id or its lookup hash.
 */
export function roomHolds(
	roomId: string,
	guest: { orderId?: string; ticket?: string },
	now = Date.now()
): Record<string, number> {
	const left: Record<string, number> = {};
	for (const hold of holds.values()) {
		const own =
			(!!guest.orderId && hold.orderId === guest.orderId) ||
			(!!guest.ticket && hold.ticket === guest.ticket);
		if (hold.roomId === roomId && !own && hold.until > now) {
			left[hold.bedId] = hold.until - now;
		}
	}
	return left;
}

/** The spots no other ticket holds right now: the roulette's drum. */
export function unheld<T extends { id: string }>(
	spots: T[],
	orderId: string,
	now = Date.now()
): T[] {
	return spots.filter((spot) => !heldByOther(spot.id, orderId, now));
}

/**
 * Holds a spot for a ticket. Call it under the ticket's and the spot's
 * booking locks, after checking that the spot is free and bookable for it:
 * then a booking and a hold can't cross.
 */
export function placeHold(
	holder: { orderId: string; ticket: string },
	bedId: string,
	roomId: string,
	now = Date.now()
): HoldOutcome {
	const { orderId, ticket } = holder;
	prune(now);
	const other = heldByOther(bedId, orderId, now);
	if (other) {
		// one hold per ticket: the spot it held before is free now
		holds.delete(orderId);
		return { status: 'taken', hold: other };
	}

	const key = startKey(orderId, bedId);
	const first = started.get(key);
	if (first !== undefined && now >= first + HOLD_MS) {
		holds.delete(orderId);
		return { status: 'spent', again: first + 2 * HOLD_MS };
	}
	const from = first ?? now;
	started.set(key, from);
	const hold: SpotHold = { bedId, roomId, orderId, ticket, until: from + HOLD_MS };
	// one hold per ticket: this replaces any other spot the ticket held
	holds.set(orderId, hold);
	return { status: 'held', hold };
}

/**
 * Lets go of the ticket's hold (the booking window closed, the guest signed
 * out). With `bedId`, only a hold on that spot ends. The spot's clock keeps
 * running for this ticket.
 * @returns whether a hold ended
 */
export function endHold(orderId: string, bedId?: string): boolean {
	const hold = holds.get(orderId);
	if (!hold || (bedId && hold.bedId !== bedId)) return false;
	holds.delete(orderId);
	return true;
}

/**
 * A booking went through: the booking ticket's hold ends, and so does any
 * hold on the spot it got (the crew books past holds).
 */
export function settleHolds(orderId: string, bedId: string): void {
	holds.delete(orderId);
	for (const [holder, hold] of holds) if (hold.bedId === bedId) holds.delete(holder);
}

/** Forgets every hold and clock: a new booking round (and tests). */
export function clearHolds(): void {
	holds.clear();
	started.clear();
}
