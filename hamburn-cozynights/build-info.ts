// build-info.ts
/**
 * What the app knows about its own build: the version from package.json, the
 * commit it was built from and when. Both Vite configs (vite.config.ts and
 * vitest.config.ts) turn these into the globals `__APP_VERSION__`,
 * `__APP_COMMIT__` and `__APP_BUILT_AT__` (declared in src/app.d.ts) that
 * `$lib/version` reads.
 *
 * The version follows the deploy numbering: 0.<deploy number>.<fix>, so
 * "Deploy Nr. 18" is v0.18.0 and a fix on top of it v0.18.1. It is stamped
 * with scripts/release.sh, which also creates the tag the GitHub release is
 * made from (.github/workflows/release.yml).
 *
 * The commit comes from GIT_SHA (the Docker build argument the deploy passes)
 * or GITHUB_SHA (CI), else from git; an image built without either shows
 * no commit, never a wrong one.
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(path.join(here, 'package.json'), 'utf8')) as {
	version: string;
};

function commit(): string {
	const given = (process.env.GIT_SHA || process.env.GITHUB_SHA || '').trim();
	if (given) return given.slice(0, 7);
	try {
		return execSync('git rev-parse --short=7 HEAD', {
			cwd: here,
			stdio: ['ignore', 'pipe', 'ignore']
		})
			.toString()
			.trim();
	} catch {
		return '';
	}
}

export const buildInfo = {
	version: pkg.version,
	commit: commit(),
	builtAt: new Date().toISOString()
};

/** The `define` entry for Vite and Vitest. */
export const buildDefine = {
	__APP_VERSION__: JSON.stringify(buildInfo.version),
	__APP_COMMIT__: JSON.stringify(buildInfo.commit),
	__APP_BUILT_AT__: JSON.stringify(buildInfo.builtAt)
};
