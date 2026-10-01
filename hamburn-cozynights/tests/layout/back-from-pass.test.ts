// tests/layout/back-from-pass.test.ts — the browser's Back button from the
// booking pass keeps the guest signed in. hooks.server.ts doesn't read the
// ticket on the pass page, so the root layout says signedIn: false there.
// SvelteKit reuses a layout's data on a client-side navigation unless the load
// used something that changed; the layout read the URL only for a ticket on a
// bar page, so Back to the room page kept the pass's answer: the page said
// "is yours", the top bar had no Sign out and no 🔁 until a reload
// (src/routes/+layout.server.ts). Runs in the layout suite because it needs a
// browser and the seeded camp (npm run test:layout).
import { test, expect } from '@playwright/test';
import fs from 'fs';
import { CAMP_FILE, setPhase, superuser, type StressCamp } from './stress-data';

const BASE = process.env.LAYOUT_BASE_URL || process.env.SMOKE_BASE_URL || '';
const PB_URL = process.env.PB_TEST_URL || '';
let camp: StressCamp;

test.beforeAll(() => {
	camp = JSON.parse(fs.readFileSync(CAMP_FILE, 'utf8'));
});

test('Back from the booking pass keeps the top bar signed in', async ({ browser }) => {
	const pb = await superuser(PB_URL, process.env.PB_ADMIN_EMAIL!, process.env.PB_ADMIN_PASSWORD!);
	await setPhase(pb, 'live');
	const context = await browser.newContext({ baseURL: BASE });
	await context.addCookies([
		{ name: 'bookingCode', value: camp.guestWithSpot, url: BASE },
		{ name: 'bookingRound', value: camp.guestRound, url: BASE }
	]);
	const page = await context.newPage();
	const bar = page.getByRole('banner');
	const signOut = bar.getByRole('button', { name: 'Sign out' });
	const swaps = bar.getByRole('link', { name: /^Swap/ });

	await page.goto(`/room/${camp.roomId}`, { waitUntil: 'networkidle' });
	await expect(signOut).toBeVisible();
	await expect(swaps).toBeVisible();

	// 🎫 Show booking pass (client-side), then the browser's Back button.
	await page.getByRole('link', { name: /Show booking pass/ }).click();
	await page.waitForURL(/\/pass\//);
	await expect(signOut).toHaveCount(0);
	await page.goBack();
	await page.waitForURL(/\/room\//);

	await expect(page.getByRole('heading', { name: 'Welcome Home!' })).toBeVisible();
	await expect(signOut, 'Sign out is back in the top bar').toBeVisible();
	await expect(swaps, 'the 🔁 swaps link is back too').toBeVisible();
	await context.close();
});
