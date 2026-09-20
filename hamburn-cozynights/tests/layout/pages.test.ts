// tests/layout/pages.test.ts — no page may squeeze, cut off or push out text.
//
// Every guest and admin page is opened with the stress camp (tests/layout/
// stress-data.ts) and resized from a small phone to a desktop; at each width
// tests/layout/layout-check.ts measures the rendered text. A failure lists
// what broke at which widths and attaches a screenshot with the spots outlined.
import { test, expect, type Browser, type Page } from '@playwright/test';
import fs from 'fs';
import type PocketBase from 'pocketbase';
import { findLayoutProblems, type LayoutProblem } from './layout-check';
import {
	CAMP_FILE,
	TEXTS,
	setPhase,
	stressLayoutFile,
	stressTicketList,
	superuser,
	type Phase,
	type StressCamp
} from './stress-data';

const BASE = process.env.LAYOUT_BASE_URL || process.env.SMOKE_BASE_URL || '';
const PB_URL = process.env.PB_TEST_URL || '';

/** 320 px (small phone) to 1440 px (laptop), every LAYOUT_STEP px (default 40). */
const STEP = Number(process.env.LAYOUT_STEP || 40);
const WIDTHS = Array.from(
	{ length: Math.floor((1440 - 320) / STEP) + 1 },
	(_, i) => 320 + i * STEP
);

/** Words up to this long must never be split: "Upper", "Available", "Reserved". */
const MAX_WORD_LENGTH = 16;

/** Moving or decorative text whose clipping is the effect itself. */
const IGNORE = ['[data-layout-ignore]'];

/** The camp map lies under the floating header and buttons on purpose. */
const CANVAS = ['.map-wrapper'];

const MARK = 'data-layout-problem';

type Who =
	'anonymous' | 'guestWithSpot' | 'guestWithoutSpot' | 'guestWithRequest' | 'admin' | 'superuser';

interface PageCase {
	name: string;
	path: (camp: StressCamp) => string;
	as: Who;
	phases?: Phase[];
	/** Optional step after loading, e.g. open a dialog; its result is checked too. */
	open?: (page: Page) => Promise<void>;
}

/** The three phases, plus both armed timers (countdown box, countdown bar). */
const ALL_PHASES: Phase[] = ['staging', 'live', 'closed', 'opening', 'closing'];

