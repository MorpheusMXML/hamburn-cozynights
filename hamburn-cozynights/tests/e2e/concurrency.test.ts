import { test, expect } from '@playwright/test';
import PocketBase from 'pocketbase';
import * as dotenv from 'dotenv';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env'), override: true });

const TEST_CODE_A = 'XXXXX';
const TEST_CODE_B = 'YYYYY';
const PB_URL = process.env.PUBLIC_PB_URL || 'http://127.0.0.1:8090';

// Helper to match app's hashing logic
function createLookupHash(text: string): string {
	const salt = process.env.ENCRYPTION_KEY || 'default_salt';
	return crypto.createHmac('sha256', salt).update(text).digest('hex');
}

test.describe('Booking Concurrency', () => {
	let adminPb: any;
	let testRoomId: string;

	test.beforeAll(async () => {
		adminPb = new PocketBase(PB_URL);
		try {
			await adminPb.collection('_superusers').authWithPassword(
				process.env.PB_ADMIN_EMAIL,
				process.env.PB_ADMIN_PASSWORD
			);
		} catch {
			await adminPb.admins.authWithPassword(
				process.env.PB_ADMIN_EMAIL,
				process.env.PB_ADMIN_PASSWORD
			);
		}

		// Ensure TEST_CODE_B exists with CORRECT HASH
		try {
			const existing = await adminPb.collection('orders').getFirstListItem(`order_number="${TEST_CODE_B}"`);
			await adminPb.collection('orders').update(existing.id, { order_hash: createLookupHash(TEST_CODE_B) });
		} catch {
			await adminPb.collection('orders').create({
				order_number: TEST_CODE_B,
				order_hash: createLookupHash(TEST_CODE_B),
				customer_name: 'Concurrency User B',
				burner_name: '0000:0000:0000',
				booking_date: new Date().toISOString()
			});
		}

		// Ensure TEST_CODE_A also has correct hash
		const orderA = await adminPb.collection('orders').getFirstListItem(`order_number="${TEST_CODE_A}"`);
		await adminPb.collection('orders').update(orderA.id, { order_hash: createLookupHash(TEST_CODE_A) });

		// Find a room with beds
		const beds = await adminPb.collection('beds').getFullList();
		testRoomId = beds[0].room;
	});

	test('should prevent two users from booking the same bed simultaneously', async ({ browser }) => {
		const contextA = await browser.newContext();
		const contextB = await browser.newContext();
		const pageA = await contextA.newPage();
		const pageB = await contextB.newPage();

		// 1. Login both users
		await Promise.all([
			pageA.goto('/'),
			pageB.goto('/')
		]);
		await pageA.fill('input[name="bookingCode"]', TEST_CODE_A);
		await pageB.fill('input[name="bookingCode"]', TEST_CODE_B);
		
		await Promise.all([
			pageA.click('button[type="submit"]'),
			pageB.click('button[type="submit"]'),
			pageA.waitForURL('/map'),
			pageB.waitForURL('/map')
		]);

		// 2. Navigate both to the same room
		await Promise.all([
			pageA.goto(`/room/${testRoomId}`),
			pageB.goto(`/room/${testRoomId}`)
		]);

		// 3. Find the same free bed
		const freeBeds = pageA.locator('.bed-card.free');
		await expect(freeBeds.first()).toBeVisible();
		const bedLabel = await freeBeds.first().locator('.bed-label').innerText();
		
		const bedBtnA = pageA.locator('.bed-card.free').filter({ hasText: bedLabel });
		const bedBtnB = pageB.locator('.bed-card.free').filter({ hasText: bedLabel });

		await bedBtnA.click();
		await bedBtnB.click();

		// 4. Fill guest names
		await pageA.fill('input[name="guestName"]', 'Racer A');
		await pageB.fill('input[name="guestName"]', 'Racer B');

		// 5. Submit booking simultaneously
		await Promise.all([
			pageA.click('.btn-confirm'),
			pageB.click('.btn-confirm')
		]);

		// 6. Assertions
		// One should succeed (.mine state), the other should show an error
		const classA = await pageA.locator('.bed-card').filter({ hasText: bedLabel }).getAttribute('class');
		const classB = await pageB.locator('.bed-card').filter({ hasText: bedLabel }).getAttribute('class');

		const isAMine = classA?.includes('mine');
		const isBMine = classB?.includes('mine');

		// XOR: Exactly one must be true
		expect(isAMine !== isBMine).toBeTruthy();

		if (!isAMine) {
			await expect(pageA.locator('.error-msg, .text-error, .alert-error')).toBeVisible();
		}
		if (!isBMine) {
			await expect(pageB.locator('.error-msg, .text-error, .alert-error')).toBeVisible();
		}

		await contextA.close();
		await contextB.close();
	});
});
