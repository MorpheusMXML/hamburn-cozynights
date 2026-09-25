// hamburn-cozynights/tests/interactions.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { actions as loginActions } from '../src/routes/+page.server';
import { load as roomLoad, actions as roomActions } from '../src/routes/room/[id]/+page.server';
import { actions as adminActions } from '../src/routes/admin/room/[id]/+page.server';
import { actions as houseAdminActions } from '../src/routes/admin/house/[id]/+page.server';
import { APP_SETTINGS_ID } from '../src/lib/server/constants';
import { overrideProblem } from '../src/lib/accommodation';
import { FakePb } from './fake-pb';

// Mock environment variables
vi.mock('$env/dynamic/private', () => ({
	env: {
		ENCRYPTION_KEY: '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff',
		PB_ADMIN_EMAIL: 'admin@test.com',
		PB_ADMIN_PASSWORD: 'password'
	}
}));

describe('Interactions & Registration', () => {
	let mockPb: any;
	let mockAdminPb: any;
	let mockLocals: any;
	let mockCookies: any;

	beforeEach(() => {
		mockPb = {
			collection: vi.fn().mockReturnThis(),
			getFirstListItem: vi.fn(),
			getOne: vi.fn(),
			filter: vi.fn((q: any) => q),
			authStore: { isValid: false, model: null }
		};
		mockAdminPb = {
			collection: vi.fn().mockReturnThis(),
			getFirstListItem: vi.fn(),
			getFullList: vi.fn(),
			// The queued mockResolvedValueOnce values answer the bed reads; what
			// is left over is BookingService re-reading the phase after the claim
			// (src/lib/server/booking.ts, readPhase), and booking is open here.
			getOne: vi.fn(async (id: string) => {
				if (id === APP_SETTINGS_ID) return { is_booking_active: true };
				throw Object.assign(new Error('not found'), { status: 404 });
			}),
			update: vi.fn(),
			filter: vi.fn((q: any) => q)
		};
		mockCookies = {
			set: vi.fn(),
			get: vi.fn()
		};
		mockLocals = {
			pb: mockPb,
			adminPb: mockAdminPb,
			orderNumber: 'TEST-CODE'
		};
	});

	it('should register/login with a valid booking code', async () => {
		// login resolves the order via BookingService, which always uses
		// adminPb (orders are never readable through the public pb connection).
		mockAdminPb.getFirstListItem.mockResolvedValueOnce({
			id: 'order_123',
			order_number: 'VALID-CODE'
		});

		const formData = new FormData();
		formData.append('bookingCode', 'VALID-CODE');
		const request = { formData: async () => formData } as any;

		try {
			await loginActions.login({ request, cookies: mockCookies, locals: mockLocals } as any);
		} catch (e: any) {
			// SvelteKit redirect throws an object with status 303
			expect(e.status).toBe(303);
		}

		expect(mockCookies.set).toHaveBeenCalledWith('bookingCode', 'VALID-CODE', expect.any(Object));
	});

	it('should fail login with an invalid booking code', async () => {
		mockAdminPb.getFirstListItem.mockRejectedValueOnce({ status: 404 });
		mockAdminPb.getFirstListItem.mockRejectedValueOnce({ status: 404 });

		const formData = new FormData();
		formData.append('bookingCode', 'INVALID');
		const request = { formData: async () => formData } as any;
		const result = (await loginActions.login({
			request,
			cookies: mockCookies,
			locals: mockLocals
		} as any)) as any;

		expect(result.status).toBe(404);
		expect(result.data.error).toContain('could not find this ticket code');
	});
});

