import type { ClientResponseError } from 'pocketbase';
import type {
	TypedPocketBase,
	OrdersResponse,
	BedsResponse,
	SwapRequestsResponse
} from '$lib/pocketbase-types';
import { createLookupHash, encrypt } from '$lib/server/crypto';
import { CHECKED_IN_NOTE } from '$lib/check-in';
import { bookingRefusal, type BookingPhase } from '$lib/booking-phase';
import { HELD_MESSAGE, heldByOther, settleHolds } from '$lib/server/spot-holds';

/**
 * Thrown when a bed can no longer be booked (already taken by someone else,
 * locked, or deactivated). Distinguishes expected booking-conflict outcomes
 * from real infrastructure/DB errors so callers can show the right message.
 */
export class BedUnavailableError extends Error {}
/**
 * A booking whose previous spot couldn't be released. Bookings are one
 * PocketBase transaction now (POST /api/cozy/book), so nothing throws it any
 * more; the routes still name it in their error handling.
 */
export class ReleaseFailedError extends Error {}

/** What POST /api/cozy/book answers (pb_hooks/lib/book.js REFUSALS). */
type BookOutcome =
	| { ok: true; reason?: undefined; phase?: undefined }
	| {
			ok: false;
			reason: 'gone' | 'taken' | 'unavailable' | 'closed' | 'checked_in';
			phase?: BookingPhase;
	  };
/**
 * The guest confirmed deleting one spot, but the ticket holds another one by
 * now (booked in a second tab): nothing was released.
 */
export class SpotChangedError extends Error {}
/**
 * Booking stopped being open while the claim was waiting for its lock: the
 * claim was undone, so the switch to Staging does not leave one booking behind.
 */
export class BookingClosedError extends Error {}
/** The guest was checked in at the spot: releasing or moving it is for the crew only. */
export class CheckedInError extends Error {
	constructor() {
		super(CHECKED_IN_NOTE);
		this.name = 'CheckedInError';
	}
}

/**
 * Why PocketBase refused a swap (pb_hooks/lib/swap.js REFUSALS): the request
 * isn't open any more, ran out, booking or swaps are closed, a spot changed
 * hands, a spot can't be swapped, or it isn't addressed to this ticket.
 */
export type SwapRefusal = 'answered' | 'expired' | 'closed' | 'moved' | 'fixed' | 'mismatch';
const SWAP_REFUSALS: readonly string[] = [
	'answered',
	'expired',
	'closed',
	'moved',
	'fixed',
	'mismatch'
];

/** PocketBase refused the swap; nothing changed. */
export class SwapRefusedError extends Error {
	constructor(public reason: SwapRefusal) {
		super(`swap refused: ${reason}`);
		this.name = 'SwapRefusedError';
	}
}

/**
 * What a check-in (or its undo) found and did:
 * - checkedin: checked in just now
 * - already: checked in before; nothing changed
 * - undone: the check-in was taken back, the booking stays
 * - booked: holds a spot but isn't checked in; nothing to undo
 * - nospot: the ticket holds no spot, so there is nothing to check in
 */
export interface CheckInOutcome {
	status: 'checkedin' | 'already' | 'undone' | 'booked' | 'nospot';
	/** The ticket's spot after the step (null for nospot). */
	bed: BedsResponse | null;
}

// In-process async locks: chain concurrent operations on the same key so a
// "read, check, write" sequence is atomic with respect to other requests of
// this server process. Keys are per ticket (order) and per bed:
// - per bed: two guests can't both claim the same free bed;
// - per order: one ticket can't grab several beds with parallel requests
//   (each ticket code is exactly one booking).
// Order lock is always taken before the bed lock, so they can't deadlock.
// A request group's steps (src/lib/server/request-groups.ts) run under
// `group:<id>`, taken before both: group → order → bed, everywhere.
// Not re-entrant: never take the same key twice in one call chain.
const locks = new Map<string, Promise<unknown>>();

