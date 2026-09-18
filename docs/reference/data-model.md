# Data model & location templates

PocketBase holds only live data: ticket codes, bookings and admin accounts.
Everything that can be rebuilt lives in Git: the schema (`pb_migrations/`),
hooks (`pb_hooks/`) and location layouts as template files. Where each kind of
data lives and how it is backed up: [Backups and where data lives](../develop/deployment#backups-and-where-data-lives).

## Collections

| Collection     | Holds                                                                                    | Personal data | Written by                                           | API rules                             |
| :------------- | :--------------------------------------------------------------------------------------- | :------------ | :--------------------------------------------------- | :------------------------------------ |
| `houses`       | `name`, `x`, `y` (map position)                                                          | no            | admins                                               | public read, admin write              |
| `rooms`        | `name`, `room_number`, `house`, `amount_beds`                                            | no            | admins                                               | public read, admin write              |
| `beds`         | `label`, `room`, `occupied`, `order`, `is_locked`, `enabled`, `is_special` (special-needs spot) | no      | admins; guest bookings via the app's service account | public read, admin write              |
| `orders`       | `order_number`, `order_hash`, `customer_name`, `burner_name` (encrypted), `email`, `pass_code` (booking pass, unique), `booking_date` | yes | the app's service account, `scripts/cozy-admin.sh tickets`; `pass_code` only by PocketBase | none (superusers only) |
| `app_settings` | `is_booking_active`, `booking_unlock_at`, `notify_mail`, `telegram_bot`, `special_requests_open` (single record `appsettings0123`) | no | admins; PocketBase keeps the two notification flags current | public read, admin write |
| `admins`       | `email`, `name`, `role` (`pending`, `admin`, `superuser`), `last_sign_in`                | yes (email)   | Google sign-in, `scripts/cozy-admin.sh`              | none (sign-in creates `pending` only) |
| `guest_notify` | per ticket: what was last confirmed by mail / Telegram (spot and special-needs request), when the next message is due, retries, the linked Telegram chat and a one-time link token (hashed) | yes (chat id) | PocketBase hooks; the app's service account (Telegram link) | none (superusers only) |
| `special_requests` | per ticket at most one: `order`, `status` (`pending`, `approved`, `declined`), `needs`, `reason` and `burner_name` (all three encrypted), `consent_at`, `decided_by`, `decided_at`, `bed` (the spot the crew booked for it) | yes (often health data) | the app's service account | none (superusers only) |
| `admin_events` | audit log: `action`, `actor`, `subject`, `details`, crew alert state                      | yes (admin emails) | PocketBase hooks; the app's service account      | none (superusers only)                |

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
- **Guest messages follow the beds.** Every change of a bed's `order` (a booking, a move, a release, a deleted room) marks the ticket in `guest_notify` as due; PocketBase then sends one message per settled state. See [Notifications](../admin/notifications).
- **Contact data is temporary.** `orders.email`, the Telegram links and all special-needs requests are deleted after the event with `scripts/cozy-admin.sh tickets forget-contacts --yes`.
- **One special-needs request per ticket** (unique index on `special_requests.order`); it goes with its ticket (cascade). The app takes the ticket from the guest's session, encrypts what the guest wrote and never logs it. See [Special-needs requests](../admin/special-needs).
- **Orders are the ticket roster.** No admin action deletes them: "clear all
  bookings" and the template import only release beds and clear burner names,
  so every guest's code keeps working. A ticket handed over to a new holder
  (Tickets page) keeps its bed and code; its `pass_code` and `burner_name`
  are cleared and its Telegram link is removed.
- **While booking is live**, the structure is locked on the server: houses
  and rooms can't be added, moved, renamed or deleted, beds can't be added or
  deleted, and templates can't be imported (see [Staging & Live Booking](../guide/phases)).

## Location templates

A template is the camp's structure as JSON: houses with their map positions,
rooms and beds. It contains no personal data, so layouts can be kept in Git.
The format is described in [Layout templates](../admin/templates#file-format)
(`format` `cozynights-layout`, version `2.0`; version `1.0` files are still read).

- **Export:** admin dashboard → TEMPLATES → download (any approved admin).
- **Compare & import:** any admin can compare a file with the camp; superusers
  apply the chosen differences, only in Staging Mode. Houses are matched by
  name, rooms by `room_number` within the house, beds by `label` within the
  room (case-insensitive). The logic is pure code in `src/lib/template-diff.ts`;
  `src/lib/server/template.ts` applies it.
- **Order of the writes:** a PocketBase backup, then new records top down (on
  a failure everything created is deleted again and nothing else happens),
  then updates, then removals bottom up (beds, rooms, houses). Beds that are
  not removed keep their bookings; removed booked beds release their
  booking and the order's burner name is cleared.
- **Coordinates:** `x`/`y` are positions in the map's 1000 × 700 coordinate
  space, drawn over the built-in map image `static/lageplan-brahmsee.jpg`.
  The map image is not part of the template, so a layout only fits the
  built-in map.

## Known gaps

- The ticket roster (`orders`) is loaded on the admin Tickets page (superusers)
  or with `cozy-admin tickets import`; there is no unique index on
  `order_number`, so the app refuses codes that exist twice or differ only in
  upper and lower case instead.
- `order_number` is still stored in plain text next to `order_hash`, for
  legacy imports (see [Security & privacy](./security)).
- PocketBase stores its own settings, including the Google OAuth client
  secret, unencrypted in the database, so they are part of every backup.
