// scripts/wallet-images.mjs — draws the images of the wallet passes from the
// CozyNights flame (src/lib/assets/favicon.svg), with the Chromium that
// Playwright installs for the layout tests. Run it again after changing the
// flame; the PNGs are committed.
//
//   node scripts/wallet-images.mjs
//
// Apple Wallet (bundled into every .pkpass, src/lib/server/wallet/apple.ts):
//   icon.png 38×38 (+ @2x, @3x): notifications and the lock screen
//   logo.png 50×50 (+ @2x, @3x): top left of the pass, next to "CozyNights"
// Google Wallet (fetched by Google from the app, so under static/):
//   static/wallet/google-logo.png 660×660: the round logo on the pass
import { chromium } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const favicon = fs.readFileSync(path.join(root, 'src/lib/assets/favicon.svg'), 'utf8');
const gradient = /<defs>[\s\S]*<\/defs>/.exec(favicon)[0];
const paths = [...favicon.matchAll(/<path [^>]*\/>/g)].map((m) => m[0]).join('');

// The flame alone, on a transparent background, in a square (Apple wants a
// logo at least as wide as it is tall).
const flame = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="3.3 2 25.4 25.4">${gradient}${paths}</svg>`;
// The flame on the app's black, with room around it for Google's round crop.
const badge = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-4 -3 40 40"><rect x="-4" y="-3" width="40" height="40" fill="#0a0a0a"/>${gradient}${paths}</svg>`;

const outputs = [
	...[1, 2, 3].map((scale) => ({
		file: `src/lib/server/wallet/images/icon${scale > 1 ? `@${scale}x` : ''}.png`,
		svg: favicon,
		size: [38 * scale, 38 * scale]
	})),
	...[1, 2, 3].map((scale) => ({
		file: `src/lib/server/wallet/images/logo${scale > 1 ? `@${scale}x` : ''}.png`,
		svg: flame,
		size: [50 * scale, 50 * scale]
	})),
	{ file: 'static/wallet/google-logo.png', svg: badge, size: [660, 660] }
];

const browser = await chromium.launch();
try {
	const page = await browser.newPage();
	for (const { file, svg, size } of outputs) {
		const [width, height] = size;
		await page.setViewportSize({ width, height });
		// the root element's own size (the favicon has one) makes way for this one
		const sized = svg.replace(
			/^<svg([^>]*)>/,
			(_, attrs) =>
				`<svg${attrs.replace(/\s(width|height)="[^"]*"/g, '')} width="${width}" height="${height}">`
		);
		await page.setContent(
			`<html><body style="margin:0;background:transparent">${sized}</body></html>`
		);
		const target = path.join(root, file);
		fs.mkdirSync(path.dirname(target), { recursive: true });
		await page.screenshot({
			path: target,
			omitBackground: true,
			clip: { x: 0, y: 0, width, height }
		});
		console.log(`${file} ${width}×${height}`);
	}
} finally {
	await browser.close();
}
