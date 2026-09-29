// tests/version.test.ts — the version the app shows about itself.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
	APP_COMMIT,
	APP_VERSION,
	builtDay,
	commitUrl,
	isReleaseVersion,
	releaseTag,
	releaseUrl,
	versionTitle
} from '$lib/version';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

describe('the app version', () => {
	it('is the one in package.json, in the 0.<deploy>.<fix> shape', () => {
		expect(APP_VERSION).toBe(pkg.version);
		expect(isReleaseVersion(APP_VERSION)).toBe(true);
	});

	it('names the tag and the release page of a version', () => {
		expect(releaseTag('0.18.1')).toBe('v0.18.1');
		expect(releaseUrl('0.18.1')).toBe(
			'https://github.com/MorpheusMXML/hamburn-cozynights/releases/tag/v0.18.1'
		);
	});

	it('links the commit when the build knows it, else the release', () => {
		expect(commitUrl('abc1234', '0.18.1')).toBe(
			'https://github.com/MorpheusMXML/hamburn-cozynights/commit/abc1234'
		);
		expect(commitUrl('', '0.18.1')).toBe(releaseUrl('0.18.1'));
		// Whatever this build knows is a short hash or nothing, never garbage.
		expect(APP_COMMIT).toMatch(/^([0-9a-f]{7,40})?$/);
	});

	it('writes the tooltip from what it knows', () => {
		expect(versionTitle('0.18.1', 'abc1234', '2026-09-24T10:00:00.000Z')).toBe(
			'Version 0.18.1 · build abc1234 · 24 Sept 2026'
		);
		expect(versionTitle('0.18.1', '', 'not a date')).toBe('Version 0.18.1');
		expect(builtDay('nope')).toBe('');
	});

	it('accepts only stamped versions', () => {
		expect(isReleaseVersion('0.18.1')).toBe(true);
		expect(isReleaseVersion('0.18')).toBe(false);
		expect(isReleaseVersion('0.18.1-dev')).toBe(false);
	});
});
