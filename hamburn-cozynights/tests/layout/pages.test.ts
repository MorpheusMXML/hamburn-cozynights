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
	MY_SPOT_LABEL,
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
	| 'anonymous'
	| 'guestWithSpot'
	| 'guestWithoutSpot'
	| 'guestWithRequest'
	| 'guestInGroup'
	| 'admin'
	| 'superuser';

interface PageCase {
	name: string;
	path: (camp: StressCamp) => string;
	as: Who;
	phases?: Phase[];
	/** Optional step after loading, e.g. open a dialog; its result is checked too. */
	open?: (page: Page) => Promise<void>;
	/**
	 * The stress guest's spot is checked in (the crew scanned the pass). Set
	 * before every case, so no case depends on what an earlier one did.
	 */
	checkedIn?: boolean;
	/** What a checked-in case must show, so it proves its state (default: the guest's note). */
	checkedInText?: RegExp;
	/** The crew renamed the stress guest's spot to this; every other case gets MY_SPOT_LABEL back. */
	spotLabel?: string;
}

/** The three phases, plus every armed timer (countdown box, countdown bar). */
const ALL_PHASES: Phase[] = ['staging', 'live', 'closed', 'opening', 'closing', 'reopening'];

/** Opens every folded form of an admin house or room page (FoldToggle). */
async function unfoldAll(page: Page) {
	const folded = page.locator('button.fold-toggle[aria-expanded="false"]');
	while ((await folded.count()) > 0) await folded.first().click();
	// The bodies slide open: measure them where they land.
	await page.evaluate(() =>
		Promise.all(
			document
				.getAnimations()
				.filter((a) => a.effect?.getTiming().iterations !== Infinity)
				.map((a) => a.finished.catch(() => undefined))
		)
	);
}

/** Each cover and the one piece of the bed it goes on (src/lib/booking-check.ts). */
const COVER_ON = [
	['Bed sheet', 'Mattress'],
	['Duvet cover', 'Blanket'],
	['Pillowcase', 'Pillow']
] as const;

/**
 * The check before a new spot: every cover onto its own piece, by tapping
 * the cover and then its place on the bed. The cases run with reduced motion,
 * so a cover lands at once.
 */
