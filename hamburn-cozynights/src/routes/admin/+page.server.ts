import { redirect, fail, type ActionFailure } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import type { TypedPocketBase } from '$lib/pocketbase-types';
import { APP_SETTINGS_ID } from '$lib/server/constants';
import { bumpGuestRound } from '$lib/server/guest-session';
import { getBookingSettings } from '$lib/server/settings';
import { berlinLocalToIso } from '$lib/time';
import { readCamp } from '$lib/server/camp';
import { readBookings } from '$lib/server/bookings';
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
		/** Crew-booked spots that were never meant to go; still worth logging. */
		public kept: number,
		public reason: unknown
	) {
		super(`Releasing bookings stopped after ${released} of ${total} spots`);
		this.name = 'ReleaseStoppedError';
	}
	/** The names were never reached, so nothing is known about them. */
	namesLeft: number | null = null;
}

/**
 * How long guest messages stay muted around a quiet release. Released spots
 * are accepted in silence while their own update runs (pb_hooks/lib/notify.js,
 * markDue), so this only has to outlast the release loop; it is ended right
 * after, and ends by itself if the app never gets there.
 */
const QUIET_RELEASE_SECONDS = 120;

/**
 * Mutes guest messages in PocketBase (POST /api/cozy/notify/quiet) for
 * `seconds`, or ends that with 0. Crew alerts are not affected. Never throws.
 * @returns whether PocketBase took it
 */
async function muteGuestMessages(adminPb: TypedPocketBase, seconds: number): Promise<boolean> {
	try {
		await adminPb.send('/api/cozy/notify/quiet', { method: 'POST', body: { seconds } });
		return true;
	} catch (err) {
		console.error(
			`[Bookings] Could not ${seconds > 0 ? 'mute' : 'unmute'} guest messages:`,
			(err as Error)?.message
		);
		return false;
	}
}

/** What a release left behind, as a sentence to append (empty when all is clean). */
function namesNote(namesLeft: number | null): string {
	if (namesLeft === null) return ' Whether burner names were left behind is unknown.';
	if (namesLeft <= 0) return '';
	return ` ${namesLeft} burner name${namesLeft === 1 ? '' : 's'} could not be cleared; those spots are free but still show a name.`;
}

/**
 * Releases every guest booking ("clear all bookings", and what the switch back
 * to Staging Mode offers). The orders themselves are the ticket roster and survive,
 * otherwise every guest's code would stop working; the burner names of the
 * released bookings are forgotten, and so are their check-ins (PocketBase
 * drops a check-in with its booking). Spots the crew booked for approved
 * special-needs requests stay: they were handed out on purpose, usually
 * before booking opened.
 *
 * A released camp starts a new booking round: every device signs in with its
 * ticket code again (bumpGuestRound), so nobody keeps a session — and a
 * "continue to the map" — for a spot that is gone.
 * @throws {ReleaseStoppedError} when the database refuses halfway
 */
async function releaseGuestBookings(
	adminPb: TypedPocketBase
): Promise<{ released: number; kept: number; namesLeft: number | null }> {
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
	} catch (err) {
		throw new ReleaseStoppedError(released, occupiedBeds.length, kept, err);
	}
	// The spots are free by now; the burner names only describe them. A name
	// left behind is worth reporting, never a failed release.
	const namesLeft = await clearBurnerNames(adminPb, keep);
	// The bookings are gone either way: a failed bump must not fail the reset.
	await bumpGuestRound(adminPb).catch((err) =>
		console.error('[Reset] Guest sessions were not ended:', (err as Error)?.message)
	);
	return { released, kept, namesLeft };
}

/**
 * Clears the burner names of all orders (they only describe bookings), except
 * `keep`. One order that refuses doesn't stop the others: leaving the whole
 * rest named would be worse than the one name that stays.
 * @returns how many names are still there, or null if they couldn't be read
 */
