# The Control Center

After signing in you land in the **Control Center** at `/admin`: one page to build the camp, open booking and keep an eye on occupancy. Don't have access yet? Start with [Admin access & roles](./access).

![The Control Center in staging, map view](../assets/screenshots/admin-control-center.webp)

## Header

| Control | What it does |
| --- | --- |
| <kbd>ADMIN GUIDE 📖</kbd> | Opens this documentation in a new tab, admin pages included. |
| <kbd>TEMPLATES 💾</kbd> | Opens the **Burn Template Manager** to export the camp layout, or compare a layout file with the camp and take over what you pick. See [Layout templates](./templates). |
| <kbd>SHOW INTEL 📊</kbd> | Shows or hides the statistics panel. |
| <kbd>🛰️ LIST VIEW</kbd> / <kbd>🗺️ MAP VIEW</kbd> | Switches between the map editor and house cards. |

The top bar on every admin page shows <kbd>🎟️ Tickets</kbd> (find a ticket, change its e-mail address, load the ticket list; see [Tickets & e-mail addresses](./tickets)), <kbd>♿ Special needs</kbd> with the number of requests waiting for a decision (see [Special-needs requests](./special-needs)), <kbd>🎫 Check passes</kbd> (see [Booking passes](./passes)), the account you're signed in with (not on phones), a **SUPERUSER ⚡️** badge if you are one, and <kbd>Eject 🚀</kbd> to sign out. While a countdown runs, a slim bar above it shows when booking opens or closes, the same one guests see.

## Booking window

Right under the header, the **🎟 BOOKING WINDOW** panel holds everything about the phase: the current phase (🛠 Staging, 🎪 Live Booking or 🔒 Closed), the opening and closing time, the timer switch and, for superusers, the switch for *right now*. Its summary line counts down to the next switch; click it to unfold the timeline and the controls.

| You want to … | Do this | Who |
| --- | --- | --- |
| Plan when booking opens and closes | <kbd>＋ Plan window</kbd> / <kbd>✎ Edit window</kbd>, then <kbd>Save window ✨</kbd> | admins: at least one day ahead and one day open |
| Let it run by itself | Flip the switch to **Timer armed** | admins |
| Hold it | Flip the switch back (paused, the times stay) | admins |
| Open, close or go back to Staging now | <kbd>⚡ Switch right now</kbd> | superusers only |
| Release every guest booking | Happens by itself when switching back to Staging; <kbd>🧨 Clear all bookings</kbd> (same place, Staging only) for what is left | superusers only |

Times are Europe/Berlin (CET/CEST). The rules and what each switch does to the timer are in [The booking window](../guide/phases#the-booking-window).

Below it, **♿ Special-needs requests: OPEN / CLOSED** opens or closes requests for guests, independent of the phase, with <kbd>Review requests →</kbd> next to it. See [Special-needs requests](./special-needs#_2-open-requests).

## Intel panel

![Intel panel with occupancy and booking trend](../assets/screenshots/admin-intel.webp)

| Widget | Shows |
| --- | --- |
| **LOAD** | Doughnut chart: share of all spots that are taken. |
| **New Bookings · Last 7 Days** | Spots booked per day over the last week, by the day the spot got its ticket (event time). A released spot drops out; a moved booking counts on the day of the move. |
| **EMPTY HOUSES · FILLING · FULL** | How many houses have no bookings yet, some bookings, or no free spot left. |
| **PLAYA PROTOCOLS** | Quick reminders of the editor gestures below. |

## Red alert: sanity checks

When the layout has gaps, a red **RED ALERT: THE CAMP LAYOUT IS INCOMPLETE** panel (with the number of issues) lists them, each with a shortcut to fix it:

| Warning | Fix button | Where it takes you |
| --- | --- | --- |
| **This house has no rooms yet.** | <kbd>ADD ROOMS ➕</kbd> | The house page, to add rooms |
| **This room has no spots yet.** | <kbd>ADD SPOTS 🛌</kbd> | The room page, to add spots |

> [!TIP]
> During Live Booking and after booking closed, houses without any active spot don't appear on the guest map. Clear the red alert before booking opens.

## Map view: the editor

In Staging Mode the map is a live editor. A status bar reads *🛠 EDITOR ACTIVE*; during Live Booking and after booking closed it switches to *🔒 LOCKED* and the map becomes read-only.

Pins are teal while a house has free spots, red when none is left, and grey while it has no active spots at all.

| Gesture | Result |
| --- | --- |
| **Click an empty place** | Sidebar *GENERATE SANCTUARY*: name the new house and set its initial number of beds, then <kbd>IGNITE HOUSE ✨</kbd>. |
| **Drag a house** | Moves it. The new position is saved when you let go. |
| **Click a house** | Sidebar *HOUSE INTEL*: rename it (<kbd>SYNC MODULE ✨</kbd>), <kbd>MANAGE ROOMS ⚙️</kbd>, or <kbd>VANISH FROM PLAYA 🌪️</kbd> to delete it. |

![A selected house with the House Intel sidebar](../assets/screenshots/admin-house-selected.webp)

## List view: house cards

![House cards in list view](../assets/screenshots/admin-list-view.webp)

Every house as a card with its occupancy badge (*n spots free*, *Fully booked* or *Not setup*), **Spots Claimed** with a progress bar, and its map coordinates. Locked spots never count as free, and deactivated spots don't count at all.

- Click a card to manage its rooms.
- <kbd>VANISH 🌪️</kbd> deletes the house after a confirmation.
- <kbd>RENAME ✏️</kbd> and the **Ignite New House** card switch to the map view and open the editor sidebar there. A new house starts in the middle of the map (500/350), ready to be dragged into place.

## During Live Booking and after it closed

![Control Center during Live Booking](../assets/screenshots/admin-live.webp)

The Control Center stays fully usable for watching: statistics, occupancy, template export. Structural buttons are greyed out and refused by the server. The one thing you can still change is locking single spots, on the [room page](./camp-layout#spots).

## Next

- [Houses, rooms & spots](./camp-layout): building the camp in detail
- [Tickets & e-mail addresses](./tickets): find a ticket, fix its address, hand it over, load the ticket list
- [Layout templates](./templates): export, compare and import
- [Notifications](./notifications): booking e-mails, Telegram for guests and the crew group
- [Booking passes](./passes): checking guests in with the QR code
- [Event checklist](./event-checklist): from the first layout to after the burn
- [Legal pages](./legal): legal notice, privacy policy and booking rules
