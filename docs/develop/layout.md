# Layout: no squeezed or cut-off text

Guests and crews type long burner names, German compound words, e-mail addresses and emoji. A layout that only looks right with "Bed 1" and "Test Guest" breaks the day real data arrives: a spot card once showed its label as `U` / `pp` / `er` / `1`, because "Reserved by the crew" next to it took all the room.

Two things keep this from coming back: a handful of **rules** for the CSS, and the **layout test**, which renders every page with awkward names at every width and fails when text or a row is squeezed, cut off, pushed out or covered.

## The rules

<div class="steps">

1. **The main text gets the space, the extras move.** A row with a name and a badge, status or buttons wraps (`flex-wrap: wrap`) and gives the name a basis: `flex: 1 1 14rem; min-width: 0`. When both don't fit, the badge goes under the name. Cards that are narrow anyway stack from the start: the spot cards put the status under the label (`grid-template-columns: auto minmax(0, 1fr)`).
2. **Never make the main text the leftover.** `flex: 1 1 0` plus `min-width: 0` next to something that sizes to its content (`flex: 0 1 auto`, `white-space: nowrap`, `max-width: 60%`) hands the name whatever is left — down to one letter.
3. **`overflow-wrap: break-word` for names and labels.** Words stay whole; only a word wider than the whole line breaks. `overflow-wrap: anywhere` is for tokens without break points (e-mail addresses, links, codes): it also lets flex and grid shrink the box to a single letter.
4. **Text columns in a grid are `minmax(0, 1fr)`**, not `1fr` (which means `minmax(auto, 1fr)` and grows with a long token).
5. **Label/value lists stack on small phones.** A `dl` with `max-content` labels leaves the values a sliver at 320 px: below `25rem`, label above value.
6. **Form controls are never wider than their box.** A `<select>` is as wide as its longest option; `src/routes/layout.css` caps `input`, `select` and `textarea` at `max-width: 100%`.
7. **Floating elements are stacked, not offset.** The map's roulette button sat `36px` above the legal links — until the footer got a second line. Things that float together go into one container that stacks them (the map's `.bottom-dock`).
8. **Fixed UI text gets room at every width.** Below the width where a header's parts fit next to each other, the least important part goes first (the guest top bar shrinks its links to icons below 900 px, gives the chips a row of their own below 640 px, and below 480 px keeps the phase icon, the digits and the chip icons while the wordmark and the version badge go) or the parts get rows of their own (the admin menu became a sidebar from 1100 px and a ☰ drawer below; the admin status bar wraps into two rows on a phone, hides the account below 480 px and shrinks Eject to its rocket and the phase pill to its icon below 420 px). Squeezed next to the account, the admin pages once stacked up in a column. The test checks every 40 px, so a breakpoint that is off shows up.
9. **A button's label is not content.** `text-overflow: ellipsis` is for long content (a file name, an e-mail address). A label the crew has to read ("DEACTIVATE") gets a box wide enough for it.
10. **SVG text is measured with `getBBox()`.** WebKit leaves CSS `letter-spacing` out of `getComputedTextLength()`, so a label background measured that way is narrower than its text in Safari.

</div>

## The layout test

```bash
npm run test:layout                                   # Chromium and WebKit, every 40 px
LAYOUT_ARGS=--project=chromium npm run test:layout     # one engine
LAYOUT_STEP=20 npm run test:layout                     # finer sweep
```

It runs on the same throwaway stack as the smoke tests (`scripts/test-stack.sh layout`: empty PocketBase, the app built from the staging Dockerfile) and needs the Playwright browsers once: `npx playwright install chromium webkit`. `npm run verify` runs it in both engines right after the smoke tests, on one stack.

CI splits it into six parts that run side by side: Chromium in two, WebKit in four (`LAYOUT_ARGS="--project=webkit --shard=2/4"`), each on its own runner with its own stack, the smoke tests first and the stress camp seeded in every part. So a test may never rely on what an earlier one did: each sets the state it needs itself — the booking phase, whether the stress guest is checked in. To run one part locally exactly as CI does: `LAYOUT_ARGS="--project=webkit --shard=2/4" bash scripts/test-stack.sh smoke layout`.

