// src/lib/server/special-requests.ts
/**
 * Special-needs requests against PocketBase (collection special_requests,
 * docs/admin/special-needs.md). A guest sends one request per ticket, also
 * while booking is closed; admins approve or decline it and assign a spot.
 * Assigning is the only way a booking happens outside Live Booking.
 *
 * Privacy: what the guest wrote may be health data. The ticked needs, the text
 * and the burner name are stored encrypted (like orders.burner_name) and only
 * decrypted here, for the guest's own page and for the admin area. They never
 * go into messages, the log or the audit log. Request groups build on this
 * module: $lib/server/request-groups.ts (it imports this one, never the other
 * way round).
 */
import type { ClientResponseError } from 'pocketbase';
import type {
	BedsResponse,
	HousesResponse,
	OrdersResponse,
	RoomsResponse,
	SpecialRequestsResponse,
	TypedPocketBase
} from '$lib/pocketbase-types';
import type { AdminSession } from '$lib/server/admin-auth';
import { logAdminEvent, logGuestEvent } from '$lib/server/admin-events';
import { BookingService, randomBurnerName } from '$lib/server/booking';
import { APP_SETTINGS_ID } from '$lib/server/constants';
import { holderName } from '$lib/tickets';
import { decrypt, encrypt } from '$lib/server/crypto';
import { compareNatural } from '$lib/template';
import { effectiveFeatures } from '$lib/accommodation';
import {
	isSpecialNeed,
	type AdminRequestView,
	type GuestRequestView,
	type RequestInput,
	type RequestStatus,
	type SpecialNeed,
	type SpotInfo
} from '$lib/special-needs';

export type { AdminRequestView, GuestRequestView, SpotInfo };

/** A step the request flow doesn't allow. `message` is written for whoever clicked. */
export class RequestError extends Error {
	constructor(
		message: string,
		public status = 409
	) {
		super(message);
		this.name = 'RequestError';
	}
}

/** Shown when a guest tries to move or release a spot the crew picked for them. */
export const SPOT_FIXED_MESSAGE =
	'The crew picked this spot for you because of your special-needs request, so only the crew can change it. Please contact the crew.';

const ALREADY_DECIDED =
	"The crew has already decided on your request, so it can't be changed anymore. If something changed, please contact the crew.";

type BedWithRoom = BedsResponse<{ room?: RoomsResponse<{ house?: HousesResponse }> }>;
type BedWithRoomAndOrder = BedsResponse<{
	room?: RoomsResponse<{ house?: HousesResponse }>;
	order?: OrdersResponse;
}>;
type RequestWithOrder = SpecialRequestsResponse<{ order?: OrdersResponse }>;

/**
 * The needs are padded to this length before they are encrypted: AES-GCM
 * keeps the length of the plaintext, and the length must not tell an access
 * request from a project request. JSON.parse ignores the trailing blanks, so
 * older, unpadded rows read the same.
 */
const NEEDS_PADDED_LENGTH = 240;

function isNotFound(err: unknown): boolean {
	return (err as ClientResponseError | undefined)?.status === 404;
}

/**
 * What encrypt('') stored before empty texts were kept empty: no ciphertext
 * after the tag, which decrypt() would hand back as if it were plain text.
 */
const EMPTY_CIPHERTEXT = /^[0-9a-f]+:[0-9a-f]+:$/i;

/** Decrypts a stored secret; an unreadable one (other ENCRYPTION_KEY) reads as "". */
export function readSecret(value: string | undefined | null): string {
	if (!value || EMPTY_CIPHERTEXT.test(value)) return '';
	try {
		return decrypt(value);
	} catch {
		return '';
	}
}

/**
 * The ticket holder's name from the ticket list, '' when the ticket has none.
 * One rule for the whole app: $lib/tickets holderName.
 */
export function ticketName(order: Pick<OrdersResponse, 'customer_name' | 'order_number'>): string {
	return holderName(order);
}

