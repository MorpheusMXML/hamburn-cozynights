// hamburn-cozynights/tests/interactions.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { actions as loginActions } from '../src/routes/+page.server';
import { load as roomLoad, actions as roomActions } from '../src/routes/room/[id]/+page.server';
import { actions as adminActions } from '../src/routes/admin/room/[id]/+page.server';
import { actions as houseAdminActions } from '../src/routes/admin/house/[id]/+page.server';

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
		mockPb.getFirstListItem.mockResolvedValueOnce({ id: 'order_123', order_number: 'VALID-CODE' });

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
		mockPb.getFirstListItem.mockRejectedValueOnce({ status: 404 });

		const formData = new FormData();
		formData.append('bookingCode', 'INVALID');
		const request = { formData: async () => formData } as any;
		const result = (await loginActions.login({
			request,
			cookies: mockCookies,
			locals: mockLocals
		} as any)) as any;

		expect(result.status).toBe(404);
		expect(result.data.error).toContain('not found');
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
			filter: vi.fn((q: any) => q)
		};
		mockLocals = {
			pb: mockPb,
			adminPb: mockAdminPb,
			orderNumber: 'TEST-CODE',
			user: { verified: false }
		};
	});

	it('should load a room and successfully handle order hash migration', async () => {
		mockPb.getOne.mockImplementation(async (id: string) => {
			if (id === 'abcsettings123') return { is_booking_active: true };
			if (id === 'room1') return { id: 'room1', name: 'Test Room' };
			throw new Error('Not found');
		});

		// Simulating hash lookup failure then fallback success
		mockAdminPb.getFirstListItem.mockRejectedValueOnce({ status: 404 }); // hash lookup fail
		mockAdminPb.getFirstListItem.mockResolvedValueOnce({ id: 'order1', order_number: 'TEST-CODE' }); // fallback success
		mockAdminPb.getFirstListItem.mockResolvedValueOnce(null); // user bed lookup
		mockAdminPb.getFullList.mockResolvedValueOnce([{ id: 'bed1', occupied: false, label: 'A1' }]); // beds list
		mockAdminPb.update.mockResolvedValueOnce({}); // migration update

		const result: any = await roomLoad({ params: { id: 'room1' }, locals: mockLocals } as any);

		expect(result.room.id).toBe('room1');
		expect(result.beds.length).toBe(1);
		expect(mockAdminPb.update).toHaveBeenCalled(); // Migration was called
	});

	it('should allow booking an available bed', async () => {
		mockPb.getOne.mockResolvedValueOnce({ is_booking_active: true }); // Settings
		mockAdminPb.getFirstListItem.mockResolvedValueOnce({ id: 'order1' }); // Order lookup
		mockAdminPb.getOne.mockResolvedValueOnce({ id: 'bed1', occupied: false, is_locked: false }); // Bed lookup
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
			create: vi.fn(),
			delete: vi.fn(),
			update: vi.fn(),
			filter: vi.fn((q: any) => q),
			authStore: {
				isValid: true,
				model: { verified: true, email: 'admin@test' }
			}
		};
		mockLocals = { pb: mockPb };
	});

	it('should create a room and bed templates in staging mode', async () => {
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
			expect.objectContaining({ label: 'Spot 1', room: 'room1' })
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
			expect.objectContaining({ label: 'New Bed', room: 'room1' })
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

	it('should toggle bed locked status as verified admin', async () => {
		const formData = new FormData();
		formData.append('id', 'bed1');
		formData.append('is_locked', 'false');
		const request = { formData: async () => formData } as any;

		await adminActions.toggleLocked({ request, locals: mockLocals } as any);

		expect(mockPb.update).toHaveBeenCalledWith('bed1', { is_locked: true });
	});
});
