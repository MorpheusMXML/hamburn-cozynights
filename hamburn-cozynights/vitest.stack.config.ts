// vitest.stack.config.ts — tests that talk to real services:
//   tests/integration  a real (empty, throwaway) PocketBase
//   tests/smoke        a running app over HTTP (local test stack or a deployment)
// Started through scripts/test-stack.sh, which provides the services and the
// connection details in the environment. Unit tests: see vitest.config.ts.
import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
	test: {
		globals: true,
		environment: 'node',
		include: ['tests/integration/**/*.test.ts', 'tests/smoke/**/*.test.ts'],
		// Name every test in the output (CI and deploy logs should show what was
		// checked); the default reporter only lists slow ones.
		reporters: ['verbose'],
		// One shared database / app: run the files one after another.
		fileParallelism: false,
		testTimeout: 20_000,
		hookTimeout: 30_000
	},
	resolve: {
		alias: {
			$lib: path.resolve(__dirname, './src/lib'),
			$env: path.resolve(__dirname, './src/env-mock'),
			'$app/environment': path.resolve(__dirname, './src/env-mock/app/environment.ts')
		}
	}
});