export function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
	const prior = locks.get(key) ?? Promise.resolve();
	const run = prior.then(fn, fn);
	const tail = run.catch(() => {});
	locks.set(key, tail);
	// Once the last holder is done the key goes, so the map only holds keys in
	// use: ids come from guests' forms, and kept keys would add up for good.
	void tail.then(() => {
		if (locks.get(key) === tail) locks.delete(key);
	});
	return run;
}

/** How many keys are held or waited for right now (tests). */
export function lockCount(): number {
	return locks.size;
}

/** Several locks, taken in the order given. */
export function withLocks<T>(keys: string[], fn: () => Promise<T>): Promise<T> {
	return keys.reduceRight<() => Promise<T>>((inner, key) => () => withLock(key, inner), fn)();
}

/**
 * The locks of these spots, sorted: the admin's spot actions take the same
 * ones, so a release or check-in and a 🔒/♿/bed-type change never write one
 * spot at the same time (PocketBase saves the whole record, the later write
 * would undo the other). Taken inside the ticket's lock, like everywhere.
 */
function withBedLocks<T>(bedIds: string[], fn: () => Promise<T>): Promise<T> {
	return withLocks(
		[...new Set(bedIds)].sort().map((id) => `bed:${id}`),
		fn
	);
}

function isNotFound(err: unknown): boolean {
	return (err as ClientResponseError | undefined)?.status === 404;
}

/**
 * Whether a guest may book this bed at all (independent of occupancy).
 * Locked spots and special-needs spots are for the crew to hand out: guests
 * see both as "Blocked by admin".
 * @param options.allowLocked a crew ticket ($lib/server/crew-ticket) or the crew on /admin/requests may book a locked 🔒 spot
 * @param options.allowSpecial only the crew's request flow books a ♿ spot
 *   (assignSpot, src/lib/server/special-requests.ts) — on the guest pages it
 *   stays closed for admins with a ticket too, so it is still free when a
 *   request needs it.
 */
export function isBedBookable(
	bed: Pick<BedsResponse, 'enabled' | 'is_locked'> & { is_special?: boolean },
	options: { allowLocked?: boolean; allowSpecial?: boolean } = {}
): boolean {
	if (bed.enabled === false) return false;
	if (bed.is_locked && !options.allowLocked) return false;
	if (bed.is_special && !options.allowSpecial) return false;
	return true;
}

// A burner name for a booking made without one, from the same list the
// slot machine in the browser rolls through ($lib/burner-names).
export { randomBurnerName } from '$lib/burner-names';

/**
 * Service for managing bed bookings and orders on the playa.
 * Handles order lookups, bed assignments, spot releases and the check-in at
 * arrival. Usually built with the app's service account; the check-in
 * methods run on the signed-in admin's own connection instead (see checkIn).
 */
export class BookingService {
	constructor(private adminPb: TypedPocketBase) {}

	/**
	 * Resolves an order by its ticket code, migrating legacy orders to `order_hash`.
	 * @param orderNumber The unique booking code/order number provided by the user.
	 * @returns The order record, or null if no order has this code.
	 * @throws on infrastructure errors (PocketBase unreachable, service account
	 *   not authenticated, …) — those must not look like "code not found".
	 */
	async getOrderByNumber(orderNumber: string): Promise<OrdersResponse | null> {
		if (!orderNumber) return null;

		// Never log the code itself: it is the guest's bearer secret.
		const orderHash = createLookupHash(orderNumber);

		try {
			// 1. Secure lookup by hash
			return await this.adminPb
				.collection('orders')
				.getFirstListItem<OrdersResponse>(
					this.adminPb.filter('order_hash = {:orderHash}', { orderHash })
				);
		} catch (err) {
			if (!isNotFound(err)) throw err;
		}

		try {
			// 2. Legacy orders imported with only a plain order_number (or hashed
			//    with a previous ENCRYPTION_KEY)
			const order = await this.adminPb
				.collection('orders')
				.getFirstListItem<OrdersResponse>(
					this.adminPb.filter('order_number = {:orderNumber}', { orderNumber })
				);

			// 3. Auto-migrate to the hash lookup
			await this.adminPb
				.collection('orders')
				.update(order.id, { order_hash: orderHash })
				.catch((e) => {
					console.error(
						`[BookingService] Hash migration failed for order ${order.id}: ${e.message}`
					);
				});
			return order;
		} catch (err) {
			if (isNotFound(err)) return null;
			throw err;
		}
	}

