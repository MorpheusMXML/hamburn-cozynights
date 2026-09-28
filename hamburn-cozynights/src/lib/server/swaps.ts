// src/lib/server/swaps.ts
/**
 * Swap requests against PocketBase (collection swap_requests,
 * docs/admin/swaps.md). During Live Booking a guest who holds a spot asks
 * the guest of another, taken spot to trade; nothing moves until that guest
 * says yes, and then both spots change hands at once (BookingService.swapSpots,
 * pb_hooks/lib/swap.js). The rules for the pages are in $lib/swaps.
 *
 * Privacy:
 * - The note may say why ("my knees…"): it is stored encrypted and only
 *   decrypted here, for the two guests' own pages. It never goes into a
 *   message, a log or the audit log, and the crew doesn't see it.
 * - Every taken spot offers a swap, so the room page never shows which ones
 *   are special. A request to a spot that can't be swapped (🔒, ♿,
 *   deactivated, picked by the crew, checked in) or to a guest who paused
 *   swap requests is stored `quiet`: never shown to that guest nor sent to
 *   them, and it runs out like an unanswered request. The asker can't tell
 *   the difference.
 * - Nobody learns a ticket code, a name from the ticket list or an address:
 *   guests see each other's burner names, as on the room pages.
 */
import type { ClientResponseError } from 'pocketbase';
import type {
	BedsResponse,
	HousesResponse,
	OrdersResponse,
	RoomsResponse,
	SwapRequestsResponse,
	TypedPocketBase
} from '$lib/pocketbase-types';
import { APP_SETTINGS_ID } from '$lib/server/constants';
import { BookingService, isBedBookable, SwapRefusedError } from '$lib/server/booking';
import { decrypt, encrypt } from '$lib/server/crypto';
import { bedRow, burnerNameOf, roomLabel } from '$lib/server/pass';
import { isSpotFixed } from '$lib/server/special-requests';
import type { BookingSettings } from '$lib/server/settings';
import { CHECKED_IN_NOTE } from '$lib/check-in';
import { levelOf } from '$lib/bunks';
import {
	SWAP_DAILY_MAX,
	SWAP_HOURS,
	SWAP_OPEN_MAX,
	cleanSwapNote,
	swapNoteProblem,
	swapVibe,
	type SwapEnd,
	type SwapPause,
	type SwapSpot,
	type SwapStatus,
	type SwapView
} from '$lib/swaps';

/** A step the swap flow doesn't allow. `message` is written for the guest who clicked. */
export class SwapError extends Error {
	constructor(
		message: string,
		public status = 409
	) {
		super(message);
		this.name = 'SwapError';
	}
}

type BedWithRoom = BedsResponse<{
	room?: RoomsResponse<{ house?: HousesResponse }>;
	bunk_partner?: BedsResponse;
}>;
type SwapRecord = SwapRequestsResponse<{
	from_order?: OrdersResponse;
	to_order?: OrdersResponse;
	from_bed?: BedWithRoom;
	to_bed?: BedWithRoom;
}>;

const DAY_MS = 24 * 60 * 60 * 1000;
const BED_EXPAND = 'room.house,bunk_partner';
const SWAP_EXPAND =
	'from_order,to_order,from_bed.room.house,from_bed.bunk_partner,to_bed.room.house,to_bed.bunk_partner';

const REFUSED: Record<string, string> = {
	answered: 'This request isn’t open any more.',
	expired: 'This request just ran out.',
	closed: 'Swaps only happen while booking is open.',
	moved: 'This swap isn’t possible any more: one of the spots changed hands.',
	// Never which spot, nor why: that could say something about the other guest.
	fixed: 'This swap isn’t possible any more. Nothing changed.',
	mismatch: 'This request isn’t addressed to you.'
};

function isNotFound(err: unknown): boolean {
	return (err as ClientResponseError | undefined)?.status === 404;
}

const toMs = (value: string | undefined) => Date.parse(String(value || '').replace(' ', 'T')) || 0;

