import { test, expect } from '@playwright/test';
import PocketBase from 'pocketbase';
import * as dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load env vars from the project root .env
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

test.describe('Booking Flow', () => {
    const TEST_CODE = 'XXXXX'; 
    const ROOM_ID = 'brahmseevill001';
    let pb: any;

    test.beforeAll(async () => {
        // Initialize admin PB for test setup
        const PB_URL = process.env.PUBLIC_PB_URL || 'http://127.0.0.1:8090';
        pb = new PocketBase(PB_URL);
        
        try {
            // Try both old and new PocketBase admin auth styles
            try {
                // New PB (v0.23+)
                await pb.collection('_superusers').authWithPassword(process.env.PB_ADMIN_EMAIL, process.env.PB_ADMIN_PASSWORD);
            } catch {
                // Old PB
                await pb.admins.authWithPassword(process.env.PB_ADMIN_EMAIL, process.env.PB_ADMIN_PASSWORD);
            }
            
            // Ensure bookings are active for testing
            await pb.collection('app_settings').update('abcsettings123', { is_booking_active: true });
        } catch (e) {
            console.warn('[E2E Setup] Admin Auth failed. Skipping staging mode toggle. Test may fail if locked.', e);
        }
    });

    test('should login, book a bed, and then release it', async ({ page }) => {
        // 1. Portal Login
        await page.goto('/');
        await page.fill('input[name="bookingCode"]', TEST_CODE);
        
        // Wait for navigation after form submit
        await Promise.all([
            page.waitForURL('/map'),
            page.click('button[type="submit"]')
        ]);

        // 2. Navigate to room
        await page.goto(`/room/${ROOM_ID}`);
        
        // Wait for the specific room title or the room number indicator
        const roomHeader = page.locator('h1');
        await expect(roomHeader).toBeVisible();
        // The room page has an <h1> with a <small> tag inside for the room number
        await expect(page.locator('h1 small')).toContainText('#');

        // 3. CLEANUP: If we already have a booking, release it first
        const releaseBanner = page.locator('.btn-unbook-banner');
        if (await releaseBanner.isVisible()) {
            await releaseBanner.click();
            await expect(releaseBanner).not.toBeVisible();
        }

        // 4. Find an available bed and book it
        // If Staging Mode is on and we couldn't disable it, we might need to skip the booking click
        const freeBed = page.locator('.bed-card.free').first();
        const isLocked = await freeBed.getAttribute('disabled') !== null;
        
        if (isLocked) {
            console.warn('[E2E] Bookings are LOCKED. Skipping actual booking steps. Please enable bookings in admin to test full flow.');
            return;
        }

        await expect(freeBed).toBeEnabled();
        const bedLabel = await freeBed.locator('.label').innerText();
        await freeBed.click();

        // 5. In Modal, save the spot
        await page.fill('input[name="guestName"]', 'E2E Tester');
        await page.click('.btn-confirm');

        // 6. Verify it's now "My Spot"
        const myBed = page.locator('.bed-card.mine');
        await expect(myBed.locator('.label')).toHaveText(bedLabel);
        
        // 7. Release the spot via modal
        await myBed.click();
        const releaseBtn = page.locator('.btn-unbook');
        await expect(releaseBtn).toBeVisible();
        await releaseBtn.click();

        // 8. Verify it's free again
        await expect(page.locator('.bed-card.free').filter({ hasText: bedLabel })).toBeVisible();
    });
});
