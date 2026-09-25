// playwright.layout.config.ts — the layout test (tests/layout): every page with
// awkward names at every width from a small phone to a desktop.
// Runs against the throwaway stack: `npm run test:layout` (scripts/test-stack.sh
// layout) builds the app image, starts it with an empty PocketBase and passes
// LAYOUT_BASE_URL + the PocketBase details in the environment.
import { defineConfig, devices } from '@playwright/test';

const BASE = process.env.LAYOUT_BASE_URL || process.env.SMOKE_BASE_URL || '';

export default defineConfig({
	testDir: './tests/layout',
	// One camp in one database, one test at a time: the tests switch the booking
	// phase. Every test sets the state it needs itself (phase, check-in), so the
	// order doesn't matter and CI can split the run into shards
	// (--shard=1/4, each shard on its own stack); fullyParallel lets a shard take
	// part of the one test file.
	fullyParallel: true,
	workers: 1,
	forbidOnly: !!process.env.CI,
	reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
	outputDir: 'test-results/layout',
	timeout: 120_000,
	use: {
		baseURL: BASE,
		// Fixed animations and a known font rendering; text size stays the default.
		reducedMotion: 'reduce',
		trace: 'retain-on-failure'
	},
	projects: [
		// Builds the stress camp once (tests/layout/seed.setup.ts), in every shard.
		{ name: 'seed', testMatch: /seed\.setup\.ts/ },
		{ name: 'chromium', use: { ...devices['Desktop Chrome'] }, dependencies: ['seed'] },
		// Safari's engine (every browser on iOS) breaks lines slightly differently.
		{
			name: 'webkit',
			use: {
				...devices['Desktop Safari'],
				// Linux WebKit paints through a software GPU (Mesa llvmpipe) by default,
				// several times slower than its own CPU painter. Only the painting
				// changes: styles, fonts and layout are the same. No effect on macOS.
				launchOptions: {
					env: { ...process.env, WEBKIT_SKIA_ENABLE_CPU_RENDERING: '1' }
				}
			},
			dependencies: ['seed']
		}
	]
});