	/**
	 * Finds the bed currently booked for a specific order.
	 * @param orderId The ID of the order to check.
	 * @returns The bed record if one exists for this order, or null.
	 */
	async getBedForOrder(orderId: string): Promise<BedsResponse | null> {
		try {
			return await this.adminPb
				.collection('beds')
				.getFirstListItem<BedsResponse>(this.adminPb.filter('order = {:orderId}', { orderId }));
		} catch (err) {
			if (isNotFound(err)) return null;
			throw err;
		}
	}

	/**
	 * Books a bed for an order. An order holds at most one bed: booking another
	 * bed moves the booking.
	 * @param order The order record of the user making the booking.
	 * @param bedId The ID of the bed to be claimed.
	 * @param guestName The burner name chosen by the user.
	 * @param options.allowLocked Locked beds too: a crew ticket ($lib/server/crew-ticket), or the crew booking for a request.
	 * @param options.allowSpecial Only the crew's request flow books ♿ beds
	 *   (special-needs spots).
	 * @param options.allowCheckedIn The crew may move a guest who is checked in
	 *   already; the check-in moves along to the new spot.
	 * @param options.requireLivePhase A guest's own booking: booking has to
	 *   still be open once the claim is through. The crew books in any phase.
	 * @throws {BedUnavailableError} if the bed is taken, locked, or deactivated.
	 * @throws {CheckedInError} if the ticket's current spot is checked in and
	 *   `allowCheckedIn` isn't set.
	 * @throws {BookingClosedError} if `requireLivePhase` is set and booking is
	 *   not open when PocketBase writes the booking; nothing changed.
	 */
	async bookBed(
		order: OrdersResponse,
		bedId: string,
		guestName: string,
		options: {
			allowLocked?: boolean;
			allowSpecial?: boolean;
			allowCheckedIn?: boolean;
			requireLivePhase?: boolean;
		} = {}
	): Promise<void> {
		await withLock(`order:${order.id}`, () =>
			withLock(`bed:${bedId}`, async () => {
				// Authoritative availability check, re-read fresh inside the locks so
				// it's atomic with the writes below.
				const bed = await this.adminPb.collection('beds').getOne<BedsResponse>(bedId);
				if (bed.occupied && bed.order !== order.id) {
					throw new BedUnavailableError('This spot is already claimed.');
				}
				// Availability is about claiming a spot. Renaming the one the ticket
				// already holds stays possible, e.g. a special-needs spot the crew
				// booked for the guest.
				const renaming = bed.order === order.id;
				if (!renaming && !isBedBookable(bed, options)) {
					throw new BedUnavailableError('This spot is not available.');
				}
				// A spot another guest started booking is theirs for a few minutes
				// ($lib/server/spot-holds). Only a guest's own booking waits for
				// that; the crew books past it.
				if (!renaming && options.requireLivePhase && heldByOther(bedId, order.id)) {
					throw new BedUnavailableError(HELD_MESSAGE);
				}

				// The ticket's other spots, released below once the new one is claimed.
				const previousBeds = await this.adminPb.collection('beds').getFullList<BedsResponse>({
					filter: this.adminPb.filter('order = {:orderId} && id != {:bedId}', {
						orderId: order.id,
						bedId
					})
				});
				// A guest who has arrived keeps their spot: only the crew moves them,
				// and then the check-in comes along in the same write (PocketBase
				// drops a check-in whose booking changes, pb_hooks/lib/booked.js).
				const arrived = previousBeds.find((prev) => !!prev.checked_in_at);
				if (arrived && !options.allowCheckedIn) throw new CheckedInError();

				// Release, claim and name in ONE PocketBase transaction
				// (pb_hooks/lib/book.js): a crash or a failed write never leaves the
				// ticket with two spots, none, or a spot without its name. PocketBase
				// checks again, with the phase as it is at that moment: switching back
				// to Staging writes app_settings first and releases the bookings right
				// after (src/routes/admin/+page.server.ts), so a guest who waited here
				// can't slip a booking in behind the release. A new name for the spot
				// the ticket already holds is no claim and works in every phase but
				// Closed (the route refuses that).
				let outcome: BookOutcome;
				try {
					outcome = await this.adminPb.send<BookOutcome>('/api/cozy/book', {
						method: 'POST',
						body: {
							order: order.id,
							bed: bedId,
							name: encrypt(guestName),
							requireLive: !!options.requireLivePhase,
							allowLocked: !!options.allowLocked,
							allowSpecial: !!options.allowSpecial,
							allowCheckedIn: !!options.allowCheckedIn
						},
						requestKey: null
					});
				} catch (err) {
					const refused = (err as ClientResponseError | undefined)?.response as
						BookOutcome | undefined;
					if ((err as ClientResponseError)?.status !== 409 || !refused?.reason) throw err;
					outcome = refused;
				}
				if (outcome.ok) {
					// Booked: the ticket's hold, and any hold on this spot, are done.
					settleHolds(order.id, bedId);
					return;
				}
				switch (outcome.reason) {
					case 'closed':
						throw new BookingClosedError(bookingRefusal(outcome.phase ?? 'staging'));
					case 'checked_in':
						throw new CheckedInError();
					case 'gone':
						throw Object.assign(new Error('This spot or ticket does not exist.'), { status: 404 });
					case 'taken':
						throw new BedUnavailableError('This spot is already claimed.');
					default:
						throw new BedUnavailableError('This spot is not available.');
				}
			})
		);
	}

