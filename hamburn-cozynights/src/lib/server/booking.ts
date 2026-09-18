import type { ClientResponseError } from 'pocketbase';
import type { TypedPocketBase, OrdersResponse, BedsResponse } from '$lib/pocketbase-types';
import { createLookupHash, encrypt } from '$lib/server/crypto';

/**
 * Thrown when a bed can no longer be booked (already taken by someone else,
 * locked, or deactivated). Distinguishes expected booking-conflict outcomes
 * from real infrastructure/DB errors so callers can show the right message.
 */
export class BedUnavailableError extends Error {}
/** The new spot was claimed, but the previous one could not be released: the claim was undone. */
export class ReleaseFailedError extends Error {}

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

const BURNER_NAMES = [
	'Dusty Nomad',
	'Neon Shaman',
	'Sparkle Pony',
	'Fire Weaver',
	'LED Lizard',
	'Gifting Goblin',
	'Moop Master',
	'Temple Guardian',
	'Solar Sprite',
	'Disco Druid',
	'Radical Robot',
	'Dust Bunny',
	'Prism Pilot',
	'Bass Beast',
	'Infinite Improviser'
];

/** A burner name for a booking made without one, e.g. "Disco Druid #417". */
export function randomBurnerName(): string {
	const name = BURNER_NAMES[Math.floor(Math.random() * BURNER_NAMES.length)];
	return `${name} #${Math.floor(100 + Math.random() * 900)}`;
}

/**
 * Service for managing bed bookings and orders on the playa.
 * Handles order lookups, bed assignments, and spot releases.
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
	 * @param options.allowLocked Admins may book beds that are locked for guests
	 *   (locked or special-needs spots).
	 * @throws {BedUnavailableError} if the bed is taken, locked, or deactivated.
	 */
	async bookBed(
		order: OrdersResponse,
		bedId: string,
		guestName: string,
		options: { allowLocked?: boolean } = {}
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

				// Claim the new spot first: if that fails, the guest keeps the old one.
				await this.adminPb.collection('beds').update(bedId, {
					occupied: true,
					order: order.id
				});

				await this.adminPb.collection('orders').update(order.id, {
					burner_name: encrypt(guestName)
				});

				// Release any other bed of this order. If that fails, the ticket
				// would hold two beds: undo the new claim instead, so the guest
				// keeps the old spot and nothing has changed.
				const previousBeds = await this.adminPb.collection('beds').getFullList({
					filter: this.adminPb.filter('order = {:orderId} && id != {:bedId}', {
						orderId: order.id,
						bedId
					})
				});
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
	 */
	async unbookOrder(orderId: string): Promise<void> {
		await withLock(`order:${orderId}`, async () => {
			const beds = await this.adminPb.collection('beds').getFullList({
				filter: this.adminPb.filter('order = {:orderId}', { orderId })
			});

			for (const bed of beds) {
				await this.adminPb.collection('beds').update(bed.id, { occupied: false, order: null });
			}
		});
	}
}
