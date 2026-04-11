import { test, expect, type Page } from '@playwright/test';
import PocketBase from 'pocketbase';
import * as dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env'), override: true });

const TEST_CODE = 'XXXXX';
const ROOM_ID = 'brahmseevill001';
const PB_URL = process.env.PUBLIC_PB_URL || 'http://127.0.0.1:8090';

test.describe('Extended Booking & Admin Flow', () => {
	let adminPb: any;

	let testRoomId: string;
	let testHouseName: string;

	test.beforeAll(async () => {
		adminPb = new PocketBase(PB_URL);
		try {
			// Auth as admin
			try {
				await adminPb
					.collection('_superusers')
					.authWithPassword(process.env.PB_ADMIN_EMAIL, process.env.PB_ADMIN_PASSWORD);
			} catch {
				await adminPb.admins.authWithPassword(
					process.env.PB_ADMIN_EMAIL,
					process.env.PB_ADMIN_PASSWORD
				);
			}
			// Ensure booking is active
			await adminPb.collection('app_settings').update('abcsettings123', { is_booking_active: true });

			// Find a room with beds to test with
			const beds = await adminPb.collection('beds').getFullList({ expand: 'room,room.house' });
			if (beds.length === 0) throw new Error('No beds found in DB to test with');
			
			const bed = beds[0];
			testRoomId = bed.room;
			testHouseName = bed.expand.room.expand.house.name;
			console.log(`[E2E Setup] Using Room: ${testRoomId} in House: ${testHouseName}`);
		} catch (e) {
			console.error('[E2E Setup] Admin Auth or Room lookup failed.', e);
			throw e;
		}
	});

	test.beforeEach(async () => {
		// Clean slate for the test order and bed
		const order = await adminPb.collection('orders').getFirstListItem(`order_number="${TEST_CODE}"`);
		const beds = await adminPb.collection('beds').getFullList({
			filter: `order = "${order.id}"`
		});
		for (const bed of beds) {
			await adminPb.collection('beds').update(bed.id, { occupied: false, order: null });
		}
		// Also ensure the first bed in our test room is free
		const firstBed = await adminPb.collection('beds').getFirstListItem(`room = "${testRoomId}"`);
		await adminPb.collection('beds').update(firstBed.id, { occupied: false, order: null });
	});

	test.afterAll(async () => {
		// Final cleanup
		try {
			const order = await adminPb.collection('orders').getFirstListItem(`order_number="${TEST_CODE}"`);
			const beds = await adminPb.collection('beds').getFullList({
				filter: `order = "${order.id}"`
			});
			for (const bed of beds) {
				await adminPb.collection('beds').update(bed.id, { occupied: false, order: null });
			}
		} catch (e) {
			console.warn('[E2E Teardown] Cleanup failed, might leave traces.', e);
		}
	});

	test('Negative: Invalid Booking Code should show error', async ({ page }) => {
		await page.goto('/');
		await page.fill('input[name="bookingCode"]', 'INVALID-CODE');
		await page.click('button[type="submit"]');

		// Check for error message
		const errorMsg = page.locator('.error-msg');
		await expect(errorMsg).toBeVisible();
		await expect(page).toHaveURL('/');
	});

	test('Negative: Direct Room Access without session should redirect to login', async ({ page }) => {
		await page.goto(`/room/${testRoomId}`);
		await expect(page).toHaveURL('/');
	});

	test('Negative: Booking Locked in Staging Mode', async ({ page }) => {
		// 1. Set to Staging Mode (Locked)
		await adminPb.collection('app_settings').update('abcsettings123', { is_booking_active: false });

		try {
			// 2. Login
			await page.goto('/');
			await page.fill('input[name="bookingCode"]', TEST_CODE);
			await Promise.all([page.waitForURL('/map'), page.click('button[type="submit"]')]);

			// 3. Go to room
			await page.goto(`/room/${testRoomId}`);
			await expect(page.locator('h1')).toBeVisible();

			// 4. Assert beds are locked/disabled
			const beds = page.locator('.bed-card');
			const firstBed = beds.first();
			await expect(firstBed).toHaveAttribute('disabled', '');
		} finally {
			// Restore Live Mode
			await adminPb.collection('app_settings').update('abcsettings123', { is_booking_active: true });
		}
	});

	test('Positive: Full Booking Cycle with DB & Admin Dashboard Verification', async ({
		browser
	}) => {
		const adminContext = await browser.newContext();
		const userContext = await browser.newContext();
		const adminPage = await adminContext.newPage();
		const userPage = await userContext.newPage();

		// 1. Admin Login & Check Dashboard (Pre-booking)
		await adminPage.goto('/admin/login');
		await adminPage.fill('input[name="email"]', process.env.PB_ADMIN_EMAIL!);
		await adminPage.fill('input[name="password"]', process.env.PB_ADMIN_PASSWORD!);
		
		// Use Promise.all to reliably catch the redirect
		await Promise.all([
			adminPage.waitForURL(/\/admin(\/)?$/, { timeout: 15000 }),
			adminPage.click('button[type="submit"]')
		]);

		// Helper to ensure we are in List View (stats are visible)
		const ensureListView = async () => {
			const btn = adminPage.locator('button', { hasText: 'LIST VIEW' });
			if (await btn.isVisible()) {
				await btn.click();
				await expect(adminPage.locator('button', { hasText: 'MAP VIEW' })).toBeVisible();
			}
		};

		await ensureListView();

		// Get initial stats from house card
		const houseCard = adminPage.locator('.house-card').filter({ hasText: testHouseName });
		await expect(houseCard).toBeVisible();
		const initialStatText = await houseCard.locator('.stat-value').innerText();
		const initialOccupiedNum = parseInt(initialStatText.split('/')[0].trim());

		// 2. User Login & Book
		await userPage.goto('/');
		await userPage.fill('input[name="bookingCode"]', TEST_CODE);
		await Promise.all([userPage.waitForURL('/map'), userPage.click('button[type="submit"]')]);
		await userPage.goto(`/room/${testRoomId}`);

		const freeBed = userPage.locator('.bed-card.free').first();
		const bedLabel = await freeBed.locator('.label').innerText();
		await freeBed.click();
		await userPage.fill('input[name="guestName"]', 'E2E Tester');
		await userPage.click('.btn-confirm');

		// Verify UI
		await expect(userPage.locator('.bed-card.mine')).toBeVisible();

		// 3. DB Verification via Admin API
		const order = await adminPb.collection('orders').getFirstListItem(`order_number="${TEST_CODE}"`);
		const bed = await adminPb.collection('beds').getFirstListItem(`label="${bedLabel}" && room="${testRoomId}"`);
		
		expect(bed.occupied).toBe(true);
		expect(bed.order).toBe(order.id);
		// burner_name should be encrypted
		expect(order.burner_name).not.toBe('E2E Tester');
		expect(order.burner_name.length).toBeGreaterThan(10);

		// 4. Admin Dashboard Verification (Post-booking)
		await adminPage.reload();
		await ensureListView();
		const updatedStatText = await houseCard.locator('.stat-value').innerText();
		expect(parseInt(updatedStatText.split('/')[0].trim())).toBe(initialOccupiedNum + 1);

		// 5. User Cancellation
		await userPage.locator('.bed-card.mine').click();
		await userPage.click('.btn-unbook');
		await expect(userPage.locator('.bed-card.free').filter({ hasText: bedLabel })).toBeVisible();

		// 6. Final DB & Dashboard Check
		const bedAfter = await adminPb.collection('beds').getOne(bed.id);
		expect(bedAfter.occupied).toBe(false);
		expect(bedAfter.order).toBe('');

		await adminPage.reload();
		await ensureListView();
		const finalStatText = await houseCard.locator('.stat-value').innerText();
		expect(parseInt(finalStatText.split('/')[0].trim())).toBe(initialOccupiedNum);

		await adminContext.close();
		await userContext.close();
	});
});
