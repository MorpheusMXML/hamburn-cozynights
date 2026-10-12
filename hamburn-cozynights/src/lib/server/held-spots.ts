// src/lib/server/held-spots.ts
/**
 * Deleting a house, a room or a spot, and freeing a spot on the room page,
 * ends the guest bookings on it (docs/admin/camp-layout.md). A misclick must
 * not cost guests their spots:
 * - only a superuser releases guest bookings that way; a regular admin is
 *   told how many there are, and nothing happens;
 * - a spot the crew booked for a special-needs request is never released on
 *   the quiet: the superuser's confirmation says so (RELEASE_CREW_SPOTS),
 *   otherwise nothing happens and the message says how many.
 * Spots the crew marked taken without a ticket (🔄 TAKEN) hold no booking:
 * any admin may free or delete them.
 */
import type { TypedPocketBase } from '$lib/pocketbase-types';
import type { AdminSession } from '$lib/server/admin-auth';
import { crewBookedBeds } from '$lib/server/special-requests';
import { RELEASE_CREW_SPOTS } from '$lib/held-spots';

export { RELEASE_CREW_SPOTS };

/** Guest bookings among some spots; `crew` of them the crew booked for requests. */
export interface HeldSpots {
	guest: number;
	crew: number;
	/** The spots the crew booked for requests (to forget them on their requests). */
	crewBedIds: string[];
}

/** Counts the guest bookings (spots with a ticket) among `beds`. */
export async function countHeld(
	adminPb: TypedPocketBase,
	beds: { id: string; order?: string | null }[]
): Promise<HeldSpots> {
	const booked = beds.filter((bed) => !!bed.order);
	if (booked.length === 0) return { guest: 0, crew: 0, crewBedIds: [] };
	const crewBooked = await crewBookedBeds(adminPb);
	const crewBedIds = booked
		.filter((bed) => crewBooked.get(bed.id) === bed.order)
		.map((bed) => bed.id);
	return { guest: booked.length, crew: crewBedIds.length, crewBedIds };
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * Why `admin` may not release these bookings, or null when they may.
 * @param what the subject of the sentence: "This house", "This room", "This spot"
 * @param form the action's form: RELEASE_CREW_SPOTS = '1' releases crew-booked spots too
 */
export function releaseRefusal(
	admin: Pick<AdminSession, 'isSuperuser'>,
	held: HeldSpots,
	form: FormData | null,
	what: string
): { status: number; message: string; crewBooked?: number } | null {
	if (held.guest === 0) return null;
	const them = held.guest === 1 ? 'it' : 'them';
	if (!admin.isSuperuser) {
		return {
			status: 403,
			message: `${what} holds ${plural(held.guest, 'guest booking', 'guest bookings')} — only a superuser can release ${them}.`
		};
	}
	if (held.crew > 0 && form?.get(RELEASE_CREW_SPOTS) !== '1') {
		const crewThem = held.crew === 1 ? 'it' : 'them';
		return {
			status: 409,
			message: `${what} holds ${plural(held.crew, 'spot', 'spots')} the crew booked for special-needs requests, so nothing was changed. Release ${crewThem} on the Special needs page first, or confirm releasing ${crewThem} too.`,
			crewBooked: held.crew
		};
	}
	return null;
}
