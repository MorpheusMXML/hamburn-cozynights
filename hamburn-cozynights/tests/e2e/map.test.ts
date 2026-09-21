import { test, expect } from '@playwright/test';
import type PocketBase from 'pocketbase';
import { TEST_CODE, adminSessionCookie, setBookingPhase, superuserClient } from './helpers';

/**
 * The camp map in every engine. The pins used to be HTML in a <foreignObject>,
 * which WebKit (Safari, all iOS browsers) drew in the top-left corner and could
 * not hit-test: guests could not open a house there. Run this file with the
 * webkit project too.
 */
test.describe('Camp map', () => {
	let pb: PocketBase;
	let house: { id: string; name: string; x: number; y: number };

	test.beforeAll(async () => {
		pb = await superuserClient();
		house = await pb.collection('houses').getFirstListItem('x > 60 && y > 60', { sort: 'name' });
	});

	test.afterAll(async () => {
		await pb.collection('houses').update(house.id, { x: house.x, y: house.y });
		await setBookingPhase(pb, true);
	});

	test('guest: pins sit on the map and a tap opens the house', async ({ page }) => {
		await setBookingPhase(pb, true);
		await page.goto('/');
		await page.fill('input[name="bookingCode"]', TEST_CODE);
		await page.click('button[type="submit"]');
		await expect(page).toHaveURL(/\/map$/);

		const map = await page.locator('svg[aria-label="Interactive house map"]').boundingBox();
		const pin = page.locator(`g.house-group[aria-label="House ${house.name}"] circle.hit`);
		await expect(pin).toBeVisible();
		const box = (await pin.boundingBox())!;
		const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };

		// Where the house's coordinates say, not piled up in a corner.
		const scale = Math.min(map!.width / 1000, map!.height / 700);
		const left = map!.x + (map!.width - 1000 * scale) / 2;
		const top = map!.y + (map!.height - 700 * scale) / 2;
		expect(Math.abs(center.x - (left + house.x * scale))).toBeLessThan(3);
		expect(Math.abs(center.y - (top + house.y * scale))).toBeLessThan(3);

		// The pin itself receives the pointer.
		const hit = await page.evaluate(
			([x, y]) =>
				document.elementFromPoint(x, y)?.closest('g.house-group')?.getAttribute('aria-label'),
			[center.x, center.y]
		);
		expect(hit).toBe(`House ${house.name}`);

		await pin.click();
		await expect(page).toHaveURL(new RegExp(`/house/${house.id}$`));
	});

	test('admin: dragging a pin saves the new position', async ({ page, context }) => {
		await setBookingPhase(pb, false);
		await context.addCookies([await adminSessionCookie(pb)]);
		await page.goto('/admin/camp', { waitUntil: 'networkidle' });

		const pin = page.locator(`g.house-group[aria-label="House ${house.name}"] circle.hit`);
		await pin.scrollIntoViewIfNeeded();
		const box = (await pin.boundingBox())!;
		const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };

		await page.mouse.move(start.x, start.y);
		await page.mouse.down();
		for (let step = 1; step <= 8; step++) {
			await page.mouse.move(start.x - step * 5, start.y - step * 5);
		}
		await page.mouse.up();

		await expect(page.locator('.toast')).toContainText('Saved');
		const moved = await pb.collection('houses').getOne(house.id);
		expect(moved.x).toBeLessThan(house.x);
		expect(moved.y).toBeLessThan(house.y);
	});

	test('admin: the layout is locked during Live Booking, and says so', async ({
		page,
		context
	}) => {
		await setBookingPhase(pb, true);
		const before = await pb.collection('houses').getOne(house.id);
		await context.addCookies([await adminSessionCookie(pb)]);
		await page.goto('/admin/camp', { waitUntil: 'networkidle' });

		const pin = page.locator(`g.house-group[aria-label="House ${house.name}"] circle.hit`);
		await pin.scrollIntoViewIfNeeded();
		const box = (await pin.boundingBox())!;
		const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };

		await page.mouse.move(start.x, start.y);
		await page.mouse.down();
		await page.mouse.move(start.x + 40, start.y + 40, { steps: 6 });
		await page.mouse.up();

		// The lock hint points at the pin that didn't move.
		const hint = page.locator('.lock-hint');
		await expect(hint).toContainText('Locked during Live Booking');
		await expect(hint).toContainText('To move houses');
		const after = await pb.collection('houses').getOne(house.id);
		expect([after.x, after.y]).toEqual([before.x, before.y]);
	});

	test('admin: typed coordinates are locked during Live Booking too', async ({
		page,
		context
	}) => {
		await setBookingPhase(pb, true);
		const before = await pb.collection('houses').getOne(house.id);
		await context.addCookies([await adminSessionCookie(pb)]);
		await page.goto('/admin/camp', { waitUntil: 'networkidle' });

		await page.locator(`g.house-group[aria-label="House ${house.name}"]`).focus();
		await page.keyboard.press('Enter');
		const x = page.locator('#house-x');
		await expect(x).toHaveAttribute('readonly', '');
		await expect(x).toHaveAttribute('aria-disabled', 'true');

		// Typing changes nothing and says why; MOVE PIN explains itself too.
		await x.focus();
		await page.keyboard.type('9');
		await expect(x).toHaveValue(String(before.x));
		await expect(page.locator('.lock-hint')).toContainText('To move houses');
		// force: Playwright waits for aria-disabled controls to become enabled.
		await page.getByRole('button', { name: 'MOVE PIN' }).click({ force: true });
		// The previous hint fades out while the new one comes in.
		await expect(page.locator('.lock-hint')).toHaveCount(1);
		await expect(page.locator('.lock-hint')).toContainText('To move houses');

		const after = await pb.collection('houses').getOne(house.id);
		expect([after.x, after.y]).toEqual([before.x, before.y]);
	});
});
