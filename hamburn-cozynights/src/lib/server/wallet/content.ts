// src/lib/server/wallet/content.ts
/**
 * What a wallet pass shows, for both platforms: the same as the pass page
 * shows to anyone with its link (house, room, spot, burner name, the kind of
 * bed and the features at the spot when the crew wrote them down, the code
 * and the QR code), never the ticket code, the name on the ticket, an address
 * or the check-in. A wallet pass belongs to a pass code: when the ticket gets
 * a new one (a hand-over) or is deleted, the old wallet pass is voided.
 */
import crypto from 'crypto';
import type {
	BedsResponse,
	HousesResponse,
	OrdersResponse,
	RoomsResponse,
	TypedPocketBase
} from '$lib/pocketbase-types';
import { levelOf } from '$lib/bunks';
import { formatPassCode } from '$lib/pass';
import {
	bedRow,
	burnerNameOf,
	findPass,
	passUrl,
	roomLabel,
	spotFeatureText
} from '$lib/server/pass';
import type { WalletConfig } from './config';

export interface WalletSpot {
	house: string;
	room: string;
	spot: string;
	/** "Upper bunk · above B1": the kind of bed; absent when nobody said. */
	bed?: string;
	/** "🔥 Heated · 🔌 Power socket": what is true at the spot; absent when nothing is. */
	features?: string;
}

export interface WalletContent {
	/** The pass code without dashes: the wallet pass's serial number. */
	serial: string;
	/** XXXX-XXXX-XXXX */
	code: string;
	/** The pass page, also what the QR code holds. */
	passUrl: string;
	/** No ticket has this pass code anymore (handed over or deleted). */
	voided: boolean;
	spot: WalletSpot | null;
	burnerName: string;
}

/** What a pass says besides the ticket's own content. */
export interface WalletExtras {
	/** Guests can get updates on Telegram (the bot is set up). */
	telegram: boolean;
}

/** What the content needs of a pass lookup (findPass fits). */
export interface ContentSource {
	spot: WalletSpot | null;
	burnerName: string;
}

/** The content for a pass code and what `findPass` found for it (null: voided). */
export function contentFromLookup(
	serial: string,
	lookup: ContentSource | null,
	origin: string
): WalletContent {
	const spot = lookup?.spot ?? null;
	return {
		serial,
		code: formatPassCode(serial),
		passUrl: passUrl(origin, serial),
		voided: !lookup,
		spot: spot
			? {
					house: spot.house,
					room: spot.room,
					spot: spot.spot,
					// only when the crew wrote it down: a pass without says nothing
					...(spot.bed ? { bed: spot.bed } : {}),
					...(spot.features ? { features: spot.features } : {})
				}
			: null,
		burnerName: spot ? (lookup?.burnerName ?? '') : ''
	};
}

/** The content of one pass, read now. */
export async function loadContent(
	adminPb: TypedPocketBase,
	serial: string,
	origin: string
): Promise<WalletContent> {
	return contentFromLookup(serial, await findPass(adminPb, serial), origin);
}

/**
 * A fingerprint of everything a pass shows, including the event details from
 * the configuration: when it changes, the wallets are told.
 */
export function contentHash(
	content: WalletContent,
	config: WalletConfig,
	extras: WalletExtras
): string {
	const shown = {
		v: 1,
		content,
		extras,
		event: config.event,
		organization: config.organization
	};
	return crypto.createHash('sha256').update(JSON.stringify(shown)).digest('hex');
}

type Bed = Pick<
	BedsResponse,
	| 'id'
	| 'order'
	| 'label'
	| 'room'
	| 'updated'
	| 'bed_type'
	| 'bunk_partner'
	| 'features'
	| 'features_off'
>;
type Room = Pick<
	RoomsResponse,
	'id' | 'name' | 'room_number' | 'house' | 'features' | 'features_off'
>;
type House = Pick<HousesResponse, 'id' | 'name' | 'features'>;

/**
 * The content of many passes at once, for the sync: four list requests
 * instead of two per pass. The same rules as findPass: a ticket's spot is its
 * most recently changed bed, its bed row names the other level of a bunk bed
 * (which may be free, so every spot is read, not only the booked ones) and
 * its features are the spot's, the room's and the house's together, minus
 * what the room or the spot switched off (`features_off`).
 */
export async function loadContents(
	adminPb: TypedPocketBase,
	serials: string[],
	origin: string
): Promise<Map<string, WalletContent>> {
	const wanted = new Set(serials);
	const result = new Map<string, WalletContent>();
	if (wanted.size === 0) return result;

	const [orders, beds, rooms, houses] = await Promise.all([
		adminPb
			.collection('orders')
			.getFullList<Pick<OrdersResponse, 'id' | 'pass_code' | 'burner_name'>>({
				filter: "pass_code != ''",
				fields: 'id,pass_code,burner_name',
				requestKey: null
			}),
		adminPb.collection('beds').getFullList<Bed>({
			fields: 'id,order,label,room,updated,bed_type,bunk_partner,features,features_off',
			requestKey: null
		}),
		adminPb.collection('rooms').getFullList<Room>({
			fields: 'id,name,room_number,house,features,features_off',
			requestKey: null
		}),
		adminPb.collection('houses').getFullList<House>({
			fields: 'id,name,features',
			requestKey: null
		})
	]);

	const roomById = new Map(rooms.map((room) => [room.id, room]));
	const houseById = new Map(houses.map((house) => [house.id, house]));
	const bedById = new Map(beds.map((bed) => [bed.id, bed]));
	const bedByOrder = new Map<string, Bed>();
	for (const bed of beds) {
		if (!bed.order) continue;
		const known = bedByOrder.get(bed.order);
		if (!known || bed.updated > known.updated) bedByOrder.set(bed.order, bed);
	}

	for (const order of orders) {
		if (!wanted.has(order.pass_code)) continue;
		const bed = bedByOrder.get(order.id);
		const room = bed ? roomById.get(bed.room) : undefined;
		const house = room ? houseById.get(room.house) : undefined;
		const partner = bed?.bunk_partner ? bedById.get(bed.bunk_partner) : undefined;
		const lookup: ContentSource = {
			spot: bed
				? {
						house: house?.name ?? '',
						room: room ? roomLabel(room) : '',
						spot: bed.label,
						bed: bedRow(bed.bed_type, levelOf(bed), partner?.label),
						features: spotFeatureText(house, room, bed)
					}
				: null,
			burnerName: bed ? burnerNameOf(order) : ''
		};
		result.set(order.pass_code, contentFromLookup(order.pass_code, lookup, origin));
	}
	for (const serial of wanted) {
		if (!result.has(serial)) result.set(serial, contentFromLookup(serial, null, origin));
	}
	return result;
}
