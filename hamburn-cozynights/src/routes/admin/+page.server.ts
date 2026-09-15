import { redirect, error, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import type { HousesResponse, BedsResponse, RoomsResponse } from '$lib/pocketbase-types';
import { APP_SETTINGS_ID } from '$lib/server/constants';
import { getBookingSettings } from '$lib/server/settings';

type HouseStats = HousesResponse & {
	totalBeds: number;
	occupiedBeds: number;
	freeBeds: number;
	occupancyRate: number;
};

export const actions: Actions = {
	togglePhase: async ({ locals }) => {
		console.log(
			`[Action:togglePhase] User: ${locals.pb.authStore.model?.email}, Verified: ${locals.pb.authStore.model?.verified}`
		);
		if (!locals.pb.authStore.model?.verified) {
			console.error('[Action:togglePhase] BLOCKED: User not verified.');
			return fail(403, { error: 'Unauthorized' });
		}

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
				console.log(
					`[Action:togglePhase] Effective: ${effectivelyActive}, Target: ${nextStatus}`
				);
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
		if (!locals.pb.authStore.model?.verified) return fail(403, { error: 'Unauthorized' });

		console.log(`[Action:clearAllBookings] INITIATED by ${locals.pb.authStore.model?.email}`);

		try {
			// 1. Fetch all occupied beds
			const occupiedBeds = await locals.pb.collection('beds').getFullList({
				filter: 'occupied = true'
			});

			console.log(`[Action:clearAllBookings] Clearing ${occupiedBeds.length} spots.`);

			// 2. Reset all beds
			for (const bed of occupiedBeds) {
				await locals.pb.collection('beds').update(bed.id, {
					occupied: false,
					bookedBy: null,
					order: null
				});
			}

			// 3. Clear orders collection (optional but logical)
			const orders = await locals.pb.collection('orders').getFullList();
			for (const order of orders) {
				await locals.pb.collection('orders').delete(order.id);
			}

			console.log('[Action:clearAllBookings] SUCCESS. Database purged of all bookings.');
			return { success: true };
		} catch (err) {
			console.error('[Action:clearAllBookings] FAILED:', err);
			return fail(500, { error: 'Purge failed' });
		}
	},
	setUnlockTimer: async ({ locals, request }) => {
		console.log(`[Action:setUnlockTimer] User: ${locals.pb.authStore.model?.email}`);
		if (!locals.pb.authStore.model?.verified) return fail(403);
		const data = await request.formData();
		const date = data.get('unlockAt') as string;

		try {
			await locals.pb.collection('app_settings').update(APP_SETTINGS_ID, {
				booking_unlock_at: date ? new Date(date).toISOString() : ''
			});
			console.log(`[Action:setUnlockTimer] SUCCESS. Target: ${date}`);
		} catch (err) {
			console.error('[Action:setUnlockTimer] FAILED:', err);
			return fail(500);
		}
	},
	cancelUnlockTimer: async ({ locals }) => {
		console.log(`[Action:cancelUnlockTimer] User: ${locals.pb.authStore.model?.email}`);
		if (!locals.pb.authStore.model?.verified) return fail(403);
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
		const x = parseFloat(data.get('x') as string);
		const y = parseFloat(data.get('y') as string);

		console.log(
			`[Action:updateHouseCoords] User: ${locals.pb.authStore.model?.email}, ID: ${id}, New: (${x}, ${y})`
		);

		if (!locals.pb.authStore.model?.verified) {
			console.error('[Action:updateHouseCoords] BLOCKED: User not verified.');
			return fail(403, { error: 'Unauthorized' });
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

		console.log(`[Action:deleteHouse] User: ${locals.pb.authStore.model?.email}, ID: ${id}`);

		if (!locals.pb.authStore.model?.verified) {
			console.error('[Action:deleteHouse] BLOCKED: User not verified.');
			return fail(403, { error: 'Unauthorized' });
		}

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

		console.log(
			`[Action:renameHouse] User: ${locals.pb.authStore.model?.email}, ID: ${id}, New Name: ${name}`
		);

		if (!locals.pb.authStore.model?.verified) {
			console.error('[Action:renameHouse] BLOCKED: User not verified.');
			return fail(403, { error: 'Unauthorized' });
		}

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
	importTemplate: async ({ locals, request }) => {
		if (!locals.pb.authStore.model?.verified) return fail(403, { error: 'Unauthorized' });

		const { isBookingActive } = await getBookingSettings(locals.pb);
		if (isBookingActive) {
			console.warn('[Import Template] BLOCKED: cannot nuke the database during LIVE mode.');
			return fail(403, {
				error: 'Templates cannot be imported during Live Booking — this would erase live bookings. Switch to Staging first. 🔒'
			});
		}

		const formData = await request.formData();
		const file = formData.get('template') as File;

		if (!file || file.size === 0) {
			return fail(400, { error: 'No template file provided' });
		}

		try {
			const text = await file.text();
			const template = JSON.parse(text);

			if (!template.houses || !Array.isArray(template.houses)) {
				return fail(400, { error: 'Invalid template structure: Missing houses array' });
			}

			console.log(`[Import Template] Starting Nuke Phase...`);

			// 1. Fetch and delete everything
			const houses = await locals.pb.collection('houses').getFullList();
			const rooms = await locals.pb.collection('rooms').getFullList();
			const beds = await locals.pb.collection('beds').getFullList();
			const orders = await locals.pb.collection('orders').getFullList();

			console.log(
				`[Import Template] Deleting ${houses.length} houses, ${rooms.length} rooms, ${beds.length} beds, ${orders.length} orders.`
			);

			// Delete in reverse order of dependency
			for (const bed of beds) await locals.pb.collection('beds').delete(bed.id);
			for (const room of rooms) await locals.pb.collection('rooms').delete(room.id);
			for (const house of houses) await locals.pb.collection('houses').delete(house.id);
			for (const order of orders) await locals.pb.collection('orders').delete(order.id);

			console.log(`[Import Template] Nuke Complete. Rebuilding...`);

			// 2. Rebuild from template
			for (const h of template.houses) {
				const houseRecord = await locals.pb.collection('houses').create({
					name: h.name,
					x: h.x,
					y: h.y
				});

				if (h.rooms && Array.isArray(h.rooms)) {
					for (const r of h.rooms) {
						const roomRecord = await locals.pb.collection('rooms').create({
							name: r.name,
							room_number: r.room_number,
							amount_beds: r.amount_beds,
							house: houseRecord.id
						});

						if (r.beds && Array.isArray(r.beds)) {
							for (const b of r.beds) {
								await locals.pb.collection('beds').create({
									label: b.label,
									enabled: b.enabled,
									is_locked: b.is_locked,
									room: roomRecord.id,
									occupied: false
								});
							}
						}
					}
				}
			}

			console.log(`[Import Template] Rebuild Complete. SUCCESS.`);
			return { success: true };
		} catch (err: any) {
			console.error('[Import Template] FAILED:', err);
			return fail(500, { error: `Import failed: ${err.message}` });
		}
	}
};

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.pb.authStore.isValid) {
		console.warn('[Security] Unauthorized access attempt detected on Admin Dashboard.');
		throw redirect(303, '/admin/login');
	}

	console.log(`[Dashboard] Initializing data for admin: ${locals.pb.authStore.model?.email}`);

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

		const totalBeds = bedsInHouse.length;
		const occupiedBeds = bedsInHouse.filter((b: BedsResponse) => b.occupied === true).length;
		const freeBeds = Math.max(0, totalBeds - occupiedBeds);
		const occupancyRate = totalBeds > 0 ? Math.round((occupiedBeds / totalBeds) * 100) : 0;

		return {
			...structuredClone(house),
			totalBeds,
			occupiedBeds,
			freeBeds,
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
		bookingUnlockAt: settings.bookingUnlockAt
	};
};
