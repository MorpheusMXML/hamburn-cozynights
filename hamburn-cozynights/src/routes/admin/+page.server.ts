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
import {
	checkWindowEdit,
	effectivePhase,
	isArmed,
	lockedDuring,
	saveTimesEdit,
	switchPhase,
	windowFromRecord,
	windowToRecord,
	type BookingPhase,
	type BookingWindow,
	type WindowEdit
} from '$lib/booking-phase';

const isBookingPhase = (value: string): value is BookingPhase =>
	value === 'staging' || value === 'live' || value === 'closed';

/** The stored booking window (defaults when the settings record is missing). */
async function readWindow(pb: TypedPocketBase) {
	const record = await pb
		.collection('app_settings')
		.getOne(APP_SETTINGS_ID, { requestKey: null })
		.catch((err) => {
			if (err?.status === 404) return null;
			throw err;
		});
	return { exists: !!record, window: windowFromRecord(record) };
}

/**
 * Written with the admin's own token: PocketBase then knows who it was (crew
 * alert) and refuses a phase switch by a non-superuser (pb_hooks/cozy_phase.pb.js).
 */
async function writeWindow(pb: TypedPocketBase, exists: boolean, next: BookingWindow) {
	const data = windowToRecord(next);
	if (exists) await pb.collection('app_settings').update(APP_SETTINGS_ID, data);
	else await pb.collection('app_settings').create({ id: APP_SETTINGS_ID, ...data });
}

function phaseFailure(action: string, err: unknown, unchanged: string) {
	const status = (err as { status?: number })?.status;
	const message = (err as { response?: { message?: unknown } })?.response?.message;
	console.error(`[Action:${action}] FAILED:`, err);
	if (status === 403) {
		return fail(403, {
			error: `${typeof message === 'string' && message ? message : 'Not allowed.'} ${unchanged}`
		});
	}
	return fail(500, { error: `The server could not save it. ${unchanged}` });
}

/** Changes of the booking window by any admin, checked by the rules in $lib/booking-phase. */
async function editWindow(
	locals: App.Locals,
	action: string,
	makeEdit: (current: BookingWindow) => WindowEdit,
	precondition: (current: BookingWindow) => string = () => ''
) {
	try {
		const { exists, window } = await readWindow(locals.pb);
		const refused = precondition(window);
		if (refused) return fail(400, { error: refused });
		const check = checkWindowEdit(window, makeEdit(window), {
			isSuperuser: !!locals.admin?.isSuperuser
		});
		if (check.error) return fail(400, { error: check.error });
		await writeWindow(locals.pb, exists, check.next);
		console.log(`[Action:${action}] SUCCESS. Phase ${check.phaseBefore} → ${check.phaseAfter}`);
		return { success: true, phase: check.phaseAfter, phaseBefore: check.phaseBefore };
	} catch (err) {
		return phaseFailure(action, err, 'The booking window was not changed.');
	}
}

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

/** Releasing bookings stopped halfway: how far it got. */
class ReleaseStoppedError extends Error {
	constructor(
		public released: number,
		public total: number,
		public reason: unknown
	) {
		super(`Releasing bookings stopped after ${released} of ${total} spots`);
		this.name = 'ReleaseStoppedError';
	}
}

/**
 * Releases every guest booking ("clear all bookings", and what going back to
 * Staging Mode does). The orders themselves are the ticket roster and survive,
 * otherwise every guest's code would stop working; the burner names of the
 * released bookings are forgotten. Spots the crew booked for approved
 * special-needs requests stay: they were handed out on purpose, usually
 * before booking opened.
 * @throws {ReleaseStoppedError} when the database refuses halfway
 */
