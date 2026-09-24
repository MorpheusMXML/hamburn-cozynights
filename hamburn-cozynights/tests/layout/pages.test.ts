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

/**
 * Floating layers that cover the page on purpose, like a dialog (the lock
 * hint) or the admin's sticky top bar, which sits over whatever scrolled
 * under it once a form field further down was brought into view.
 */
const OVERLAYS = ['[data-layout-overlay]', '.admin-topbar'];

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

/** The three phases, plus every armed timer (countdown box, countdown bar). */
const ALL_PHASES: Phase[] = ['staging', 'live', 'closed', 'opening', 'closing', 'reopening'];

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
	// The roulette's slot machine: idle while booking is live, asleep in every other phase.
	{ name: 'random spot', path: () => '/random-bed', as: 'guestWithoutSpot', phases: ALL_PHASES },
	{
		// Landed, with the name plate. The machine picks at random: spin until the
		// house reel shows the stress camp's longest house name.
		name: 'random spot: landed',
		path: () => '/random-bed',
		as: 'guestWithoutSpot',
		open: async (page) => {
			await page.getByRole('button', { name: /^Spin/ }).click();
			const house = page.locator('.reel.house .face');
			for (let i = 0; i < 40 && !/Waldhütte/.test(await house.innerText()); i++) {
				await page.getByRole('button', { name: /Spin again/ }).click();
			}
			await page.locator('#guestName').waitFor();
		}
	},
	{
		// A guest with a spot: it stands on the reels, with the booking pass below.
		name: 'random spot: my spot',
		path: () => '/random-bed',
		as: 'guestWithSpot',
		phases: ['staging', 'live', 'closed']
	},
	{
		name: 'random spot: leave no trace',
		path: () => '/random-bed',
		as: 'guestWithSpot',
		open: async (page) => {
			// "admin pass check: results" checks this guest in, and a checked-in
			// guest can't give the spot up (no button). The second engine runs
			// after the first one's pass check: undo the check-in first.
			const order = await pb
				.collection('orders')
				.getFirstListItem(pb.filter('pass_code = {:code}', { code: camp.passCode }));
			const bed = await pb
				.collection('beds')
				.getFirstListItem(pb.filter('order = {:order}', { order: order.id }));
			if (bed.checked_in_at) {
				await pb.collection('beds').update(bed.id, { checked_in_at: '', checked_in_by: '' });
				await page.reload({ waitUntil: 'networkidle' });
			}
			await page.getByRole('button', { name: /Leave No Trace/ }).click();
			await page.getByRole('alertdialog').waitFor();
		}
	},
	{ name: 'special needs: request sent', path: () => '/special-needs', as: 'guestWithRequest' },
	{ name: 'special needs: new request', path: () => '/special-needs', as: 'guestWithoutSpot' },
	// The wallet buttons and the Telegram offer under a guest's pass
	// (docs/admin/passes.md). Both wallets are set up in the test stack.
	{ name: 'updates on Telegram', path: () => '/telegram', as: 'guestWithSpot' },
	{ name: 'updates on Telegram without a spot', path: () => '/telegram', as: 'guestWithoutSpot' },
	{
		name: 'special needs: refused request',
		path: () => '/special-needs',
		as: 'guestWithoutSpot',
		open: async (page) => {
			await page.getByRole('button', { name: 'Send request' }).click();
			await page.locator('#consent-error').waitFor();
		}
	},
	// The Control Center: booking window, attention, latest bookings, Intel
	// (always open since the camp editor moved to /admin/camp). Each phase lists
	// other things under "Needs attention" and in the bookings card.
	{ name: 'admin dashboard', path: () => '/admin', as: 'admin', phases: ALL_PHASES },
	{ name: 'admin dashboard (superuser)', path: () => '/admin', as: 'superuser' },
	{
		// Narrowed to the house with the longest name, by the hour, sorted by
		// free spots, with the chart's numbers open as a table.
		name: 'admin dashboard: intel panel for one house',
		path: () => '/admin',
		as: 'admin',
		phases: ['live'],
		open: async (page) => {
			const panel = page.locator('.intel-dashboard');
			await panel.locator('.houses-pick', { hasText: TEXTS.houseLong.slice(0, 40) }).click();
			await panel.locator('.intel-reset').waitFor();
			await panel.getByRole('button', { name: '24 h' }).click();
			await panel.locator('.tile[data-state="open"]').click();
			await panel.getByRole('button', { name: 'Show the numbers as a table' }).click();
			await panel.locator('.activity-data').waitFor();
			// The clicks scrolled the page; the other cases measure from the top
			// (scrolled, the sticky admin header lies over the booking panel).
			await page.evaluate(() => window.scrollTo(0, 0));
		}
	},
	// The camp editor: the map (staging: editable, live: locked) and the list.
	{ name: 'admin camp', path: () => '/admin/camp', as: 'admin', phases: ['staging', 'live'] },
	{ name: 'admin camp: list view', path: () => '/admin/camp?view=list', as: 'admin' },
	{
		// The house with the stress bookings: who is here, next to (below) the map.
		name: 'admin camp: house sidebar with bookings',
		path: () => '/admin/camp',
		as: 'admin',
		phases: ['live', 'closed'],
		open: async (page) => {
			await page
				.locator(`g.house-group[aria-label^="House ${TEXTS.houseLong.slice(0, 40)}"]`)
				.focus();
			await page.keyboard.press('Enter');
			const sidebar = page.locator('.details-sidebar');
			await sidebar.locator('.house-bookings .booking-guest').first().waitFor();
			// The sidebar flies in (Svelte transitions ignore reduced motion):
			// measure it where it lands, not on its way.
			await sidebar.evaluate((el) =>
				Promise.all(
					el
						.getAnimations({ subtree: true })
						.filter((a) => a.effect?.getTiming().iterations !== Infinity)
						.map((a) => a.finished)
				)
			);
			await page.evaluate(() => window.scrollTo(0, 0));
		}
	},
	// Every ticket with everything attached; a ticket without a spot is grey
	// while booking runs and red once it closed.
	{
		name: 'admin guests',
		path: () => '/admin/guests',
		as: 'admin',
		phases: ['staging', 'live', 'closed']
	},
	{
		// A count tile pressed: the list narrowed to the tickets without a spot.
		name: 'admin guests: filtered',
		path: () => '/admin/guests',
		as: 'admin',
		open: async (page) => {
			await page.getByRole('button', { name: /without a spot/ }).click();
			await page.locator('.count[aria-pressed="true"]', { hasText: 'without a spot' }).waitFor();
		}
	},
	// Who booked which spot: Staging (crew holds), Live (newest first), Closed
	// (still to arrive first; with Check in buttons).
	{
		name: 'admin bookings',
		path: () => '/admin/bookings',
		as: 'admin',
		phases: ['staging', 'live', 'closed']
	},
	{
		name: 'admin bookings: one house, every booking',
		path: (c) => `/admin/bookings?house=${c.houseId}&show=all&sort=guest`,
		as: 'superuser'
	},
	{
		// The confirmation before a check-in without the pass (nothing is saved).
		name: 'admin bookings: check-in dialog',
		path: () => '/admin/bookings?show=arriving',
		as: 'admin',
		phases: ['closed'],
		open: async (page) => {
			await page.locator('.booking-row .btn-step').first().click();
			await page.getByRole('alertdialog').waitFor();
		}
	},
	{
		// The menu as a drawer (phones, tablets); from 1100 px it is the sidebar.
		name: 'admin menu: drawer',
		path: () => '/admin/tickets',
		as: 'superuser',
		open: async (page) => {
			await page.setViewportSize({ width: 390, height: 900 });
			await page.getByRole('button', { name: 'Open the menu' }).click();
			await page.locator('#admin-menu.open').waitFor();
		}
	},
	{
		// The sidebar shrunk to its icons (below 1100 px it is the drawer again).
		name: 'admin menu: icons only',
		path: () => '/admin/bookings',
		as: 'admin',
		open: async (page) => {
			await page.getByRole('button', { name: /Shrink menu/ }).click();
			await page.locator('.admin-sidebar.collapsed').waitFor();
		}
	},
	{
		// Staging says the layout can be changed; Live locks it (notice, greyed
		// controls with padlocks).
		name: 'admin house',
		path: (c) => `/admin/house/${c.houseId}`,
		as: 'admin',
		phases: ['staging', 'live']
	},
	{
		name: 'admin room',
		path: (c) => `/admin/room/${c.roomId}`,
		as: 'admin',
		phases: ['staging', 'live']
	},
	{ name: 'admin new house', path: () => '/admin/house/new', as: 'admin' },
	{
		// A typed key in a locked field answers with the lock hint next to it.
		// The field keeps the focus, so the hint stays while the width changes.
		name: 'admin new house: lock hint',
		path: () => '/admin/house/new',
		as: 'admin',
		phases: ['live'],
		open: async (page) => {
			await page.locator('#name').focus();
			await page.keyboard.press('x');
			await page.locator('.lock-hint.ready').waitFor();
		}
	},
	{
		// The house editor next to the map (below it on a phone), read-only
		// while the layout is locked; the house with the long compound name.
		name: 'admin camp: locked house editor',
		path: () => '/admin/camp',
		as: 'admin',
		phases: ['live'],
		open: async (page) => {
			await page.locator(`g.house-group[aria-label="House ${TEXTS.houseCompound}"]`).focus();
			await page.keyboard.press('Enter');
			const sidebar = page.locator('.details-sidebar');
			await sidebar.locator('.locked-badge').waitFor();
			// The sidebar flies in (Svelte transitions ignore reduced motion):
			// measure it where it lands, not on its way.
			await sidebar.evaluate((el) =>
				Promise.all(
					el
						.getAnimations({ subtree: true })
						.filter((a) => a.effect?.getTiming().iterations !== Infinity)
						.map((a) => a.finished)
				)
			);
			// Opening it scrolled the page; the other cases measure from the top.
			await page.evaluate(() => window.scrollTo(0, 0));
		}
	},
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
			// A hut group's form says HUT (src/lib/accommodation.ts, roomWord).
			await page.getByRole('button', { name: /IGNITE (ROOM|HUT|TENT|PLACE)/ }).click();
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
		path: () => '/admin/templates',
		as: 'superuser',
		phases: ['staging'],
		open: async (page) => {
			await page.locator('.import-card input[type="file"]').setInputFiles({
				name: 'kuschelzeltplatz-layout-2026.json',
				mimeType: 'application/json',
				buffer: Buffer.from(stressLayoutFile(camp))
			});
			await page.getByRole('button', { name: /Expand all/ }).click();
			await page.getByRole('list', { name: 'Houses, rooms and spots' }).waitFor();
			// The review scrolled into view; the other cases measure from the top
			// (scrolled, the sticky admin bar lies over the page on purpose).
			await page.evaluate(() => window.scrollTo(0, 0));
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
			? []
			: who === 'admin' || who === 'superuser'
				? [{ name: 'pb_auth', value: who === 'admin' ? camp.adminAuth : camp.superuserAuth }]
				: [
						{ name: 'bookingCode', value: camp[who] },
						// the round the code was signed in for: without it, a reset in an
						// earlier suite on this stack would count the session as over
						{ name: 'bookingRound', value: camp.guestRound }
					];
	await context.addCookies(session.map((cookie) => ({ ...cookie, url: BASE })));
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
			canvas: CANVAS,
			overlays: OVERLAYS
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
					overlays: OVERLAYS,
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