const PAGES: PageCase[] = [
	{ name: 'start page', path: () => '/', as: 'anonymous', phases: ALL_PHASES },
	{ name: 'booking rules', path: () => '/booking-rules', as: 'anonymous', phases: ['closing'] },
	{ name: 'privacy', path: () => '/privacy', as: 'anonymous' },
	{ name: 'legal notice', path: () => '/legal-notice', as: 'anonymous' },
	{ name: 'admin login', path: () => '/admin/login', as: 'anonymous' },
	{ name: 'booking pass', path: (c) => `/pass/${c.passCode}`, as: 'anonymous' },
	{ name: 'map', path: () => '/map', as: 'guestWithSpot', phases: ALL_PHASES },
	{
		name: 'map: looking around after booking closed',
		path: () => '/map',
		as: 'guestWithSpot',
		phases: ['closed'],
		open: async (page) => {
			await page.getByRole('button', { name: /LOOK AROUND/ }).click();
			await page.locator('.phase-overlay').waitFor({ state: 'detached' });
		}
	},
	{
		name: 'house without my spot',
		path: (c) => `/house/${c.otherHouseIds[0]}`,
		as: 'guestWithSpot',
		phases: ALL_PHASES
	},
	{
		name: 'room without my spot',
		path: (c) => `/room/${c.otherRoomIds[0]}`,
		as: 'guestWithSpot',
		phases: ALL_PHASES
	},
	{ name: 'house', path: (c) => `/house/${c.houseId}`, as: 'guestWithSpot', phases: ALL_PHASES },
	{
		name: 'room with my spot',
		path: (c) => `/room/${c.roomId}`,
		as: 'guestWithSpot',
		phases: ALL_PHASES
	},
	{
		name: 'room without a spot',
		path: (c) => `/room/${c.roomId}`,
		as: 'guestWithoutSpot',
		phases: ALL_PHASES
	},
	{
		name: 'room: booking dialog',
		path: (c) => `/room/${c.roomId}`,
		as: 'guestWithoutSpot',
		open: async (page) => {
			await page.locator('button.bed-card.free').first().click();
			await page.getByRole('dialog').waitFor();
		}
	},
	{
		// The same dialog before booking opens: only the burner name can change
		// there, so it has one button less than during Live Booking.
		name: 'room: rename dialog before booking opens',
		path: (c) => `/room/${c.roomId}`,
		as: 'guestWithSpot',
		phases: ['staging'],
		open: async (page) => {
			await page.locator('button.bed-card.mine').click();
			await page.getByRole('dialog').waitFor();
		}
	},
	{
		name: 'start page: refused ticket code',
		path: () => '/',
		as: 'anonymous',
		open: async (page) => {
			await page.locator('#ticket-code').fill('no such code!');
			await page.locator('#ticket-code').press('Enter');
			await page.locator('#ticket-code-error').waitFor();
		}
	},
	{ name: 'random spot', path: () => '/random-bed', as: 'guestWithoutSpot' },
	{ name: 'special needs: request sent', path: () => '/special-needs', as: 'guestWithRequest' },
	{ name: 'special needs: new request', path: () => '/special-needs', as: 'guestWithoutSpot' },
	{
		name: 'special needs: refused request',
		path: () => '/special-needs',
		as: 'guestWithoutSpot',
		open: async (page) => {
			await page.getByRole('button', { name: 'Send request' }).click();
			await page.locator('#consent-error').waitFor();
		}
	},
	{ name: 'admin dashboard', path: () => '/admin', as: 'admin', phases: ALL_PHASES },
	{ name: 'admin dashboard (superuser)', path: () => '/admin', as: 'superuser' },
	{
		// The panel starts closed, so the dashboard case above never measured it.
		name: 'admin dashboard: intel panel',
		path: () => '/admin',
		as: 'admin',
		phases: ['staging', 'live'],
		open: async (page) => {
			await page.getByRole('button', { name: /SHOW INTEL/ }).click();
			await page.locator('.intel-dashboard .tiles').waitFor();
		}
	},
	{ name: 'admin house', path: (c) => `/admin/house/${c.houseId}`, as: 'admin' },
	{ name: 'admin room', path: (c) => `/admin/room/${c.roomId}`, as: 'admin' },
	{ name: 'admin new house', path: () => '/admin/house/new', as: 'admin' },
	{
		name: 'admin new house: refused',
		path: () => '/admin/house/new',
		as: 'admin',
		// Staging: Live and Closed lock the layout, and these forms with it.
		phases: ['staging'],
		open: async (page) => {
			await page.locator('#bedCount').fill('999');
			await page.getByRole('button', { name: 'Save House' }).click();
			await page.locator('#bedcount-error').waitFor();
		}
	},
	{
		name: 'admin house: refused room',
		path: (c) => `/admin/house/${c.houseId}`,
		as: 'admin',
		// Staging: Live and Closed lock the layout, and these forms with it.
		phases: ['staging'],
		open: async (page) => {
			await page.locator('#room-number').fill('x');
			await page.getByRole('button', { name: /IGNITE ROOM/ }).click();
			await page.locator('#room-number-error').waitFor();
		}
	},
	{ name: 'admin tickets', path: () => '/admin/tickets', as: 'superuser' },
	{
		name: 'admin tickets: search result',
		path: () => '/admin/tickets',
		as: 'admin',
		open: async (page) => {
			await page.locator('#ticket-query').fill(TEXTS.emailLong);
			await page.locator('#ticket-query').press('Enter');
			await page.locator('.results .result-meta').waitFor();
		}
	},
	{
		name: 'admin tickets: ticket list review',
		path: () => '/admin/tickets',
		as: 'superuser',
		open: async (page) => {
			await page.locator('input[type="file"]').setInputFiles({
				name: 'pretix-export-with-a-rather-long-file-name-2026-09-19.csv',
				mimeType: 'text/csv',
				buffer: Buffer.from(stressTicketList(camp))
			});
			await page.locator('.review').waitFor();
		}
	},
	{
		name: 'admin layout templates: review',
		path: () => '/admin',
		as: 'superuser',
		phases: ['staging'],
		open: async (page) => {
			await page.getByRole('button', { name: /TEMPLATES/ }).click();
			await page.locator('.import-card input[type="file"]').setInputFiles({
				name: 'kuschelzeltplatz-layout-2026.json',
				mimeType: 'application/json',
				buffer: Buffer.from(stressLayoutFile(camp))
			});
			await page.getByRole('button', { name: /Expand all/ }).click();
			await page.getByRole('list', { name: 'Houses, rooms and spots' }).waitFor();
		}
	},
	{ name: 'admin special-needs requests', path: () => '/admin/requests', as: 'admin' },
	{
		name: 'admin special-needs: confirm dialog',
		path: () => '/admin/requests',
		as: 'admin',
		open: async (page) => {
			const request = page.locator('article.request.status-pending').first();
			await request.locator('select').selectOption({ index: 1 });
			await request.locator('form.assign button.primary').click();
			await page.getByRole('alertdialog').waitFor();
		}
	},
	{ name: 'admin message texts', path: () => '/admin/messages', as: 'admin' },
	{ name: 'admin pass check', path: () => '/admin/check', as: 'admin' },
	{
		name: 'admin pass check: results',
		path: () => '/admin/check',
		as: 'admin',
		open: async (page) => {
			for (const code of [camp.passCode, 'AAAA-BBBB-CCCC']) {
				await page.locator('#pass-code').fill(code);
				await page.locator('#pass-code').press('Enter');
				await page.getByText(code.replace(/-/g, '').slice(0, 4)).first().waitFor();
			}
		}
	},
	{ name: 'booking pass (crew view)', path: (c) => `/pass/${c.passCode}`, as: 'admin' }
];

