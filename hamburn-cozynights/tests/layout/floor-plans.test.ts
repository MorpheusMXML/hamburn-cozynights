// tests/layout/floor-plans.test.ts — guests see a house's floor plans, before
// booking opens too: in Staging the map's panel offers 🗺️ LOOK AROUND, a tap
// on a pin opens the house (read-only), and its 🗺️ Floor plans button shows
// the plans there and on every room page of the house. Runs in the layout
// suite because it needs a browser and the seeded camp (npm run test:layout).
import { test, expect, type Page } from '@playwright/test';
import fs from 'fs';
import { CAMP_FILE, setPhase, superuser, type StressCamp } from './stress-data';

const BASE = process.env.LAYOUT_BASE_URL || process.env.SMOKE_BASE_URL || '';
const PB_URL = process.env.PB_TEST_URL || '';
const PLANS = [
	{ image: '/floorplans/waelderhaus-lower-floor-2026-v2.webp', caption: 'Lower floor' },
	{ image: '/floorplans/waelderhaus-upper-floor-2026-v2.webp', caption: 'Upper floor' }
];
let camp: StressCamp;

test.beforeAll(() => {
	camp = JSON.parse(fs.readFileSync(CAMP_FILE, 'utf8'));
});

async function expectPlansShown(page: Page, houseName: string) {
	await page.getByRole('button', { name: /Floor plans/ }).click();
	const dialog = page.getByRole('dialog');
	await expect(dialog).toBeVisible();
	await expect(dialog.getByRole('heading', { name: houseName })).toBeVisible();
	await expect(dialog.getByText('Upper floor')).toBeVisible();
	const loaded = await dialog.locator('img').evaluateAll((imgs) =>
		Promise.all(
			(imgs as HTMLImageElement[]).map((img) =>
				img.decode().then(
					() => img.naturalWidth,
					() => 0
				)
			)
		)
	);
	expect(loaded, 'every plan picture loads').toEqual([1600, 1600]);
	await dialog.getByRole('button', { name: 'Close the floor plans' }).click();
	await expect(dialog).toBeHidden();
}

for (const phase of ['staging', 'live'] as const) {
	test(`guests see the floor plans from the map in ${phase}`, async ({ browser }) => {
		const pb = await superuser(PB_URL, process.env.PB_ADMIN_EMAIL!, process.env.PB_ADMIN_PASSWORD!);
		const house = await pb.collection('houses').getOne(camp.houseId);
		await pb.collection('houses').update(camp.houseId, { floor_plans: PLANS });
		const context = await browser.newContext({ baseURL: BASE });
		try {
			await context.addCookies([
				{ name: 'bookingCode', value: camp.guestWithSpot, url: BASE },
				{ name: 'bookingRound', value: camp.guestRound, url: BASE }
			]);
			const page = await context.newPage();
			await setPhase(pb, phase);
			await page.goto('/map', { waitUntil: 'networkidle' });
			// Before booking opens the panel lies over the map; LOOK AROUND puts it away.
			if (phase === 'staging') await page.getByRole('button', { name: /LOOK AROUND/ }).click();
			// Tap the pin itself: the label of a long name at the map's edge is mostly map.
			await page
				.getByRole('button', { name: `House ${house.name}` })
				.locator('.hit')
				.click();
			await page.waitForURL(`**/house/${camp.houseId}`);
			await expectPlansShown(page, house.name);

			await page.goto(`/room/${camp.roomId}`, { waitUntil: 'networkidle' });
			await expectPlansShown(page, house.name);
		} finally {
			await pb
				.collection('houses')
				.update(camp.houseId, { floor_plans: house.floor_plans ?? null });
			await context.close();
		}
	});
}
