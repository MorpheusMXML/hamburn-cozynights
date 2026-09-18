import { redirect, error, fail, type ActionFailure } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import type {
	HousesResponse,
	BedsResponse,
	RoomsResponse,
	TypedPocketBase
} from '$lib/pocketbase-types';
import { APP_SETTINGS_ID } from '$lib/server/constants';
import { getBookingSettings } from '$lib/server/settings';
import { berlinLocalToIso } from '$lib/time';
import { countSpots } from '$lib/occupancy';
import { MAP_WIDTH, MAP_HEIGHT, parseMapCoordinate } from '$lib/map-geometry';
import { parseTemplate, TEMPLATE_LIMITS, type TemplateParseResult } from '$lib/template';
import { defaultSelection } from '$lib/template-diff';
import { applyTemplate, compareTemplate, TemplateImportError } from '$lib/server/template';
import { logAdminEvent } from '$lib/server/admin-events';
import { crewBookedBeds } from '$lib/server/special-requests';

/** Keys of the chosen changes; a real layout has far fewer. */
const MAX_SELECTED_CHANGES = 20000;

/**
 * The uploaded template file, validated. Shared by the review (every admin,
 * any phase: it changes nothing) and the import (superusers, Staging only).
 */
async function readTemplateUpload(
	request: Request
): Promise<
	| { refused: ActionFailure<{ error: string; errors: string[] }> }
	| { parsed: Extract<TemplateParseResult, { ok: true }>; form: FormData }
> {
	const refuse = (status: number, ...errors: string[]) => ({
		refused: fail(status, { error: errors[0], errors })
	});

	const form = await request.formData().catch(() => null);
	const file = form?.get('template');
	// A form sent without a chosen file carries an empty, nameless one.
	if (!form || !(file instanceof Blob) || (file.size === 0 && !(file as File).name)) {
		return refuse(400, 'No template file arrived. Choose a .json template file first.');
	}
	if (file.size > TEMPLATE_LIMITS.fileBytes) {
		return refuse(
			400,
			`The file is ${Math.ceil(file.size / 1024)} KB, templates are limited to ${TEMPLATE_LIMITS.fileBytes / 1024} KB. A layout file is usually far smaller, so this is probably the wrong file.`
		);
	}

	const parsed = parseTemplate(await file.text());
	if (!parsed.ok) return refuse(400, ...parsed.errors);
	return { parsed, form };
}

/** The `selection` field of the import: a JSON list of change keys. */
function readSelection(form: FormData): string[] | null {
	try {
		const value = JSON.parse(String(form.get('selection') ?? ''));
		if (!Array.isArray(value) || value.length > MAX_SELECTED_CHANGES) return null;
		return value.filter((key): key is string => typeof key === 'string' && key.length <= 1000);
	} catch {
		return null;
	}
}

/** Clears the burner names of all orders (they only describe bookings), except `keep`. */
async function clearBurnerNames(pb: TypedPocketBase, keep: Set<string> = new Set()) {
	const named = await pb.collection('orders').getFullList({
		filter: 'burner_name != ""',
		fields: 'id'
	});
	for (const order of named) {
		if (keep.has(order.id)) continue;
		await pb.collection('orders').update(order.id, { burner_name: '' });
	}
}

type HouseStats = HousesResponse & {
	totalBeds: number;
	occupiedBeds: number;
	freeBeds: number;
	occupancyRate: number;
};

