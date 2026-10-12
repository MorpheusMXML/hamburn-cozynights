// tests/emoji-support.test.ts — no emoji that older phones draw as an empty square
//
// An emoji from Unicode 13 (2020) or later needs iOS 14.2, Android 11 or
// Windows 11. Older devices show a box instead: the 🛖 hut on the hut-group
// pins did that on several guests' phones (2026-10-11). Up to Unicode 12
// (2019) every device at the camp draws them, so the app sticks to those.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = fileURLToPath(new URL('../', import.meta.url));
/** Everything a guest or an admin sees: the pages and the mails/Telegram texts. */
const FOLDERS = ['src', 'pb_hooks'];
const EXTENSIONS = /\.(svelte|ts|js|json|html|css)$/;

/** The emoji planes: everything from U+1F000 up to the end of U+1FBFF. */
const PLANE = [0x1f000, 0x1fbff];

/**
 * What Unicode 12.1 (2019) had assigned in those planes (Age ≤ 12.1 in the
 * Unicode Character Database), the only code points allowed there. Anything
 * else is refused, unassigned ones included, so the emoji every new Unicode
 * version brings fail without this list changing. Generated with Perl's
 * Unicode::UCD (Age property) on 2026-10-12.
 */
const ALLOWED: [number, number][] = [
	[0x1f000, 0x1f02b],
	[0x1f030, 0x1f093],
	[0x1f0a0, 0x1f0ae],
	[0x1f0b1, 0x1f0bf],
	[0x1f0c1, 0x1f0cf],
	[0x1f0d1, 0x1f0f5],
	[0x1f100, 0x1f10c],
	[0x1f110, 0x1f16c],
	[0x1f170, 0x1f1ac],
	[0x1f1e6, 0x1f202],
	[0x1f210, 0x1f23b],
	[0x1f240, 0x1f248],
	[0x1f250, 0x1f251],
	[0x1f260, 0x1f265],
	[0x1f300, 0x1f6d5],
	[0x1f6e0, 0x1f6ec],
	[0x1f6f0, 0x1f6fa],
	[0x1f700, 0x1f773],
	[0x1f780, 0x1f7d8],
	[0x1f7e0, 0x1f7eb],
	[0x1f800, 0x1f80b],
	[0x1f810, 0x1f847],
	[0x1f850, 0x1f859],
	[0x1f860, 0x1f887],
	[0x1f890, 0x1f8ad],
	[0x1f900, 0x1f90b],
	[0x1f90d, 0x1f971],
	[0x1f973, 0x1f976],
	[0x1f97a, 0x1f9a2],
	[0x1f9a5, 0x1f9aa],
	[0x1f9ae, 0x1f9ca],
	[0x1f9cd, 0x1fa53],
	[0x1fa60, 0x1fa6d],
	[0x1fa70, 0x1fa73],
	[0x1fa78, 0x1fa7a],
	[0x1fa80, 0x1fa82],
	[0x1fa90, 0x1fa95]
];

const tooNew = (codePoint: number) =>
	codePoint >= PLANE[0] &&
	codePoint <= PLANE[1] &&
	!ALLOWED.some(([from, to]) => codePoint >= from && codePoint <= to);

function files(folder: string): string[] {
	const root = path.join(APP, folder);
	return readdirSync(root, { recursive: true, encoding: 'utf8' })
		.filter((file) => EXTENSIONS.test(file) && !file.includes('node_modules'))
		.map((file) => path.join(root, file));
}

describe('emoji every device can draw', () => {
	it('knows a too-new emoji when it sees one', () => {
		expect(tooNew('🛖'.codePointAt(0)!)).toBe(true);
		expect(tooNew('🪜'.codePointAt(0)!)).toBe(true);
		expect(tooNew('🏘️'.codePointAt(0)!)).toBe(false);
		expect(tooNew('🔝'.codePointAt(0)!)).toBe(false);
		expect(tooNew('🧺'.codePointAt(0)!)).toBe(false);
		expect(tooNew('🩺'.codePointAt(0)!)).toBe(false);
		// Unicode 17 (2025) and code points nobody has assigned yet
		expect(tooNew(0x1f6d8)).toBe(true);
		expect(tooNew(0x1fa8e)).toBe(true);
		expect(tooNew(0x1fbff)).toBe(true);
		// outside the emoji planes: ♿ and the like are old enough
		expect(tooNew('♿'.codePointAt(0)!)).toBe(false);
	});

	it('uses none from Unicode 13 or later in the app, its mails or its Telegram texts', () => {
		const found: string[] = [];
		for (const file of FOLDERS.flatMap(files)) {
			readFileSync(file, 'utf8')
				.split('\n')
				.forEach((line, index) => {
					for (const char of line) {
						if (tooNew(char.codePointAt(0)!)) {
							found.push(`${path.relative(APP, file)}:${index + 1} ${char}`);
						}
					}
				});
		}
		expect(found).toEqual([]);
	});
});
