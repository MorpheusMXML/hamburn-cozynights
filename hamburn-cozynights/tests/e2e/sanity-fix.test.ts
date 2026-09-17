import { test, expect } from '@playwright/test';
import PocketBase from 'pocketbase';
import * as dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env'), override: true });

const PB_URL = process.env.PUBLIC_PB_URL || 'http://127.0.0.1:8090';

test.describe('Sanity Check Fix Modal', () => {
	let adminPb: any;

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
	});

	test('should open fix modal and successfully create a room', async ({ page }) => {
		// 1. Create a house with no rooms to trigger sanity warning
		const house = await adminPb.collection('houses').create({
			name: 'Empty Test House',
			x: 100,
			y: 100
		});

		try {
			// 2. Login and go to admin dashboard
			await page.goto('/admin/login');
			await page.fill('input[name="email"]', process.env.PB_ADMIN_EMAIL!);
			await page.fill('input[name="password"]', process.env.PB_ADMIN_PASSWORD!);
			await Promise.all([
				page.waitForURL(/\/admin(\/)?$/),
				page.click('button[type="submit"]')
			]);

			// 3. Verify sanity warning is visible
			const warningNode = page.locator('.house-node').filter({ hasText: 'Empty Test House' });
			await expect(warningNode).toBeVisible();
			await expect(warningNode.locator('.error-tag')).toHaveText('NO ROOMS DETECTED');

			// 4. Click "SOLVE ISSUE NOW"
			await warningNode.locator('button.fix-btn').click();

			// 5. Verify modal is open
			const modal = page.locator('.modal-content');
			await expect(modal).toBeVisible();
			await expect(modal.locator('h2')).toContainText('Empty Test House');

			// 6. Fill in Add Room form
			await modal.locator('input[name="name"]').fill('E2E Room');
			await modal.locator('input[name="room_number"]').fill('999');
			await modal.locator('input[name="amount_beds"]').fill('2');

			// 7. Submit and wait for modal to close
			await Promise.all([
				modal.locator('button[type="submit"]').click(),
				expect(modal).not.toBeVisible()
			]);

			// 8. Verify DB update via API
			const rooms = await adminPb.collection('rooms').getFullList({
				filter: `house = "${house.id}"`
			});
			expect(rooms.length).toBe(1);
			expect(rooms[0].name).toBe('E2E Room');

			// 9. Verify warning is gone or updated
			await expect(warningNode.locator('.error-tag')).not.toBeVisible();
			// It should now show "EMPTY MODULE (NO BEDS)" for the room if beds weren't created,
			// but our action creates them if amount_beds > 0.
			
			const roomNode = warningNode.locator('.room-node');
			await expect(roomNode).not.toBeVisible(); // Should be gone if beds were created

		} finally {
			// Cleanup
			const rooms = await adminPb.collection('rooms').getFullList({ filter: `house="${house.id}"` });
			for (const r of rooms) {
				const beds = await adminPb.collection('beds').getFullList({ filter: `room="${r.id}"` });
				for (const b of beds) await adminPb.collection('beds').delete(b.id);
				await adminPb.collection('rooms').delete(r.id);
			}
			await adminPb.collection('houses').delete(house.id);
		}
	});
});
