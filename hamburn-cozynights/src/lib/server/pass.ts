import encodeQR from 'qr';
import type { ClientResponseError } from 'pocketbase';
import type {
	BedsResponse,
	HousesResponse,
	OrdersResponse,
	RoomsResponse,
	TypedPocketBase
} from '$lib/pocketbase-types';
import { formatPassCode } from '$lib/pass';
import { decrypt } from '$lib/server/crypto';

/**
 * Booking passes (docs/admin/passes.md). A pass shows that a ticket holds a
 * spot: the guest opens it from their room page or the confirmation message,
 * the crew checks it in the admin area. The pass code is random and only
 * shows a booking — it is not the ticket code, which can change bookings.
 * PocketBase creates the codes (pb_hooks/cozy_pass.pb.js).
 */

export interface PassSpot {
	bedId: string;
	roomId: string;
	house: string;
	room: string;
	spot: string;
	enabled: boolean;
	locked: boolean;
	since: string;
}

export interface PassLookup {
	code: string;
	order: OrdersResponse;
	spot: PassSpot | null;
	burnerName: string;
}

type BedWithRoom = BedsResponse<{ room?: RoomsResponse<{ house?: HousesResponse }> }>;

function isNotFound(err: unknown): boolean {
	return (err as ClientResponseError | undefined)?.status === 404;
}

/** The ticket's pass code; PocketBase creates one if the ticket has none yet. */
export async function ensurePassCode(
	adminPb: TypedPocketBase,
	order: Pick<OrdersResponse, 'id' | 'pass_code'>
): Promise<string> {
	if (order.pass_code) return order.pass_code;
	const res = await adminPb.send<{ code: string }>(
		`/api/cozy/pass/${encodeURIComponent(order.id)}`,
		{ method: 'POST' }
	);
	return res.code;
}

/** The ticket behind a pass code and where it sleeps right now, or null. */
export async function findPass(adminPb: TypedPocketBase, code: string): Promise<PassLookup | null> {
	let order: OrdersResponse;
	try {
		order = await adminPb
			.collection('orders')
			.getFirstListItem<OrdersResponse>(adminPb.filter('pass_code = {:code}', { code }));
	} catch (err) {
		if (isNotFound(err)) return null;
		throw err;
	}

	let bed: BedWithRoom | null = null;
	try {
		bed = await adminPb
			.collection('beds')
			.getFirstListItem<BedWithRoom>(adminPb.filter('order = {:order}', { order: order.id }), {
				sort: '-updated',
				expand: 'room,room.house'
			});
	} catch (err) {
		if (!isNotFound(err)) throw err;
	}

	let burnerName = '';
	if (bed && order.burner_name) {
		try {
			burnerName = decrypt(order.burner_name);
		} catch {
			/* unreadable name: leave it out */
		}
	}

	const room = bed?.expand?.room;
	return {
		code,
		order,
		burnerName,
		spot: bed
			? {
					bedId: bed.id,
					roomId: bed.room,
					house: room?.expand?.house?.name ?? '',
					room: room ? `${room.name || 'Room'} #${room.room_number}` : '',
					spot: bed.label,
					enabled: bed.enabled !== false,
					locked: !!bed.is_locked,
					since: bed.updated
				}
			: null
	};
}

/** Where the guest's pass lives; also what its QR code holds. */
export function passUrl(origin: string, code: string): string {
	return `${origin}/pass/${formatPassCode(code)}`;
}

export function passQrSvg(url: string): string {
	return encodeQR(url, 'svg', { ecc: 'medium', border: 2 });
}

/** A GIF of the QR code: saves to a phone's photos, unlike SVG. */
export function passQrGif(url: string): Uint8Array<ArrayBuffer> {
	return encodeQR(url, 'gif', { ecc: 'medium', border: 4, scale: 8 });
}