/** Decrypts a stored secret; an unreadable one (other ENCRYPTION_KEY) reads as "". */
function readSecret(value: string | undefined | null): string {
	if (!value) return '';
	try {
		return decrypt(value);
	} catch {
		return '';
	}
}

/** Why nobody can ask or say yes right now: '' while booking is open and swaps are on. */
export function swapPause(settings: Pick<BookingSettings, 'phase' | 'swapsOff'>): SwapPause {
	if (settings.phase !== 'live') return 'closed';
	return settings.swapsOff ? 'off' : '';
}

function pauseMessage(pause: SwapPause): string {
	return pause === 'off'
		? 'The crew paused swaps for a moment. Try again a little later.'
		: 'Swaps only happen while booking is open.';
}

/** A spot as the swap pages show it. */
export function toSwapSpot(bed: BedWithRoom | undefined | null): SwapSpot {
	if (!bed) return { bedId: '', roomId: '', spot: '', room: '', house: '', label: '', bed: '' };
	const room = bed.expand?.room;
	const roomName = room ? roomLabel(room) : '';
	const house = room?.expand?.house?.name ?? '';
	return {
		bedId: bed.id,
		roomId: bed.room,
		spot: bed.label ?? '',
		room: roomName,
		house,
		label: [bed.label, roomName, house].filter(Boolean).join(' · '),
		bed: bedRow(bed.bed_type, levelOf(bed), bed.expand?.bunk_partner?.label)
	};
}

/**
 * Why a guest can't offer their own spot in a swap, in their words; '' when
 * they can. It is their own spot, so saying why is fine.
 */
async function ownSpotProblem(
	adminPb: TypedPocketBase,
	orderId: string,
	bed: BedsResponse
): Promise<string> {
	if (bed.checked_in_at) return CHECKED_IN_NOTE;
	if (await isSpotFixed(adminPb, orderId, bed.id)) {
		return 'The crew picked your spot for you, so only the crew can change it.';
	}
	if (!isBedBookable(bed)) {
		return 'The crew set your spot aside for you, so it can’t be swapped. Please ask the crew.';
	}
	return '';
}

/** Whether the spot a guest holds could change hands (the other side of a request; never told). */
async function spotSwappable(
	adminPb: TypedPocketBase,
	orderId: string,
	bed: BedsResponse
): Promise<boolean> {
	if (bed.checked_in_at || !isBedBookable(bed)) return false;
	return !(await isSpotFixed(adminPb, orderId, bed.id));
}

async function requestsOf(
	adminPb: TypedPocketBase,
	side: 'from_order' | 'to_order',
	orderId: string
): Promise<SwapRecord[]> {
	return adminPb.collection('swap_requests').getFullList<SwapRecord>({
		filter: adminPb.filter(`${side} = {:orderId}`, { orderId }),
		expand: SWAP_EXPAND,
		sort: '-created',
		requestKey: null
	});
}

/**
 * Brings open requests up to date: ran out → expired; a spot that changed
 * hands → void. Only what anybody can see anyway ends a request here — the
 * other guest's spot turning special keeps it waiting (quietly) until it runs
 * out. Writes are best effort: the next look tries again.
 */
async function settle(adminPb: TypedPocketBase, rows: SwapRecord[], now: number): Promise<void> {
	for (const row of rows) {
		if (row.status !== 'pending') continue;
		let change: { status: SwapStatus; ended?: SwapEnd } | null = null;
		const fromBed = row.expand?.from_bed;
		const toBed = row.expand?.to_bed;
		if (toMs(row.expires_at) <= now) change = { status: 'expired' };
		else if (!fromBed || fromBed.order !== row.from_order) {
			change = { status: 'void', ended: 'yours_moved' };
		} else if (!toBed || toBed.order !== row.to_order) change = { status: 'void', ended: 'moved' };
		else if (fromBed.checked_in_at || !isBedBookable(fromBed)) {
			change = { status: 'void', ended: 'yours_fixed' };
		}
		if (!change) continue;
		Object.assign(row, change);
		row.answered_at = new Date(now).toISOString();
		await adminPb
			.collection('swap_requests')
			.update(row.id, { ...change, answered_at: row.answered_at, notify_due: '' })
			.catch((err) => console.error('[Swaps] Could not close a request:', (err as Error)?.message));
	}
}

