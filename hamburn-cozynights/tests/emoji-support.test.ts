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

/**
 * Code points that came with Unicode 13.0 or later (Age ≥ 13 in the Unicode
 * Character Database), in the emoji planes. Generated with Perl's
 * Unicode::UCD on 2026-10-11, Unicode 16 assignments.
 */
const TOO_NEW: [number, number][] = [
	[0x1f10d, 0x1f10f],
	[0x1f16d, 0x1f16f],
	[0x1f1ad, 0x1f1ad],
	[0x1f6d6, 0x1f6d7],
	[0x1f6dc, 0x1f6df],
	[0x1f6fb, 0x1f6fc],
	[0x1f774, 0x1f776],
	[0x1f77b, 0x1f77f],
	[0x1f7d9, 0x1f7d9],
	[0x1f7f0, 0x1f7f0],
	[0x1f8b0, 0x1f8bb],
	[0x1f8c0, 0x1f8c1],
	[0x1f90c, 0x1f90c],
	[0x1f972, 0x1f972],
	[0x1f977, 0x1f979],
	[0x1f9a3, 0x1f9a4],
	[0x1f9ab, 0x1f9ad],
	[0x1f9cb, 0x1f9cc],
	[0x1fa74, 0x1fa77],
	[0x1fa7b, 0x1fa7c],
	[0x1fa83, 0x1fa89],
	[0x1fa8f, 0x1fa8f],
	[0x1fa96, 0x1fac6],
	[0x1face, 0x1fadc],
	[0x1fadf, 0x1fae9],
	[0x1faf0, 0x1faf8]
];

const tooNew = (codePoint: number) =>
	TOO_NEW.some(([from, to]) => codePoint >= from && codePoint <= to);

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