**What is switched off while measuring.** Pages are opened with reduced motion, and a test-only stylesheet (`MEASURE_CSS` in `pages.test.ts`) hides the two decorative full-screen layers (the ambient background and the cursor-trail canvas) and turns off shadows and CSS transitions. None of that moves text — shadows take up no room, the layers are fixed and show no text under reduced motion — but WebKit on Linux paints in software and redraws all of it at every width, which made the WebKit part several times slower than Chromium. For the same reason the WebKit project paints with WebKit's CPU painter instead of the software GPU (`WEBKIT_SKIA_ENABLE_CPU_RENDERING`, Linux only). Without transitions the sweep also measures where a box ends up, not a point on its way there.

**The stress camp** (`tests/layout/stress-data.ts`) is built once per run (in CI once per part): houses on all four edges of the map, a 95-character house name, a 34-letter compound word, a room number of 9999, spot labels up to 50 characters, burner names up to the 80-character limit, a 34-letter burner name, emoji, an 87-character e-mail address and a special-needs request. Every text is checked against the limits the app accepts, so the camp stays realistic.

**The pages** (`tests/layout/pages.test.ts`): start page, map (also after *Look around* once booking is closed), house and room (with and without an own spot, with the booking dialog open, elsewhere in the camp with the booking pass in the *You already have a spot* banner, and after the crew checked the guest in), random spot, special needs, booking pass, legal pages, the admin dashboard, house and room editors, tickets (search, ticket list review), layout templates (review), special-needs requests (with the confirm dialog), message texts and the pass check — each as the right guest or admin, and where it matters in every phase: Staging, Live, Closed, and with the opening or closing timer armed (the countdowns).

**The check** (`tests/layout/layout-check.ts`) runs inside the browser at every width from 320 to 1440 px and measures the rendered text:

| Problem | Meaning |
| --- | --- |
| `page-overflow` | The page scrolls sideways by more than 1 % of its width (at least 4 px). Below that is the noise floor of font metrics: the same page is 2 px wider in WebKit on Linux than on macOS. |
| `broken-word` | A word of up to 16 letters is split across lines: its box was squeezed below the word. Longer words, e-mail addresses and links may break. |
| `text-outside` | Text sticks out of the box it belongs to. |
| `clipped-text` | Text is cut off by an `overflow: hidden` ancestor (text shortened with `…` on purpose is fine). |
| `word-stack` | A phrase of three or more words gets one line per word. |
| `item-stack` | A wrapping row of three or more items (links, buttons, chips) gets one line per item because its neighbours squeeze it. |
| `cut-label` | A button's or link's own label is shortened with `…` ("DEACTIV…"). Long content — a file name, an e-mail address — may be shortened. |
| `text-overlap` | Text lies on top of other text. A dialog covering the page is fine, and so is the camp map under the floating controls. |

A failure lists each problem with the widths it appears at, for example `broken-word: "Upper" in div.bed-card.occupied > span.label at 960–1440 px — split across 3 lines in a 30px box`, and attaches a screenshot of the first failing width with the offending elements outlined in magenta. `npx playwright show-report` opens it, together with a trace of the run.

### Adding a page or a state

Add an entry to `PAGES` in `tests/layout/pages.test.ts`: the path, who looks at it, the phases it changes with, and an `open` step for a state that needs a click (a dialog, a file to review). If a new feature shows text the camp doesn't have yet, add the awkward version of it to the stress camp.

### When something is meant to overflow

Mark the element with `data-layout-ignore` (moving or decorative text whose clipping is the effect itself) and say why in a comment. Backgrounds meant to lie under floating controls, like the camp map, are listed as `CANVAS` in the test: their text may be covered, but not cut off. A small floating layer that covers the page on purpose, like the lock hint, carries `data-layout-overlay` (`OVERLAYS` in the test): what lies under it doesn't count as covered, its own text is still measured.