function isOpen(row: SwapRequestsResponse, now: number): boolean {
	return row.status === 'pending' && toMs(row.expires_at) > now;
}

function toView(row: SwapRecord, direction: 'in' | 'out'): SwapView {
	const incoming = direction === 'in';
	const other = incoming ? row.expand?.from_order : row.expand?.to_order;
	return {
		id: row.id,
		direction,
		status: row.status as SwapStatus,
		ended: (row.ended || '') as SwapEnd,
		name: other ? burnerNameOf(other) : '',
		vibe: swapVibe(row.vibe)?.value ?? '',
		note: readSecret(row.note),
		mine: toSwapSpot(incoming ? row.expand?.to_bed : row.expand?.from_bed),
		other: toSwapSpot(incoming ? row.expand?.from_bed : row.expand?.to_bed),
		createdAt: row.created,
		expiresAt: row.expires_at,
		answeredAt: row.answered_at || ''
	};
}

export interface SwapInput {
	vibe: unknown;
	note: unknown;
}

/**
 * Asks the guest of `targetBedId` to swap with this ticket's spot. The ticket
 * comes from the guest's session, never from the form.
 * @returns the new request's id
 * @throws {SwapError} with a message for the guest
 */
export async function askForSwap(
	adminPb: TypedPocketBase,
	settings: Pick<BookingSettings, 'phase' | 'swapsOff'>,
	order: Pick<OrdersResponse, 'id'>,
	targetBedId: string,
	input: SwapInput
): Promise<string> {
	const pause = swapPause(settings);
	if (pause) throw new SwapError(pauseMessage(pause), 403);
	const note = cleanSwapNote(input.note);
	const noteProblem = swapNoteProblem(note);
	if (noteProblem) throw new SwapError(noteProblem, 400);
	const vibe = swapVibe(input.vibe)?.value ?? '';

	const myBed = await new BookingService(adminPb).getBedForOrder(order.id);
	if (!myBed) throw new SwapError('Book a spot first: a swap trades your spot for theirs.');
	const own = await ownSpotProblem(adminPb, order.id, myBed);
	if (own) throw new SwapError(own);

	let target: BedsResponse;
	try {
		target = await adminPb.collection('beds').getOne<BedsResponse>(targetBedId);
	} catch (err) {
		if (isNotFound(err)) throw new SwapError('This spot doesn’t exist any more.', 404);
		throw err;
	}
	if (target.id === myBed.id || target.order === order.id) {
		throw new SwapError('That’s your own spot.', 400);
	}
	if (!target.order) {
		throw new SwapError(
			'This spot is free right now: no need to ask anyone. Release yours, then book it.'
		);
	}

	const now = Date.now();
	const mine = await requestsOf(adminPb, 'from_order', order.id);
	await settle(adminPb, mine, now);
	const open = mine.filter((row) => isOpen(row, now));
	if (open.some((row) => row.to_bed === target.id)) {
		throw new SwapError('You asked for this spot already. Your request is waiting for an answer.');
	}
	if (open.length >= SWAP_OPEN_MAX) {
		throw new SwapError(
			`You have ${SWAP_OPEN_MAX} open swap requests. Wait for an answer, or take one back first.`
		);
	}
	if (mine.filter((row) => now - toMs(row.created) < DAY_MS).length >= SWAP_DAILY_MAX) {
		throw new SwapError(
			`That’s ${SWAP_DAILY_MAX} swap requests within a day. Take a breath and try again tomorrow.`,
			429
		);
	}
	if (
		mine.some(
			(row) =>
				row.status === 'declined' && row.to_order === target.order && row.to_bed === target.id
		)
	) {
		throw new SwapError('They said no to this swap already. Maybe another spot?');
	}

	// Asked of a spot that can't be swapped, or of a guest who paused swap
	// requests: stored like any other, but never shown or sent to them.
	const holder = await adminPb.collection('orders').getOne<OrdersResponse>(target.order);
	const quiet = !!holder.no_swap_requests || !(await spotSwappable(adminPb, target.order, target));

	const created = await adminPb.collection('swap_requests').create<SwapRequestsResponse>({
		from_order: order.id,
		from_bed: myBed.id,
		to_order: target.order,
		to_bed: target.id,
		status: 'pending',
		vibe,
		note: note ? encrypt(note) : '',
		quiet,
		expires_at: new Date(now + SWAP_HOURS * 60 * 60 * 1000).toISOString(),
		// PocketBase tells the other guest with its next run (pb_hooks/lib/notify.js)
		notify_due: quiet ? '' : new Date(now).toISOString()
	});
	return created.id;
}