describe('Room Load & Booking Logic', () => {
	let mockPb: any;
	let mockAdminPb: any;
	let mockLocals: any;

	beforeEach(() => {
		mockPb = {
			collection: vi.fn().mockReturnThis(),
			getOne: vi.fn(),
			filter: vi.fn((q: any) => q)
		};
		mockAdminPb = {
			collection: vi.fn().mockReturnThis(),
			getFirstListItem: vi.fn(),
			getFullList: vi.fn(),
			// The queued mockResolvedValueOnce values answer the bed reads; what
			// is left over is BookingService re-reading the phase after the claim
			// (src/lib/server/booking.ts, readPhase), and booking is open here.
			getOne: vi.fn(async (id: string) => {
				if (id === APP_SETTINGS_ID) return { is_booking_active: true };
				throw Object.assign(new Error('not found'), { status: 404 });
			}),
			update: vi.fn(),
			filter: vi.fn((q: any) => q),
			// bookBed/unbookBed require a valid admin session before touching
			// the database — see BookingService and room/[id]/+page.server.ts.
			authStore: { isValid: true }
		};
		mockLocals = {
			pb: mockPb,
			adminPb: mockAdminPb,
			orderNumber: 'TEST-CODE',
			admin: null
		};
	});

	it('should load a room and successfully handle order hash migration', async () => {
		mockPb.getOne.mockImplementation(async (id: string) => {
			if (id === APP_SETTINGS_ID) return { is_booking_active: true };
			if (id === 'room1') return { id: 'room1', name: 'Test Room' };
			throw new Error('Not found');
		});

		// Simulating hash lookup failure then fallback success
		mockAdminPb.getFirstListItem.mockRejectedValueOnce({ status: 404 }); // hash lookup fail
		mockAdminPb.getFirstListItem.mockResolvedValueOnce({ id: 'order1', order_number: 'TEST-CODE' }); // fallback success
		mockAdminPb.getFirstListItem.mockResolvedValueOnce(null); // user bed lookup
		mockAdminPb.getFullList.mockResolvedValueOnce([
			{ id: 'bed1', occupied: false, label: 'A1', enabled: true },
			{
				id: 'bed2',
				occupied: true,
				label: 'A2',
				enabled: true,
				order: 'other-order',
				expand: {
					order: {
						order_number: 'SOMEONE-ELSES-CODE',
						order_hash: 'hash',
						customer_name: 'Jane Doe',
						burner_name: 'Dusty Nomad #123'
					}
				}
			}
		]); // beds list
		mockAdminPb.update.mockResolvedValueOnce({}); // migration update

		const result: any = await roomLoad({
			url: new URL('http://test.local/'),
			params: { id: 'room1' },
			locals: mockLocals
		} as any);

		expect(result.room.id).toBe('room1');
		expect(result.beds.length).toBe(2);
		expect(mockAdminPb.update).toHaveBeenCalled(); // Migration was called
		// A taken spot is never "bookable": the flag would tell locked or
		// special-needs spots apart from others, next to the burner name.
		expect(result.beds[1]).toEqual({
			id: 'bed2',
			label: 'A2',
			occupied: true,
			bookable: false,
			burnerName: 'Dusty Nomad #123',
			// what kind of bed it is and what only this spot has; nobody said here
			bedType: '',
			features: [],
			// the other spot of a bunk bed; this one stands alone
			bunkPartner: '',
			missing: []
		});
	});

	it("never sends other guests' order data (ticket codes, names) to the browser", async () => {
		mockPb.getOne.mockImplementation(async (id: string) => {
			if (id === APP_SETTINGS_ID) return { is_booking_active: true };
			return { id: 'room1', name: 'Test Room', room_number: 1, house: 'house1' };
		});
		mockAdminPb.getFirstListItem.mockResolvedValueOnce({ id: 'order1' }); // own order
		mockAdminPb.getFirstListItem.mockRejectedValueOnce({ status: 404 }); // no bed yet
		mockAdminPb.getFullList.mockResolvedValueOnce([
			{
				id: 'bed2',
				occupied: true,
				label: 'A2',
				order: 'other-order',
				expand: { order: { order_number: 'SECRET-CODE-42', customer_name: 'Jane Doe' } }
			}
		]);

		const result: any = await roomLoad({
			url: new URL('http://test.local/'),
			params: { id: 'room1' },
			locals: mockLocals
		} as any);
		const serialized = JSON.stringify(result);

		expect(serialized).not.toContain('SECRET-CODE-42');
		expect(serialized).not.toContain('Jane Doe');
		expect(serialized).not.toContain('other-order');
		expect(serialized).not.toContain('TEST-CODE');
	});

	it('should allow booking an available bed', async () => {
		mockPb.getOne.mockResolvedValueOnce({ is_booking_active: true }); // Settings
		mockAdminPb.getFirstListItem.mockResolvedValueOnce({ id: 'order1' }); // Order lookup
		// Read inside BookingService.bookBed's authoritative under-lock check.
		mockAdminPb.getOne.mockResolvedValueOnce({
			id: 'bed1',
			occupied: false,
			is_locked: false,
			enabled: true
		});
		mockAdminPb.getFullList.mockResolvedValueOnce([]); // Previous beds

		const formData = new FormData();
		formData.append('bedId', 'bed1');
		formData.append('guestName', 'Alice');
		const request = { formData: async () => formData } as any;

		const result = (await roomActions.bookBed({ request, locals: mockLocals } as any)) as any;
		expect(result.success).toBe(true);
		expect(mockAdminPb.update).toHaveBeenCalledWith(
			'bed1',
			expect.objectContaining({ occupied: true, order: 'order1' })
		);
	});

	it('should refuse a locked bed for guests but allow it for admins', async () => {
		const lockedBed = { id: 'bed1', occupied: false, is_locked: true, enabled: true };
		const makeRequest = () => {
			const formData = new FormData();
			formData.append('bedId', 'bed1');
			formData.append('guestName', 'Alice');
			return { formData: async () => formData } as any;
		};

		mockPb.getOne.mockResolvedValueOnce({ is_booking_active: true });
		mockAdminPb.getFirstListItem.mockResolvedValueOnce({ id: 'order1' });
		mockAdminPb.getOne.mockResolvedValueOnce(lockedBed);
		const guest = (await roomActions.bookBed({
			request: makeRequest(),
			locals: mockLocals
		} as any)) as any;
		expect(guest.status).toBe(409);
		expect(mockAdminPb.update).not.toHaveBeenCalled();

		mockPb.getOne.mockResolvedValueOnce({ is_booking_active: true });
		mockAdminPb.getFirstListItem.mockResolvedValueOnce({ id: 'order1' });
		mockAdminPb.getOne.mockResolvedValueOnce(lockedBed);
		mockAdminPb.getFullList.mockResolvedValueOnce([]);
		const admin = (await roomActions.bookBed({
			request: makeRequest(),
			locals: { ...mockLocals, admin: { email: 'max@mauersegler.art', role: 'admin' } }
		} as any)) as any;
		expect(admin.success).toBe(true);
	});

	it('should refuse a deactivated bed', async () => {
		mockPb.getOne.mockResolvedValueOnce({ is_booking_active: true });
		mockAdminPb.getFirstListItem.mockResolvedValueOnce({ id: 'order1' });
		mockAdminPb.getOne.mockResolvedValueOnce({ id: 'bed1', occupied: false, enabled: false });

		const formData = new FormData();
		formData.append('bedId', 'bed1');
		const request = { formData: async () => formData } as any;

		const result = (await roomActions.bookBed({ request, locals: mockLocals } as any)) as any;
		expect(result.status).toBe(409);
		expect(mockAdminPb.update).not.toHaveBeenCalled();
	});

	it('lets a guest rename the spot they hold before booking opens, but not book one', async () => {
		const post = (bedId: string, guestName: string) => {
			const formData = new FormData();
			formData.append('bedId', bedId);
			formData.append('guestName', guestName);
			return { formData: async () => formData } as any;
		};

		// Staging (booking not open yet); the ticket holds bed1, e.g. a handed-over
		// ticket whose spot lost its name, or a spot the crew booked.
		mockPb.getOne.mockResolvedValueOnce({ is_booking_active: false });
		mockAdminPb.getFirstListItem.mockResolvedValueOnce({ id: 'order1' }); // order
		mockAdminPb.getFirstListItem.mockResolvedValueOnce({
			id: 'bed1',
			occupied: true,
			order: 'order1'
		}); // its spot
		mockAdminPb.getOne.mockResolvedValueOnce({
			id: 'bed1',
			occupied: true,
			order: 'order1',
			enabled: true
		}); // under-lock read
		mockAdminPb.getFullList.mockResolvedValueOnce([]); // no other spots
		const renamed = (await roomActions.bookBed({
			request: post('bed1', 'Neon Nebula'),
			locals: mockLocals
		} as any)) as any;
		expect(renamed.success).toBe(true);
		expect(mockAdminPb.update).toHaveBeenCalledWith(
			'order1',
			expect.objectContaining({ burner_name: expect.any(String) })
		);

		// Taking a spot stays a Live Booking thing.
		mockAdminPb.update.mockClear();
		mockPb.getOne.mockResolvedValueOnce({ is_booking_active: false });
		mockAdminPb.getFirstListItem.mockResolvedValueOnce({ id: 'order1' });
		mockAdminPb.getFirstListItem.mockRejectedValueOnce({ status: 404 }); // holds no spot
		const refused = (await roomActions.bookBed({
			request: post('bed2', 'Alice'),
			locals: mockLocals
		} as any)) as any;
		expect(refused.status).toBe(403);
		expect(refused.data.error).toMatch(/not open yet/);
		expect(mockAdminPb.update).not.toHaveBeenCalled();
	});

	it('refuses to rename once booking has closed, without looking anything up', async () => {
		mockPb.getOne.mockResolvedValueOnce({ booking_closed: true });
		const formData = new FormData();
		formData.append('bedId', 'bed1');
		formData.append('guestName', 'Neon Nebula');
		const result = (await roomActions.bookBed({
			request: { formData: async () => formData },
			locals: mockLocals
		} as any)) as any;
		expect(result.status).toBe(403);
		expect(result.data.error).toMatch(/closed/);
		expect(mockAdminPb.getFirstListItem).not.toHaveBeenCalled();
		expect(mockAdminPb.update).not.toHaveBeenCalled();
	});

	it('should allow unbooking a bed', async () => {
		mockPb.getOne.mockResolvedValueOnce({ is_booking_active: true }); // Settings
		mockAdminPb.getFirstListItem.mockResolvedValueOnce({ id: 'order1' }); // Order lookup
		mockAdminPb.getFullList.mockResolvedValueOnce([
			{ id: 'bed1', occupied: true, order: 'order1' }
		]); // Current beds

		const result = (await roomActions.unbookBed({ locals: mockLocals } as any)) as any;
		expect(result.success).toBe(true);
		expect(mockAdminPb.update).toHaveBeenCalledWith('bed1', { occupied: false, order: null });
	});
});

