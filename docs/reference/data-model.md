# Data model & location templates

PocketBase holds only live data: ticket codes, bookings and admin accounts.
Everything that can be rebuilt lives in Git: the schema (`pb_migrations/`),
hooks (`pb_hooks/`) and location layouts as template files. Where each kind of
data lives and how it is backed up: [Backups and where data lives](../develop/deployment#backups-and-where-data-lives).

## Collections

| Collection     | Holds                                                                                    | Personal data | Written by                                           | API rules                             |
| :------------- | :--------------------------------------------------------------------------------------- | :------------ | :--------------------------------------------------- | :------------------------------------ |
| `houses`       | `name`, `x`, `y` (map position), `kind` (house, hut group, tent area, other), `features`, `description` | no            | admins                                               | public read, admin write              |
| `rooms`        | `name`, `room_number`, `house`, `amount_beds` (spots created with the room; an initial count only, not maintained: count the room's `beds`), `kind`, `features`, `description` (like a house), `features_off` (house features this room switches off for itself; superusers only) | no            | admins                                               | public read, admin write              |
| `beds`         | `label`, `room`, `occupied`, `order`, `is_locked`, `enabled`, `is_special` (special-needs spot), `bed_type` (single bed, lower/upper bunk, half of a double bed, sofa, mattress, camp bed), `bunk_partner` (the other spot of a bunk bed, set on both spots), `features`, `features_off` (house or room features this spot switches off for itself; superusers only), `booked_at` (when the spot got its ticket, set by PocketBase), `checked_in_at` and `checked_in_by` (the check-in at arrival: when, which admin) | no      | admins; guest bookings via the app's service account; a check-in with the checking admin's own session (the service account only moves it along or clears it) | admin read, admin write (guests see spots only through the app) |
| `orders`       | `order_number`, `order_hash`, `customer_name`, `burner_name` (encrypted), `email`, `pass_code` (booking pass, unique), `handed_over_at` (when the ticket was last passed on) | yes | the app's service account, `scripts/cozy-admin.sh tickets`; `pass_code` only by PocketBase | none (superusers only) |
| `app_settings` | the phase set by hand: `is_booking_active` (live), `booking_closed` (closed); the booking window: `booking_unlock_at`, `booking_close_at`, `booking_timer_paused`; `notify_mail`, `telegram_bot`, `wallet_platforms` (which wallets the app offers), `special_requests_open`, `guest_round` (the booking round guests are signed in for; released bookings count it up) (single record `appsettings0123`) | no | admins (a phase switch right now: superusers only); PocketBase keeps the notification flags current, the app the wallet one | public read, admin write |
| `admins`       | `email`, `name`, `role` (`pending`, `admin`, `superuser`), `last_sign_in`                | yes (email)   | Google sign-in, `scripts/cozy-admin.sh`              | none (sign-in creates `pending` only) |
| `guest_notify` | per ticket: what was last confirmed by mail / Telegram (spot, special-needs request, and the hand-over the address was told about), when the next message is due, retries, the linked Telegram chat and a one-time link token (hashed) | yes (chat id) | PocketBase hooks; the app's service account (Telegram link) | none (superusers only) |
| `special_requests` | per ticket at most one: `order`, `status` (`pending`, `approved`, `declined`), `needs`, `reason` and `burner_name` (all three encrypted), `consent_at`, `decided_by`, `decided_at`, `bed` (the spot the crew booked for it) | yes (often health data) | the app's service account | none (superusers only) |
| `admin_events` | audit log: `action`, `actor`, `subject`, `details`, crew alert state                      | yes (admin emails) | PocketBase hooks; the app's service account      | none (superusers only)                |
| `wallet_passes` | per booking pass and wallet: `platform` (`apple`, `google`), `serial` (the pass code it was made for), what it shows now and what the wallet was last told (`hash`, `pushed_hash`, `changed_at`), and failed updates (`attempts`, `next_try`, `last_error`) | no | the app (handing a pass out, and its sync) | none (superusers only) |
| `wallet_devices` | the phones that follow an Apple Wallet pass: `pass`, `device` and `push_token`, both issued by Apple for this pass type only | yes (device identifiers) | the app, through Apple's pass web service | none (superusers only) |
| `message_texts` | the message texts admins changed: `key` (as in `pb_hooks/lib/texts.js`, unique), `text`, `updated_by`; a text without a record uses the default | yes (admin email) | the app's service account                        | none (superusers only)                |

Deleting a house in the dashboard also deletes its rooms and beds. "Admin
write" means an approved `admins` record (see [Security & privacy](./security)).

## Integrity rules

- **One ticket code = one order = at most one bed.** Booking another bed moves
  the booking. `BookingService` serializes bookings per order and per bed with
  locks inside the app process, which is correct for the single app container
  per environment. The database itself does not enforce it yet.
- **A bed is taken** when `occupied` is true; `order` points to the order.
  Guest bookings and releases write both fields together. The admin toggle in
  the room view only flips `occupied`, so the two fields can drift apart.
  PocketBase stamps `booked_at` whenever `order` is set and clears it on
  release (`pb_hooks/cozy_booked.pb.js`), whoever does the writing; when a
  ticket is deleted, the bed it held becomes free in the same hook.
- **A spot is free, booked or checked in.** Checked in means the crew checked
  the guest's booking pass at arrival (`checked_in_at`, `checked_in_by`; only
  admins and superusers, see [Booking passes & check-in](../admin/passes)).
  A check-in only exists while the bed has its `order`: the same hook drops it
  when the bed is released or gets another ticket, unless that write brings a
  check-in along (the crew moving a guest who arrived). Guests can't release
  a checked-in spot; a ticket handed over to a new holder loses its check-in.
- **One ticket, one spot, also on the server:** the room page refuses a second
  spot while the ticket holds one (release first). A move whose release of
  the old spot fails is undone, so a ticket never keeps two spots.
- **Only superusers release bookings:** the switch back to Staging Mode asks
  whether the guest bookings (and with them their check-ins) are released or
  stay while the layout is edited; spots the crew booked for special-needs
  requests stay either way. "Clear all bookings" does the same later and only
  works in Staging Mode. Both are superuser-only, in the app and in PocketBase.
- **Guest messages follow the beds.** Every change of a bed's `order` (a booking, a move, a release, a deleted room) marks the ticket in `guest_notify` as due; PocketBase then sends one message per settled state. See [Notifications](../admin/notifications).
- **Wallet passes follow them too.** Every half minute the app compares what each pass in `wallet_passes` shows with the booking as it is now, and tells Apple's devices or Google when they differ — whoever changed the booking. See [Wallet passes](../admin/passes#wallet-passes-apple-wallet-google-wallet).
- **Contact data is temporary.** `orders.email`, the Telegram links, all special-needs requests and the wallet device registrations are deleted after the event with `scripts/cozy-admin.sh tickets forget-contacts --yes`.
- **One special-needs request per ticket** (unique index on `special_requests.order`); it goes with its ticket (cascade). The app takes the ticket from the guest's session, encrypts what the guest wrote and never logs it. See [Special-needs requests](../admin/special-needs).
- **Orders are the ticket roster.** No admin action deletes them: "clear all
  bookings" and the template import only release beds and clear burner names,
  so every guest's code keeps working. A ticket handed over to a new holder
  (Tickets page) keeps its bed and code; its `pass_code` and `burner_name`
  are cleared, its Telegram link and its special-needs request are removed,
  and `handed_over_at` records when: the new address gets its own message
  once, and the date stays on the ticket.
- **A bunk bed is two spots of one room that point at each other:**
  `bunk_partner` is set on both spots, and their bed types are the levels
  (`bunk_lower`, `bunk_upper`; `src/lib/bunks.ts` is the model). The app
  writes both sides together; PocketBase completes the other side when a spot
  is written on its own, lets a former partner go, leaves a deleted spot's
  partner standing as a single spot (no cascade), and refuses a partner
  outside the room or a spot as its own partner
  (`pb_hooks/cozy_bunks.pb.js`, logic in `pb_hooks/lib/bunks.js`). Stacking
  works in every phase, like 🔒 and ♿: it moves no booking (see
  [Bunk beds](../admin/camp-layout#bunk-beds)).
- **Features add up from the house down, and the closer level wins:** what
  is true for one spot is the house's `features`, minus what the room
  switched off (`rooms.features_off`), plus the room's own, minus what the
  spot switched off (`beds.features_off`), plus the spot's own — so a heated
  room in an unheated hut group counts as heated, and a room with `heated` in
  its off list stays cold in a heated house (`effectiveFeatures` in
  `src/lib/accommodation.ts`, mirrored in `pb_hooks/lib/beds.js`). An off
  list drops a feature before the level's own features count, may name any
  feature a level above can have (a room: the house's; a spot: the house's
  and the room's; `offAllowed`), is set and reset by superusers only (the
  app's actions check for a superuser session; an admin's form never carries
  it), and an empty list means *inherit everything*. Two features that say
  the opposite of each other, `heated` and `unheated`, are never both set on
  one house or room: the forms clear the other box, the template import
  refuses the file, and PocketBase refuses the write on the records API. A
  room or spot never switches a feature off that it ticks itself either: the
  forms clear the other box, the template import refuses the file, and the
  same hook refuses the write — it guards `houses`, `rooms` and `beds`
  (`pb_hooks/cozy_features.pb.js`, logic in `pb_hooks/lib/beds.js`). An upper bunk is never `wheelchair`, however
  accessible its room or house is: a bed with a ladder loses ♿ wherever a
  spot's features are summed up, so the ♿ picker, the map wishes, the guest
  pages, the messages and the passes never show it for one.
- **While booking is live or closed**, the structure is locked on the server:
  houses and rooms can't be added, moved, renamed or deleted, beds can't be
  added or deleted, and templates can't be imported (see
  [Staging, Live Booking & Closed](../guide/phases)).
- **The phase is computed, not scheduled.** An armed timer (not
  `booking_timer_paused`) whose `booking_close_at` has passed means closed,
  one whose `booking_unlock_at` has passed means live; otherwise the phase
  set by hand counts. `src/lib/booking-phase.ts` and
  `pb_hooks/lib/phase.js` hold the same rule. An update by an admin who isn't
  a superuser must leave that phase as it is (`pb_hooks/cozy_phase.pb.js`).

## Location templates

A template is the camp's structure as JSON: houses with their map positions,
rooms, beds and what each place is like. It contains no personal data, so
layouts can be kept in Git. The format is described in
[Layout templates](../admin/templates#file-format) (`format`
`cozynights-layout`, version `2.2`; version `2.1`, `2.0` and `1.0` files are
still read).

- **Details:** `kind`, `features` and `description` of a house or room, a
  spot's `bed_type` and what a room or spot switched off (`features_off`, see
  above) travel with the layout, and so does a bunk bed: each of its two spots
  carries `bunk_partner`, the **label** of the other one. They are written
  only when they are set, so a layout nobody described exports as it always
  did, and a place that inherits everything looks as it did in version `2.1`.
  The catalogue of allowed values is `src/lib/accommodation.ts` — one fixed,
  venue-independent list, because the ♿ matching, the map filters and the
  roulette wishes read meaning out of it. Anything true for one venue only belongs in `description`.
- **Export:** admin dashboard → TEMPLATES → download (any approved admin).
- **Compare & import:** any admin can compare a file with the camp; superusers
  apply the chosen differences, only in Staging Mode. Houses are matched by
  name, rooms by `room_number` within the house, beds by `label` within the
  room (case-insensitive). The logic is pure code in `src/lib/template-diff.ts`;
  `src/lib/server/template.ts` applies it.
- **Order of the writes:** a PocketBase backup, then new records top down (on
  a failure everything created is deleted again and nothing else happens),
  then updates, then removals bottom up (beds, rooms, houses), then the bunk
  pairings of the chosen spots, once both spots of a pair exist (a partner is
  named by label; the file's check completes a pairing written on one spot
  only and fills in missing levels). Beds that are not removed keep their
  bookings; removed booked beds release their booking and the order's burner
  name is cleared.
- **Coordinates:** `x`/`y` are positions in the map's 1000 × 700 coordinate
  space, drawn over the built-in map image (`static/lageplan-brahmsee-2026-v2.jpg`,
  swapped once a year: see [The map image](../develop/#the-map-image)). The
  image is not part of the template; `map.image` only records which one a
  layout was made for, and importing a layout made for another one shows a
  warning to check the pins.

## Known gaps

- The ticket roster (`orders`) is loaded on the admin Tickets page (superusers)
  or with `cozy-admin tickets import`; there is no unique index on
  `order_number`, so the app refuses codes that exist twice or differ only in
  upper and lower case instead.
- `order_number` is still stored in plain text next to `order_hash`, for
  legacy imports (see [Security & privacy](./security)).
- A collection's OAuth2 provider settings — the Google client secret of the
  admin sign-in — sit outside PocketBase's settings encryption
  (`--encryptionEnv`), so they are part of every backup in plain text; the
  secret is rotated after the event.