/** One of the ticket's own requests: one it sent (out) or one addressed to it (in). */
async function ownRequest(
	adminPb: TypedPocketBase,
	orderId: string,
	id: string,
	direction: 'in' | 'out'
): Promise<SwapRecord> {
	let row: SwapRecord;
	try {
		row = await adminPb.collection('swap_requests').getOne<SwapRecord>(id);
	} catch (err) {
		if (isNotFound(err)) throw new SwapError('This request doesn’t exist any more.', 404);
		throw err;
	}
	const own = direction === 'out' ? row.from_order === orderId : row.to_order === orderId;
	// A quiet request doesn't exist for the guest it names.
	if (!own || (direction === 'in' && row.quiet)) {
		throw new SwapError('This request doesn’t exist any more.', 404);
	}
	return row;
}

/**
 * A yes that PocketBase refused because a spot can't be swapped: when this
 * guest's own spot is fine, the asker's is the one — that request is over
 * (the asker reads "your spot can't be swapped any more"). When it is this
 * guest's own spot, the request just drops off their list and runs out.
 */
async function closeIfTheirs(adminPb: TypedPocketBase, row: SwapRecord): Promise<void> {
	try {
		const myBed = await new BookingService(adminPb).getBedForOrder(row.to_order);
		if (!myBed || !(await spotSwappable(adminPb, row.to_order, myBed))) return;
		await adminPb.collection('swap_requests').update(row.id, {
			status: 'void',
			ended: 'yours_fixed',
			answered_at: new Date().toISOString(),
			notify_due: ''
		});
	} catch (err) {
		console.error('[Swaps] Could not close a refused request:', (err as Error)?.message);
	}
}

/** The asker takes their open request back. */
export async function withdrawSwap(
	adminPb: TypedPocketBase,
	order: Pick<OrdersResponse, 'id'>,
	id: string
): Promise<void> {
	const row = await ownRequest(adminPb, order.id, id, 'out');
	if (row.status !== 'pending') throw new SwapError(REFUSED.answered);
	await adminPb.collection('swap_requests').update(row.id, {
		status: 'withdrawn',
		answered_at: new Date().toISOString(),
		notify_due: ''
	});
}

/**
 * The guest a request is addressed to says no; the asker hears it with the
 * next run. With `pause`, no new swap requests reach this guest from now on
 * (they can switch that back on /swaps).
 */
export async function declineSwap(
	adminPb: TypedPocketBase,
	order: Pick<OrdersResponse, 'id'>,
	id: string,
	options: { pause?: boolean } = {}
): Promise<void> {
	const row = await ownRequest(adminPb, order.id, id, 'in');
	if (row.status !== 'pending') throw new SwapError(REFUSED.answered);
	const now = new Date().toISOString();
	await adminPb
		.collection('swap_requests')
		.update(row.id, { status: 'declined', answered_at: now, notify_due: now });
	if (options.pause) await setSwapPause(adminPb, order, true);
}