describe('Admin Management Actions', () => {
	let mockPb: any;
	let mockLocals: any;

	beforeEach(() => {
		mockPb = {
			collection: vi.fn().mockReturnThis(),
			getOne: vi.fn(),
			getFullList: vi.fn().mockResolvedValue([]),
			create: vi.fn(),
			delete: vi.fn(),
			update: vi.fn(),
			filter: vi.fn((q: any) => q)
		};
		mockLocals = {
			pb: mockPb,
			admin: {
				id: 'admin1',
				email: 'crew@mauersegler.art',
				name: '',
				role: 'admin',
				isSuperuser: false
			}
		};
	});

	it('should refuse every structural action without an admin session', async () => {
		const noAdmin = { pb: mockPb, admin: null };
		const formData = new FormData();
		formData.append('id', 'x');
		formData.append('name', 'x');
		formData.append('label', 'x');
		const request = { formData: async () => formData } as any;

		const results = [
			await houseAdminActions.createRoom({ request, params: { id: 'h' }, locals: noAdmin } as any),
			await houseAdminActions.deleteRoom({ request, locals: noAdmin } as any),
			await adminActions.createBed({ request, params: { id: 'r' }, locals: noAdmin } as any),
			await adminActions.deleteBed({ request, locals: noAdmin } as any),
			await adminActions.toggleOccupied({ request, locals: noAdmin } as any),
			await adminActions.toggleEnabled({ request, locals: noAdmin } as any),
			await adminActions.toggleLocked({ request, locals: noAdmin } as any),
			await adminActions.saveSpot({ request, params: { id: 'r' }, locals: noAdmin } as any),
			await adminActions.setBedTypes({ request, params: { id: 'r' }, locals: noAdmin } as any),
			await adminActions.stackBunk({ request, params: { id: 'r' }, locals: noAdmin } as any),
			await adminActions.unstackBunk({ request, params: { id: 'r' }, locals: noAdmin } as any),
			await adminActions.swapBunk({ request, params: { id: 'r' }, locals: noAdmin } as any)
		] as any[];

		for (const result of results) expect(result.status).toBe(403);
		expect(mockPb.create).not.toHaveBeenCalled();
		expect(mockPb.update).not.toHaveBeenCalled();
		expect(mockPb.delete).not.toHaveBeenCalled();
	});

	it('should create a room with active spots in staging mode', async () => {
		mockPb.getOne.mockResolvedValueOnce({ is_booking_active: false }); // Staging mode
		// the house the room belongs to: its kind decides the new room's kind
		mockPb.getOne.mockResolvedValueOnce({ id: 'house1', name: 'Villa', kind: 'house' });
		mockPb.create.mockResolvedValueOnce({ id: 'room1' }); // Room created

		const formData = new FormData();
		formData.append('name', 'Villa Suite');
		formData.append('room_number', '101');
		formData.append('amount_beds', '2');
		const request = { formData: async () => formData } as any;

		await houseAdminActions.createRoom({
			request,
			params: { id: 'house1' },
			locals: mockLocals
		} as any);

		expect(mockPb.create).toHaveBeenCalledWith(
			expect.objectContaining({ name: 'Villa Suite', house: 'house1', kind: 'room' })
		);
		expect(mockPb.create).toHaveBeenCalledWith(
			expect.objectContaining({ label: 'Spot 1', room: 'room1', enabled: true })
		);
		expect(mockPb.create).toHaveBeenCalledWith(
			expect.objectContaining({ label: 'Spot 2', room: 'room1', enabled: true })
		);
	});

	it('should delete a room in staging mode', async () => {
		mockPb.getOne.mockResolvedValueOnce({ is_booking_active: false }); // Staging mode

		const formData = new FormData();
		formData.append('id', 'room1');
		const request = { formData: async () => formData } as any;

		await houseAdminActions.deleteRoom({ request, locals: mockLocals } as any);

		expect(mockPb.delete).toHaveBeenCalledWith('room1');
	});

	it('should create a bed if staging mode (booking inactive)', async () => {
		mockPb.getOne.mockResolvedValueOnce({ is_booking_active: false }); // Staging mode

		const formData = new FormData();
		formData.append('label', 'New Bed');
		const request = { formData: async () => formData } as any;

		await adminActions.createBed({ request, params: { id: 'room1' }, locals: mockLocals } as any);

		expect(mockPb.create).toHaveBeenCalledWith(
			expect.objectContaining({ label: 'New Bed', room: 'room1', enabled: true })
		);
	});

	it('should delete a bed in staging mode', async () => {
		mockPb.getOne.mockResolvedValueOnce({ is_booking_active: false }); // Staging mode

		const formData = new FormData();
		formData.append('id', 'bed1');
		const request = { formData: async () => formData } as any;

		await adminActions.deleteBed({ request, locals: mockLocals } as any);

		expect(mockPb.delete).toHaveBeenCalledWith('bed1');
	});

	it('should toggle bed locked status as admin', async () => {
		const formData = new FormData();
		formData.append('id', 'bed1');
		formData.append('is_locked', 'false');
		const request = { formData: async () => formData } as any;

		await adminActions.toggleLocked({ request, locals: mockLocals } as any);

		expect(mockPb.update).toHaveBeenCalledWith('bed1', { is_locked: true });
	});

	describe('Bunk beds', () => {
		type Row = Record<string, any>;

		/** A browser's form post with these fields; an array repeats the field. */
		const form = (fields: Record<string, string | string[]>) => {
			const data = new FormData();
			for (const [key, value] of Object.entries(fields)) {
				for (const one of Array.isArray(value) ? value : [value]) data.append(key, one);
			}
			return { formData: async () => data } as any;
		};

		/**
		 * A room of spots in the fake PocketBase, seeded in the order given (the
		 * real database lists B1, B10, B2; the actions sort naturally), and the
		 * room page's actions posted to it as the admin of this file.
		 */
		function seedRoom(labels: string[]) {
			const pb = new FakePb();
			const room = pb.seed('rooms', { name: 'Dorm', house: 'house1' });
			const ids: Record<string, string> = {};
			for (const label of labels) {
				ids[label] = pb.seed('beds', {
					label,
					room: room.id,
					enabled: true,
					occupied: false,
					bed_type: '',
					bunk_partner: '',
					features: []
				}).id;
			}
			const locals = { pb, admin: mockLocals.admin };
			const post = async (action: string, fields: Record<string, string | string[]>) =>
				(await adminActions[action]({
					request: form(fields),
					params: { id: room.id },
					locals
				} as any)) as any;
			const spot = (label: string): Row => pb.rows('beds').find((row) => row.label === label)!;
			return { pb, ids, post, spot };
		}

		it('stacks two spots into a bunk bed, written on both sides', async () => {
			const { ids, post, spot } = seedRoom(['B1', 'B2', 'B3']);

			const result = await post('stackBunk', { lower: ids.B1, upper: ids.B2 });

			expect(result).toEqual({ success: true });
			expect(spot('B1')).toMatchObject({ bunk_partner: ids.B2, bed_type: 'bunk_lower' });
			expect(spot('B2')).toMatchObject({ bunk_partner: ids.B1, bed_type: 'bunk_upper' });
			expect(spot('B3')).toMatchObject({ bunk_partner: '', bed_type: '' });
		});

		it('refuses to stack a spot on itself, one of another room, or one stacked already', async () => {
			const { pb, ids, post, spot } = seedRoom(['B1', 'B2', 'B3']);
			const elsewhere = pb.seed('beds', { label: 'C1', room: 'other-room', bunk_partner: '' });
			await post('stackBunk', { lower: ids.B1, upper: ids.B2 });

			const refused = [
				await post('stackBunk', { lower: ids.B3, upper: ids.B3 }),
				await post('stackBunk', { lower: ids.B3, upper: elsewhere.id }),
				await post('stackBunk', { lower: ids.B3, upper: ids.B2 }),
				await post('stackBunk', { lower: ids.B1, upper: ids.B3 })
			];

			expect(refused.map((result) => result.status)).toEqual([400, 400, 400, 400]);
			expect(refused[0].data.message).toMatch(/cannot be stacked on itself/);
			expect(refused[1].data.message).toMatch(/not in this room/);
			expect(refused[2].data.message).toMatch(/"B2" is part of a bunk bed already/);
			expect(refused[3].data.message).toMatch(/"B1" is part of a bunk bed already/);
			// Nothing was written: B3 and the other room's spot still stand alone.
			expect(spot('B3')).toMatchObject({ bunk_partner: '', bed_type: '' });
			expect(spot('C1').bunk_partner).toBe('');
		});

		it('takes a bunk bed apart from either of its spots', async () => {
			const { ids, post, spot } = seedRoom(['B1', 'B2', 'B3']);
			await post('stackBunk', { lower: ids.B1, upper: ids.B2 });

			expect(await post('unstackBunk', { id: ids.B2 })).toEqual({ success: true });

			for (const label of ['B1', 'B2']) {
				expect(spot(label)).toMatchObject({ bunk_partner: '', bed_type: '' });
			}
			// A spot that stands alone has nothing to take apart.
			const alone = await post('unstackBunk', { id: ids.B3 });
			expect(alone.status).toBe(400);
			expect(alone.data.message).toMatch(/not part of a bunk bed/);
		});

		it('swaps the two levels of a bunk bed and keeps the pairing', async () => {
			const { ids, post, spot } = seedRoom(['B1', 'B2']);
			await post('stackBunk', { lower: ids.B1, upper: ids.B2 });

			expect(await post('swapBunk', { id: ids.B2 })).toEqual({ success: true });

			expect(spot('B1')).toMatchObject({ bunk_partner: ids.B2, bed_type: 'bunk_upper' });
			expect(spot('B2')).toMatchObject({ bunk_partner: ids.B1, bed_type: 'bunk_lower' });
		});

		it('SPOT TYPES "bunks" stacks consecutive spots in natural label order, "single" takes them apart', async () => {
			// Seeded as PocketBase sorts labels (B1, B10, B11, B2, …): the action
			// pairs B1 + B2, …, B9 + B10 all the same, and B11 has nobody left.
			const labels = ['B1', 'B10', 'B11', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'B8', 'B9'];
			const { ids, post, spot } = seedRoom(labels);

			expect(await post('setBedTypes', { pattern: 'bunks' })).toEqual({ success: true });

			const pairs = [
				['B1', 'B2'],
				['B3', 'B4'],
				['B5', 'B6'],
				['B7', 'B8'],
				['B9', 'B10']
			];
			for (const [lower, upper] of pairs) {
				expect(spot(lower)).toMatchObject({ bunk_partner: ids[upper], bed_type: 'bunk_lower' });
				expect(spot(upper)).toMatchObject({ bunk_partner: ids[lower], bed_type: 'bunk_upper' });
			}
			expect(spot('B11')).toMatchObject({ bunk_partner: '', bed_type: '' });

			expect(await post('setBedTypes', { pattern: 'single' })).toEqual({ success: true });
			for (const label of labels) {
				expect(spot(label)).toMatchObject({ bunk_partner: '', bed_type: 'single' });
			}
		});

		it('refuses a bed change on a stacked spot, but still saves its features', async () => {
			const { ids, post, spot } = seedRoom(['B1', 'B2']);
			await post('stackBunk', { lower: ids.B1, upper: ids.B2 });

			const refused = await post('saveSpot', { id: ids.B1, bed_type: 'single' });
			expect(refused.status).toBe(400);
			expect(refused.data.message).toMatch(/part of a bunk bed/);
			expect(spot('B1')).toMatchObject({ bunk_partner: ids.B2, bed_type: 'bunk_lower' });

			// The details editor sends the stored level back (its select is disabled).
			const saved = await post('saveSpot', {
				id: ids.B1,
				bed_type: 'bunk_lower',
				features: ['power']
			});
			expect(saved).toEqual({ success: true });
			expect(spot('B1')).toMatchObject({ bed_type: 'bunk_lower', features: ['power'] });
		});
	});

	describe('Inherited features switched off (features_off)', () => {
		/** A browser's form post with these fields; an array repeats the field. */
		const form = (fields: Record<string, string | string[]>) => {
			const data = new FormData();
			for (const [key, value] of Object.entries(fields)) {
				for (const one of Array.isArray(value) ? value : [value]) data.append(key, one);
			}
			return { formData: async () => data } as any;
		};

		/**
		 * A heated, quiet house with one room and one spot in the fake PocketBase,
		 * and the room page's actions posted to it as an admin or as a superuser.
		 * The stored overrides are given, so a test can see whether a post changed them.
		 */
		function seedHeatedHouse(roomOff: string[], spotOff: string[]) {
			const pb = new FakePb();
			const house = pb.seed('houses', { name: 'Villa', features: ['heated', 'quiet'] });
			const room = pb.seed('rooms', {
				name: 'Dorm',
				house: house.id,
				kind: 'room',
				features: ['own_bathroom'],
				features_off: roomOff
			});
			const bed = pb.seed('beds', {
				label: 'B1',
				room: room.id,
				enabled: true,
				occupied: false,
				bed_type: '',
				bunk_partner: '',
				features: [],
				features_off: spotOff
			});
			const superuser = {
				...mockLocals.admin,
				email: 'max@mauersegler.art',
				role: 'superuser',
				isSuperuser: true
			};
			const as =
				(admin: Record<string, unknown>) =>
				async (action: string, fields: Record<string, string | string[]>) =>
					(await adminActions[action]({
						request: form(fields),
						params: { id: room.id },
						locals: { pb, admin }
					} as any)) as any;
			const stored = () => ({
				room: pb.rows('rooms').find((row) => row.id === room.id)!,
				spot: pb.rows('beds').find((row) => row.id === bed.id)!
			});
			return { bed, asAdmin: as(mockLocals.admin), asSuperuser: as(superuser), stored };
		}

		it("an admin's save never changes what is switched off, even when the form claims it", async () => {
			const { bed, asAdmin, stored } = seedHeatedHouse(['heated'], ['quiet']);

			const room = await asAdmin('saveRoom', {
				kind: 'room',
				features: ['own_bathroom'],
				features_off: ['quiet']
			});
			const spot = await asAdmin('saveSpot', { id: bed.id, features_off: ['heated'] });

			expect(room).toEqual({ success: true });
			expect(spot).toEqual({ success: true });
			// The details were saved, the stored overrides are as they were.
			expect(stored().room).toMatchObject({ features: ['own_bathroom'], features_off: ['heated'] });
			expect(stored().spot).toMatchObject({ features: [], features_off: ['quiet'] });
		});

		it('a superuser switches a feature off, and a save without the boxes resets it', async () => {
			const { bed, asSuperuser, stored } = seedHeatedHouse([], []);

			expect(await asSuperuser('saveRoom', { kind: 'room', features_off: ['heated'] })).toEqual({
				success: true
			});
			expect(await asSuperuser('saveSpot', { id: bed.id, features_off: ['heated'] })).toEqual({
				success: true
			});
			expect(stored().room.features_off).toEqual(['heated']);
			expect(stored().spot.features_off).toEqual(['heated']);

			// The form always posts its features_off boxes for a superuser, so a
			// save with none ticked (nothing posted) is the reset.
			expect(await asSuperuser('saveRoom', { kind: 'room' })).toEqual({ success: true });
			expect(await asSuperuser('saveSpot', { id: bed.id })).toEqual({ success: true });
			expect(stored().room.features_off).toEqual([]);
			expect(stored().spot.features_off).toEqual([]);
		});

		it('refuses a superuser who switches a feature off and ticks it at once', async () => {
			const { bed, asSuperuser, stored } = seedHeatedHouse([], []);

			const room = await asSuperuser('saveRoom', {
				kind: 'room',
				features: ['heated'],
				features_off: ['heated']
			});
			const spot = await asSuperuser('saveSpot', {
				id: bed.id,
				features: ['power'],
				features_off: ['power']
			});

			expect(room.status).toBe(400);
			expect(room.data.message).toBe(overrideProblem(['heated'], ['heated']));
			expect(spot.status).toBe(400);
			expect(spot.data.message).toBe(overrideProblem(['power'], ['power']));
			// Nothing was written.
			expect(stored().room).toMatchObject({ features: ['own_bathroom'], features_off: [] });
			expect(stored().spot).toMatchObject({ features: [], features_off: [] });
		});
	});
});
