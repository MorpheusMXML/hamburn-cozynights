import { error, redirect } from '@sveltejs/kit';
import { InventoryService } from '$lib/server/inventory';
import type { PageServerLoad } from './$types';
import type { OrdersResponse } from '$lib/pocketbase-types';
import { BookingService } from '$lib/server/booking';
import { signInUrl } from '$lib/server/guest-session';
import { getBookingSettings } from '$lib/server/settings';
import { readAvailableFilters } from '$lib/server/wishes';
import { passSummary } from '$lib/server/pass';
import { openingCountdownAt } from '$lib/booking-phase';
import { readFilters, spotFacts, spotMatchesFilters, type SpotFilter } from '$lib/accommodation';
import type { HouseData } from '$lib/types';

/**
 * A house as the camp map draws it: the pin and its name, the glow (spots in
 * all, spots free), the hut-group icon, the guest's own house, and while the
 * map is filtered how many free spots fit the wishes. Nothing else of the
 * camp goes to the browser: the whole tree, every room and spot record, was
 * ~107 KB per visit for the 297 spots of Hamburn 2026, and the house and room
 * pages read their own rooms and spots when the guest opens them.
 */
export interface MapHouse {
	id: string;
	name: string;
	x: number;
	y: number;
	kind: string;
	totalBeds: number;
	freeBeds: number;
	mine: boolean;
	/** Only while the map is filtered (`?w=`): free spots that answer every wish. */
	fittingFree?: number;
}

/**
 * Free spots of a house that answer every wish the guest picked. The tree
 * comes from InventoryService.getFullTree (whole records, so `features_off`
 * is there): what a room or spot switched off is gone from its sum.
 */
function countFitting(house: { features?: string[]; rooms: any[] }, wishes: SpotFilter[]): number {
	return house.rooms.reduce(
		(sum, room) =>
			sum +
			room.beds.filter(
				(bed: { occupied?: boolean; bed_type?: string; features_off?: string[] }) =>
					!bed.occupied &&
					spotMatchesFilters(
						wishes,
						spotFacts({
							bedType: bed.bed_type,
							house: house.features,
							room: room.features,
							roomOff: room.features_off,
							spotOff: bed.features_off
						})
					)
			).length,
		0
	);
}

/** The summary of one house of the tree (see MapHouse). */
function mapHouse(house: HouseData, wishes: SpotFilter[]): MapHouse {
	const summary: MapHouse = {
		id: house.id,
		name: house.name,
		x: house.x ?? 0,
		y: house.y ?? 0,
		kind: house.kind ?? '',
		totalBeds: house.totalBeds,
		freeBeds: house.freeBeds,
		mine: !!house.mine
	};
	if (wishes.length > 0) summary.fittingFree = countFitting(house, wishes);
	return summary;
}

/** What the wishes found, as the top bar says it next to the chips. */
function wishFitText(matchingHouses: number): string {
	if (matchingHouses === 0) {
		return 'No house has a free spot that fits — the crew may not have filled in every detail.';
	}
	return `${matchingHouses} ${matchingHouses === 1 ? 'house has' : 'houses have'} a fitting free spot`;
}

/** Closed: the ticket's spot as a small booking pass, or that it holds none. Optional too. */
async function closedPanelPass(locals: App.Locals, order: OrdersResponse) {
	try {
		const bed = await new BookingService(locals.adminPb).getBedForOrder(order.id);
		return { pass: bed ? await passSummary(locals.adminPb, order, bed) : null, noSpot: !bed };
	} catch (err) {
		console.error('[Map] Booking pass failed:', (err as Error)?.message);
		return { pass: null, noSpot: false };
	}
}

export const load: PageServerLoad = async ({ locals, url, setHeaders }) => {
	// Free spots change by the second: never from a cache (a Back after the
	// back-forward cache dropped the page would otherwise show the old map).
	setHeaders({ 'cache-control': 'private, no-store' });
	// The ticket list or the booking round ended this session: say so on the
	// start page instead of showing the map as if nobody had ever signed in.
	if (locals.guestSignOut) throw redirect(303, signInUrl(locals));

	try {
		// The service account reads the beds (their rules are admin-only since
		// beds carry is_special, order and booked_at); getFullTree strips all of it.
		// Without its token the beds rule quietly answers with no beds at all, and
		// the camp would look sold out: say "try again" instead.
		if (!locals.adminPb.authStore.isValid) throw new Error('service account not signed in');
		// Only the guest's own house learns that it holds their spot (`mine`).
		const inventory = new InventoryService(locals.adminPb);
		let tree = await inventory.getFullTree({ orderId: locals.order?.id });
		const [{ isBookingActive, phase, guestPhase, next }, availableFilters] = await Promise.all([
			getBookingSettings(locals.pb),
			// The wish chips of the top bar: only the wishes some spot answers.
			readAvailableFilters(locals.adminPb)
		]);

		if (phase !== 'staging') {
			// The layout is final: leave out unconfigured houses (live and closed).
			tree = tree.filter((h) => h.isBookable);
		}

		// What the guest is looking for. Strict on purpose: a spot nobody described
		// never matches, so a wish never promises something the crew never wrote down.
		const wishes = readFilters(url.searchParams.get('w'));
		// The tree stays here: the map gets one small summary per house.
		const houses = tree.map((house) => mapHouse(house, wishes));
		const wishFit =
			wishes.length > 0
				? wishFitText(houses.filter((house) => (house.fittingFree ?? 0) > 0).length)
				: '';

		// Closed: the panel over the map shows the guest's spot as a small booking
		// pass. The ticket was read once per request in hooks.server.ts; whether
		// it sent a special-needs request comes with the layout data (the ♿ link).
		const { pass, noSpot } =
			phase === 'closed' && locals.order
				? await closedPanelPass(locals, locals.order)
				: { pass: null, noSpot: false };

		return {
			houses,
			wishes,
			availableFilters,
			wishFit,
			isBookingActive,
			phase,
			// what the boxes and banners say; the phase itself still decides what is allowed
			guestPhase,
			// only an armed opening still ahead: a paused or elapsed time shows no countdown
			bookingUnlockAt: openingCountdownAt(phase, next),
			pass,
			noSpot
		};
	} catch (err) {
		console.error('[Map] Load failed:', (err as Error)?.message);
		throw error(503, 'The map could not be loaded right now. Please try again in a minute.');
	}
};