	/**
	 * Swaps two guests' spots for a swap request the other guest said yes to.
	 * PocketBase does it in one transaction (POST /api/cozy/swap,
	 * pb_hooks/lib/swap.js): both spots change tickets, the request becomes
	 * accepted and every other open request about either spot or ticket ends,
	 * after PocketBase's own last checks. This runs in both tickets' and both
	 * spots' queues, so no booking, move or release of either guest can run
	 * in between. The locks are taken tickets first, then spots, each sorted —
	 * the same order everywhere, so two swaps never wait on each other.
	 * @throws {SwapRefusedError} when PocketBase refused it; nothing changed
	 */
	async swapSpots(
		request: Pick<SwapRequestsResponse, 'id' | 'from_order' | 'to_order' | 'from_bed' | 'to_bed'>
	): Promise<void> {
		const keys = [
			...[request.from_order, request.to_order].map((id) => `order:${id}`).sort(),
			...[request.from_bed, request.to_bed].map((id) => `bed:${id}`).sort()
		];
		await withLocks(keys, async () => {
			try {
				await this.adminPb.send('/api/cozy/swap', {
					method: 'POST',
					body: { request: request.id, order: request.to_order },
					requestKey: null
				});
			} catch (err) {
				const refused = err as ClientResponseError | undefined;
				const reason = refused?.response?.reason;
				if (refused?.status === 409 && SWAP_REFUSALS.includes(reason)) {
					throw new SwapRefusedError(reason as SwapRefusal);
				}
				throw err;
			}
		});
	}

