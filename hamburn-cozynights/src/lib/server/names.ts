// src/lib/server/names.ts
/**
 * The names of the camp layout after they were created (docs/admin/camp-layout.md,
 * "Renaming"): a house's name, a room's name and number, a spot's label. The
 * rules are the ones creating them follows — and the template import, so an
 * exported layout can always be imported again: not empty, not too long, a
 * house name once in the camp, a room number once in its house, a spot label
 * once in its room (case does not count). Renaming is a structure change: the
 * actions allow it in Staging Mode only.
 */
import type { TypedPocketBase } from '$lib/pocketbase-types';
import { TEMPLATE_LIMITS } from '$lib/template';

export type NameCheck<T> = { ok: true; value: T } | { ok: false; message: string };

/** What the actions answer while booking is live or closed. */
export const NAMES_LOCKED =
	"Names can only be changed in Staging Mode: while booking is live or closed, the layout holds the guests' bookings.";

const text = (raw: unknown) => (typeof raw === 'string' ? raw : '').trim();
const same = (a: unknown, b: string) =>
	String(a ?? '')
		.trim()
		.toLowerCase() === b.toLowerCase();

/** A house's new name: one in the camp, whatever the case. */
export async function checkHouseName(
	pb: TypedPocketBase,
	houseId: string,
	raw: unknown
): Promise<NameCheck<string>> {
	const name = text(raw);
	if (!name) return { ok: false, message: 'Enter a name for the house.' };
	if (name.length > TEMPLATE_LIMITS.houseNameLength) {
		return {
			ok: false,
			message: `The house name is too long. Use at most ${TEMPLATE_LIMITS.houseNameLength} characters.`
		};
	}
	const houses = await pb.collection('houses').getFullList({ fields: 'id,name', requestKey: null });
	const other = houses.find((house) => house.id !== houseId && same(house.name, name));
	if (other) {
		return {
			ok: false,
			message: `There is already a house called "${other.name}". Pick another name.`
		};
	}
	return { ok: true, value: name };
}

/** A room's new name and number: the number once in its house. */
export async function checkRoomName(
	pb: TypedPocketBase,
	room: { id: string; house: string },
	rawName: unknown,
	rawNumber: unknown
): Promise<NameCheck<{ name: string; room_number: number }>> {
	const name = text(rawName);
	if (!name) return { ok: false, message: 'Enter a name for the room.' };
	if (name.length > TEMPLATE_LIMITS.roomNameLength) {
		return {
			ok: false,
			message: `The name is too long. Use at most ${TEMPLATE_LIMITS.roomNameLength} characters.`
		};
	}
	const digits = text(rawNumber);
	const number = /^\d{1,6}$/.test(digits) ? Number(digits) : NaN;
	if (!(number >= 1 && number <= TEMPLATE_LIMITS.roomNumber)) {
		return {
			ok: false,
			message: `Enter a room number: a whole number from 1 to ${TEMPLATE_LIMITS.roomNumber}.`
		};
	}
	const siblings = await pb.collection('rooms').getFullList({
		filter: pb.filter('house = {:house} && id != {:id}', { house: room.house, id: room.id }),
		fields: 'id,name,room_number',
		requestKey: null
	});
	const other = siblings.find((sibling) => sibling.room_number === number);
	if (other) {
		return {
			ok: false,
			message: `Room number ${number} is already used by "${other.name}" in this house. Pick another number.`
		};
	}
	return { ok: true, value: { name, room_number: number } };
}

/** A spot's new label: once in its room. */
export async function checkSpotLabel(
	pb: TypedPocketBase,
	spot: { id: string; room: string },
	raw: unknown
): Promise<NameCheck<string>> {
	const label = text(raw);
	if (!label) {
		return { ok: false, message: 'Enter a label for the spot, for example "B1" or "Top Bunk".' };
	}
	if (label.length > TEMPLATE_LIMITS.bedLabelLength) {
		return {
			ok: false,
			message: `The label is too long. Use at most ${TEMPLATE_LIMITS.bedLabelLength} characters.`
		};
	}
	const siblings = await pb.collection('beds').getFullList({
		filter: pb.filter('room = {:room} && id != {:id}', { room: spot.room, id: spot.id }),
		fields: 'id,label',
		requestKey: null
	});
	if (siblings.some((bed) => same(bed.label, label))) {
		return {
			ok: false,
			message: `This room already has a spot called "${label}". Pick another label.`
		};
	}
	return { ok: true, value: label };
}
