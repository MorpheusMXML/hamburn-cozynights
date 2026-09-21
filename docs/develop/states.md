# States, colours and live numbers

Three things in this app are easy to get subtly wrong: showing a state,
pointing at the field a form refused, and showing a number that has since
changed. All three have one home now.

## One state vocabulary

`src/routes/state.css` holds the colours and the animation; `src/lib/occupancy.ts`
holds the counting and the names. Nothing else should invent either.

| State | Token | Colour | Means |
| --- | --- | --- | --- |
| `open` | `--state-open` | green `#4ade80` | free spots, nothing booked yet |
| `filling` | `--state-filling` | orange `#fb923c` | booked and free side by side |
| `full` | `--state-full` | red `#f87171` | nothing left to book |
| `unconfigured` / `idle` | `--state-idle` | grey `#a3a3a3` | no active spots |
| `checked-in` | `--state-checked-in` | turquoise `#2dd4bf` | guest checked in at arrival |
| `special` | `--state-special` | pink `#f472b6` | ♿ spot, held for a request |
| `locked` | `--state-locked` | violet `#a78bfa` | locked 🔒 by the crew |
| `danger` | `--state-danger` | red `#f87171` | refused input, failed action |
| `staging` / `live` / `closed` | `--state-staging` … | turquoise / pink / light grey | the booking phase |

Put `data-state="…"` on an element and it gets `--state` and `--state-soft`.
Add `class="state-ring"` and it gets a border in that colour that breathes:

```svelte
<a class="house-card state-ring" data-state={houseState(house)}>…</a>
```

Three helpers come with it: `.state-dot` (the 8 px legend dot), `.state-chip`
(a small uppercase badge) and `.state-ring-alert` (three quick beats, then
still — for something that just went wrong, see the form fields).

### Why a `::after` overlay

