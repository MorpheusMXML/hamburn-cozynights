# States, colours and live numbers

Two things in this app are easy to get subtly wrong: showing a state, and
showing a number that has since changed. Both have one home now.

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

## Live numbers

The browser never talks to PocketBase (see `$lib/server/pocketbase.ts`), so
there is no socket to subscribe to. The control center polls instead.

```
+page.server.ts ─┐                          ┌─ deriveLiveStats()  (pure)
                 ├─ $lib/server/stats.ts ───┤
/admin/api/stats ┘                          └─ liveStatsSnapshot() (cached)
```

- **`deriveLiveStats(houses, rooms, beds)`** is pure and does the counting. The
  page load and the endpoint both call it, so the first paint and every poll
  afterwards agree.
- **`liveStatsSnapshot(pb)`** caches for `SNAPSHOT_TTL_MS` (3 s) and
  single-flights concurrent callers: ten open dashboards are one PocketBase
  read. `changedAt` and the ETag only move when a number actually changes.
- **`GET /admin/api/stats`** is admin-only (`hooks.server.ts` already refuses
  everything under `/admin/api/` without a session) and answers `304` while the
  ETag matches. `cache-control: no-store, private`.
- **`createLivePoll()`** (`$lib/live-stats-poll.ts`) asks every
  `POLL_INTERVAL_MS` (5 s), skips hidden tabs entirely and catches up on
  `visibilitychange`, doubles the gap after an error up to a minute, and stops
  for good on `403` (the weekly re-sign-in) instead of hammering.

The page merges the answer into the numbers only. Which houses exist, and
where their pins stand, still comes from the page load — if that changed, the
panel offers a reload instead of drifting.

### Adding a number to the panel

1. Count it in `deriveLiveStats` (or in `countSpots`, if it is a spot state).
2. Add it to the `LiveStats` interface in `$lib/live-stats.ts` — server and
   browser share that file, so the wire format stays honest.
3. Show it in `IntelDashboard.svelte`, with `data-state` for its colour.
4. Cover it in `tests/live-stats.test.ts`.

Nothing needs to change in nginx, the compose files or the deploy script: it is
one more field in an answer that already travels.

### Charts without a chart library

`IntelDashboard.svelte` draws the occupancy ring as an inline `<svg>` circle
with `stroke-dasharray`, and the seven day bars as divs scaled with
`transform: scaleY()`. Both animate on the compositor. Chart.js used to cost
49 KB brotli on `/admin` — about a third of the page — and is gone.

Numbers roll with `@number-flow/svelte`, the same component the booking
countdown uses. NumberFlow does not hydrate cleanly, so components render plain
digits until `onMount` (copy the `mounted` pattern from `CountdownDigits.svelte`).
