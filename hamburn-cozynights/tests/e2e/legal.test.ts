import { test, expect } from '@playwright/test';

/**
 * Impressum and privacy policy: reachable from every page with one click,
 * clearly labelled. Needs no PocketBase. The operator details come from the
 * server's .env, so the checks don't depend on them.
 */
test.describe('Legal pages', () => {
	test('Impressum has the § 5 DDG block and the disclaimer', async ({ page }) => {
		await page.goto('/impressum');
		await expect(page.getByRole('heading', { level: 1, name: 'Impressum' })).toBeVisible();
		await expect(page.getByText('Angaben gemäß § 5 DDG')).toBeVisible();
		await expect(page.getByRole('heading', { name: 'Kontakt' })).toBeVisible();
		await expect(page.getByRole('heading', { name: 'Haftungsausschluss' })).toBeVisible();
		await expect(page.locator('main')).toHaveAttribute('lang', 'de');
		// The EU dispute platform was shut down in 2025; a link to it is a liability now.
		await expect(page.locator('a[href*="ec.europa.eu/consumers/odr"]')).toHaveCount(0);
	});

	test('the privacy policy covers hosting, logs, cookies and rights', async ({ page }) => {
		await page.goto('/datenschutz');
		await expect(
			page.getByRole('heading', { level: 1, name: 'Datenschutzerklärung' })
		).toBeVisible();
		for (const section of ['Hosting', 'Server-Logdateien', 'Anmeldung der Crew', 'Deine Rechte']) {
			await expect(page.getByRole('heading', { name: section })).toBeVisible();
		}
		await expect(page.getByText('Widerspruchsrecht:')).toBeVisible();
		await expect(page.getByText('bookingCode')).toBeVisible();
	});

	test('the booking rules cover booking, reassignment, names and the houses', async ({ page }) => {
		await page.goto('/buchungsregeln');
		await expect(page.getByRole('heading', { level: 1, name: 'Buchungsregeln' })).toBeVisible();
		for (const section of [
			'Wer buchen kann',
			'Kein Anspruch auf einen bestimmten Platz',
			'Burner-Name',
			'In den Unterkünften'
		]) {
			await expect(page.getByRole('heading', { name: section })).toBeVisible();
		}
		await expect(page.locator('main')).toHaveAttribute('lang', 'de');
	});

	for (const path of ['/', '/map', '/impressum', '/no-such-page']) {
		test(`one click from ${path} to both pages`, async ({ page }) => {
			await page.goto(path);
			const legal = page.getByRole('navigation', { name: 'Legal' });
			await expect(legal.getByRole('link', { name: 'Impressum' })).toBeVisible();
			await expect(legal.getByRole('link', { name: 'Buchungsregeln' })).toBeVisible();
			await legal.getByRole('link', { name: 'Datenschutz' }).click();
			await expect(page).toHaveURL(/\/datenschutz$/);
		});
	}
});
