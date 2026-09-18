import { test, expect } from '@playwright/test';

/**
 * Legal notice, privacy policy and booking rules: reachable from every page
 * with one click, clearly labelled. Needs no PocketBase. The operator details
 * come from the server's .env, so the checks don't depend on them.
 */
test.describe('Legal pages', () => {
	test('the legal notice has the § 5 DDG block and the disclaimer', async ({ page }) => {
		await page.goto('/legal-notice');
		await expect(page.getByRole('heading', { level: 1, name: 'Legal notice' })).toBeVisible();
		await expect(page.getByText('Information according to § 5 DDG')).toBeVisible();
		await expect(page.getByRole('heading', { name: 'Contact' })).toBeVisible();
		await expect(page.getByRole('heading', { name: 'Disclaimer' })).toBeVisible();
		// The EU dispute platform was shut down in 2025; a link to it is a liability now.
		await expect(page.locator('a[href*="ec.europa.eu/consumers/odr"]')).toHaveCount(0);
	});

	test('the privacy policy covers hosting, logs, bookings, cookies and rights', async ({
		page
	}) => {
		await page.goto('/privacy');
		await expect(page.getByRole('heading', { level: 1, name: 'Privacy policy' })).toBeVisible();
		for (const section of [
			'Hosting',
			'Server log files',
			'Booking a bed',
			'Crew sign-in',
			'Your rights'
		]) {
			await expect(page.getByRole('heading', { name: section, exact: true })).toBeVisible();
		}
		await expect(page.getByText('Right to object:')).toBeVisible();
		await expect(page.getByText('bookingCode')).toBeVisible();
	});

	test('the booking rules say who can book and what applies in the houses', async ({ page }) => {
		await page.goto('/booking-rules');
		await expect(page.getByRole('heading', { level: 1, name: 'Booking rules' })).toBeVisible();
		for (const section of [
			'Who can book',
			'No claim to a particular bed',
			'Burner name',
			'In the houses'
		]) {
			await expect(page.getByRole('heading', { name: section })).toBeVisible();
		}
		await expect(page.getByText('Camper memberships')).toBeVisible();
	});

	test('the German addresses lead to the English pages', async ({ page }) => {
		await page.goto('/impressum');
		await expect(page).toHaveURL(/\/legal-notice$/);
		await page.goto('/datenschutz');
		await expect(page).toHaveURL(/\/privacy$/);
	});

	for (const path of ['/', '/map', '/legal-notice', '/no-such-page']) {
		test(`one click from ${path} to every legal page`, async ({ page }) => {
			await page.goto(path);
			const legal = page.getByRole('navigation', { name: 'Legal' });
			await expect(legal.getByRole('link', { name: 'Legal notice' })).toBeVisible();
			await expect(legal.getByRole('link', { name: 'Booking rules' })).toBeVisible();
			await legal.getByRole('link', { name: 'Privacy' }).click();
			await expect(page).toHaveURL(/\/privacy$/);
		});
	}
});
