/**
 * The guest list of the admin area (/admin/guests): every imported ticket
 * with its spot, check-in, special-needs request, messages and wallet passes.
 *
 * Orders are superuser-only in PocketBase, so this runs on the app's service
 * account: every caller checks `locals.admin` first. Everything is read in
 * bulk — eight list requests for the whole camp, never one per ticket — and
 * joined in memory. What leaves this module is what the check-in desk shows
 * (names, masked e-mail, masked ticket code, stamps and yes/no facts); a pass
 * serial, a chat id or what a guest wrote in a request never does.
 */
import type {
	GuestNotifyResponse,
	OrdersResponse,
	SpecialRequestsResponse,
	TypedPocketBase,
	WalletPassesResponse
} from '$lib/pocketbase-types';
import type { GuestRequestState, GuestRow, GuestWalletState } from '$lib/guests';
import { describeBookings, type BookingRecords } from '$lib/server/bookings';
import type { BookingRow } from '$lib/bookings';
import { holderName, maskTicketCode } from '$lib/tickets';
import { maskEmail } from '$lib/server/notifications';
import { burnerNameOf } from '$lib/server/pass';
import { crewBookedBeds } from '$lib/server/special-requests';

type GuestOrder = Pick<
	OrdersResponse,
	| 'id'
	| 'order_number'
	| 'order_hash'
	| 'customer_name'
	| 'email'
	| 'burner_name'
	| 'pass_code'
	| 'handed_over_at'
	| 'created'
>;
type GuestNotify = Pick<
	GuestNotifyResponse,
	'order' | 'mail_sent' | 'mail_to' | 'tg_chat' | 'due' | 'attempts'
>;
type GuestRequest = Pick<SpecialRequestsResponse, 'order' | 'status' | 'bed'>;
type GuestPass = Pick<WalletPassesResponse, 'order' | 'platform' | 'serial' | 'attempts'>;

export interface GuestRecords {
	orders: GuestOrder[];
	/** Only the spots that hold a ticket, with their rooms and houses. */
	beds: BookingRecords['beds'];
	rooms: BookingRecords['rooms'];
	houses: BookingRecords['houses'];
	/** Spot → ticket of approved special-needs requests (crewBookedBeds). */
	assigned: Map<string, string>;
	notify: GuestNotify[];
	requests: GuestRequest[];
	passes: GuestPass[];
}

/** Is the pass in this wallet the ticket's pass (like wallet/content.ts decides it)? */
function walletState(pass: GuestPass, passCode: string): GuestWalletState {
	if ((pass.attempts ?? 0) > 0) return 'failing';
	return pass.serial === passCode ? 'current' : 'voided';
}

/** A ticket's request: pending beats decided, so an open one is never hidden by an old one. */
function requestState(records: GuestRequest[]): GuestRequestState {
	let state: GuestRequestState = 'none';
	for (const record of records) {
		if (record.status === 'pending') return 'pending';
		if (record.status === 'approved' || record.status === 'declined') state = record.status;
	}
	return state;
}