async function releaseGuestBookings(
	adminPb: TypedPocketBase
): Promise<{ released: number; kept: number }> {
	const crewBooked = await crewBookedBeds(adminPb);
	const booked = await adminPb.collection('beds').getFullList({
		filter: 'occupied = true || order != ""'
	});
	const occupiedBeds = booked.filter((bed) => !(bed.order && crewBooked.get(bed.id) === bed.order));
	const kept = booked.length - occupiedBeds.length;
	const keep = new Set(booked.filter((bed) => !occupiedBeds.includes(bed)).map((bed) => bed.order));
	let released = 0;
	try {
		for (const bed of occupiedBeds) {
			await adminPb.collection('beds').update(bed.id, { occupied: false, order: null });
			released++;
		}
		await clearBurnerNames(adminPb, keep);
	} catch (err) {
		throw new ReleaseStoppedError(released, occupiedBeds.length, err);
	}
	return { released, kept };
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
	/** The superuser's override: Staging, Live or Closed, right now. */
	setPhase: async ({ locals, request }) => {
		console.log(`[Action:setPhase] Admin: ${locals.admin?.email}`);
		if (!locals.admin) return fail(403, { error: 'Unauthorized' });
		if (!locals.admin.isSuperuser) {
			return fail(403, {
				error:
					'Only superusers can switch the booking phase right now. Plan it with the booking window and arm the timer instead.'
			});
		}
		const to = String((await request.formData().catch(() => null))?.get('phase') ?? '');
		if (!isBookingPhase(to)) return fail(400, { error: 'Unknown booking phase.' });

		try {
			const { exists, window } = await readWindow(locals.pb);
			const now = Date.now();
			const phaseBefore = effectivePhase(window, now);
			if (phaseBefore === to) return { success: true, phase: to, phaseBefore, pausedTimer: false };

			const next = switchPhase(window, to, now);
			await writeWindow(locals.pb, exists, next);
			console.log(`[Action:setPhase] SUCCESS: ${phaseBefore} → ${to}`);

			// Staging Mode never starts with guest bookings: the layout is about to
			// be edited. Spots the crew booked for special-needs requests stay.
			let cleared: { released: number; kept: number } | null = null;
			if (to === 'staging') {
				try {
					cleared = await releaseGuestBookings(locals.adminPb);
					await logAdminEvent(locals.adminPb, locals.admin, 'bookings_cleared', '', {
						...cleared,
						reason: 'staging'
					});
					console.log(
						`[Action:setPhase] ${cleared.released} bookings released, ${cleared.kept} special-needs spots kept.`
					);
				} catch (err) {
					console.error('[Action:setPhase] Staging is on, but releasing the bookings failed:', err);
					const released = err instanceof ReleaseStoppedError ? err.released : 0;
					if (released > 0) {
						await logAdminEvent(locals.adminPb, locals.admin, 'bookings_cleared', '', {
							released,
							kept: 0,
							reason: 'staging',
							stopped: err instanceof ReleaseStoppedError ? err.total : undefined
						});
					}
					return fail(500, {
						error: `Staging Mode is on, but the bookings could not all be released (${released} done). Use "Clear all bookings" for the rest.`
					});
				}
			}
			return {
				success: true,
				phase: to,
				phaseBefore,
				pausedTimer: next.paused && !window.paused,
				released: cleared?.released,
				kept: cleared?.kept
			};
		} catch (err) {
			return phaseFailure('setPhase', err, 'The booking phase was not changed.');
		}
	},
	/** Opening and closing time of the booking window; keeps the timer armed or paused. */
	saveWindow: async ({ locals, request }) => {
		console.log(`[Action:saveWindow] Admin: ${locals.admin?.email}`);
		if (!locals.admin) return fail(403, { error: 'Unauthorized' });
		const form = await request.formData().catch(() => null);
		const opensLocal = String(form?.get('opensAt') ?? '').trim();
		const closesLocal = String(form?.get('closesAt') ?? '').trim();
		// The form's datetime-local values have no timezone; the UI presents them
		// as event time (Europe/Berlin), independent of the server's timezone.
		const opensAt = opensLocal ? berlinLocalToIso(opensLocal) : '';
		const closesAt = closesLocal ? berlinLocalToIso(closesLocal) : '';
		if (opensLocal && !opensAt) {
			return fail(400, { error: 'The opening time is not a complete date and time.' });
		}
		if (closesLocal && !closesAt) {
			return fail(400, { error: 'The closing time is not a complete date and time.' });
		}
		return editWindow(locals, 'saveWindow', (w) => saveTimesEdit(w, opensAt, closesAt));
	},
	armTimer: async ({ locals }) => {
		console.log(`[Action:armTimer] Admin: ${locals.admin?.email}`);
		if (!locals.admin) return fail(403, { error: 'Unauthorized' });
		return editWindow(
			locals,
			'armTimer',
			(w) => ({ ...w, paused: false }),
			(w) =>
				isArmed({ ...w, paused: false })
					? ''
					: 'Plan the booking window first: it has no times yet.'
		);
	},
	pauseTimer: async ({ locals }) => {
		console.log(`[Action:pauseTimer] Admin: ${locals.admin?.email}`);
		if (!locals.admin) return fail(403, { error: 'Unauthorized' });
		return editWindow(locals, 'pauseTimer', (w) => ({ ...w, paused: true }));
	},
	clearAllBookings: async ({ locals }) => {
		if (!locals.admin?.isSuperuser) {
			return fail(403, { error: 'Only superusers can clear all bookings.' });
		}
		// Only in Staging Mode: switching back to Staging releases the bookings
		// itself, and a stale tab must never clear a live camp.
		const { phase } = await getBookingSettings(locals.pb);
		if (phase !== 'staging') {
			return fail(403, {
				error: `Bookings can only be cleared in Staging Mode, not ${lockedDuring(phase)}. Switching back to Staging releases them.`
			});
		}

		console.log(`[Action:clearAllBookings] INITIATED by ${locals.admin.email}`);
		try {
			const { released, kept } = await releaseGuestBookings(locals.adminPb);
			console.log(
				`[Action:clearAllBookings] SUCCESS. ${released} spots released, ${kept} special-needs spots kept, ticket codes kept.`
			);
			await logAdminEvent(locals.adminPb, locals.admin, 'bookings_cleared', '', {
				released,
				kept
			});
			return { success: true, released, kept };
		} catch (err) {
			console.error('[Action:clearAllBookings] FAILED:', err);
			if (err instanceof ReleaseStoppedError && err.released > 0) {
				await logAdminEvent(locals.adminPb, locals.admin, 'bookings_cleared', '', {
					released: err.released,
					kept: 0,
					stopped: err.total
				});
				return fail(500, {
					error: `Clearing stopped after ${err.released} of ${err.total} spots: the rest are still booked. Reload the page and try again.`
				});
			}
			return fail(500, {
				error: 'No booking was released: the server could not write to the database. Try again.'
			});
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
			const { isLayoutLocked, phase } = await getBookingSettings(locals.pb);
			if (isLayoutLocked) {
				console.warn(`[Action:updateHouseCoords] BLOCKED: ${phase} — map layout is locked.`);
				return fail(403, { error: `Map layout is locked ${lockedDuring(phase)}. 🔒` });
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

		let progress: { released: number; rooms: number; total: number } | null = null;
		try {
			const { isLayoutLocked, phase } = await getBookingSettings(locals.pb);
			if (isLayoutLocked) {
				console.warn(`[Action:deleteHouse] BLOCKED: ${phase} — structure is locked.`);
				return fail(403, {
					error: `The playa says NO! 🛑 Houses cannot be vanished ${lockedDuring(phase)}.`
				});
			}

			const occupiedBeds = await locals.pb.collection('beds').getFullList({
				filter: locals.pb.filter('room.house = {:id} && occupied = true', { id }),
				expand: 'room'
			});
			// For the audit log / crew chat: every deleted house is recorded.
			const houseName =
				(
					await locals.pb
						.collection('houses')
						.getOne(id)
						.catch(() => null)
				)?.name ?? id;

			const rooms = await locals.pb.collection('rooms').getFullList({
				filter: locals.pb.filter('house = {:id}', { id })
			});
			// What already happened when a step fails halfway (the message says so).
			progress = { released: 0, rooms: 0, total: rooms.length };

			if (occupiedBeds.length > 0) {
				console.log(
					`[Action:deleteHouse] Staging Mode: Auto-clearing ${occupiedBeds.length} test bookings for House ${id}.`
				);
				for (const bed of occupiedBeds) {
					await locals.pb.collection('beds').update(bed.id, { occupied: false, order: null });
					progress.released++;
				}
			}

			console.log(`[Action:deleteHouse] Vanishing ${rooms.length} modules...`);
			for (const room of rooms) {
				const beds = await locals.pb.collection('beds').getFullList({
					filter: locals.pb.filter('room = {:id}', { id: room.id })
				});
				for (const bed of beds) {
					await locals.pb.collection('beds').delete(bed.id);
				}
				await locals.pb.collection('rooms').delete(room.id);
				progress.rooms++;
			}

			await locals.pb.collection('houses').delete(id);
			console.log(`[Action:deleteHouse] SUCCESS. House ${id} evaporated.`);
			await logAdminEvent(locals.adminPb, locals.admin, 'house_deleted', houseName, {
				released: occupiedBeds.length,
				rooms: rooms.length
			});
			return { success: true };
		} catch (err) {
			console.error(`[Action:deleteHouse] FAILED for ${id}:`, err);
			if (progress && (progress.released > 0 || progress.rooms > 0)) {
				return fail(500, {
					error: `Vanish stopped halfway: ${progress.rooms} of ${progress.total} rooms are gone and ${progress.released} bookings were released, the house is still there. Reload the page and try again.`
				});
			}
			return fail(500, { error: 'Vanish failed. Nothing was deleted.' });
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
			const { isLayoutLocked, phase } = await getBookingSettings(locals.pb);
			if (isLayoutLocked) {
				console.warn(`[Action:renameHouse] BLOCKED: ${phase} — structure is locked.`);
				return fail(403, { error: `House names are locked ${lockedDuring(phase)}. 🔒` });
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
			const [diff, { isLayoutLocked, phase }] = await Promise.all([
				compareTemplate(locals.adminPb, template),
				getBookingSettings(locals.pb)
			]);
			let lockedReason = '';
			if (!locals.admin.isSuperuser) {
				lockedReason = 'Only superusers can apply a template. You can compare files with the camp.';
			} else if (isLayoutLocked) {
				lockedReason = `The layout is locked ${lockedDuring(phase)}. Switch to Staging Mode to apply changes.`;
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
		const { isLayoutLocked, phase } = await getBookingSettings(locals.pb);
		if (isLayoutLocked) {
			console.warn(`[Import Template] BLOCKED: layout is locked (${phase}).`);
			return refuse(
				403,
				`Templates cannot be imported ${lockedDuring(phase)} — the layout is locked. Switch to Staging Mode first. 🔒`
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

	const [houses, allRooms, allBeds, settings] = await Promise.all([
		locals.pb.collection('houses').getFullList<HousesResponse>({ sort: 'name' }),
		locals.pb.collection('rooms').getFullList<RoomsResponse>(),
		locals.pb
			.collection('beds')
			.getFullList<BedsResponse<{ room: RoomsResponse }>>({ expand: 'room' }),
		getBookingSettings(locals.pb)
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

	// Spots the crew booked for approved special-needs requests: they survive a
	// switch back to Staging and "clear all bookings", so the dialogs say so.
	const crewBooked = await crewBookedBeds(locals.adminPb).catch((err) => {
		console.error('[Admin] crew-booked spots could not be read:', (err as Error)?.message);
		return new Map<string, string>();
	});
	const crewBookedSpots = allBeds.filter(
		(bed) => !!bed.order && crewBooked.get(bed.id) === bed.order
	).length;

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

	// Spots booked per day, last 7 days (including today): PocketBase stamps
	// beds.booked_at whenever a spot gets a ticket (pb_hooks/cozy_booked.pb.js),
	// so a ticket import is not a booking wave. A released spot drops out, a
	// moved booking counts on the day of the move.
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
	for (const bed of allBeds) {
		if (!bed.order || !bed.booked_at) continue;
		const key = berlinDay.format(new Date(bed.booked_at));
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
		crewBookedSpots,
		sanityWarnings,
		history,
		phase: settings.phase,
		isBookingActive: settings.isBookingActive,
		bookingUnlockAt: settings.bookingUnlockAt,
		requestsOpen: settings.requestsOpen,
		isLayoutLocked: settings.isLayoutLocked,
		bookingWindow: settings.window
	};
};