export const actions: Actions = {
	togglePhase: async ({ locals }) => {
		console.log(`[Action:togglePhase] Admin: ${locals.admin?.email}`);
		if (!locals.admin) return fail(403, { error: 'Unauthorized' });

		try {
			const raw = await locals.pb
				.collection('app_settings')
				.getOne(APP_SETTINGS_ID)
				.catch(() => null);
			// Toggle relative to the *effective* state (raw flag OR an elapsed
			// timer) so the button does what the admin sees, not just the flag.
			const { isBookingActive: effectivelyActive } = await getBookingSettings(locals.pb);
			const nextStatus = !effectivelyActive;

			const update: Record<string, unknown> = { is_booking_active: nextStatus };
			if (!nextStatus && raw?.booking_unlock_at) {
				// Going back to staging: an already-elapsed timer would just make
				// the system effectively live again on the next request, so clear
				// it. A timer still in the future is left alone.
				const unlockTime = new Date(raw.booking_unlock_at).getTime();
				if (!Number.isNaN(unlockTime) && Date.now() >= unlockTime) {
					update.booking_unlock_at = '';
				}
			}

			if (raw) {
				console.log(`[Action:togglePhase] Effective: ${effectivelyActive}, Target: ${nextStatus}`);
				await locals.pb.collection('app_settings').update(APP_SETTINGS_ID, update);
			} else {
				console.log('[Action:togglePhase] Creating initial settings.');
				await locals.pb.collection('app_settings').create({
					id: APP_SETTINGS_ID,
					is_booking_active: true
				});
			}
			console.log('[Action:togglePhase] SUCCESS.');
			return { success: true, isBookingActive: nextStatus };
		} catch (err) {
			console.error('[Action:togglePhase] FAILED:', err);
			return fail(500, { error: 'Toggle failed' });
		}
	},
	clearAllBookings: async ({ locals }) => {
		if (!locals.admin?.isSuperuser) {
			return fail(403, { error: 'Only superusers can clear all bookings.' });
		}

		console.log(`[Action:clearAllBookings] INITIATED by ${locals.admin.email}`);

		try {
			// 1. Release every occupied bed. The orders themselves are the ticket
			//    roster (one order per ticket code) and must survive, otherwise every
			//    guest's code would stop working. Spots the crew booked for
			//    approved special-needs requests stay: they were handed out on
			//    purpose, usually before booking opened.
			const crewBooked = await crewBookedBeds(locals.adminPb);
			const booked = await locals.adminPb.collection('beds').getFullList({
				filter: 'occupied = true || order != ""'
			});
			const occupiedBeds = booked.filter(
				(bed) => !(bed.order && crewBooked.get(bed.id) === bed.order)
			);
			const kept = booked.length - occupiedBeds.length;
			const keep = new Set(
				booked.filter((bed) => !occupiedBeds.includes(bed)).map((bed) => bed.order)
			);

			console.log(
				`[Action:clearAllBookings] Clearing ${occupiedBeds.length} spots, keeping ${kept} special-needs spots.`
			);

			for (const bed of occupiedBeds) {
				await locals.adminPb.collection('beds').update(bed.id, {
					occupied: false,
					order: null
				});
			}

			// 2. Forget the burner names chosen for those bookings.
			await clearBurnerNames(locals.adminPb, keep);

			console.log('[Action:clearAllBookings] SUCCESS. All spots released, ticket codes kept.');
			await logAdminEvent(locals.adminPb, locals.admin, 'bookings_cleared', '', {
				released: occupiedBeds.length,
				kept
			});
			return { success: true, kept };
		} catch (err) {
			console.error('[Action:clearAllBookings] FAILED:', err);
			return fail(500, { error: 'Purge failed' });
		}
	},
	setUnlockTimer: async ({ locals, request }) => {
		console.log(`[Action:setUnlockTimer] Admin: ${locals.admin?.email}`);
		if (!locals.admin) return fail(403);
		const data = await request.formData();
		const date = data.get('unlockAt') as string;

		// The form's datetime-local value has no timezone; the UI presents it as
		// event time (Europe/Berlin), independent of the server's own timezone.
		const unlockAt = date ? berlinLocalToIso(date) : '';
		if (date && !unlockAt) return fail(400, { error: 'Invalid date.' });

		try {
			await locals.pb.collection('app_settings').update(APP_SETTINGS_ID, {
				booking_unlock_at: unlockAt
			});
			console.log(`[Action:setUnlockTimer] SUCCESS. Target: ${date}`);
		} catch (err) {
			console.error('[Action:setUnlockTimer] FAILED:', err);
			return fail(500);
		}
	},
	cancelUnlockTimer: async ({ locals }) => {
		console.log(`[Action:cancelUnlockTimer] Admin: ${locals.admin?.email}`);
		if (!locals.admin) return fail(403);
		try {
			await locals.pb.collection('app_settings').update(APP_SETTINGS_ID, {
				booking_unlock_at: ''
			});
			console.log('[Action:cancelUnlockTimer] SUCCESS.');
		} catch (err) {
			console.error('[Action:cancelUnlockTimer] FAILED:', err);
			return fail(500);
		}
	},
	updateHouseCoords: async ({ locals, request }) => {
		const data = await request.formData();
		const id = data.get('id') as string;
		const x = parseMapCoordinate(data.get('x'), MAP_WIDTH);
		const y = parseMapCoordinate(data.get('y'), MAP_HEIGHT);

		console.log(
			`[Action:updateHouseCoords] Admin: ${locals.admin?.email}, ID: ${id}, New: (${x}, ${y})`
		);

		if (!locals.admin) return fail(403, { error: 'Unauthorized' });
		if (!id || x === null || y === null) {
			return fail(400, {
				error: `Coordinates must be numbers on the map: X 0–${MAP_WIDTH}, Y 0–${MAP_HEIGHT}.`
			});
		}

		try {
			const { isBookingActive } = await getBookingSettings(locals.pb);
			if (isBookingActive) {
				console.warn(`[Action:updateHouseCoords] BLOCKED: LIVE mode — map layout is locked.`);
				return fail(403, { error: 'Map layout is locked during Live Booking. 🔒' });
			}

			await locals.pb.collection('houses').update(id, { x, y });
			console.log(`[Action:updateHouseCoords] SUCCESS for ${id}`);
			return { success: true };
		} catch (err) {
			console.error(`[Action:updateHouseCoords] FAILED for ${id}:`, err);
			return fail(500, { error: 'Sync failed.' });
		}
	},
	deleteHouse: async ({ locals, request }) => {
		const data = await request.formData();
		const id = data.get('id') as string;

		console.log(`[Action:deleteHouse] Admin: ${locals.admin?.email}, ID: ${id}`);

		if (!locals.admin) return fail(403, { error: 'Unauthorized' });

		try {
			const { isBookingActive } = await getBookingSettings(locals.pb);
			if (isBookingActive) {
				console.warn(`[Action:deleteHouse] BLOCKED: LIVE mode — structure is locked.`);
				return fail(403, {
					error: 'The playa says NO! 🛑 Houses cannot be vanished during Live Booking.'
				});
			}

			const occupiedBeds = await locals.pb.collection('beds').getFullList({
				filter: locals.pb.filter('room.house = {:id} && occupied = true', { id }),
				expand: 'room'
			});
			// For the audit log / crew chat when bookings go with the house.
			const houseName =
				occupiedBeds.length > 0
					? ((
							await locals.pb
								.collection('houses')
								.getOne(id)
								.catch(() => null)
						)?.name ?? id)
					: '';

			if (occupiedBeds.length > 0) {
				console.log(
					`[Action:deleteHouse] Staging Mode: Auto-clearing ${occupiedBeds.length} test bookings for House ${id}.`
				);
				for (const bed of occupiedBeds) {
					await locals.pb.collection('beds').update(bed.id, { occupied: false, order: null });
				}
			}

			const rooms = await locals.pb.collection('rooms').getFullList({
				filter: locals.pb.filter('house = {:id}', { id })
			});

			console.log(`[Action:deleteHouse] Vanishing ${rooms.length} modules...`);
			for (const room of rooms) {
				const beds = await locals.pb.collection('beds').getFullList({
					filter: locals.pb.filter('room = {:id}', { id: room.id })
				});
				for (const bed of beds) {
					await locals.pb.collection('beds').delete(bed.id);
				}
				await locals.pb.collection('rooms').delete(room.id);
			}

			await locals.pb.collection('houses').delete(id);
			console.log(`[Action:deleteHouse] SUCCESS. House ${id} evaporated.`);
			if (occupiedBeds.length > 0) {
				await logAdminEvent(locals.adminPb, locals.admin, 'house_deleted', houseName, {
					released: occupiedBeds.length
				});
			}
			return { success: true };
		} catch (err) {
			console.error(`[Action:deleteHouse] FAILED for ${id}:`, err);
			return fail(500, { error: 'Vanish failed.' });
		}
	},
	renameHouse: async ({ locals, request }) => {
		const data = await request.formData();
		const id = data.get('id') as string;
		const name = data.get('name') as string;

		console.log(`[Action:renameHouse] Admin: ${locals.admin?.email}, ID: ${id}, New Name: ${name}`);

		if (!locals.admin) return fail(403, { error: 'Unauthorized' });

		if (!name) return fail(400, { error: 'Name is required' });

		try {
			const { isBookingActive } = await getBookingSettings(locals.pb);
			if (isBookingActive) {
				console.warn(`[Action:renameHouse] BLOCKED: LIVE mode — structure is locked.`);
				return fail(403, { error: 'House names are locked during Live Booking. 🔒' });
			}

			await locals.pb.collection('houses').update(id, { name });
			console.log(`[Action:renameHouse] SUCCESS for ${id}`);
			return { success: true };
		} catch (err) {
			console.error(`[Action:renameHouse] FAILED for ${id}:`, err);
			return fail(500, { error: 'Update failed.' });
		}
	},
	previewTemplate: async ({ locals, request }) => {
		if (!locals.admin) return fail(403, { error: 'Unauthorized', errors: ['Unauthorized'] });
		const upload = await readTemplateUpload(request);
		if ('refused' in upload) return upload.refused;

		const { template, summary, warnings } = upload.parsed;
		try {
			const [diff, { isBookingActive }] = await Promise.all([
				compareTemplate(locals.adminPb, template),
				getBookingSettings(locals.pb)
			]);
			let lockedReason = '';
			if (!locals.admin.isSuperuser) {
				lockedReason = 'Only superusers can apply a template. You can compare files with the camp.';
			} else if (isBookingActive) {
				lockedReason =
					'Live Booking is active, so the layout is locked. Switch to Staging Mode to apply changes.';
			}
			return {
				review: {
					name: template.name,
					summary,
					warnings: [...warnings, ...diff.warnings],
					diff,
					selection: [...defaultSelection(diff)],
					lockedReason
				}
			};
		} catch (err) {
			console.error('[Preview Template] FAILED:', err);
			const error = 'The current layout could not be read from the database. Try again.';
			return fail(500, { error, errors: [error] });
		}
	},
	importTemplate: async ({ locals, request }) => {
		const refuse = (status: number, error: string) => fail(status, { error, errors: [error] });
		if (!locals.admin?.isSuperuser) {
			return refuse(403, 'Only superusers can import a template.');
		}
		const { isBookingActive } = await getBookingSettings(locals.pb);
		if (isBookingActive) {
			console.warn('[Import Template] BLOCKED: layout is locked during LIVE mode.');
			return refuse(
				403,
				'Templates cannot be imported during Live Booking — the layout is locked. Switch to Staging Mode first. 🔒'
			);
		}

		// Validates the file again: the review is only a courtesy of the UI.
		const upload = await readTemplateUpload(request);
		if ('refused' in upload) return upload.refused;
		const selected = readSelection(upload.form);
		if (!selected) {
			return refuse(400, 'The list of chosen changes did not arrive. Check the file again.');
		}

		const { template } = upload.parsed;
		const pb = locals.adminPb;
		console.log(
			`[Import Template] ${locals.admin.email} applies ${selected.length} change(s) from "${template.name}".`
		);

		try {
			const outcome = await applyTemplate(pb, template, selected, {
				skipBackup: upload.form.get('skipBackup') === '1'
			});
			console.log(
				`[Import Template] DONE. Backup: ${outcome.backup ?? 'none'}, created ${JSON.stringify(outcome.created)}, updated ${JSON.stringify(outcome.updated)}, removed ${JSON.stringify(outcome.removed)}, released bookings: ${outcome.releasedBookings}, problems: ${outcome.problems.length}.`
			);
			const touched =
				Object.values(outcome.created).some(Boolean) ||
				Object.values(outcome.updated).some(Boolean) ||
				Object.values(outcome.removed).some(Boolean);
			if (touched) {
				await logAdminEvent(pb, locals.admin, 'template_imported', template.name, {
					created: outcome.created,
					updated: outcome.updated,
					removed: outcome.removed,
					releasedBookings: outcome.releasedBookings,
					problems: outcome.problems.length,
					backup: outcome.backup ?? 'skipped'
				});
			}
			return { applied: outcome };
		} catch (err) {
			if (err instanceof TemplateImportError) {
				return fail(err.status, {
					error: err.message,
					errors: [err.message],
					backupFailed: err.backupFailed
				});
			}
			console.error('[Import Template] FAILED:', err);
			const error =
				'The import stopped with an unexpected error. Check the layout on the map before you try again. The server log has the details.';
			return fail(500, { error, errors: [error] });
		}
	}
};

