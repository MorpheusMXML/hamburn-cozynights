import encodeQR from 'qr';
import { FailureRateLimiter } from '$lib/server/rate-limit';
import { bedTypeLabel } from '$lib/accommodation';
import { levelOf } from '$lib/bunks';
import type { ClientResponseError } from 'pocketbase';
import type {
	BedsResponse,
	HousesResponse,
	OrdersResponse,
	RoomsResponse,
	TypedPocketBase
} from '$lib/pocketbase-types';
import { formatPassCode, type PassSummary } from '$lib/pass';
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
	/** When the spot got this ticket. */
	bookedAt: string;
	/** The check-in at arrival: when and by which admin; null while only booked. */
	checkIn: { at: string; by: string } | null;
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

/** "Blue Room #2": a room as passes, confirmations and the roulette name it. */
export function roomLabel(room: Pick<RoomsResponse, 'name' | 'room_number'>): string {
	return `${room.name || 'Room'} #${room.room_number}`;
}

/** The ticket's burner name, or '' when it has none or it can't be read. */
export function burnerNameOf(order: Pick<OrdersResponse, 'burner_name'>): string {
	if (!order.burner_name) return '';
	try {
		return decrypt(order.burner_name);
	} catch {
		return ''; // unreadable name: leave it out
	}
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

	const room = bed?.expand?.room;
	return {
		code,
		order,
		burnerName: bed ? burnerNameOf(order) : '',
		spot: bed
			? {
					bedId: bed.id,
					roomId: bed.room,
					house: room?.expand?.house?.name ?? '',
					room: room ? roomLabel(room) : '',
					spot: bed.label,
					enabled: bed.enabled !== false,
					locked: !!bed.is_locked,
					// when the spot got this ticket (pb_hooks/lib/booked.js); `updated`
					// also moves on a rename, a lock or a ♿ toggle
					bookedAt: bed.booked_at || bed.updated,
					checkIn: checkInOf(bed)
				}
			: null
	};
}

/** A spot's check-in, or null while it is only booked. */
export function checkInOf(
	bed: Pick<BedsResponse, 'checked_in_at' | 'checked_in_by'>
): { at: string; by: string } | null {
	return bed.checked_in_at ? { at: bed.checked_in_at, by: bed.checked_in_by ?? '' } : null;
}

/**
 * The small ticket on house, room and map pages: the guest's pass code (made
 * on first use) and the spot `bed` they hold. For a bunk bed the "Bed" row
 * also says where the other level is ("Upper bunk · above B1"), which costs
 * one more read — the partner spot's label — only for a stacked spot.
 */
export async function passSummary(
	adminPb: TypedPocketBase,
	order: Pick<OrdersResponse, 'id' | 'pass_code' | 'burner_name'>,
	bed: Pick<BedsResponse, 'room' | 'label'> & { bed_type?: string; bunk_partner?: string }
): Promise<PassSummary> {
	const level = levelOf(bed);
	const [code, room, partner] = await Promise.all([
		ensurePassCode(adminPb, order),
		adminPb
			.collection('rooms')
			.getOne<RoomsResponse<{ house?: HousesResponse }>>(bed.room, { expand: 'house' }),
		bed.bunk_partner && level
			? adminPb
					.collection('beds')
					.getOne<Pick<BedsResponse, 'id' | 'label'>>(bed.bunk_partner, { fields: 'id,label' })
					// A half-written pairing (the partner gone): say the level alone.
					.catch((err) => {
						if (!isNotFound(err)) throw err;
						return null;
					})
			: null
	]);
	return {
		code: formatPassCode(code),
		house: room.expand?.house?.name ?? '',
		room: roomLabel(room),
		spot: bed.label,
		burnerName: burnerNameOf(order),
		// Only when the crew wrote it down, like every other detail.
		...(bedTypeLabel(bed.bed_type) ? { bed: bedRow(bed.bed_type, level, partner?.label) } : {})
	};
}

/** "Upper bunk · above B1", or just "Upper bunk" when the other level is unknown. */
function bedRow(bedType: string | undefined, level: 'lower' | 'upper' | null, partner?: string) {
	const label = bedTypeLabel(bedType);
	if (!level || !partner) return label;
	return `${label} · ${level === 'lower' ? 'below' : 'above'} ${partner}`;
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

/**
 * Unknown pass codes per client, shared by the pass page and its QR image:
 * codes can't be guessed (31^12), but nobody needs to try thousands either.
 */
export const unknownPassCodes = new FailureRateLimiter(30, 10 * 60 * 1000);