export function toSpot(bed: BedWithRoom): SpotInfo {
	const room = bed.expand?.room;
	const roomName = room
		? `${room.name || 'Room'}${room.room_number ? ` #${room.room_number}` : ''}`
		: '';
	const building = room?.expand?.house;
	const house = building?.name ?? '';
	return {
		bedId: bed.id,
		roomId: bed.room,
		houseId: building?.id ?? room?.house ?? '',
		label: [bed.label, roomName, house].filter(Boolean).join(' · '),
		spot: bed.label,
		room: roomName,
		house,
		special: !!bed.is_special,
		locked: !!bed.is_locked,
		bedType: bed.bed_type ?? '',
		// What the room and the house say counts for the spot too — minus what
		// the room or the spot switched off (a superuser's call), so the ♿
		// matching never offers a quiet the spot gave up.
		features: effectiveFeatures({
			house: building?.features,
			room: room?.features,
			roomOff: room?.features_off,
			spotOff: bed.features_off,
			bedType: bed.bed_type
		})
	};
}

/**
 * The ticked needs, stored encrypted as a JSON list. Anything unreadable counts
 * as none. Values the form no longer offers (RETIRED_NEEDS) are kept.
 */
export function readNeeds(value: string | undefined): SpecialNeed[] {
	const text = readSecret(value);
	if (!text) return [];
	try {
		const list: unknown = JSON.parse(text);
		return Array.isArray(list) ? list.filter(isSpecialNeed) : [];
	} catch {
		return [];
	}
}

const toMs = (value: string | undefined) => Date.parse(String(value || '').replace(' ', 'T'));

function toGuestView(record: SpecialRequestsResponse): GuestRequestView {
	return {
		status: record.status as RequestStatus,
		needs: readNeeds(record.needs),
		text: readSecret(record.reason),
		burnerName: readSecret(record.burner_name),
		sentAt: record.created,
		updatedAt: record.updated
	};
}

export async function findRequest(
	adminPb: TypedPocketBase,
	orderId: string
): Promise<SpecialRequestsResponse | null> {
	try {
		return await adminPb
			.collection('special_requests')
			.getFirstListItem(adminPb.filter('order = {:orderId}', { orderId }));
	} catch (err) {
		if (isNotFound(err)) return null;
		throw err;
	}
}

async function getRequest(
	adminPb: TypedPocketBase,
	requestId: string
): Promise<SpecialRequestsResponse> {
	try {
		return await adminPb.collection('special_requests').getOne(requestId);
	} catch (err) {
		if (isNotFound(err)) {
			throw new RequestError(
				'This request does not exist anymore. The guest may have withdrawn it. Reload the page.',
				404
			);
		}
		throw err;
	}
}

/** The guest's own request, decrypted, or null. */
export async function getGuestRequest(
	adminPb: TypedPocketBase,
	orderId: string
): Promise<GuestRequestView | null> {
	const record = await findRequest(adminPb, orderId);
	return record ? toGuestView(record) : null;
}

/** Where a ticket sleeps right now, or null. */
export async function getSpotForOrder(
	adminPb: TypedPocketBase,
	orderId: string
): Promise<SpotInfo | null> {
	try {
		const bed = await adminPb
			.collection('beds')
			.getFirstListItem<BedWithRoom>(adminPb.filter('order = {:orderId}', { orderId }), {
				sort: '-updated',
				expand: 'room,room.house'
			});
		return toSpot(bed);
	} catch (err) {
		if (isNotFound(err)) return null;
		throw err;
	}
}

export async function countOpenRequests(adminPb: TypedPocketBase): Promise<number> {
	const page = await adminPb
		.collection('special_requests')
		.getList(1, 1, { filter: "status = 'pending'", fields: 'id', requestKey: null });
	return page.totalItems;
}

/**
 * Creates the ticket's request, or changes it while the crew hasn't decided.
 * The ticket comes from the guest's session, never from the form.
 * @param input what the guest sent; the group choice is handled by
 *   saveGuestRequest ($lib/server/request-groups.ts), which passes `extra`
 * @param extra.requestGroup puts the request into this group
 * @param extra.groupEvent tells the crew chat that a new request started or
 *   joined a group (count only, never which one)
 * @throws {RequestError} when the crew has already decided
 */