/** The rows, derived from records already read. No I/O. */
export function describeGuests(records: GuestRecords): GuestRow[] {
	// The spot part is the bookings list's row: same joins, same masking.
	const bookings = new Map<string, BookingRow>();
	for (const row of describeBookings({
		houses: records.houses,
		rooms: records.rooms,
		beds: records.beds,
		orders: records.orders,
		assigned: records.assigned
	})) {
		// A ticket holds one spot; should the data ever say two, the first wins.
		if (row.guest && !bookings.has(row.guest.orderId)) bookings.set(row.guest.orderId, row);
	}
	const notifyByOrder = new Map(records.notify.map((record) => [record.order, record]));
	const requestsByOrder = new Map<string, GuestRequest[]>();
	for (const request of records.requests) {
		const list = requestsByOrder.get(request.order) ?? [];
		list.push(request);
		requestsByOrder.set(request.order, list);
	}
	const passesByOrder = new Map<string, GuestPass[]>();
	for (const pass of records.passes) {
		if (!pass.order) continue;
		const list = passesByOrder.get(pass.order) ?? [];
		list.push(pass);
		passesByOrder.set(pass.order, list);
	}

	const rows: GuestRow[] = [];
	for (const order of records.orders) {
		// A record without a code is not a ticket (loadStoredTickets skips it too).
		if (!order.order_number) continue;
		const booking = bookings.get(order.id);
		const notify = notifyByOrder.get(order.id);
		const passes = passesByOrder.get(order.id) ?? [];
		// Of several passes on one wallet (a hand-over made a new one), the
		// ticket's current pass counts; the others are voided anyway.
		const wallet = (platform: 'apple' | 'google'): GuestWalletState => {
			const own = passes.filter((pass) => pass.platform === platform);
			if (own.length === 0) return null;
			const current = own.find((pass) => pass.serial === order.pass_code) ?? own[0];
			return walletState(current, order.pass_code ?? '');
		};
		const attempts = notify?.attempts ?? 0;
		rows.push({
			id: order.id,
			ticket: maskTicketCode(order.order_number),
			name: holderName(order),
			burnerName: burnerNameOf(order),
			email: maskEmail(order.email),
			hasEmail: !!order.email,
			signedIn: !!order.order_hash,
			imported: order.created ?? '',
			handedOverAt: order.handed_over_at ?? '',
			spot: booking
				? {
						houseId: booking.houseId,
						houseName: booking.house,
						roomId: booking.roomId,
						roomName: booking.room,
						label: booking.spot,
						bookedAt: booking.bookedAt,
						viaRequest: booking.viaRequest,
						special: booking.special
					}
				: null,
			checkIn: booking?.checkIn ?? null,
			request: requestState(requestsByOrder.get(order.id) ?? []),
			notify: {
				mailed: !!notify?.mail_sent,
				mailedTo: notify?.mail_sent ? maskEmail(notify.mail_to) : '',
				telegram: !!notify?.tg_chat,
				queued: !!notify?.due,
				// The same reading as the ops counts (src/lib/server/stats.ts, OPS_FILTERS).
				failed: !notify?.due && attempts > 0
			},
			wallet: { apple: wallet('apple'), google: wallet('google') }
		});
	}
	return rows;
}

/**
 * Reads what the rows are made of, everything in bulk: the tickets, the
 * booked spots with their rooms and houses, the notify records, the
 * special-needs requests (only ticket, status and spot — never the needs or
 * the reason, they are health data) and the wallet passes.
 */
export async function readGuests(adminPb: TypedPocketBase): Promise<GuestRow[]> {
	const bulk = { batch: 1000, requestKey: null } as const;
	const [orders, beds, rooms, houses, assigned, notify, requests, passes] = await Promise.all([
		adminPb.collection('orders').getFullList<GuestOrder>({
			fields:
				'id,order_number,order_hash,customer_name,email,burner_name,pass_code,handed_over_at,created',
			...bulk
		}),
		adminPb.collection('beds').getFullList<BookingRecords['beds'][number]>({
			filter: 'order != ""',
			fields:
				'id,room,label,enabled,occupied,is_locked,is_special,order,booked_at,checked_in_at,checked_in_by',
			...bulk
		}),
		adminPb.collection('rooms').getFullList<BookingRecords['rooms'][number]>({
			fields: 'id,house,name,room_number',
			...bulk
		}),
		adminPb
			.collection('houses')
			.getFullList<BookingRecords['houses'][number]>({ fields: 'id,name', ...bulk }),
		// Before the special-needs migration there is nothing assigned.
		crewBookedBeds(adminPb).catch(() => new Map<string, string>()),
		adminPb
			.collection('guest_notify')
			.getFullList<GuestNotify>({
				fields: 'order,mail_sent,mail_to,tg_chat,due,attempts',
				...bulk
			})
			.catch(() => [] as GuestNotify[]),
		adminPb
			.collection('special_requests')
			.getFullList<GuestRequest>({ fields: 'order,status,bed', ...bulk })
			.catch(() => [] as GuestRequest[]),
		adminPb
			.collection('wallet_passes')
			.getFullList<GuestPass>({
				fields: 'order,platform,serial,attempts',
				...bulk
			})
			.catch(() => [] as GuestPass[])
	]);
	return describeGuests({ orders, beds, rooms, houses, assigned, notify, requests, passes });
}