The ring is drawn by a pseudo-element and animates **`opacity` only**. That
stays on the compositor: a list of forty house cards costs no repaints per
frame. Animating `border-color` or `box-shadow` instead — as the older
`pulse-glow` in `layout.css` still does (Baustelle #74) — repaints every frame
for every element.

The element also keeps a static border in its state colour, so the state is
readable while the animation is paused, off or still starting. Two rules
switch it off: `prefers-reduced-motion: reduce`, and the landing page's pause
button (`:root[data-motion='paused']`, WCAG 2.2.2).

### The four states of a house

`houseState()` and `houseStateLabel()` in `$lib/occupancy.ts` are the single
source. Before, the badge on a card called a house "green" while the legend in
the same panel counted it as "empty" — two classifications of the same house,
side by side.

`countSpots()` partitions the active spots into `occupied + free + locked +
special = total`, which is what lets the ring add up. `checkedIn` is a subset
of `occupied`, and `deactivated` counts the switched-off spots outside `total`.

## Refused input

A refused field uses the same vocabulary — the `danger` state — and one switch:
**`aria-invalid="true"`**. Forms set it anyway for screen readers; `state.css`
turns it into the look for every form at once:

| Element | Gets |
| --- | --- |
| `input`/`select`/`textarea` with `aria-invalid="true"` | red border, one ping (`field-refused`), then a steady faint glow |
| `.field-error` | the reason under the field: red, ⚠️ from CSS, slides in |
| `.form-error` | a refusal of the whole form: red box, ⚠️ from CSS, slides in |
| `.field-box` + `data-state="danger"` + `state-ring state-ring-alert` | a wrapper that *is* the visible box (the ticket box on `/`, a group of checkboxes): three quick beats of the ring, then still |

A control inside a `.field-box` is skipped by the field rule, so nothing glows
twice. Don't type ⚠️ into a message — the CSS adds it.

```svelte
<input
	id="room-name"
	name="name"
	aria-invalid={!!errors.name}
	aria-describedby={errors.name ? 'room-name-error' : undefined}
	on:input={() => (errors = { ...errors, name: undefined })}
/>
{#if errors.name}
	<p class="field-error" id="room-name-error" role="alert">{errors.name}</p>
{/if}
```

**After a refused submit** — by the browser-side check or by the server — call
`revealInvalid(formElement)` from `$lib/field-alert`. It waits a tick for the
error markup, puts the cursor into the first refused field (scrolled into
view), nudges every refused box sideways for 320 ms (`transform` only) and
replays the ping, so a second click with the same mistake is never silent:

```ts
const handleSubmit: SubmitFunction = ({ formData, formElement, cancel }) => {
	errors = validate(formData);
	if (Object.keys(errors).length) {
		cancel();
		revealInvalid(formElement);
		return;
	}
	return async ({ result }) => {
		if (result.type === 'failure') {
			errors = result.data?.errors ?? {};
			revealInvalid(formElement);
		}
	};
};
```

Two UX rules the forms follow:

- **Punish late, reward early.** Don't mark a field red while it's being typed
  (half an e-mail address isn't wrong yet): mark it once it was left or a save
  was tried, and clear it on the first keystroke that fixes it
  (`TicketCard.svelte` shows the pattern).
- **Don't grey out Save to signal an error.** A disabled button doesn't say
  why. Keep it clickable and let `revealInvalid` show what to fix.

The **forwards-filled animation** is deliberate: an animation outranks the
forms' own `:focus` glow in the cascade without `!important`, so the refused
field stays red while the cursor is in it. With `prefers-reduced-motion` the
animation runs for 1 ms and lands on the steady glow; the nudge is skipped.

`tests/field-alert.test.ts` covers the helper; the layout suite measures the
refused states of the start page, the special-needs form, the new-house form
and the add-room form in both engines.

## Locked controls

Some controls exist but can't be used right now. During Live Booking and after
booking closed the camp layout is locked: adding, moving, renaming and deleting
houses, rooms and spots, (de)activating spots and marking them taken is refused
(`isLayoutLocked`, the actions and `pb_hooks/cozy_layout.pb.js` decide — the UI
only shows it). Such a control stays **where it is, greyed out with a
padlock**, and a try is answered right next to it. Don't hide it, and don't
use `disabled` for it: a disabled button can't be focused or clicked, so it
could never say why.

| Piece | Where | Does |
| --- | --- | --- |
| `layoutLock(phase, isSuperuser)` | `$lib/layout-lock.ts` | the hint for one kind of change: `lock('delete spots')` → *Locked during Live Booking* and who can lift it; an optional tip (`LOCK_SPOT_TIP`: lock the spot instead) |
| `lockAttrs(hint)` | `$lib/layout-lock.ts` | what to spread on the control: `aria-disabled="true"`, `title`, `data-locked` and the hint; `{}` while unlocked. Rendered on the server, so a locked page never flashes up as editable |
| `LockHintHost.svelte` | admin layout, once | one capture listener for the admin area: a click, <kbd>Enter</kbd> or a typed key on a `[data-locked]` element never reaches the control's handler or the browser (no submit, no navigation); the control shakes, its padlock rattles, a bubble explains, a live region reads it out |
| `showLockHint(anchor, hint)` | `$lib/layout-lock.ts` | the same bubble for what isn't a locked control: the map's `layoutLocked` event (a pin that can't be dragged, a click on an empty place) |
| "Locked controls" | `src/routes/state.css` | the look: greyed out, a padlock badge on buttons and inside fields, no hover lift or glow; `data-lock-rattle` plays the refusal with `translate` (`transform: none !important` switches the hover lifts off and would outrank an animated transform) |
| `LayoutLockNotice.svelte` | house, room, new-house page | the line on top: quiet in Staging (*the layout can be changed*, and when an armed opening locks it), orange during Live Booking and Closed with what is locked, what still works and who can unlock |
| `LockGlyph.svelte` | notices, map status bar, hint | the padlock that swings shut or open when the phase changes while the page is open |

```svelte
<script lang="ts">
	import { layoutLock, lockAttrs } from '$lib/layout-lock';
	$: lock = isLayoutLocked ? layoutLock(phase, isSuperuser) : null;
</script>

<input name="label" readonly={!!lock} {...lockAttrs(lock?.('add spots'))} />
<button class="btn-icon" title="Delete this spot" {...lockAttrs(lock?.('delete spots'))}>
	🗑 DELETE
</button>
```

A field gets `readonly` as well. Put the spread **after** the control's own
`title`: while locked, the lock's title replaces it. And keep the server check
— the look is a courtesy, not the rule.

`tests/layout-lock.test.ts` covers texts, attributes, keys and where the
bubble goes; the layout suite measures the house and room pages in both
states, the read-only house editor and an open hint in both engines; the
map's e2e test drags a pin and types coordinates during Live Booking.
Playwright treats `aria-disabled="true"` as disabled: a test that clicks a
locked control needs `click({ force: true })`, or focuses it and presses a key.

## Live numbers

The browser never talks to PocketBase (see `$lib/server/pocketbase.ts`), so
there is no socket to subscribe to. The control center polls instead.

```
+page.server.ts ─┐                          ┌─ deriveLiveStats()   (pure: houses, rooms, beds)
                 ├─ $lib/server/stats.ts ───┼─ readOpsStats()     (counts: tickets, messages, requests, crew)
/admin/api/stats ┘                          └─ liveStatsSnapshot() (cached, one ETag over both)
                                                        │
                                   $lib/intel.ts ◄──────┘ filters, time buckets, house table, attention list
                                   (in the browser)
```

- **`deriveLiveStats(houses, rooms, beds)`** is pure and does the spot
  counting. The page load and the endpoint both call it, so the first paint and
  every poll afterwards agree. Per house it also hands out `bookedAt` and
  `checkedInAt`: the minute (since the epoch, UTC) of every current booking and
  check-in, so the browser can bucket them by any range without asking again.
- **`readOpsStats(pb)`** counts what belongs to no house — tickets (with an
  address, with Telegram), guest messages queued / retrying / given up
  (`guest_notify.due` and `attempts`, the states `pb_hooks/lib/notify.js`
  leaves behind), special-needs requests by status, admins and access requests,
  crew alerts by `alert_status` — and how many of the failed ones came after
  the last alert that was sent (`failingAlertsFilter`: only those still mean
  a broken chat, older failures are history). One small `getList(1, 1)` per
  count; each may fail on its own and then reads as `null` (shown as —), it
  never throws.
  **`opsSnapshot(pb)`** caches that for `OPS_TTL_MS` (10 s).
- **`liveStatsSnapshot(pb)`** caches the whole answer for `SNAPSHOT_TTL_MS`
  (3 s) and single-flights concurrent callers: ten open dashboards are one
  PocketBase read. `changedAt` and the ETag only move when a number actually
  changes.
- **`GET /admin/api/stats`** is for approved admins only (`hooks.server.ts`
  already refuses everything under `/admin/api/` without an admin session, a
  pending access request included; the endpoint checks again) and answers `304`
  while the ETag matches. `cache-control: no-store, private`. Only counts,
  house names and minutes travel — no guest names, addresses or ticket codes.
- **`createLivePoll()`** (`$lib/live-stats-poll.ts`) asks every
  `POLL_INTERVAL_MS` (5 s), skips hidden tabs entirely and catches up on
  `visibilitychange`, doubles the gap after an error up to a minute, and stops
  for good on `403` (the weekly re-sign-in) instead of hammering.
- **`$lib/intel.ts`** is everything the panel does with the answer, pure and
  unit-tested: `scopedSpots` (whole camp or one house), `activityBuckets`
  (24 hours, 7 days or all, by Europe/Berlin hour and calendar day — DST-safe,
  a 23- or 25-hour day never loses or doubles a bar), `houseRows` (search,
  state, sort), `attentionItems` (what waits for the crew, depending on the
  phase). A filter change costs no request.

The page merges the answer into the numbers only. Which houses exist, and
where their pins stand, still comes from the page load — if that changed, the
panel offers a reload instead of drifting.

### Adding a number to the panel

1. Count it: a spot state in `countSpots`, anything per house in
   `houseStats`, anything camp-wide in `readOpsStats` (a count that may fail
   is a `Count`, `number | null`).
2. Add it to the interfaces in `$lib/live-stats.ts` — server and browser share
   that file, so the wire format stays honest.
3. Show it in `IntelDashboard.svelte` or one of its parts in
   `$lib/components/admin/intel/`, with `data-state` for its colour. If it is
   something to act on, give it a line in `attentionItems`.
4. Cover it in `tests/live-stats.test.ts` (counting, caching, the endpoint)
   and `tests/intel.test.ts` (what the browser makes of it).

Nothing needs to change in nginx, the compose files or the deploy script: it is
one more field in an answer that already travels.

### Charts without a chart library

`IntelDonut.svelte` draws the occupancy ring as an inline `<svg>` circle with
`stroke-dasharray`, with 2 px of the panel's colour between the slices instead
of a border. `IntelActivity.svelte` draws the bars as divs scaled with
`transform: scaleY()`; the plot is one `role="slider"` tab stop, so the arrow
keys walk the bars and a screen reader reads each one, and a table view lists
every bar. Everything animates on the compositor. Chart.js used to cost 49 KB
brotli on `/admin` — about a third of the page — and is gone.

> [!WARNING] Class names that are Tailwind utilities
> `layout.css` imports Tailwind, which scans every source file and emits each
> utility it finds globally — scoped Svelte styles don't protect against that.
> The ring used to be `<svg class="ring">` and got Tailwind's `ring` utility: a
> 1 px box-shadow in `currentColor`, a white square frame round the chart. Give
> own elements prefixed names (`intel-donut`, `donut-slice`), never `ring`,
> `shadow`, `border`, `outline`, `grid`, `table`, `container`, `hidden` & co.

Numbers roll with `@number-flow/svelte`, the same component the booking
countdown uses. NumberFlow does not hydrate cleanly, so components render plain
digits until `onMount` (copy the `mounted` pattern from `CountdownDigits.svelte`).