export async function saveRequest(
	adminPb: TypedPocketBase,
	order: Pick<OrdersResponse, 'id'>,
	input: Omit<RequestInput, 'group'>,
	extra: { requestGroup?: string; groupEvent?: 'started' | 'joined' } = {}
): Promise<'created' | 'updated'> {
	const data = {
		// Padded, so the ciphertext's length doesn't tell what was ticked.
		needs: encrypt(JSON.stringify(input.needs).padEnd(NEEDS_PADDED_LENGTH)),
		// A group member may write nothing: kept empty, like the burner name.
		reason: input.text ? encrypt(input.text) : '',
		burner_name: input.burnerName ? encrypt(input.burnerName) : '',
		// The form asks for consent every time it is sent.
		consent_at: new Date().toISOString(),
		...(extra.requestGroup ? { request_group: extra.requestGroup } : {})
	};

	const update = async (existing: SpecialRequestsResponse) => {
		if (existing.status !== 'pending') throw new RequestError(ALREADY_DECIDED);
		await adminPb.collection('special_requests').update(existing.id, data);
		return 'updated' as const;
	};

	const existing = await findRequest(adminPb, order.id);
	if (existing) return update(existing);

	let created: SpecialRequestsResponse;
	try {
		created = await adminPb
			.collection('special_requests')
			.create({ order: order.id, status: 'pending', ...data });
	} catch (err) {
		// Sent twice at once (a second tab): the unique index on `order` refused
		// the second one, so change the first instead.
		const raced = await findRequest(adminPb, order.id);
		if (!raced) throw err;
		return update(raced);
	}

	const open = await countOpenRequests(adminPb).catch(() => 0);
	await logGuestEvent(adminPb, 'special_request_new', created.id, {
		open,
		...(extra.groupEvent ? { group: extra.groupEvent } : {})
	});
	return 'created';
}

/** Deletes the ticket's request (the guest withdraws it). A spot it got stays booked. */
export async function withdrawRequest(adminPb: TypedPocketBase, orderId: string): Promise<boolean> {
	const existing = await findRequest(adminPb, orderId);
	if (!existing) return false;
	await adminPb.collection('special_requests').delete(existing.id);
	await logGuestEvent(adminPb, 'special_request_withdrawn', existing.id, {
		status: existing.status
	});
	return true;
}

/**
 * Deletes the ticket's request without a guest event: the ticket was passed on
 * to a new holder (Tickets page, ticket list import), so the old holder's
 * health data goes with them. A spot the crew booked stays with the ticket as
 * an ordinary booking. Returns whether there was a request.
 */
export async function forgetRequest(adminPb: TypedPocketBase, orderId: string): Promise<boolean> {
	const existing = await findRequest(adminPb, orderId);
	if (!existing) return false;
	await adminPb.collection('special_requests').delete(existing.id);
	return true;
}

/**
 * Whether the ticket's spot is the one the crew booked for its approved
 * request: only the crew moves or releases that one. A spot the guest booked
 * themselves stays theirs to change.
 * @param currentBedId the ticket's spot, when the caller has looked it up already
 */
export async function isSpotFixed(
	adminPb: TypedPocketBase,
	orderId: string,
	currentBedId?: string | null
): Promise<boolean> {
	const request = await findRequest(adminPb, orderId);
	if (request?.status !== 'approved' || !request.bed) return false;
	const bedId =
		currentBedId !== undefined
			? currentBedId
			: ((await new BookingService(adminPb).getBedForOrder(orderId))?.id ?? null);
	return !!bedId && bedId === request.bed;
}

/** Spots the crew booked for approved requests: bed id → ticket. */
export async function crewBookedBeds(adminPb: TypedPocketBase): Promise<Map<string, string>> {
	const approved = await adminPb
		.collection('special_requests')
		.getFullList({ filter: "status = 'approved' && bed != ''", fields: 'order,bed' });
	return new Map(approved.map((request) => [request.bed, request.order]));
}

