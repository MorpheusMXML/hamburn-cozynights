// tests/layout/make-the-bed.test.ts — the "idiot check" of the booking
// window's first step (src/lib/components/booking/MakeTheBed.svelte): every
// cover only goes on its own piece of the bed — the bed sheet on the mattress,
// the duvet cover on the blanket, the pillowcase on the pillow — whether it is
// tapped and placed, dragged, or moved with the keyboard. A wrong piece says
// where the cover belongs and keeps it out. Runs in the layout suite because
// it needs a browser and the seeded camp (npm run test:layout); with reduced
// motion (the suite's setting) a cover lands at once. Nothing is booked.
import { test, expect, type Locator, type Page } from '@playwright/test';
import fs from 'fs';
import { CAMP_FILE, setPhase, superuser, type StressCamp } from './stress-data';

const BASE = process.env.LAYOUT_BASE_URL || process.env.SMOKE_BASE_URL || '';
const PB_URL = process.env.PB_TEST_URL || '';
let camp: StressCamp;

test.beforeAll(async () => {
	camp = JSON.parse(fs.readFileSync(CAMP_FILE, 'utf8'));
	const pb = await superuser(PB_URL, process.env.PB_ADMIN_EMAIL!, process.env.PB_ADMIN_PASSWORD!);
	await setPhase(pb, 'live');
});

/** A guest without a spot opens the booking window of a free spot: step 1, the bare bed. */
async function openBookingWindow(page: Page) {
	await page.context().addCookies([
		{ name: 'bookingCode', value: camp.guestWithoutSpot, url: BASE },
		{ name: 'bookingRound', value: camp.guestRound, url: BASE }
	]);
	await page.goto(`/room/${camp.roomId}`, { waitUntil: 'networkidle' });
	// a click before hydration does nothing: try again until the window is there
	for (let i = 0; i < 20 && !(await page.locator('.make-bed').count()); i++) {
		await page.locator('button.bed-card.free').first().click();
		await page.waitForTimeout(250);
	}
	await page.locator('.make-bed').waitFor();
}

const cover = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
const spot = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
const status = (page: Page) => page.locator('.make-bed .status');

/** Drags with the mouse from the middle of one element to the middle of another. */
async function dragOnto(page: Page, from: Locator, to: Locator) {
	const a = (await from.boundingBox())!;
	const b = (await to.boundingBox())!;
	await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
	await page.mouse.down();
	await page.mouse.move(a.x + a.width / 2 + 12, a.y + a.height / 2 - 12, { steps: 3 });
	await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 8 });
	await page.mouse.up();
}

test('a tapped cover only goes on its own piece', async ({ page }) => {
	await openBookingWindow(page);

	// nothing in hand: the bed asks for a cover first
	await spot(page, 'Blanket').click();
	await expect(status(page)).toHaveText(/Pick a cover from your bag first/);

	await cover(page, 'Pillowcase').click();
	await expect(cover(page, 'Pillowcase')).toHaveAttribute('aria-pressed', 'true');
	await expect(status(page)).toHaveText('Where does the pillowcase go? Tap its place on the bed.');

	// the wrong pieces say so, and the cover stays in hand
	await spot(page, 'Blanket').click();
	await expect(status(page)).toHaveText("That's the blanket! The pillowcase goes on the pillow.");
	await spot(page, 'Mattress').click();
	await expect(status(page)).toHaveText("That's the mattress! The pillowcase goes on the pillow.");
	await expect(cover(page, 'Pillowcase')).toHaveAttribute('aria-pressed', 'true');
	await expect(page.locator('.cover-layer')).toHaveCount(0);

	// its own piece takes it
	await spot(page, 'Pillow').click();
	await expect(status(page)).toHaveText('Pillowcase on the pillow ✓ · 2 covers to go');
	await expect(page.getByRole('button', { name: 'Pillowcase: on the pillow' })).toBeDisabled();
	await expect(page.getByRole('button', { name: 'Pillow: pillowcase on' })).toBeDisabled();
	await expect(page.locator('.cover-layer.case')).toHaveCount(1);

	// tapping the cover in hand again puts it back
	await cover(page, 'Bed sheet').click();
	await cover(page, 'Bed sheet').click();
	await expect(cover(page, 'Bed sheet')).toHaveAttribute('aria-pressed', 'false');
});

