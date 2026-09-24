import type { TypedPocketBase } from '$lib/pocketbase-types';
import { availableFilters, spotFacts, type SpotFilter } from '$lib/accommodation';

/**
 * The wish chips the guest top bar offers: only the filters some spot in the
 * camp answers (src/lib/accommodation.ts, availableFilters).
 *
 * The answer is cached in this module for a minute. It is read on every map
 * and roulette request, it changes only when the crew edits the camp (which
 * is locked during Live Booking anyway), and a chip that appears a minute
 * after the crew ticked "heated" is soon enough. One camp per server, so one
 * cache; a restart empties it.
 */
const CACHE_MS = 60_000;

let cached: { at: number; filters: SpotFilter[] } | null = null;
let pending: Promise<SpotFilter[]> | null = null;

/**
 * Every active spot of the camp as facts: its own features plus its room's and
 * house's, minus what the room or the spot switched off (`features_off`, a
 * superuser's call) — otherwise a chip would promise a heating the spot gave up.
 */
async function readSpotFacts(pb: TypedPocketBase) {
	const [houses, rooms, beds] = await Promise.all([
		pb.collection('houses').getFullList({ fields: 'id,features', requestKey: null }),
		pb.collection('rooms').getFullList({
			fields: 'id,house,features,features_off',
			requestKey: null
		}),
		pb.collection('beds').getFullList({
			fields: 'room,bed_type,features,features_off,enabled',
			requestKey: null
		})
	]);
	const houseById = new Map(houses.map((house) => [house.id, house]));
	const roomById = new Map(rooms.map((room) => [room.id, room]));
	return beds
		.filter((bed) => bed.enabled !== false)
		.map((bed) => {
			const room = roomById.get(bed.room);
			return spotFacts({
				bedType: bed.bed_type,
				house: room ? houseById.get(room.house)?.features : undefined,
				room: room?.features,
				spot: bed.features,
				roomOff: room?.features_off,
				spotOff: bed.features_off
			});
		});
}

/**
 * The filters worth offering right now. Reads houses, rooms and beds once
 * (the service account: beds are admin-only) and keeps the answer for a
 * minute; parallel requests share one read. When PocketBase can't answer,
 * the last answer stays in use, or no chips are offered.
 */
export async function readAvailableFilters(pb: TypedPocketBase): Promise<SpotFilter[]> {
	const now = Date.now();
	if (cached && now - cached.at < CACHE_MS) return cached.filters;
	if (!pending) {
		pending = readSpotFacts(pb)
			.then((spots) => {
				cached = { at: Date.now(), filters: availableFilters(spots) };
				return cached.filters;
			})
			.catch((err) => {
				console.error('[Wishes] Reading the camp failed:', (err as Error)?.message);
				return cached?.filters ?? [];
			})
			.finally(() => (pending = null));
	}
	return pending;
}

/** Drops the cached answer (tests, and after the crew changed the camp). */
export function forgetAvailableFilters(): void {
	cached = null;
}