	/**
	 * Releases all spots for an order.
	 * @param orderId The ID of the order to release spots for.
	 * @param options.allowCheckedIn The crew may release a spot whose guest is
	 *   checked in; guests can't.
	 * @param options.onlyBed The spot the guest confirmed giving up (✨ Leave No Trace).
	 *   If the ticket holds another one, nothing is released.
	 * @returns How many spots were released (0: the ticket held none).
	 * @throws {CheckedInError} if a spot is checked in and `allowCheckedIn` isn't set.
	 * @throws {SpotChangedError} if the ticket holds a spot other than `onlyBed`.
	 */
	async unbookOrder(
		orderId: string,
		options: { allowCheckedIn?: boolean; onlyBed?: string } = {}
	): Promise<number> {
		return withLock(`order:${orderId}`, async () => {
			const beds = await this.adminPb.collection('beds').getFullList<BedsResponse>({
				filter: this.adminPb.filter('order = {:orderId}', { orderId })
			});
			// Both checks run under the order lock, so neither a check-in nor a
			// booking made in a second tab can slip in before the release.
			if (!options.allowCheckedIn && beds.some((bed) => !!bed.checked_in_at)) {
				throw new CheckedInError();
			}
			if (options.onlyBed && beds.some((bed) => bed.id !== options.onlyBed)) {
				throw new SpotChangedError(
					'Your ticket holds a different spot by now (changed in another tab?), so nothing was deleted. Reload the page and check your spot.'
				);
			}

			await withBedLocks(
				beds.map((bed) => bed.id),
				async () => {
					for (const bed of beds) {
						await this.adminPb.collection('beds').update(bed.id, { occupied: false, order: null });
					}
				}
			);
			return beds.length;
		});
	}

	/**
	 * Checks the ticket's guest in at the spot it holds: the crew, at arrival.
	 * Build the service with the signed-in admin's own connection (locals.pb)
	 * for this: PocketBase lets only approved admins and superusers write beds,
	 * so no guest session could ever check anybody in. Runs in the ticket's
	 * queue, so a check-in and a release or move can't cross. A second check-in
	 * changes nothing and reports the first one.
	 * @param by The admin's e-mail, stored as checked_in_by.
	 */
	async checkIn(orderId: string, by: string): Promise<CheckInOutcome> {
		return withLock(`order:${orderId}`, async () => {
			const bed = await this.getBedForOrder(orderId);
			if (!bed) return { status: 'nospot', bed: null };
			if (bed.checked_in_at) return { status: 'already', bed };
			const updated = await withBedLocks([bed.id], () =>
				this.adminPb.collection('beds').update<BedsResponse>(bed.id, {
					checked_in_at: new Date().toISOString(),
					checked_in_by: by
				})
			);
			return { status: 'checkedin', bed: updated };
		});
	}

	/**
	 * Takes a check-in back (a mistake at the desk); the booking stays. Same
	 * connection as checkIn.
	 */
	async undoCheckIn(orderId: string): Promise<CheckInOutcome> {
		return withLock(`order:${orderId}`, async () => {
			const bed = await this.getBedForOrder(orderId);
			if (!bed) return { status: 'nospot', bed: null };
			if (!bed.checked_in_at) return { status: 'booked', bed };
			const updated = await withBedLocks([bed.id], () =>
				this.adminPb
					.collection('beds')
					.update<BedsResponse>(bed.id, { checked_in_at: '', checked_in_by: '' })
			);
			return { status: 'undone', bed: updated };
		});
	}

	/**
	 * Forgets the ticket's check-in when the ticket goes to a new holder: they
	 * check in with their own, new pass. The spot stays booked.
	 * @returns whether the ticket was checked in
	 */
	async resetCheckIn(orderId: string): Promise<boolean> {
		return withLock(`order:${orderId}`, async () => {
			const beds = await this.adminPb.collection('beds').getFullList<BedsResponse>({
				filter: this.adminPb.filter('order = {:orderId} && checked_in_at != ""', { orderId })
			});
			await withBedLocks(
				beds.map((bed) => bed.id),
				async () => {
					for (const bed of beds) {
						await this.adminPb
							.collection('beds')
							.update(bed.id, { checked_in_at: '', checked_in_by: '' });
					}
				}
			);
			return beds.length > 0;
		});
	}
}