/** All requests for the admin area, oldest first, with ticket and current spot. */
export async function listRequests(adminPb: TypedPocketBase): Promise<AdminRequestView[]> {
	const records = await adminPb
		.collection('special_requests')
		.getFullList<RequestWithOrder>({ sort: 'created', expand: 'order' });
	if (records.length === 0) return [];

	const booked = await adminPb
		.collection('beds')
		.getFullList<BedWithRoom>({ filter: 'order != ""', expand: 'room,room.house' });
	const spotByOrder = new Map(booked.map((bed) => [bed.order, toSpot(bed)]));

	return records.map((record) => {
		const order = record.expand?.order;
		const spot = spotByOrder.get(record.order);
		return {
			...toGuestView(record),
			// stored, but not readable with this ENCRYPTION_KEY
			textUnreadable:
				!!record.reason && !EMPTY_CIPHERTEXT.test(record.reason) && !readSecret(record.reason),
			id: record.id,
			consentAt: record.consent_at,
			decidedBy: record.decided_by,
			decidedAt: record.decided_at,
			changedAfterDecision:
				!!record.decided_at && toMs(record.consent_at) > toMs(record.decided_at) + 1000,
			ticket: { name: order ? ticketName(order) : '', email: order?.email ?? '' },
			spot: spot
				? { ...spot, assigned: record.status === 'approved' && record.bed === spot.bedId }
				: null,
			groupId: record.request_group ?? ''
		};
	});
}

/**
 * Where a ♿ spot stands, for the ♿ panel on the requests page (in this order):
 * - inactive: deactivated
 * - request: booked by the crew for an approved request
 * - booked: booked otherwise (by a guest, or the crew outside a request)
 * - blocked: taken without a ticket (TAKEN on the room page)
 * - free: offered in the picker
 */
export type SpecialSpotState = 'free' | 'request' | 'booked' | 'blocked' | 'inactive';

export interface SpecialSpotView extends SpotInfo {
	state: SpecialSpotState;
	/** The ticket's name from the ticket list ('' for none). Admin-only, never leaves that page. */
	holder: string;
}

/** Every ♿ spot of the camp with its state, house by house. */
export async function listSpecialSpots(adminPb: TypedPocketBase): Promise<SpecialSpotView[]> {
	const [beds, crew] = await Promise.all([
		adminPb.collection('beds').getFullList<BedWithRoomAndOrder>({
			filter: 'is_special = true',
			expand: 'room,room.house,order'
		}),
		crewBookedBeds(adminPb)
	]);
	return beds
		.map((bed): SpecialSpotView => {
			const order = bed.expand?.order;
			let state: SpecialSpotState;
			if (bed.enabled === false) state = 'inactive';
			else if (bed.order && crew.get(bed.id) === bed.order) state = 'request';
			else if (bed.order) state = 'booked';
			else if (bed.occupied) state = 'blocked';
			else state = 'free';
			return { ...toSpot(bed), state, holder: order ? ticketName(order) : '' };
		})
		.sort(
			(a, b) =>
				compareNatural(a.house, b.house) ||
				compareNatural(a.room, b.room) ||
				compareNatural(a.spot, b.spot)
		);
}

/** Free active spots an admin can assign, special-needs spots first. */
export async function listAssignableSpots(adminPb: TypedPocketBase): Promise<SpotInfo[]> {
	const beds = await adminPb.collection('beds').getFullList<BedWithRoom>({
		filter: 'enabled = true && occupied = false && order = ""',
		expand: 'room,room.house'
	});
	return beds
		.map(toSpot)
		.sort(
			(a, b) =>
				Number(b.special) - Number(a.special) ||
				compareNatural(a.house, b.house) ||
				compareNatural(a.room, b.room) ||
				compareNatural(a.spot, b.spot)
		);
}

/**
 * @param opts.log false: a group step (request-groups.ts) logs one event for
 *   the whole group instead of one per request
 * @throws {RequestError} when the step isn't allowed
 */
