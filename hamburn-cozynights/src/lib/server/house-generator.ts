// src/lib/server/house-generator.ts
/**
 * The house generator against PocketBase (docs/admin/camp-layout.md): the
 * rooms of a plan ($lib/house-plan) with rolled names ($lib/place-names) and
 * their spots B1 … Bn, bunk beds stacked right away. Used by "IGNITE HOUSE"
 * (/admin/house/new) and by ADD ROOMS on a house page.
 */
import type { TypedPocketBase, RoomsResponse } from '$lib/pocketbase-types';
import { defaultRoomKind, roomWord } from '$lib/accommodation';
import { planProblem, planRooms, planSpots, planTotals, type RoomPlan } from '$lib/house-plan';
import { rollRoomNames } from '$lib/place-names';
import { describeError } from './template';

/** A generation that did not happen; `message` is written for the admin. */
export class GeneratorError extends Error {
	constructor(
		message: string,
		public status = 500,
		/** What became of the rooms created before the failure, when there were any. */
		public aftermath = ''
	) {
		super(message);
		this.name = 'GeneratorError';
	}

	/** The message and its aftermath, as the house page shows it. */
	get full(): string {
		return this.aftermath ? `${this.message} ${this.aftermath}` : this.message;
	}
}

export interface GeneratedRooms {
	rooms: number;
	spots: number;
	bunkBeds: number;
	/** The new rooms' names, in number order. */
	names: string[];
}

const isNotFound = (err: unknown) => (err as { status?: number })?.status === 404;

/**
 * Creates the planned rooms and their spots in `house`. The house's rooms
 * are read first: numbers continue after them (planRooms) and no rolled name
 * repeats one of them. Every spot is active, like any new spot.
 *
 * PocketBase has no transaction over several requests: when a write fails,
 * the rooms created so far are deleted again — their spots go with them —
 * and a GeneratorError says what happened.
 */
export async function generateRooms(
	pb: TypedPocketBase,
	house: { id: string; kind?: string },
	plan: RoomPlan,
	options: { allowEmpty?: boolean; random?: () => number } = {}
): Promise<GeneratedRooms> {
	let existing: Pick<RoomsResponse, 'id' | 'name' | 'room_number'>[];
	try {
		existing = await pb.collection('rooms').getFullList({
			filter: pb.filter('house = {:id}', { id: house.id }),
			fields: 'id,name,room_number',
			requestKey: null
		});
	} catch (err) {
		console.error('[Generator] The house could not be read:', err);
		throw new GeneratorError(
			`The house could not be read (${describeError(err)}). Nothing was created. Reload the page and try again.`
		);
	}

	const numbers = existing.map((room) => Number(room.room_number)).filter(Number.isFinite);
	const word = roomWord(house.kind);
	const problem = planProblem(plan, {
		existing: numbers,
		allowEmpty: options.allowEmpty,
		word,
		plural: roomWord(house.kind, true)
	});
	if (problem) throw new GeneratorError(problem.message, 400);

	const planned = planRooms(plan, numbers);
	const kind = defaultRoomKind(house.kind);
	const names = rollRoomNames(
		planned.length,
		kind,
		existing.map((room) => room.name ?? ''),
		options.random
	);

	const created: string[] = [];
	let where = '';
	try {
		for (const [index, room] of planned.entries()) {
			where = `${word} #${room.number} "${names[index]}"`;
			const record = await pb.collection('rooms').create({
				name: names[index],
				room_number: room.number,
				kind,
				amount_beds: room.spots,
				house: house.id
			});
			created.push(record.id);

			const spots = planSpots(room.spots, room.bunks);
			const ids: string[] = [];
			for (const spot of spots) {
				where = `spot ${spot.label} of ${word} #${room.number}`;
				// The upper bunk points at the lower one, created just before it;
				// the lower one gets its pointer back right after.
				const partner = spot.bed_type === 'bunk_upper' && spot.partner !== null;
				const bed = await pb.collection('beds').create({
					label: spot.label,
					room: record.id,
					enabled: true,
					occupied: false,
					...(spot.bed_type ? { bed_type: spot.bed_type } : {}),
					...(partner ? { bunk_partner: ids[spot.partner as number] } : {})
				});
				ids.push(bed.id);
				if (partner) {
					await pb.collection('beds').update(ids[spot.partner as number], { bunk_partner: bed.id });
				}
			}
		}
	} catch (err) {
		console.error(`[Generator] Creating ${where} failed, rolling back:`, err);
		let stuck = 0;
		for (const id of created) {
			try {
				await pb.collection('rooms').delete(id);
			} catch (cleanup) {
				if (isNotFound(cleanup)) continue;
				stuck++;
				console.error(`[Generator] Could not remove room ${id}:`, cleanup);
			}
		}
		throw new GeneratorError(
			`The database refused ${where} (${describeError(err)}).`,
			500,
			stuck === 0
				? 'Everything created so far was removed again, nothing changed.'
				: `${stuck} half-created ${stuck === 1 ? word : roomWord(house.kind, true)} could not be removed. Delete them on the house page.`
		);
	}

	const totals = planTotals(plan.sizes);
	return { rooms: totals.rooms, spots: totals.spots, bunkBeds: totals.bunkBeds, names };
}
