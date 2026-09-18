// hamburn-cozynights/tests/interactions.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { actions as loginActions } from '../src/routes/+page.server';
import { load as roomLoad, actions as roomActions } from '../src/routes/room/[id]/+page.server';
import { actions as adminActions } from '../src/routes/admin/room/[id]/+page.server';
import { actions as houseAdminActions } from '../src/routes/admin/house/[id]/+page.server';
import { APP_SETTINGS_ID } from '../src/lib/server/constants';

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
			getOne: vi.fn(),
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
			getOne: vi.fn(),
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

		const result: any = await roomLoad({ params: { id: 'room1' }, locals: mockLocals } as any);

		expect(result.room.id).toBe('room1');
		expect(result.beds.length).toBe(2);
		expect(mockAdminPb.update).toHaveBeenCalled(); // Migration was called
		expect(result.beds[1]).toEqual({
			id: 'bed2',
			label: 'A2',
			occupied: true,
			bookable: true,
			burnerName: 'Dusty Nomad #123'
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

		const result: any = await roomLoad({ params: { id: 'room1' }, locals: mockLocals } as any);
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
			await adminActions.toggleLocked({ request, locals: noAdmin } as any)
		] as any[];

		for (const result of results) expect(result.status).toBe(403);
		expect(mockPb.create).not.toHaveBeenCalled();
		expect(mockPb.update).not.toHaveBeenCalled();
		expect(mockPb.delete).not.toHaveBeenCalled();
	});

	it('should create a room with active spots in staging mode', async () => {
		mockPb.getOne.mockResolvedValueOnce({ is_booking_active: false }); // Staging mode
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
			expect.objectContaining({ name: 'Villa Suite', house: 'house1' })
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
});
