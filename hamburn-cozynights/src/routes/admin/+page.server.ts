import { redirect, error, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import type { HousesResponse, BedsResponse, RoomsResponse } from '$lib/pocketbase-types';

type HouseStats = HousesResponse & {
	totalBeds: number;
	occupiedBeds: number;
	freeBeds: number;
	occupancyRate: number;
};

export const actions = {
	togglePhase: async ({ locals }) => {
		console.log(
			`[Action:togglePhase] User: ${locals.pb.authStore.model?.email}, Verified: ${locals.pb.authStore.model?.verified}`
		);
		if (!locals.pb.authStore.model?.verified) {
			console.error('[Action:togglePhase] BLOCKED: User not verified.');
			return fail(403, { error: 'Unauthorized' });
		}

		try {
			const settings = await locals.pb
				.collection('app_settings')
				.getOne('abcsettings123')
				.catch(() => null);
			let nextStatus = true;
			if (settings) {
				nextStatus = !settings.is_booking_active;
				console.log(
					`[Action:togglePhase] Updating existing settings. Current: ${settings.is_booking_active}, Target: ${nextStatus}`
				);
				await locals.pb.collection('app_settings').update('abcsettings123', {
					is_booking_active: nextStatus
				});
			} else {
				console.log('[Action:togglePhase] Creating initial settings.');
				await locals.pb.collection('app_settings').create({
					id: 'abcsettings123',
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
			await locals.pb.collection('app_settings').update('abcsettings123', {
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
			await locals.pb.collection('app_settings').update('abcsettings123', {
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
			const settings = await locals.pb
				.collection('app_settings')
				.getOne('abcsettings123')
				.catch(() => ({ is_booking_active: false }));
			if (settings.is_booking_active) {
				const occupiedBeds = await locals.pb.collection('beds').getFullList({
					filter: locals.pb.filter('room.house = {:id} && occupied = true', { id })
				});

				if (occupiedBeds.length > 0) {
					console.warn(`[Action:updateHouseCoords] BLOCKED: House ${id} is occupied in LIVE mode.`);
					return fail(400, { error: 'Cannot move house: It has active bookings in LIVE mode! 🔒' });
				}
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
			const settings = await locals.pb
				.collection('app_settings')
				.getOne('abcsettings123')
				.catch(() => ({ is_booking_active: false }));
			const isLive = settings.is_booking_active;

			const occupiedBeds = await locals.pb.collection('beds').getFullList({
				filter: locals.pb.filter('room.house = {:id} && occupied = true', { id }),
				expand: 'room'
			});

			if (occupiedBeds.length > 0) {
				console.log(
					`[Action:deleteHouse] Occupancy detected in House ${id}:`,
					occupiedBeds
						.map((b: any) => `Bed ${b.label} (Room ${b.expand?.room?.room_number})`)
						.join(', ')
				);

				if (isLive) {
					console.warn(
						`[Action:deleteHouse] BLOCKED: House ${id} has active bookings in LIVE mode.`
					);
					return fail(400, {
						error: 'The playa says NO! 🛑 Cannot vanish a house with active bookings in LIVE mode.'
					});
				} else {
					console.log(
						`[Action:deleteHouse] Staging Mode: Auto-clearing ${occupiedBeds.length} test bookings.`
					);
					for (const bed of occupiedBeds) {
						await locals.pb.collection('beds').update(bed.id, { occupied: false, order: null });
					}
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

	const [houses, allRooms, allBeds, settings] = await Promise.all([
		locals.pb.collection('houses').getFullList<HousesResponse>({ sort: 'name' }),
		locals.pb.collection('rooms').getFullList<RoomsResponse>(),
		locals.pb
			.collection('beds')
			.getFullList<BedsResponse<{ room: RoomsResponse }>>({ expand: 'room' }),
		locals.pb
			.collection('app_settings')
			.getOne('abcsettings123')
			.catch(() => ({ is_booking_active: false, booking_unlock_at: '' }))
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

	// Mocked historical data for trend charts
	const history = {
		bookingTrend: [12, 15, 18, 22, 30, 45, 52], // Last 7 days cumulative
		trafficTrend: [120, 150, 110, 200, 350, 420, 380], // Last 7 days hits
		labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
	};

	return {
		houses: housesWithStats,
		sanityWarnings,
		history,
		isBookingActive: settings.is_booking_active,
		bookingUnlockAt: settings.booking_unlock_at || ''
	};
};