test('a dragged cover on the wrong piece goes back into the bag', async ({ page }) => {
	await openBookingWindow(page);

	await dragOnto(page, cover(page, 'Bed sheet'), spot(page, 'Blanket'));
	await expect(status(page)).toHaveText("That's the blanket! The bed sheet goes on the mattress.");
	await expect(cover(page, 'Bed sheet')).toBeEnabled();
	await expect(page.locator('.cover-layer')).toHaveCount(0);

	await dragOnto(page, cover(page, 'Duvet cover'), spot(page, 'Pillow'));
	await expect(status(page)).toHaveText("That's the pillow! The duvet cover goes on the blanket.");
	await expect(page.locator('.cover-layer')).toHaveCount(0);

	await dragOnto(page, cover(page, 'Bed sheet'), spot(page, 'Mattress'));
	await expect(status(page)).toHaveText('Bed sheet on the mattress ✓ · 2 covers to go');
	await expect(page.locator('.cover-layer.sheet')).toHaveCount(1);
});

test('a second finger on another cover in the middle of a drag strands nothing', async ({
	page
}) => {
	await openBookingWindow(page);

	// Two touches as a phone sends them (pointer events with their own ids): finger 1
	// drags the bed sheet, finger 2 taps the duvet cover meanwhile, finger 1 lets go
	// next to the bed. Before the fix, finger 2 took over the press and the sheet
	// stayed lifted for good: no tap, drag or key could pick it up again.
	const { duringDrag, lifted } = await page.evaluate(async () => {
		const button = (name: string) =>
			document.querySelector<HTMLButtonElement>(`button.cover[aria-label="${name}"]`)!;
		const sheet = button('Bed sheet');
		const duvet = button('Duvet cover');
		const middle = (el: Element) => {
			const box = el.getBoundingClientRect();
			return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
		};
		const touch = (el: Element, type: string, id: number, at: { x: number; y: number }) =>
			el.dispatchEvent(
				new PointerEvent(type, {
					pointerId: id,
					pointerType: 'touch',
					isPrimary: id === 1,
					clientX: at.x,
					clientY: at.y,
					button: 0,
					buttons: type === 'pointerup' ? 0 : 1,
					bubbles: true,
					cancelable: true
				})
			);
		const frame = () => new Promise((done) => requestAnimationFrame(done));
		const s = middle(sheet);
		touch(sheet, 'pointerdown', 1, s);
		touch(sheet, 'pointermove', 1, { x: s.x + 20, y: s.y - 20 });
		await frame();
		// the drag runs: the sheet is out of the bag (so the handlers saw these events)
		const duringDrag = sheet.classList.contains('lifted');
		touch(duvet, 'pointerdown', 2, middle(duvet));
		touch(duvet, 'pointerup', 2, middle(duvet));
		touch(sheet, 'pointerup', 1, { x: 2, y: 2 });
		await frame();
		return { duringDrag, lifted: [sheet, duvet].map((el) => el.classList.contains('lifted')) };
	});
	expect(duringDrag, 'the synthetic drag reached the handlers').toBe(true);
	expect(lifted, 'neither cover is left lifted').toEqual([false, false]);

	// the sheet still goes on the mattress (a click right after a drag belongs to it: wait)
	await page.waitForTimeout(600);
	await cover(page, 'Bed sheet').click();
	await spot(page, 'Mattress').click();
	await expect(page.locator('.cover-layer.sheet')).toHaveCount(1);
});

test('the keyboard makes the bed the same way, and the focus follows', async ({ page }) => {
	await openBookingWindow(page);

	// Enter picks the duvet cover up and takes the focus to the bed. The way on
	// between the pieces is the user's own Tab (Safari: Option-Tab, or with
	// "Press Tab to highlight each item"); the test focuses the piece instead.
	await cover(page, 'Duvet cover').focus();
	await page.keyboard.press('Enter');
	await expect(spot(page, 'Pillow')).toBeFocused();
	await page.keyboard.press('Enter');
	await expect(status(page)).toHaveText("That's the pillow! The duvet cover goes on the blanket.");
	await expect(page.locator('.cover-layer')).toHaveCount(0);
	await spot(page, 'Blanket').focus();
	await page.keyboard.press('Enter');
	await expect(page.locator('.cover-layer.duvet')).toHaveCount(1);

	// on to the next cover in the bag
	await expect(cover(page, 'Bed sheet')).toBeFocused();
	await page.keyboard.press('Enter');
	await expect(spot(page, 'Pillow')).toBeFocused();
	await spot(page, 'Mattress').focus();
	await page.keyboard.press('Enter');
	await expect(page.locator('.cover-layer.sheet')).toHaveCount(1);
	await expect(cover(page, 'Pillowcase')).toBeFocused();
	await page.keyboard.press('Enter');
	await expect(spot(page, 'Pillow')).toBeFocused();
	await page.keyboard.press('Enter');

	// the bed is made: the promise to pack, then step 2
	await expect(page.getByRole('button', { name: /I'll pack them/ })).toBeFocused();
	await page.keyboard.press('Enter');
	await expect(page.getByRole('heading', { name: 'Grab This Spot' })).toBeVisible();
});