export async function decideRequest(
	adminPb: TypedPocketBase,
	admin: AdminSession,
	requestId: string,
	decision: 'approved' | 'declined',
	opts: { log?: boolean } = {}
): Promise<void> {
	const request = await getRequest(adminPb, requestId);
	if (request.status === decision) return;
	if (decision === 'declined' && (await isSpotFixed(adminPb, request.order))) {
		throw new RequestError(
			'The crew booked a spot for this request. Release the spot first, then decline the request.'
		);
	}
	await adminPb.collection('special_requests').update(request.id, {
		status: decision,
		decided_by: admin.email,
		decided_at: new Date().toISOString(),
		...(decision === 'declined' ? { bed: '' } : {})
	});
	if (opts.log === false) return;
	await logAdminEvent(
		adminPb,
		admin,
		decision === 'approved' ? 'special_request_approved' : 'special_request_declined',
		request.id,
		{}
	);
}

/**
 * Books a spot for the request's ticket, whatever the booking phase: locked and
 * special-needs spots included — this is the only way a ♿ spot is booked.
 * Books first, so a taken spot changes nothing; then remembers the spot on the
 * request and approves a waiting request.
 * @param opts.log false: a group booking (request-groups.ts) logs one event
 *   for the whole group instead
 * @returns whether the request was approved on the way
 * @throws {RequestError} for a declined request, or a spot that is gone
 * @throws {BedUnavailableError} when the spot is taken or deactivated
 */
export async function assignSpot(
	adminPb: TypedPocketBase,
	admin: AdminSession,
	requestId: string,
	bedId: string,
	opts: { log?: boolean } = {}
): Promise<{ approved: boolean }> {
	const request = await getRequest(adminPb, requestId);
	if (request.status === 'declined') {
		throw new RequestError('This request is declined. Approve it first, then assign a spot.');
	}
	const order = await adminPb.collection('orders').getOne<OrdersResponse>(request.order);

	// The name the guest uses now wins; the one from the request is for a first spot.
	const name =
		readSecret(order.burner_name) || readSecret(request.burner_name) || randomBurnerName();
	try {
		// The crew may move a guest who has already arrived: the check-in moves along.
		await new BookingService(adminPb).bookBed(order, bedId, name, {
			allowLocked: true,
			allowSpecial: true,
			allowCheckedIn: true
		});
	} catch (err) {
		if (isNotFound(err)) {
			throw new RequestError("This spot doesn't exist anymore. Reload the page.", 409);
		}
		throw err;
	}

	const approving = request.status === 'pending';
	try {
		await adminPb.collection('special_requests').update(request.id, {
			bed: bedId,
			...(approving
				? { status: 'approved', decided_by: admin.email, decided_at: new Date().toISOString() }
				: {})
		});
	} catch (err) {
		if (isNotFound(err)) {
			throw new RequestError(
				'The guest withdrew the request meanwhile. The spot is booked for the ticket anyway; release it on the room page if it should be free.',
				409
			);
		}
		throw err;
	}
	if (opts.log !== false) {
		if (approving) await logAdminEvent(adminPb, admin, 'special_request_approved', request.id, {});
		await logAdminEvent(adminPb, admin, 'special_spot_assigned', request.id, {});
	}
	return { approved: approving };
}

/** Releases the spot of the request's ticket. The request stays approved. */
export async function releaseSpot(
	adminPb: TypedPocketBase,
	admin: AdminSession,
	requestId: string
): Promise<void> {
	const request = await getRequest(adminPb, requestId);
	await new BookingService(adminPb).unbookOrder(request.order, { allowCheckedIn: true });
	if (request.bed) {
		await adminPb
			.collection('special_requests')
			.update(request.id, { bed: '' })
			.catch((err) => {
				if (!isNotFound(err)) throw err; // withdrawn meanwhile: nothing to remember
			});
	}
	await logAdminEvent(adminPb, admin, 'special_spot_released', request.id, {});
}

/**
 * Opens or closes requests for guests. Uses the admin's own connection, so
 * PocketBase records who did it (pb_hooks/cozy_notify.pb.js).
 */
export async function setRequestsOpen(pb: TypedPocketBase, open: boolean): Promise<void> {
	await pb.collection('app_settings').update(APP_SETTINGS_ID, { special_requests_open: open });
}