async function clearBurnerNames(
	pb: TypedPocketBase,
	keep: Set<string> = new Set()
): Promise<number | null> {
	let named;
	try {
		named = await pb.collection('orders').getFullList({
			filter: 'burner_name != ""',
			fields: 'id'
		});
	} catch (err) {
		console.error('[Bookings] The burner names could not be read:', (err as Error)?.message);
		return null;
	}
	let left = 0;
	for (const order of named) {
		if (keep.has(order.id)) continue;
		try {
			await pb.collection('orders').update(order.id, { burner_name: '' });
		} catch (err) {
			left++;
			console.error(`[Bookings] Burner name of order ${order.id} stays:`, (err as Error)?.message);
		}
	}
	return left;
}

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
		const form = await request.formData().catch(() => null);
		const to = String(form?.get('phase') ?? '');
		if (!isBookingPhase(to)) return fail(400, { error: 'Unknown booking phase.' });
		// Releasing the guest bookings (and with them their check-ins) is the
		// superuser's explicit choice in the dialog, not a side effect: without
		// it the bookings stay and "clear all bookings" can do it later.
		const clearBookings = form?.get('clearBookings') === '1';
		// "Don't notify the guests": the release happens without a message to
		// anyone whose spot goes (the crew alert still goes out).
		const quiet = to === 'staging' && clearBookings && form?.get('quietRelease') === '1';

		try {
			const { exists, window } = await readWindow(locals.pb);
			const now = Date.now();
			const phaseBefore = effectivePhase(window, now);
			if (phaseBefore === to) return { success: true, phase: to, phaseBefore, pausedTimer: false };

			// Muted before anything changes: when PocketBase can't mute the guest
			// messages, the switch doesn't happen either — a release the
			// superuser asked to keep quiet must never go out loud.
			if (quiet && !(await muteGuestMessages(locals.adminPb, QUIET_RELEASE_SECONDS))) {
				return fail(503, {
					error:
						"The guest messages could not be muted, so nothing was changed. Try again, or untick “Don't notify the guests”."
				});
			}
			try {
				const next = switchPhase(window, to, now);
				await writeWindow(locals.pb, exists, next);
				console.log(`[Action:setPhase] SUCCESS: ${phaseBefore} → ${to}`);

				// Editing the layout with guest bookings in it is what the dialog
				// warns about; only a "yes, release them" gets here. Spots the crew
				// booked for special-needs requests stay.
				let cleared: { released: number; kept: number; namesLeft: number | null } | null = null;
				if (to === 'staging' && clearBookings) {
					try {
						cleared = await releaseGuestBookings(locals.adminPb);
						await logAdminEvent(locals.adminPb, locals.admin, 'bookings_cleared', '', {
							...cleared,
							guestsNotified: !quiet,
							reason: 'staging'
						});
						console.log(
							`[Action:setPhase] ${cleared.released} bookings released${quiet ? ' quietly' : ''}, ${cleared.kept} special-needs spots kept, ${cleared.namesLeft ?? '?'} burner names left.`
						);
					} catch (err) {
						console.error(
							'[Action:setPhase] Staging is on, but releasing the bookings failed:',
							err
						);
						const stopped = err instanceof ReleaseStoppedError ? err : null;
						const released = stopped?.released ?? 0;
						// The crew-booked spots were never part of the release, so the
						// count belongs in the log even when it stopped halfway.
						if (released > 0) {
							await logAdminEvent(locals.adminPb, locals.admin, 'bookings_cleared', '', {
								released,
								kept: stopped?.kept ?? 0,
								namesLeft: stopped?.namesLeft ?? null,
								guestsNotified: !quiet,
								reason: 'staging',
								stopped: stopped?.total
							});
						}
						return fail(500, {
							error: `Staging Mode is on, but the bookings could not all be released (${released} of ${stopped?.total ?? '?'} done).${namesNote(stopped?.namesLeft ?? null)} Use "Clear all bookings" for the rest.`
						});
					}
				}
				return {
					success: true,
					phase: to,
					phaseBefore,
					pausedTimer: next.paused && !window.paused,
					released: cleared?.released,
					kept: cleared?.kept,
					namesLeft: cleared?.namesLeft,
					guestsNotified: cleared ? !quiet : undefined
				};
			} finally {
				// Right after the release, not at the end of the window: guest
				// messages about anything else must not stay muted.
				if (quiet) await muteGuestMessages(locals.adminPb, 0);
			}
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
		// Only in Staging Mode: the switch back asks about the bookings itself,
		// and a stale tab must never clear a live camp.
		const { phase } = await getBookingSettings(locals.pb);
		if (phase !== 'staging') {
			return fail(403, {
				error: `Bookings can only be cleared in Staging Mode, not ${lockedDuring(phase)}. Switch back to Staging first; that switch also offers to release them.`
			});
		}

		console.log(`[Action:clearAllBookings] INITIATED by ${locals.admin.email}`);
		try {
			const { released, kept, namesLeft } = await releaseGuestBookings(locals.adminPb);
			console.log(
				`[Action:clearAllBookings] SUCCESS. ${released} spots released, ${kept} special-needs spots kept, ${namesLeft ?? '?'} burner names left, ticket codes kept.`
			);
			await logAdminEvent(locals.adminPb, locals.admin, 'bookings_cleared', '', {
				released,
				kept,
				namesLeft
			});
			return { success: true, released, kept, namesLeft };
		} catch (err) {
			console.error('[Action:clearAllBookings] FAILED:', err);
			if (err instanceof ReleaseStoppedError && err.released > 0) {
				await logAdminEvent(locals.adminPb, locals.admin, 'bookings_cleared', '', {
					released: err.released,
					kept: err.kept,
					namesLeft: err.namesLeft,
					stopped: err.total
				});
				const stillBooked = err.total - err.released;
				return fail(500, {
					error: `Clearing stopped after ${err.released} of ${err.total} spots; ${stillBooked} ${stillBooked === 1 ? 'is' : 'are'} still booked.${namesNote(err.namesLeft)} Reload the page and try again.`
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

/**
 * The Control Center: booking window, the special-needs switch, what needs
 * attention, the live numbers and the latest bookings. The camp editor lives
 * on /admin/camp; its writes (move, rename, delete a house, templates) stay
 * actions of this page, so every form, script and test that posts to
 * /admin?/… keeps working.
 */
export const load: PageServerLoad = async ({ locals }) => {
	// Runs in parallel with the layout load, so it guards itself too.
	if (!locals.admin) throw redirect(303, '/admin/login');

	const [camp, bookings] = await Promise.all([
		readCamp(locals),
		readBookings(locals.adminPb).catch((err) => {
			console.error('[Admin] Bookings could not be read:', (err as Error)?.message);
			return null;
		})
	]);
	const { settings } = camp;
	return {
		houses: camp.houses,
		crewBookedSpots: camp.crewBookedSpots,
		sanityIssues: camp.sanityWarnings.reduce(
			(sum, warning) => sum + (warning.noRooms ? 1 : 0) + warning.roomsWithNoBeds.length,
			0
		),
		stats: camp.stats,
		bookings,
		phase: settings.phase,
		isBookingActive: settings.isBookingActive,
		bookingUnlockAt: settings.bookingUnlockAt,
		requestsOpen: settings.requestsOpen,
		isLayoutLocked: settings.isLayoutLocked,
		bookingWindow: settings.window
	};
};