/**
 * The guest a request is addressed to says yes: the two spots swap.
 * @returns the guest's new spot and the one they gave away
 * @throws {SwapError} when it can't happen (any more); nothing changed then
 */
export async function acceptSwap(
	adminPb: TypedPocketBase,
	settings: Pick<BookingSettings, 'phase' | 'swapsOff'>,
	order: Pick<OrdersResponse, 'id'>,
	id: string
): Promise<{ gained: SwapSpot; gave: SwapSpot }> {
	const row = await ownRequest(adminPb, order.id, id, 'in');
	if (row.status !== 'pending') throw new SwapError(REFUSED.answered);
	const pause = swapPause(settings);
	if (pause) throw new SwapError(pauseMessage(pause), 403);
	try {
		await new BookingService(adminPb).swapSpots(row);
	} catch (err) {
		if (err instanceof SwapRefusedError) {
			if (err.reason === 'fixed') await closeIfTheirs(adminPb, row);
			throw new SwapError(REFUSED[err.reason] ?? REFUSED.fixed);
		}
		throw err;
	}
	const [gained, gave] = await Promise.all(
		[row.from_bed, row.to_bed].map((bedId) =>
			adminPb
				.collection('beds')
				.getOne<BedWithRoom>(bedId, { expand: BED_EXPAND })
				.then(toSwapSpot)
				.catch(() => toSwapSpot(null))
		)
	);
	return { gained, gave };
}

export interface GuestSwaps {
	/** Open requests addressed to this guest, newest first. */
	incoming: SwapView[];
	/** What this guest asked, open ones first, then the latest outcomes. */
	outgoing: SwapView[];
	/** How many of this guest's own requests are open. */
	openOut: number;
	/** The guest paused swap requests to them. */
	paused: boolean;
}

/** Outcomes of past requests the asker still sees. */
const OUTCOMES_SHOWN = 8;

/**
 * Everything the /swaps page shows the guest: requests for them and their own.
 * A request for them only shows while it can still be answered with a yes:
 * open, not quiet, and their spot is still the one asked for and swappable.
 */
export async function guestSwaps(
	adminPb: TypedPocketBase,
	order: Pick<OrdersResponse, 'id' | 'no_swap_requests'>
): Promise<GuestSwaps> {
	const now = Date.now();
	const [sent, received, myBed] = await Promise.all([
		requestsOf(adminPb, 'from_order', order.id),
		requestsOf(adminPb, 'to_order', order.id),
		new BookingService(adminPb).getBedForOrder(order.id)
	]);
	await settle(adminPb, sent, now);
	await settle(adminPb, received, now);

	const canAnswer = !!myBed && (await spotSwappable(adminPb, order.id, myBed));
	const incoming = canAnswer
		? received
				.filter((row) => !row.quiet && isOpen(row, now) && row.to_bed === myBed?.id)
				.map((row) => toView(row, 'in'))
		: [];
	const open = sent.filter((row) => isOpen(row, now));
	const done = sent.filter((row) => !isOpen(row, now)).slice(0, OUTCOMES_SHOWN);
	return {
		incoming,
		outgoing: [...open, ...done].map((row) => toView(row, 'out')),
		openOut: open.length,
		paused: !!order.no_swap_requests
	};
}

/**
 * How many requests wait for this guest's answer (the 🔁 badge in the top
 * bar). The same rule as guestSwaps, in fewer reads: nothing is read about
 * the spot unless a request is waiting.
 */
export async function countIncoming(adminPb: TypedPocketBase, orderId: string): Promise<number> {
	const now = Date.now();
	const rows = await adminPb.collection('swap_requests').getFullList<SwapRequestsResponse>({
		filter: adminPb.filter("to_order = {:orderId} && status = 'pending'", { orderId }),
		fields: 'id,to_bed,quiet,expires_at,status',
		requestKey: null
	});
	const waiting = rows.filter((row) => !row.quiet && isOpen(row, now));
	if (waiting.length === 0) return 0;
	const myBed = await new BookingService(adminPb).getBedForOrder(orderId);
	if (!myBed || !(await spotSwappable(adminPb, orderId, myBed))) return 0;
	return waiting.filter((row) => row.to_bed === myBed.id).length;
}

