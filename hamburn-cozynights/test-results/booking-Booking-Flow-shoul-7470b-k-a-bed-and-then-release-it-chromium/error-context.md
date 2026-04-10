# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: booking.test.ts >> Booking Flow >> should login, book a bed, and then release it
- Location: tests/e2e/booking.test.ts:41:5

# Error details

```
Test timeout of 30000ms exceeded.
```

```
Error: page.fill: Test timeout of 30000ms exceeded.
Call log:
  - waiting for locator('input[name="guestName"]')

```

# Page snapshot

```yaml
- generic [ref=e4]:
  - banner [ref=e5]:
    - link "← Back to House" [ref=e7] [cursor=pointer]:
      - /url: /house/brahmseevilla01
    - 'heading "Brahmsee Villa (1) #1" [level=1] [ref=e8]'
  - generic [ref=e9]:
    - button "🛏️ R Available Grab it now!" [active] [ref=e10] [cursor=pointer]:
      - generic [ref=e11]: 🛏️
      - generic [ref=e12]: R
      - generic [ref=e13]:
        - generic [ref=e14]: Available
        - generic [ref=e15]: Grab it now!
    - button "🛏️ test1 Available Grab it now!" [ref=e16] [cursor=pointer]:
      - generic [ref=e17]: 🛏️
      - generic [ref=e18]: test1
      - generic [ref=e19]:
        - generic [ref=e20]: Available
        - generic [ref=e21]: Grab it now!
    - button "🛏️ test2 Available Grab it now!" [ref=e22] [cursor=pointer]:
      - generic [ref=e23]: 🛏️
      - generic [ref=e24]: test2
      - generic [ref=e25]:
        - generic [ref=e26]: Available
        - generic [ref=e27]: Grab it now!
    - button "🛏️ test3 Available Grab it now!" [ref=e28] [cursor=pointer]:
      - generic [ref=e29]: 🛏️
      - generic [ref=e30]: test3
      - generic [ref=e31]:
        - generic [ref=e32]: Available
        - generic [ref=e33]: Grab it now!
```

# Test source

```ts
  1   | import { test, expect } from '@playwright/test';
  2   | import PocketBase from 'pocketbase';
  3   | import * as dotenv from 'dotenv';
  4   | import path from 'path';
  5   | import { fileURLToPath } from 'url';
  6   | 
  7   | const __filename = fileURLToPath(import.meta.url);
  8   | const __dirname = path.dirname(__filename);
  9   | 
  10  | // Load env vars from the project root .env
  11  | // override: true ensures that .env values win over any pre-set shell variables
  12  | dotenv.config({ path: path.resolve(__dirname, '../../.env'), override: true });
  13  | 
  14  | test.describe('Booking Flow', () => {
  15  |     const TEST_CODE = 'XXXXX'; 
  16  |     const ROOM_ID = 'brahmseevill001';
  17  |     let pb: any;
  18  | 
  19  |     test.beforeAll(async () => {
  20  |         // Initialize admin PB for test setup
  21  |         const PB_URL = process.env.PUBLIC_PB_URL || 'http://127.0.0.1:8090';
  22  |         pb = new PocketBase(PB_URL);
  23  |         
  24  |         try {
  25  |             // Try both old and new PocketBase admin auth styles
  26  |             try {
  27  |                 // New PB (v0.23+)
  28  |                 await pb.collection('_superusers').authWithPassword(process.env.PB_ADMIN_EMAIL, process.env.PB_ADMIN_PASSWORD);
  29  |             } catch {
  30  |                 // Old PB
  31  |                 await pb.admins.authWithPassword(process.env.PB_ADMIN_EMAIL, process.env.PB_ADMIN_PASSWORD);
  32  |             }
  33  |             
  34  |             // Ensure bookings are active for testing
  35  |             await pb.collection('app_settings').update('abcsettings123', { is_booking_active: true });
  36  |         } catch (e) {
  37  |             console.warn('[E2E Setup] Admin Auth failed. Skipping staging mode toggle. Test may fail if locked.', e);
  38  |         }
  39  |     });
  40  | 
  41  |     test('should login, book a bed, and then release it', async ({ page }) => {
  42  |         // 1. Portal Login
  43  |         await page.goto('/');
  44  |         await page.fill('input[name="bookingCode"]', TEST_CODE);
  45  |         
  46  |         // Wait for navigation after form submit
  47  |         await Promise.all([
  48  |             page.waitForURL('/map'),
  49  |             page.click('button[type="submit"]')
  50  |         ]);
  51  | 
  52  |         // 2. Navigate to room
  53  |         await page.goto(`/room/${ROOM_ID}`);
  54  |         
  55  |         // Wait for the specific room title or the room number indicator
  56  |         const roomHeader = page.locator('h1');
  57  |         await expect(roomHeader).toBeVisible();
  58  |         // The room page has an <h1> with a <small> tag inside for the room number
  59  |         await expect(page.locator('h1')).toContainText('#');
  60  | 
  61  |         // 3. CLEANUP: If we already have a booking, release it first
  62  |         const releaseBanner = page.locator('.btn-unbook-banner');
  63  |         if (await releaseBanner.isVisible()) {
  64  |             await releaseBanner.click();
  65  |             await expect(releaseBanner).not.toBeVisible();
  66  |         }
  67  | 
  68  |         // 4. Find an available bed and book it
  69  |         // If Staging Mode is on and we couldn't disable it, we might need to skip the booking click
  70  |         const freeBed = page.locator('.bed-card.free').first();
  71  |         const isLocked = await freeBed.getAttribute('disabled') !== null;
  72  |         
  73  |         if (isLocked) {
  74  |             console.warn('[E2E] Bookings are LOCKED. Skipping actual booking steps. Please enable bookings in admin to test full flow.');
  75  |             return;
  76  |         }
  77  | 
  78  |         await expect(freeBed).toBeEnabled();
  79  |         const bedLabel = await freeBed.locator('.label').innerText();
  80  |         await freeBed.click();
  81  | 
  82  |         // 5. In Modal, save the spot
> 83  |         await page.fill('input[name="guestName"]', 'E2E Tester');
      |                    ^ Error: page.fill: Test timeout of 30000ms exceeded.
  84  |         await page.click('.btn-confirm');
  85  | 
  86  |         // 6. Verify it's now "My Spot"
  87  |         const myBed = page.locator('.bed-card.mine');
  88  |         await expect(myBed.locator('.label')).toHaveText(bedLabel);
  89  |         
  90  |         // 7. Release the spot via modal
  91  |         await myBed.click();
  92  |         const releaseBtn = page.locator('.btn-unbook');
  93  |         await expect(releaseBtn).toBeVisible();
  94  |         await releaseBtn.click();
  95  | 
  96  |         // 8. Verify it's free again
  97  |         await expect(page.locator('.bed-card.free').filter({ hasText: bedLabel })).toBeVisible();
  98  |     });
  99  | });
  100 | 
```