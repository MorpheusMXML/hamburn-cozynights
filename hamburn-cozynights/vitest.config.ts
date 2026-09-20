// vitest.config.ts
import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
	test: {
		globals: true,
		environment: 'node',
		// tests/e2e/** and tests/layout/** use the Playwright test API
		// (npm run test:e2e / test:layout), not Vitest's — without this exclude,
		// Vitest's default glob picks them up too and fails on the API mismatch.
		// tests/integration/** and tests/smoke/** need running services and have
		// their own config (vitest.stack.config.ts, npm run test:integration/smoke).
		exclude: [
			'**/node_modules/**',
			'tests/e2e/**',
			'tests/layout/**',
			'tests/integration/**',
			'tests/smoke/**'
		]
	},
	resolve: {
		alias: {
			$lib: path.resolve(__dirname, './src/lib'),
			$env: path.resolve(__dirname, './src/env-mock'), // We'll create a mock for $env
			'$app/environment': path.resolve(__dirname, './src/env-mock/app/environment.ts')
		}
	}
});