/** What a room page needs to offer swaps on the taken spots. */
export interface RoomSwaps {
	/** Why nobody can swap right now ('' when they can). */
	pause: SwapPause;
	/** The guest's own spot, when they can offer it. */
	mine: SwapSpot | null;
	/** Why the guest's spot can't be offered ('' when it can, or when they hold none). */
	why: string;
	/** The guest's open requests: the spot asked for → the request's id. */
	asked: Record<string, string>;
	/** How many of them are open. */
	openCount: number;
}

export async function roomSwaps(
	adminPb: TypedPocketBase,
	settings: Pick<BookingSettings, 'phase' | 'swapsOff'>,
	order: Pick<OrdersResponse, 'id'>,
	myBed: BedsResponse | null
): Promise<RoomSwaps> {
	const pause = swapPause(settings);
	const result: RoomSwaps = { pause, mine: null, why: '', asked: {}, openCount: 0 };
	if (pause || !myBed) return result;
	result.why = await ownSpotProblem(adminPb, order.id, myBed);
	if (result.why) return result;
	const [bed, sent] = await Promise.all([
		adminPb.collection('beds').getOne<BedWithRoom>(myBed.id, { expand: BED_EXPAND }),
		requestsOf(adminPb, 'from_order', order.id)
	]);
	const now = Date.now();
	await settle(adminPb, sent, now);
	result.mine = toSwapSpot(bed);
	for (const row of sent.filter((r) => isOpen(r, now))) result.asked[row.to_bed] = row.id;
	result.openCount = Object.keys(result.asked).length;
	return result;
}

/** The guest pauses (or resumes) swap requests to them. Open ones can still be answered. */
export async function setSwapPause(
	adminPb: TypedPocketBase,
	order: Pick<OrdersResponse, 'id'>,
	paused: boolean
): Promise<void> {
	await adminPb.collection('orders').update(order.id, { no_swap_requests: paused });
}

/**
 * Deletes every request asked by or of this ticket: the ticket went to a new
 * holder (Tickets page, ticket list import), so the old holder's requests and
 * what they wrote go with them. Returns how many.
 */
export async function forgetSwaps(adminPb: TypedPocketBase, orderId: string): Promise<number> {
	let removed = 0;
	for (const side of ['from_order', 'to_order'] as const) {
		const rows = await adminPb.collection('swap_requests').getFullList({
			filter: adminPb.filter(`${side} = {:orderId}`, { orderId }),
			fields: 'id'
		});
		for (const row of rows) {
			await adminPb
				.collection('swap_requests')
				.delete(row.id)
				.then(() => removed++)
				.catch((err) => {
					if (!isNotFound(err)) throw err; // both sides of a request to itself
				});
		}
	}
	return removed;
}

/**
 * Turns swap requests off or on for everyone (the Control Center). Uses the
 * admin's own connection, so PocketBase records who did it and tells the
 * crew chat (pb_hooks/cozy_notify.pb.js).
 */
export async function setSwapsOff(pb: TypedPocketBase, off: boolean): Promise<void> {
	await pb.collection('app_settings').update(APP_SETTINGS_ID, { swaps_off: off });
}

/** Open requests in the whole camp and swaps done, for the Control Center. */
export async function swapCounts(
	adminPb: TypedPocketBase
): Promise<{ open: number; swapped: number }> {
	const count = async (status: string) =>
		(
			await adminPb.collection('swap_requests').getList(1, 1, {
				filter: adminPb.filter('status = {:status}', { status }),
				fields: 'id',
				requestKey: null
			})
		).totalItems;
	const [open, swapped] = await Promise.all([count('pending'), count('accepted')]);
	return { open, swapped };
}
