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
| `beds`         | `label`, `room`, `occupied`, `order`, `is_locked`, `enabled`                             | no            | admins; guest bookings via the app's service account | public read, admin write              |
| `orders`       | `order_number`, `order_hash`, `customer_name`, `burner_name` (encrypted), `email`, `pass_code` (booking pass, unique), `booking_date` | yes | the app's service account, `scripts/cozy-admin.sh tickets`; `pass_code` only by PocketBase | none (superusers only) |
| `app_settings` | the phase set by hand: `is_booking_active` (live), `booking_closed` (closed); the booking window: `booking_unlock_at`, `booking_close_at`, `booking_timer_paused`; `notify_mail`, `telegram_bot` (single record `appsettings0123`) | no | admins (a phase switch right now: superusers only); PocketBase keeps the two notification flags current | public read, admin write |
| `admins`       | `email`, `name`, `role` (`pending`, `admin`, `superuser`), `last_sign_in`                | yes (email)   | Google sign-in, `scripts/cozy-admin.sh`              | none (sign-in creates `pending` only) |
| `guest_notify` | per ticket: what was last confirmed by mail / Telegram, when the next message is due, retries, the linked Telegram chat and a one-time link token (hashed) | yes (chat id) | PocketBase hooks; the app's service account (Telegram link) | none (superusers only) |
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
- **Contact data is temporary.** `orders.email` and the Telegram links are deleted after the event with `scripts/cozy-admin.sh tickets forget-contacts --yes`.
- **Orders are the ticket roster.** No admin action deletes them: "clear all
  bookings" and the template import only release beds and clear burner names,
  so every guest's code keeps working.
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
rooms and beds. It contains no personal data, so layouts can be kept in Git.

```json
{
	"name": "Burn Location Template",
	"exported_at": "2026-09-17T12:00:00.000Z",
	"version": "1.0",
	"houses": [
		{
			"name": "Haus 1",
			"x": 100,
			"y": 200,
			"rooms": [
				{
					"name": "Main Module",
					"room_number": 1,
					"amount_beds": 2,
					"beds": [
						{ "label": "B1", "enabled": true, "is_locked": false },
						{ "label": "B2", "enabled": true, "is_locked": false }
					]
				}
			]
		}
	]
}
```

- **Export:** admin dashboard → TEMPLATES → download (any approved admin).
- **Import:** superusers only, and only in Staging Mode. It replaces all houses,
  rooms and beds. Bookings on the replaced beds are released, orders stay.
- **Coordinates:** `x`/`y` are positions in the map's 1000 × 700 coordinate
  space, drawn over the built-in map image `static/lageplan-brahmsee.jpg`.

Current limits of the import (format version `1.0`):

- It is not atomic: it deletes the old structure first, then creates records
  one by one. If it fails halfway, the structure is incomplete. Create a
  backup in the PocketBase dashboard (Settings → Backups) before importing.
- The `version` field is not checked, and malformed entries only fail during
  the import.
- The map image is not part of the template, so a layout only fits the
  built-in map.

## Known gaps

- There is no import for the ticket roster (`orders`) in the app yet.
- `order_number` is still stored in plain text next to `order_hash`, for
  legacy imports (see [Security & privacy](./security)).
- PocketBase stores its own settings, including the Google OAuth client
  secret, unencrypted in the database, so they are part of every backup.
