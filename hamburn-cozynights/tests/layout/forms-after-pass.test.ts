// tests/layout/forms-after-pass.test.ts — forms keep working after the booking
// pass. A page's referrer policy stays with the browser document for the rest
// of a visit without a reload: "no-referrer" on the pass page made every later
// plain form POST (Sign out, Eject, connect Telegram, …) arrive with
// "Origin: null", which SvelteKit refuses with 403 "Cross-site POST form
// submissions are forbidden". Runs in the layout suite because it needs a
// browser and the seeded camp (npm run test:layout).
import { test, expect, type Page } from '@playwright/test';
import fs from 'fs';
import { CAMP_FILE, setPhase, superuser, type StressCamp } from './stress-data';

const BASE = process.env.LAYOUT_BASE_URL || process.env.SMOKE_BASE_URL || '';
const PB_URL = process.env.PB_TEST_URL || '';
let camp: StressCamp;

test.beforeAll(() => {
	camp = JSON.parse(fs.readFileSync(CAMP_FILE, 'utf8'));
});

/** Presses Sign out in the top bar and returns the status of the form POST. */
async function signOut(page: Page): Promise<number> {
	const post = page.waitForResponse(
		(r) => r.request().method() === 'POST' && r.url().includes('signOut')
	);
	await page.getByRole('button', { name: 'Sign out' }).click();
	return (await post).status();
}

for (const how of ['opened in the app', 'opened by its link'] as const) {
	test(`Sign out works after the booking pass (${how})`, async ({ browser }) => {
		const pb = await superuser(PB_URL, process.env.PB_ADMIN_EMAIL!, process.env.PB_ADMIN_PASSWORD!);
		await setPhase(pb, 'live');
		const context = await browser.newContext({ baseURL: BASE });
		await context.addCookies([
			{ name: 'bookingCode', value: camp.guestWithSpot, url: BASE },
			{ name: 'bookingRound', value: camp.guestRound, url: BASE }
		]);
		const page = await context.newPage();

		if (how === 'opened in the app') {
			// Room page → 🎫 Show booking pass (client-side, the pass page's <meta>).
			await page.goto(`/room/${camp.roomId}`, { waitUntil: 'networkidle' });
			await page.getByRole('link', { name: /Show booking pass/ }).click();
			await page.waitForURL(/\/pass\//);
		} else {
			// From a mail or a QR scan: the pass loads first (its response header).
			await page.goto(`/pass/${camp.passCode}`, { waitUntil: 'networkidle' });
		}
		// On into the app without a reload.
		await page.getByRole('link', { name: 'Camp map' }).click();
		await page.waitForURL(/\/map/);

		expect(await signOut(page), 'the sign-out POST is accepted').not.toBe(403);
		await page.waitForURL(/login=out/);
		await context.close();
	});
}
