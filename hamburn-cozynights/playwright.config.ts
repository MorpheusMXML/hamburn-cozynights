import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
	testDir: './tests/e2e',
	// The tests share one PocketBase and switch the booking phase: one at a time.
	fullyParallel: false,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 2 : 0,
	workers: 1,
	reporter: 'html',
	use: {
		baseURL: 'http://localhost:5173',
		trace: 'on-first-retry'
	},
	projects: [
		{
			name: 'chromium',
			use: { ...devices['Desktop Chrome'] }
		},
		// Safari and every browser on iOS: the engine most guests' phones use.
		// (`npx playwright install webkit` once.)
		{
			name: 'webkit-iphone',
			use: { ...devices['iPhone 14'] },
			testMatch: /map\.test\.ts/
		}
	],
	webServer: {
		command: 'npm run dev',
		url: 'http://localhost:5173',
		reuseExistingServer: !process.env.CI
	}
});
