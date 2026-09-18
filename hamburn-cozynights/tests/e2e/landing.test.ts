import { test, expect } from '@playwright/test';
import { GLYPH_WIDTH } from '../../src/lib/fx/effigy/glyphs';
import { DEFAULT_LINES, layoutUnits, lineWidthUnits } from '../../src/lib/fx/effigy/structure';

/**
 * The landing page title: the burning effigy (canvas) on top of a real heading.
 * Needs no PocketBase.
 */
test.describe('Landing page title', () => {
	test('keeps a real heading, and the animation can be paused', async ({ page }) => {
		await page.goto('/');
		await expect(
			page.getByRole('heading', { level: 1, name: 'Hamburn CozyNights' })
		).toBeAttached();
		await expect(page.locator('.effigy')).toHaveClass(/live/);

		const toggle = page.getByRole('button', { name: 'Pause animation' });
		await expect(toggle).toHaveAttribute('aria-pressed', 'false');
		await toggle.click();
		await expect(toggle).toHaveAttribute('aria-pressed', 'true');
		await expect(page.locator('html')).toHaveAttribute('data-motion', 'paused');

		// Remembered in this browser.
		await page.reload();
		await expect(toggle).toHaveAttribute('aria-pressed', 'true');
		await toggle.click();
		await expect(page.locator('html')).not.toHaveAttribute('data-motion', 'paused');
	});

	test('the cursor (or a finger) lights the standing letters', async ({ page, isMobile }) => {
		await page.goto('/');
		const title = page.locator('.effigy');
		// Magic balls build the title first.
		await expect(title).toHaveAttribute('data-phase', 'stand', { timeout: 15_000 });

		// The left leg of the first letter.
		const box = (await title.boundingBox())!;
		const scale = box.width / layoutUnits(DEFAULT_LINES).width;
		const left = box.x + (box.width - lineWidthUnits(DEFAULT_LINES[0]) * scale) / 2;
		const x = left + 0.075 * scale;
		expect(GLYPH_WIDTH * scale).toBeGreaterThan(10);
		if (isMobile) {
			await page.touchscreen.tap(x, box.y + 0.5 * scale);
		} else {
			await page.mouse.move(x, box.y + 0.1 * scale);
			await page.mouse.move(x, box.y + 0.9 * scale, { steps: 12 });
		}
		await expect(title).toHaveAttribute('data-phase', 'burn');
	});

	test('prefers-reduced-motion: a still title and no pause button', async ({ page }) => {
		await page.emulateMedia({ reducedMotion: 'reduce' });
		await page.goto('/');
		const title = page.locator('.effigy');
		await expect(title).toHaveClass(/live/);
		await expect(title).toHaveAttribute('data-phase', 'stand');
		await expect(page.getByRole('button', { name: 'Pause animation' })).toHaveCount(0);
		await page.waitForTimeout(6000);
		await expect(title).toHaveAttribute('data-phase', 'stand');
	});
});
