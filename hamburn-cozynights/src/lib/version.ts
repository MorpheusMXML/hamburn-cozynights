// src/lib/version.ts
/**
 * The version the running app was built as, for the badge next to the title,
 * the footer, the admin menu and /api/health. The values are baked in at
 * build time (build-info.ts); nothing here asks the server.
 *
 * 0.<deploy number>.<fix>: "Deploy Nr. 18" is v0.18.0, a fix on top of it
 * v0.18.1. Every deployed version has a tag `v<version>` and a GitHub release
 * with the notes since the previous tag (docs/develop/deployment.md,
 * "Versions and releases").
 */
export const APP_VERSION: string = __APP_VERSION__;
/** Short commit hash the build was made from; empty when the build did not know it. */
export const APP_COMMIT: string = __APP_COMMIT__;
/** ISO timestamp of the build. */
export const APP_BUILT_AT: string = __APP_BUILT_AT__;

export const REPO_URL = 'https://github.com/MorpheusMXML/hamburn-cozynights';

/** The git tag of a version: `v0.18.1`. */
export function releaseTag(version: string = APP_VERSION): string {
	return `v${version}`;
}

/** The GitHub release page of a version. */
export function releaseUrl(version: string = APP_VERSION): string {
	return `${REPO_URL}/releases/tag/${releaseTag(version)}`;
}

/** The commit on GitHub, or the release page when the commit is unknown. */
export function commitUrl(commit: string = APP_COMMIT, version: string = APP_VERSION): string {
	return commit ? `${REPO_URL}/commit/${commit}` : releaseUrl(version);
}

/**
 * The words behind the badge (its tooltip and screen-reader name):
 * "Version 0.18.1 · build a1b2c3d · 24 Sep 2026".
 */
export function versionTitle(
	version: string = APP_VERSION,
	commit: string = APP_COMMIT,
	builtAt: string = APP_BUILT_AT
): string {
	const parts = [`Version ${version}`];
	if (commit) parts.push(`build ${commit}`);
	const day = builtDay(builtAt);
	if (day) parts.push(day);
	return parts.join(' · ');
}

/** "24 Sep 2026" from an ISO timestamp; empty when it cannot be read. */
export function builtDay(builtAt: string = APP_BUILT_AT): string {
	const time = Date.parse(builtAt);
	if (Number.isNaN(time)) return '';
	return new Date(time).toLocaleDateString('en-GB', {
		day: 'numeric',
		month: 'short',
		year: 'numeric',
		timeZone: 'UTC'
	});
}

/** True for the 0.<deploy>.<fix> shape the release script stamps. */
export function isReleaseVersion(version: string): boolean {
	return /^\d+\.\d+\.\d+$/.test(version);
}
