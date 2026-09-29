/**
 * The bookings of the camp with the ticket behind each one, for the admin
 * area: the bookings list (/admin/bookings), the room and house pages and the
 * map's house sidebar (docs/admin/bookings.md).
 *
 * Orders are superuser-only in PocketBase, so this runs on the app's service
 * account: every caller checks `locals.admin` first. What leaves this module
 * is what the check-in desk shows — names, masked e-mail, masked ticket code,
 * booked and checked-in times — never a full code, a full address or anything
 * a guest wrote in a special-needs request. None of it goes into the shared
 * stats snapshot ($lib/server/stats.ts), which stays counts only.
 */
import type {
	BedsResponse,
	HousesResponse,
	OrdersResponse,
	RoomsResponse,
	TypedPocketBase
} from '$lib/pocketbase-types';
import type { BookingRow } from '$lib/bookings';
import { holderName, maskTicketCode } from '$lib/tickets';
import { maskEmail } from '$lib/server/notifications';
import { burnerNameOf, roomLabel } from '$lib/server/pass';
import { crewBookedBeds } from '$lib/server/special-requests';

type BookingBed = Pick<BedsResponse, 'id' | 'room'> & {
	label?: string;
	enabled?: boolean;
	occupied?: boolean;
	is_locked?: boolean;
	is_special?: boolean;
	order?: string;
	booked_at?: string;
	checked_in_at?: string;
	checked_in_by?: string;
};
type BookingRoom = Pick<RoomsResponse, 'id' | 'house' | 'name' | 'room_number'>;
type BookingHouse = Pick<HousesResponse, 'id' | 'name'>;
type BookingOrder = Pick<
	OrdersResponse,
	'id' | 'order_number' | 'customer_name' | 'email' | 'burner_name'
>;

export interface BookingRecords {
	houses: BookingHouse[];
	rooms: BookingRoom[];
	beds: BookingBed[];
	orders: BookingOrder[];
	/** Spot → ticket of approved special-needs requests (crewBookedBeds). */
	assigned: Map<string, string>;
}

/** A spot that holds something: a guest's ticket, or taken by the crew. */
export function isBooked(bed: Pick<BookingBed, 'occupied' | 'order'>): boolean {
	return !!bed.order || !!bed.occupied;
}

/** The rows, derived from records already read. No I/O; beds of unknown rooms drop out. */
export function describeBookings(records: BookingRecords): BookingRow[] {
	const houses = new Map(records.houses.map((house) => [house.id, house]));
	const rooms = new Map(records.rooms.map((room) => [room.id, room]));
	const orders = new Map(records.orders.map((order) => [order.id, order]));

	const rows: BookingRow[] = [];
	for (const bed of records.beds) {
		if (!isBooked(bed)) continue;
		const room = rooms.get(bed.room);
		if (!room) continue;
		const house = houses.get(room.house);
		const order = bed.order ? orders.get(bed.order) : undefined;
		rows.push({
			bedId: bed.id,
			spot: bed.label ?? '',
			roomId: room.id,
			room: roomLabel(room),
			roomNumber: room.room_number ?? 0,
			houseId: room.house,
			house: house?.name ?? '',
			enabled: bed.enabled !== false,
			locked: !!bed.is_locked,
			special: !!bed.is_special,
			viaRequest: !!bed.order && records.assigned.get(bed.id) === bed.order,
			guest: order
				? {
						orderId: order.id,
						name: holderName(order),
						burnerName: burnerNameOf(order),
						email: maskEmail(order.email),
						ticket: maskTicketCode(order.order_number ?? '')
					}
				: null,
			bookedAt: order ? (bed.booked_at ?? '') : '',
			// A check-in only ever belongs to a ticket (pb_hooks/lib/booked.js).
			checkIn:
				order && bed.checked_in_at ? { at: bed.checked_in_at, by: bed.checked_in_by ?? '' } : null
		});
	}
	return rows;
}

const BED_FIELDS =
	'id,room,label,enabled,occupied,is_locked,is_special,order,booked_at,checked_in_at,checked_in_by';

/**
 * Reads what the rows are made of: the booked spots (of one house or room, or
 * of the whole camp), their rooms and houses, and only the tickets on them.
 */
export async function readBookings(
	adminPb: TypedPocketBase,
	scope: { houseId?: string; roomId?: string } = {}
): Promise<BookingRow[]> {
	const booked = '(occupied = true || order != "")';
	const filter = scope.roomId
		? adminPb.filter(`room = {:room} && ${booked}`, { room: scope.roomId })
		: scope.houseId
			? adminPb.filter(`room.house = {:house} && ${booked}`, { house: scope.houseId })
			: booked;

	const [beds, rooms, houses, assigned] = await Promise.all([
		adminPb
			.collection('beds')
			.getFullList<BookingBed>({ filter, fields: BED_FIELDS, requestKey: null }),
		adminPb.collection('rooms').getFullList<BookingRoom>({
			fields: 'id,house,name,room_number',
			filter: scope.roomId
				? adminPb.filter('id = {:room}', { room: scope.roomId })
				: scope.houseId
					? adminPb.filter('house = {:house}', { house: scope.houseId })
					: undefined,
			requestKey: null
		}),
		adminPb.collection('houses').getFullList<BookingHouse>({ fields: 'id,name', requestKey: null }),
		// Before the special-needs migration there is nothing assigned.
		crewBookedBeds(adminPb).catch(() => new Map<string, string>())
	]);

	const orderIds = [...new Set(beds.map((bed) => bed.order).filter(Boolean))] as string[];
	const orders = await readOrders(adminPb, orderIds);
	return describeBookings({ houses, rooms, beds, orders, assigned });
}

/** Tickets by id, in chunks: a filter with hundreds of ids would outgrow a URL. */
async function readOrders(adminPb: TypedPocketBase, ids: string[]): Promise<BookingOrder[]> {
	const CHUNK = 50;
	const chunks: string[][] = [];
	for (let start = 0; start < ids.length; start += CHUNK) {
		chunks.push(ids.slice(start, start + CHUNK));
	}
	const lists = await Promise.all(
		chunks.map((chunk) =>
			adminPb.collection('orders').getFullList<BookingOrder>({
				filter: chunk.map((id) => adminPb.filter('id = {:id}', { id })).join(' || '),
				fields: 'id,order_number,customer_name,email,burner_name',
				requestKey: null
			})
		)
	);
	return lists.flat();
}
