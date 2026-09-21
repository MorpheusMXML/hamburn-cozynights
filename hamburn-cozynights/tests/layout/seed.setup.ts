// tests/layout/seed.setup.ts — builds the stress camp once per run (a Playwright
// setup project, so a failing test that restarts its worker doesn't add
// another camp). The page tests read it from CAMP_FILE.
import { test as setup } from '@playwright/test';
import fs from 'fs';
import { CAMP_FILE, seedStressCamp, superuser } from './stress-data';

setup('seed the stress camp', async () => {
	const base = process.env.LAYOUT_BASE_URL || process.env.SMOKE_BASE_URL || '';
	const pbUrl = process.env.PB_TEST_URL || '';
	if (!base || !pbUrl) {
		throw new Error(
			'LAYOUT_BASE_URL / PB_TEST_URL are not set — run the layout test with `npm run test:layout`.'
		);
	}
	// It writes tickets, houses and admins: never against a real site.
	for (const url of [base, pbUrl]) {
		if (!/^(localhost|127\.0\.0\.1|\[::1\]|[\w-]+\.localhost)$/.test(new URL(url).hostname)) {
			throw new Error(
				`The layout test writes test data; it only runs against a local stack, not ${url}.`
			);
		}
	}
	const pb = await superuser(pbUrl, process.env.PB_ADMIN_EMAIL!, process.env.PB_ADMIN_PASSWORD!);
	const camp = await seedStressCamp(base, pb);
	fs.writeFileSync(CAMP_FILE, JSON.stringify(camp));
});