let pb: PocketBase;
let camp: StressCamp;

test.beforeAll(async () => {
	camp = JSON.parse(fs.readFileSync(CAMP_FILE, 'utf8'));
	pb = await superuser(PB_URL, process.env.PB_ADMIN_EMAIL!, process.env.PB_ADMIN_PASSWORD!);
});

/** A browser signed in the way `who` is: guests by ticket code, admins by session. */
async function openAs(browser: Browser, who: Who) {
	const context = await browser.newContext({ baseURL: BASE, reducedMotion: 'reduce' });
	const session =
		who === 'anonymous'
			? null
			: who === 'admin' || who === 'superuser'
				? { name: 'pb_auth', value: who === 'admin' ? camp.adminAuth : camp.superuserAuth }
				: { name: 'bookingCode', value: camp[who] };
	if (session) await context.addCookies([{ ...session, url: BASE }]);
	return context;
}

interface Finding extends LayoutProblem {
	widths: number[];
}

/** Resizes through all widths and collects what breaks where. */
async function sweep(page: Page): Promise<Finding[]> {
	const findings = new Map<string, Finding>();
	for (const width of WIDTHS) {
		await page.setViewportSize({ width, height: 900 });
		// Two frames: resize observers and media queries have settled.
		await page.evaluate(
			() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)))
		);
		const problems = await page.evaluate(findLayoutProblems, {
			maxWordLength: MAX_WORD_LENGTH,
			ignore: IGNORE,
			canvas: CANVAS
		});
		for (const problem of problems) {
			const key = `${problem.kind}|${problem.where}|${problem.text}`;
			const known = findings.get(key);
			if (known) known.widths.push(width);
			else findings.set(key, { ...problem, widths: [width] });
		}
	}
	return [...findings.values()];
}

/** "320–400, 1000–1440" from a sorted list of swept widths. */
function ranges(widths: number[]): string {
	const out: string[] = [];
	let start = widths[0];
	let prev = widths[0];
	for (const width of [...widths.slice(1), Infinity]) {
		if (width !== prev + STEP) {
			out.push(start === prev ? `${start}` : `${start}–${prev}`);
			start = width;
		}
		prev = width;
	}
	return out.join(', ') + ' px';
}

function report(findings: Finding[]): string {
	return findings
		.map((f) => `${f.kind}: "${f.text}" in ${f.where}\n    at ${ranges(f.widths)} — ${f.detail}`)
		.join('\n');
}

for (const pageCase of PAGES) {
	for (const phase of pageCase.phases ?? ['live']) {
		const title = pageCase.phases ? `${pageCase.name} (${phase})` : pageCase.name;
		test(title, async ({ browser }, testInfo) => {
			await setPhase(pb, phase);
			const context = await openAs(browser, pageCase.as);
			const page = await context.newPage();
			await page.setViewportSize({ width: 1280, height: 900 });
			const response = await page.goto(pageCase.path(camp), { waitUntil: 'networkidle' });
			expect(response?.status(), 'the page loads').toBeLessThan(400);
			await pageCase.open?.(page);
			await page.evaluate(() => document.fonts.ready);

			const findings = await sweep(page);
			if (findings.length > 0) {
				// Screenshot at the first width that fails, problems outlined.
				const width = Math.min(...findings.flatMap((f) => f.widths));
				await page.setViewportSize({ width, height: 900 });
				await page.evaluate(findLayoutProblems, {
					maxWordLength: MAX_WORD_LENGTH,
					ignore: IGNORE,
					canvas: CANVAS,
					markAttribute: MARK
				});
				await page.addStyleTag({
					content: `[${MARK}] { outline: 3px solid #ff00ff !important; outline-offset: 1px; }`
				});
				await testInfo.attach(`layout-${width}px`, {
					body: await page.screenshot({ fullPage: true }),
					contentType: 'image/png'
				});
			}
			await context.close();
			expect(report(findings), 'text squeezed, cut off or pushed out').toBe('');
		});
	}
}
