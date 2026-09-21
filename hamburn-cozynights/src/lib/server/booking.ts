import type { ClientResponseError } from 'pocketbase';
import type { TypedPocketBase, OrdersResponse, BedsResponse } from '$lib/pocketbase-types';
import { createLookupHash, encrypt } from '$lib/server/crypto';
import { CHECKED_IN_NOTE } from '$lib/check-in';
import { APP_SETTINGS_ID } from '$lib/server/constants';
import {
	bookingRefusal,
	effectivePhase,
	windowFromRecord,
	type BookingPhase
} from '$lib/booking-phase';

/**
 * Thrown when a bed can no longer be booked (already taken by someone else,
 * locked, or deactivated). Distinguishes expected booking-conflict outcomes
 * from real infrastructure/DB errors so callers can show the right message.
 */
export class BedUnavailableError extends Error {}
/** The new spot was claimed, but the previous one could not be released: the claim was undone. */
export class ReleaseFailedError extends Error {}
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
const locks = new Map<string, Promise<unknown>>();

function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
	const prior = locks.get(key) ?? Promise.resolve();
	const run = prior.then(fn, fn);
	// Key space is bounded by the number of beds and orders, so entries are
	// simply overwritten on reuse rather than explicitly cleaned up.
	locks.set(
		key,
		run.catch(() => {})
	);
	return run;
}

function isNotFound(err: unknown): boolean {
	return (err as ClientResponseError | undefined)?.status === 404;
}

/**
 * Whether a guest may book this bed at all (independent of occupancy).
 * Locked spots and special-needs spots are for the crew to hand out: guests
 * see both as "Reserved by the crew".
 */
export function isBedBookable(
	bed: Pick<BedsResponse, 'enabled' | 'is_locked'> & { is_special?: boolean },
	options: { allowLocked?: boolean } = {}
): boolean {
	if (bed.enabled === false) return false;
	if ((bed.is_locked || bed.is_special) && !options.allowLocked) return false;
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
	 * The booking phase straight from app_settings, or null when the record
	 * can't be read. Deliberately not getBookingSettings: that answers
	 * "staging" for a failed read, and a database hiccup must never undo a
	 * booking that is perfectly fine. Only a phase it actually read counts.
	 */
	private async readPhase(): Promise<BookingPhase | null> {
		try {
			const settings = await this.adminPb
				.collection('app_settings')
				// requestKey null: a parallel booking reads this too, never cancel it.
				.getOne(APP_SETTINGS_ID, { requestKey: null });
			return effectivePhase(windowFromRecord(settings));
		} catch (err) {
			console.error(
				'[Booking] Could not re-read the booking phase after the claim, letting it stand:',
				(err as Error)?.message
			);
			return null;
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
	 * @param options.allowLocked Admins may book beds that are locked for guests
	 *   (locked or special-needs spots).
	 * @param options.allowCheckedIn The crew may move a guest who is checked in
	 *   already; the check-in moves along to the new spot.
	 * @param options.requireLivePhase A guest's own booking: booking has to
	 *   still be open once the claim is through. The crew books in any phase.
	 * @throws {BedUnavailableError} if the bed is taken, locked, or deactivated.
	 * @throws {CheckedInError} if the ticket's current spot is checked in and
	 *   `allowCheckedIn` isn't set.
	 * @throws {BookingClosedError} if `requireLivePhase` is set and booking is
	 *   no longer open; the claim is undone first.
	 */
	async bookBed(
		order: OrdersResponse,
		bedId: string,
		guestName: string,
		options: { allowLocked?: boolean; allowCheckedIn?: boolean; requireLivePhase?: boolean } = {}
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
				if (bed.order !== order.id && !isBedBookable(bed, options)) {
					throw new BedUnavailableError('This spot is not available.');
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

				// Claim the new spot first: if that fails, the guest keeps the old one.
				await this.adminPb.collection('beds').update(bedId, {
					occupied: true,
					order: order.id,
					...(arrived
						? { checked_in_at: arrived.checked_in_at, checked_in_by: arrived.checked_in_by ?? '' }
						: {})
				});

				// The route checked the phase before this request queued up behind
				// the locks. Switching back to Staging writes app_settings first and
				// releases the bookings right after (src/routes/admin/+page.server.ts),
				// so a guest who was waiting here could otherwise slip a booking in
				// behind the release and keep it in an empty camp.
				if (options.requireLivePhase) {
					const phase = await this.readPhase();
					if (phase && phase !== 'live') {
						await this.adminPb
							.collection('beds')
							.update(bedId, { occupied: false, order: null })
							.catch((undoErr) =>
								console.error(
									`[Booking] Booking closed mid-claim and undoing spot ${bedId} of order ${order.id} failed too — it may still look booked:`,
									(undoErr as Error)?.message
								)
							);
						throw new BookingClosedError(bookingRefusal(phase));
					}
				}

				await this.adminPb.collection('orders').update(order.id, {
					burner_name: encrypt(guestName)
				});

				// Release any other bed of this order. If that fails, the ticket
				// would hold two beds: undo the new claim instead, so the guest
				// keeps the old spot and nothing has changed.
				try {
					for (const prevBed of previousBeds) {
						await this.adminPb
							.collection('beds')
							.update(prevBed.id, { occupied: false, order: null });
					}
				} catch (err) {
					console.error(
						`[Booking] Could not release the previous spot of order ${order.id}, undoing the new claim:`,
						(err as Error)?.message
					);
					await this.adminPb
						.collection('beds')
						.update(bedId, { occupied: false, order: null })
						.catch((undoErr) =>
							console.error(
								`[Booking] Undo failed too — order ${order.id} may hold two spots (${bedId} and ${previousBeds.map((b) => b.id).join(', ')}):`,
								(undoErr as Error)?.message
							)
						);
					throw new ReleaseFailedError(
						'Your previous spot could not be released, so nothing was changed. Try again in a moment.'
					);
				}
			})
		);
	}

	/**
	 * Releases all spots for an order.
	 * @param orderId The ID of the order to release spots for.
	 * @param options.allowCheckedIn The crew may release a spot whose guest is
	 *   checked in; guests can't.
	 * @param options.onlyBed The spot the guest confirmed deleting (the ☢ nuke).
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

			for (const bed of beds) {
				await this.adminPb.collection('beds').update(bed.id, { occupied: false, order: null });
			}
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
			const updated = await this.adminPb.collection('beds').update<BedsResponse>(bed.id, {
				checked_in_at: new Date().toISOString(),
				checked_in_by: by
			});
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
			const updated = await this.adminPb
				.collection('beds')
				.update<BedsResponse>(bed.id, { checked_in_at: '', checked_in_by: '' });
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
			for (const bed of beds) {
				await this.adminPb
					.collection('beds')
					.update(bed.id, { checked_in_at: '', checked_in_by: '' });
			}
			return beds.length > 0;
		});
	}
}