export const load: PageServerLoad = async ({ locals }) => {
	// Runs in parallel with the layout load, so it guards itself too.
	if (!locals.admin) throw redirect(303, '/admin/login');

	const [houses, allRooms, allBeds, settings, orders] = await Promise.all([
		locals.pb.collection('houses').getFullList<HousesResponse>({ sort: 'name' }),
		locals.pb.collection('rooms').getFullList<RoomsResponse>(),
		locals.pb
			.collection('beds')
			.getFullList<BedsResponse<{ room: RoomsResponse }>>({ expand: 'room' }),
		getBookingSettings(locals.pb),
		locals.adminPb.collection('orders').getFullList({ fields: 'created' })
	]);

	// Sanity Checks logic 🛠️
	const sanityWarnings = houses
		.map((house) => {
			const houseRooms = allRooms.filter((r) => r.house === house.id);
			const roomsWithIssues = houseRooms
				.map((room) => {
					const roomBeds = allBeds.filter((b) => b.room === room.id);
					return {
						id: room.id,
						name: room.name,
						number: room.room_number,
						bedCount: roomBeds.length,
						hasNoBeds: roomBeds.length === 0
					};
				})
				.filter((r) => r.hasNoBeds);

			return {
				id: house.id,
				name: house.name,
				noRooms: houseRooms.length === 0,
				roomsWithNoBeds: roomsWithIssues
			};
		})
		.filter((w) => w.noRooms || w.roomsWithNoBeds.length > 0);

	const housesWithStats: HouseStats[] = houses.map((house: HousesResponse) => {
		const bedsInHouse = allBeds.filter((b: BedsResponse<{ room: RoomsResponse }>) => {
			return b.expand?.room?.house === house.id;
		});

		// Same counting as the house page: deactivated spots don't count, locked
		// ones aren't free.
		const spots = countSpots(bedsInHouse);
		const occupancyRate = spots.total > 0 ? Math.round((spots.occupied / spots.total) * 100) : 0;

		return {
			...structuredClone(house),
			totalBeds: spots.total,
			occupiedBeds: spots.occupied,
			freeBeds: spots.free,
			occupancyRate
		};
	});

	// Real orders created per day, last 7 days (including today).
	// Bucket by Berlin calendar day (the event's timezone), not UTC — a raw
	// UTC slice would misfile any booking made in the CET/CEST evening into
	// "tomorrow".
	const berlinDay = new Intl.DateTimeFormat('en-CA', {
		timeZone: 'Europe/Berlin',
		year: 'numeric',
		month: '2-digit',
		day: '2-digit'
	});
	const berlinWeekday = new Intl.DateTimeFormat('en-US', {
		timeZone: 'Europe/Berlin',
		weekday: 'short'
	});
	const days: { key: string; label: string }[] = [];
	for (let i = 6; i >= 0; i--) {
		const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
		days.push({ key: berlinDay.format(d), label: berlinWeekday.format(d) });
	}
	const countsByDay = new Map(days.map((d) => [d.key, 0]));
	for (const order of orders) {
		if (!order.created) continue;
		const key = berlinDay.format(new Date(order.created));
		if (countsByDay.has(key)) {
			countsByDay.set(key, (countsByDay.get(key) || 0) + 1);
		}
	}
	const history = {
		bookingTrend: days.map((d) => countsByDay.get(d.key) || 0),
		labels: days.map((d) => d.label)
	};

	return {
		houses: housesWithStats,
		sanityWarnings,
		history,
		isBookingActive: settings.isBookingActive,
		bookingUnlockAt: settings.bookingUnlockAt,
		requestsOpen: settings.requestsOpen
	};
};