async function makeTheBed(page: Page) {
	for (const [cover, piece] of COVER_ON) {
		await page.getByRole('button', { name: cover, exact: true }).click();
		await page.getByRole('button', { name: piece, exact: true }).click();
	}
	await page.getByRole('button', { name: /I'll pack them/ }).waitFor();
}

/** Lets one-shot animations end, so the sweep measures boxes where they land. */
async function settle(page: Page) {
	await page.evaluate(() =>
		Promise.all(
			document
				.getAnimations()
				.filter((a) => a.effect?.getTiming().iterations !== Infinity)
				.map((a) => a.finished.catch(() => undefined))
		)
	);
}

/**
 * The roulette landed on a spot with a name on the plate: "Book it" opens the
 * check. Its card scales in (220 ms): measured mid-way, an SVG label inside
 * looked 3 px off its own box.
 */
/**
 * The group guest opens the booking window of a free spot in the page's room
 * (it holds the spot, $lib/server/spot-holds); the page then shows it as
 * being booked. A ticket gets ten minutes per spot, and the suite runs longer
 * than that: a spot this ticket can't hold again just tries the next one.
 */
async function holdASpot(page: Page) {
	if (await page.locator('.bed-card.held').count()) return;
	const roomPath = new URL(page.url()).pathname;
	const spots = await page
		.locator('.bed-card.free')
		.evaluateAll((cards) => cards.map((card) => card.getAttribute('data-bed-id') ?? ''));
	for (const bedId of spots) {
		const res = await fetch(`${BASE}${roomPath}?/holdSpot`, {
			method: 'POST',
			headers: {
				accept: 'application/json',
				'x-sveltekit-action': 'true',
				'content-type': 'application/x-www-form-urlencoded',
				origin: BASE,
				cookie: `bookingCode=${camp.guestInGroup}; bookingRound=${camp.guestRound}`
			},
			body: new URLSearchParams({ bedId }).toString()
		});
		if (!res.ok) throw new Error(`holding a spot → ${res.status}: ${await res.text()}`);
		await page.reload({ waitUntil: 'networkidle' });
		if (await page.locator('.bed-card.held').count()) return;
	}
	throw new Error('No spot of the room could be held for the group guest.');
}

async function openRouletteCheck(page: Page) {
	await page.getByRole('button', { name: /^Spin/ }).click();
	await page.locator('#guestName').fill('Layout Owl');
	await page.getByRole('button', { name: /Book it/ }).click();
	await page.locator('.check-card').waitFor();
	await settle(page);
}

/**
 * The stress room in the open spot picker: the only room of the stress house,
 * where five other guests sleep and the crew locked Upper 1.
 */
function stressRoom(page: Page) {
	return page
		.locator(`.picker-sheet section.house[aria-label^="${TEXTS.houseLong.slice(0, 40)}"]`)
		.locator('article.room')
		.first();
}

const PAGES: PageCase[] = [
	{ name: 'start page', path: () => '/', as: 'anonymous', phases: ALL_PHASES },
	{ name: 'booking rules', path: () => '/booking-rules', as: 'anonymous', phases: ['closing'] },
	{ name: 'privacy', path: () => '/privacy', as: 'anonymous' },
	{ name: 'legal notice', path: () => '/legal-notice', as: 'anonymous' },
	{ name: 'admin login', path: () => '/admin/login', as: 'anonymous' },
	{ name: 'booking pass', path: (c) => `/pass/${c.passCode}`, as: 'anonymous' },
	{ name: 'map', path: () => '/map', as: 'guestWithSpot', phases: ALL_PHASES },
	{
		name: 'map: looking around',
		path: () => '/map',
		as: 'guestWithSpot',
		phases: ['staging', 'opening', 'closed', 'reopening'],
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
		// Another guest is booking a spot right now: its card makes its bed
		// ("Bed being made", $lib/spot-hold) until it is booked or free again.
		// In another house's room: the booking dialog cases need the free spots
		// of the stress room for the guest without a spot.
		name: 'room: a spot being booked',
		path: (c) => `/room/${c.otherRoomIds[c.otherRoomIds.length - 1]}`,
		as: 'guestWithSpot',
		open: holdASpot
	},
	{
		// A new spot starts with the check: make the bed (step 1).
		name: 'room: booking dialog',
		path: (c) => `/room/${c.roomId}`,
		as: 'guestWithoutSpot',
		open: async (page) => {
			await page.locator('button.bed-card.free').first().click();
			await page.getByRole('dialog').waitFor();
		}
	},
	{
		// A cover in hand on the wrong piece: the bed says where it goes.
		name: 'room: booking dialog, wrong piece',
		path: (c) => `/room/${c.roomId}`,
		as: 'guestWithoutSpot',
		open: async (page) => {
			await page.locator('button.bed-card.free').first().click();
			await page.getByRole('dialog').waitFor();
			await page.getByRole('button', { name: 'Pillowcase', exact: true }).click();
			await page.getByRole('button', { name: 'Blanket', exact: true }).click();
			await page.locator('.make-bed .status', { hasText: "That's the blanket!" }).waitFor();
		}
	},
	{
		// The bed is made: the card asks to pack the three covers for real.
		name: 'room: booking dialog, bed made',
		path: (c) => `/room/${c.roomId}`,
		as: 'guestWithoutSpot',
		open: async (page) => {
			await page.locator('button.bed-card.free').first().click();
			await page.getByRole('dialog').waitFor();
			await makeTheBed(page);
		}
	},
	{
		// Step 2: name and rules box, after Save without the tick (its message shows).
		name: 'room: booking dialog, rules',
		path: (c) => `/room/${c.roomId}`,
		as: 'guestWithoutSpot',
		open: async (page) => {
			await page.locator('button.bed-card.free').first().click();
			await page.getByRole('dialog').waitFor();
			await makeTheBed(page);
			await page.getByRole('button', { name: /I'll pack them/ }).click();
			await page.getByRole('button', { name: 'Save Spot' }).click();
			await page.locator('.rules-error').waitFor();
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
	// Swap requests (docs/guide/booking.md "Swap spots"): the sheet on a taken
	// spot, and /swaps with a request at the limits for "me" and one of mine.
	{
		name: 'room: swap sheet',
		path: (c) => `/room/${c.roomId}`,
		as: 'guestWithSpot',
		phases: ['live'],
		open: async (page) => {
			await page
				.locator('button.bed-card.swappable', { hasText: TEXTS.burnerLong.slice(0, 30) })
				.click();
			await page.getByRole('dialog').waitFor();
			// The sheet and its tickets fly in: measure them where they land.
			await page.evaluate(() =>
				Promise.all(
					document
						.getAnimations()
						.filter((a) => a.effect?.getTiming().iterations !== Infinity)
						.map((a) => a.finished.catch(() => undefined))
				)
			);
		}
	},
	{ name: 'swap requests', path: () => '/swaps', as: 'guestWithSpot', phases: ['live', 'closed'] },
	{ name: 'swap requests without a spot', path: () => '/swaps', as: 'guestWithoutSpot' },
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
		// "Book it" opens the check over the machine: the bed first.
		name: 'random spot: booking check',
		path: () => '/random-bed',
		as: 'guestWithoutSpot',
		open: openRouletteCheck
	},
	{
		// The bed is made; "Book it" without the tick shows why it waits.
		name: 'random spot: booking check, rules',
		path: () => '/random-bed',
		as: 'guestWithoutSpot',
		open: async (page) => {
			await openRouletteCheck(page);
			await makeTheBed(page);
			await page.getByRole('button', { name: /I'll pack them/ }).click();
			await page
				.locator('.check-card')
				.getByRole('button', { name: /Book it/ })
				.click();
			await page.locator('.rules-error').waitFor();
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
		// Not checked in (the default): a checked-in guest has no such button.
		open: async (page) => {
			await page.getByRole('button', { name: /Leave No Trace/ }).click();
			await page.getByRole('alertdialog').waitFor();
		}
	},
	// Checked in at arrival: the spot is final, the pages say so instead of
	// offering a release (src/lib/check-in.ts, CHECKED_IN_NOTE).
	{
		name: 'house: checked in',
		path: (c) => `/house/${c.houseId}`,
		as: 'guestWithSpot',
		phases: ['live'],
		checkedIn: true
	},
	// The room card with my spot says "Your spot · <label>"; a label the crew
	// renamed to 50 characters must wrap inside the card, not widen the page.
	{
		name: 'house: my spot with a long label',
		path: (c) => `/house/${c.houseId}`,
		as: 'guestWithSpot',
		spotLabel: TEXTS.spotLabelMine,
		open: async (page) => {
			await page.locator('.card.mine .mine-chip', { hasText: TEXTS.spotLabelMine }).waitFor();
		}
	},
	{
		name: 'house without my spot: checked in',
		path: (c) => `/house/${c.otherHouseIds[0]}`,
		as: 'guestWithSpot',
		phases: ['live'],
		checkedIn: true
	},
	{
		name: 'room with my spot: checked in',
		path: (c) => `/room/${c.roomId}`,
		as: 'guestWithSpot',
		phases: ['live'],
		checkedIn: true
	},
	{
		name: 'room without my spot: checked in',
		path: (c) => `/room/${c.otherRoomIds[0]}`,
		as: 'guestWithSpot',
		phases: ['live'],
		checkedIn: true
	},
	{
		name: 'room: rename dialog, checked in',
		path: (c) => `/room/${c.roomId}`,
		as: 'guestWithSpot',
		phases: ['staging'],
		checkedIn: true,
		open: async (page) => {
			await page.locator('button.bed-card.mine').click();
			await page.getByRole('dialog').waitFor();
		}
	},
	{
		name: 'random spot: my spot, checked in',
		path: () => '/random-bed',
		as: 'guestWithSpot',
		phases: ['live'],
		checkedIn: true
	},
	// The stress requester leads a full request group: its card lists all
	// GROUP_MAX burner names at the limit under a group name at the limit.
	{ name: 'special needs: request sent', path: () => '/special-needs', as: 'guestWithRequest' },
	{ name: 'special needs: new request', path: () => '/special-needs', as: 'guestWithoutSpot' },
	// The Telegram offer under a guest's pass (docs/admin/passes.md).
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
	// The three paths of the form: each shows only its own checkboxes (with
	// JavaScript), the helper's refusal sits at the group question.
	{
		name: 'special needs: a personal need',
		path: () => '/special-needs',
		as: 'guestWithoutSpot',
		open: async (page) => {
			await page.getByLabel('A personal need: a medical reason or a disability').check();
			await page.getByText('Stable light conditions').waitFor();
		}
	},
	{
		name: 'special needs: an art project',
		path: () => '/special-needs',
		as: 'guestWithoutSpot',
		open: async (page) => {
			await page.getByLabel('An art project or a crew').check();
			await page.getByText('A bed close to our art piece or project').waitFor();
		}
	},
	{
		name: 'special needs: a helper without a group',
		path: () => '/special-needs',
		as: 'guestWithoutSpot',
		open: async (page) => {
			await page.getByLabel('I come as the helper of someone with a personal need').check();
			await page.getByRole('button', { name: 'Send request' }).click();
			await page.locator('#group-error').waitFor();
		}
	},
	// Request groups (docs/guide/special-needs.md "Asking as a group"): a group
	// that isn't full shows its invite link and the Copy button; leaving asks
	// first; an invite link opens the form with the code filled in.
	{
		name: 'special needs: in a group',
		path: () => '/special-needs',
		as: 'guestInGroup',
		open: async (page) => {
			await page.locator('#group-link').waitFor();
			await page.getByRole('button', { name: /Copy link/ }).waitFor();
		}
	},
	{
		name: 'special needs: leaving the group',
		path: () => '/special-needs',
		as: 'guestWithRequest',
		open: async (page) => {
			await page.getByRole('button', { name: 'Leave the group' }).click();
			await page.getByRole('alertdialog').waitFor();
		}
	},
	{
		name: 'special needs: invite',
		path: (c) => `/special-needs?group=${c.groupCode}`,
		as: 'guestWithoutSpot',
		open: async (page) => {
			await expect(page.locator('input[name="groupCode"]')).not.toHaveValue('');
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
			// A step through the drawer moves the marked entry with it (the menu
			// once kept marking the page it was first opened on).
			await page.getByRole('button', { name: 'Open the menu' }).click();
			await page
				.locator('#admin-menu.open')
				.getByRole('link', { name: /Control Center/ })
				.click();
			await page.waitForURL(/\/admin$/);
			await page.getByRole('button', { name: 'Open the menu' }).click();
			await page.locator('#admin-menu.open').waitFor();
			await expect(page.locator('#admin-menu a[aria-current="page"]')).toHaveText(/Control Center/);
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
		// The forms are folded; the titles carry a summary of what is set.
		name: 'admin house',
		path: (c) => `/admin/house/${c.houseId}`,
		as: 'admin',
		phases: ['staging', 'live']
	},
	{
		name: 'admin house: forms unfolded',
		path: (c) => `/admin/house/${c.houseId}`,
		as: 'admin',
		phases: ['staging', 'live'],
		open: unfoldAll
	},
	{
		name: 'admin room',
		path: (c) => `/admin/room/${c.roomId}`,
		as: 'admin',
		phases: ['staging', 'live']
	},
	{
		name: 'admin room: forms unfolded',
		path: (c) => `/admin/room/${c.roomId}`,
		as: 'admin',
		phases: ['staging', 'live'],
		open: unfoldAll
	},
	{
		// A superuser sees the "off here" boxes and "Reset to house" under the
		// inherited chips of the room and of every spot; an admin only the chips.
		name: 'admin room: forms unfolded, superuser overrides',
		path: (c) => `/admin/room/${c.roomId}`,
		as: 'superuser',
		phases: ['staging'],
		open: unfoldAll
	},
	{
		// A click on a name opens its field with ✓ and ✕ (InlineRename): the
		// room's long title with its number, and the spot with the longest label.
		name: 'admin room: renaming',
		path: (c) => `/admin/room/${c.roomId}`,
		as: 'admin',
		phases: ['staging'],
		open: async (page) => {
			await page.locator('h1 .rename-title').click();
			await page
				.locator('.bed-info .rename-title', { hasText: 'Kuschelzeltplatzverwaltungsbett' })
				.click();
			await page.locator('.rename').nth(1).waitFor();
		}
	},
	{
		// The details of the locked upper bunk in the ♿ room: the room's ♿ is
		// struck through ("never on an upper bunk", no box), next to a
		// superuser's "off here" boxes and the spot's own list of them.
		name: 'admin room: upper bunk details',
		path: (c) => `/admin/room/${c.roomId}`,
		as: 'superuser',
		phases: ['staging'],
		open: async (page) => {
			const upper = page.locator('.bunk-half', {
				has: page.locator('.bed-label', { hasText: /^Upper 1$/ })
			});
			await upper.locator('.spot-details .btn-toggle').click();
			await upper.locator('.chip.never').waitFor();
		}
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
			// More rooms than a house holds: the generator's check answers.
			await page.locator('#new-house-rooms-0').fill('99');
			await page.getByRole('button', { name: 'Save House' }).click();
			await page.locator('.room-sizes [role="alert"]').waitFor();
		}
	},
	{
		// The house generator next to the map (below it on a phone): the rolled
		// name, the kind chips, two size rows and the live count with numbers.
		name: 'admin camp: house generator',
		path: () => '/admin/camp?view=list',
		as: 'admin',
		phases: ['staging'],
		open: async (page) => {
			await page.getByRole('button', { name: /Ignite New House/ }).click();
			const sidebar = page.locator('.details-sidebar');
			await sidebar.locator('#house-gen-rooms-0').waitFor();
			await sidebar.getByRole('button', { name: /ANOTHER ROOM SIZE/ }).click();
			await sidebar.getByRole('button', { name: 'Bunk beds in size 2' }).click();
			await sidebar.getByRole('button', { name: /FLOOR BLOCKS/ }).click();
			await sidebar.locator('.ranges', { hasText: '#11' }).waitFor();
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
	{
		name: 'admin house: refused rooms',
		path: (c) => `/admin/house/${c.houseId}`,
		as: 'admin',
		// Staging: Live and Closed lock the layout, and these forms with it.
		phases: ['staging'],
		open: async (page) => {
			await unfoldAll(page);
			await page.locator('#add-rooms-first').fill('0');
			// A hut group's form says HUTS (src/lib/accommodation.ts, roomWord).
			await page.getByRole('button', { name: /IGNITE \d* ?(ROOM|HUT|TENT|PLACE)S?/ }).click();
			await page.locator('.room-sizes [role="alert"]').waitFor();
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
	// The spot picker (SpotPicker): houses, rooms and spots over the page;
	// picking one and pressing its button books it after a confirmation.
	{
		name: 'admin special-needs: spot picker',
		path: () => '/admin/requests',
		as: 'admin',
		open: async (page) => {
			const request = page.locator('article.request.status-pending').first();
			await request.locator('form.assign button.primary').click();
			const sheet = page.locator('.picker-sheet');
			await sheet.waitFor();
			await sheet.locator('button.tile').first().click();
			await sheet.locator('.picker-foot .choice-label').waitFor();
		}
	},
	{
		name: 'admin special-needs: confirm dialog',
		path: () => '/admin/requests',
		as: 'admin',
		open: async (page) => {
			const request = page.locator('article.request.status-pending').first();
			await request.locator('form.assign button.primary').click();
			const sheet = page.locator('.picker-sheet');
			await sheet.locator('button.tile').first().click();
			await sheet.locator('.picker-foot button.primary').click();
			await page.getByRole('alertdialog').waitFor();
		}
	},
	// A spot the crew locked 🔒 picked on purpose: the picker's footer warns
	// (the stress room's Upper 1, out of service).
	{
		name: 'admin special-needs: blocked spot',
		path: () => '/admin/requests',
		as: 'admin',
		open: async (page) => {
			const request = page.locator('article.request.status-pending').first();
			await request.locator('form.assign button.primary').click();
			const sheet = page.locator('.picker-sheet');
			await sheet.locator('button.tile.blocked').first().click();
			await sheet.locator('.picker-foot .warn-text', { hasText: 'blocked' }).waitFor();
		}
	},
	// Request groups and ♿ spots on the requests page: the full group (one
	// member's ⋯ menu open), the group booking's confirmation, every ♿ spot.
	{
		name: 'admin special-needs: groups',
		path: () => '/admin/requests',
		as: 'admin',
		open: async (page) => {
			// the stress camp's: the smoke tests run first on the same stack and leave a group
			const group = page.locator(`#group-${camp.fullGroupId}`);
			await group.scrollIntoViewIfNeeded();
			await group.locator('details.more > summary').first().click();
			await group.locator('details.more[open]').waitFor();
		}
	},
	{
		name: 'admin special-needs: group confirm',
		path: () => '/admin/requests',
		as: 'admin',
		open: async (page) => {
			// A group sleeps in one room: when no room has space for all (as in the
			// stress camp) there is no plan, so put as many as fit into one, then book.
			const group = page.locator(`#group-${camp.fullGroupId}`);
			await group.locator('.where button').click();
			const sheet = page.locator('.picker-sheet');
			await sheet.locator('.room-action button').first().click();
			await sheet.getByRole('button', { name: 'Edit the plan' }).click();
			await group.locator('form.plan button.primary').click();
			await page.getByRole('alertdialog').waitFor();
		}
	},
	// The picker for a whole group: a room chosen, its spots carry the names.
	{
		name: 'admin special-needs: group picker',
		path: () => '/admin/requests',
		as: 'admin',
		open: async (page) => {
			await page.locator(`#group-${camp.fullGroupId} .where button`).click();
			const sheet = page.locator('.picker-sheet');
			await sheet.locator('.room-action button').first().click();
			await sheet.locator('.tile.planned').first().waitFor();
		}
	},
	// The group into a room where other guests sleep (the stress room): the
	// picker's info line, then the booking's confirmation with it, the ✗ of
	// what a spot misses and a long room name in the title.
	{
		name: 'admin special-needs: group picker, room with guests',
		path: () => '/admin/requests',
		as: 'admin',
		open: async (page) => {
			await page.locator(`#group-${camp.fullGroupId} .where button`).click();
			const sheet = page.locator('.picker-sheet');
			await stressRoom(page).locator('.room-action button').click();
			await sheet.locator('.picker-foot .info-line').waitFor();
		}
	},
	{
		name: 'admin special-needs: group confirm, room with guests',
		path: () => '/admin/requests',
		as: 'admin',
		open: async (page) => {
			const group = page.locator(`#group-${camp.fullGroupId}`);
			await group.locator('.where button').click();
			await stressRoom(page).locator('.room-action button').click();
			await page.locator('.picker-sheet').getByRole('button', { name: 'Edit the plan' }).click();
			await group.locator('form.plan button.primary').click();
			await page.getByRole('alertdialog').waitFor();
		}
	},
	{
		name: 'admin special-needs: ♿ spots',
		path: () => '/admin/requests',
		as: 'admin',
		open: async (page) => {
			await page.locator('.special-spots details > summary').click();
			await page.locator('.special-spots details[open]').waitFor();
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
	// Checked in, like right after the pass check above: arrival time and crew address.
	{
		name: 'booking pass (crew view)',
		path: (c) => `/pass/${c.passCode}`,
		as: 'admin',
		checkedIn: true,
		checkedInText: /CHECKED IN/
	}
];

let pb: PocketBase;
let camp: StressCamp;

test.beforeAll(async () => {
	camp = JSON.parse(fs.readFileSync(CAMP_FILE, 'utf8'));
	pb = await superuser(PB_URL, process.env.PB_ADMIN_EMAIL!, process.env.PB_ADMIN_PASSWORD!);
});

// The other test files on this stack find the guest's spot as it was seeded.
test.afterAll(async () => {
	if (pb && camp) await setMySpot(false, MY_SPOT_LABEL);
});

/**
 * Checks the stress guest in, or takes the check-in back, and gives the spot
 * its label, straight in the database, as the admin's pass check and a crew
 * rename would. Every case sets both, so no case depends on what an earlier
 * one left behind (the run is split into shards).
 */
async function setMySpot(checkedIn: boolean, label: string) {
	const order = await pb
		.collection('orders')
		.getFirstListItem(pb.filter('pass_code = {:code}', { code: camp.passCode }));
	const bed = await pb
		.collection('beds')
		.getFirstListItem(pb.filter('order = {:order}', { order: order.id }));
	const change: Record<string, string> = {};
	if (!!bed.checked_in_at !== checkedIn) {
		Object.assign(
			change,
			checkedIn
				? { checked_in_at: new Date().toISOString(), checked_in_by: camp.adminEmail }
				: { checked_in_at: '', checked_in_by: '' }
		);
	}
	if (bed.label !== label) change.label = label;
	if (Object.keys(change).length > 0) await pb.collection('beds').update(bed.id, change);
}

/**
 * Paint-only decoration, switched off while measuring. None of it moves text,
 * but WebKit on Linux paints in software and redraws it at every width, which
 * made the WebKit run several times slower than Chromium:
 *  - the two decorative full-screen layers: the ambient background and the
 *    cursor-trail canvas on top (fixed, pointer-events: none, no text shown
 *    under reduced motion),
 *  - shadows (they never take up room),
 *  - CSS transitions, so the sweep measures where a box ends up, not a random
 *    point on its way there.
 * The failure screenshot is taken with it too: it shows what was measured.
 */
const MEASURE_CSS = `
.fairy-container, .burner-trail { display: none !important; }
*, *::before, *::after { transition: none !important; text-shadow: none !important; box-shadow: none !important; }
`;

/** A browser signed in the way `who` is: guests by ticket code, admins by session. */
async function openAs(browser: Browser, who: Who) {
	const context = await browser.newContext({ baseURL: BASE, reducedMotion: 'reduce' });
	await context.addInitScript((css) => {
		const add = () =>
			document.head.appendChild(
				Object.assign(document.createElement('style'), { id: 'layout-measure', textContent: css })
			);
		if (document.head) add();
		else document.addEventListener('DOMContentLoaded', add);
	}, MEASURE_CSS);
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
			await setMySpot(!!pageCase.checkedIn, pageCase.spotLabel ?? MY_SPOT_LABEL);
			const context = await openAs(browser, pageCase.as);
			const page = await context.newPage();
			await page.setViewportSize({ width: 1280, height: 900 });
			const response = await page.goto(pageCase.path(camp), { waitUntil: 'networkidle' });
			expect(response?.status(), 'the page loads').toBeLessThan(400);
			if (pageCase.checkedIn) {
				// The case shows what it says: the check-in reached the page.
				await expect(
					page.getByText(pageCase.checkedInText ?? /The crew has checked you in/).first()
				).toBeVisible();
			}
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
