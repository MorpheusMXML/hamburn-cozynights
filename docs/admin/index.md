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

The top bar on every admin page shows <kbd>🎟️ Tickets</kbd> (find a ticket, change its e-mail address, load the ticket list; see [Tickets & e-mail addresses](./tickets)), <kbd>♿ Special needs</kbd> with the number of requests waiting for a decision (see [Special-needs requests](./special-needs)), <kbd>🎫 Check-in</kbd> (check guests in with their booking pass; see [Booking passes & check-in](./passes)), <kbd>✉️ Messages</kbd> (every text guests get, see [Message texts](./notifications#message-texts)), the account you're signed in with (not on phones), a **SUPERUSER ⚡️** badge if you are one, and <kbd>Eject 🚀</kbd> to sign out. While a countdown runs, a slim bar above it shows when booking opens or closes, the same one guests see.

## Booking window

Right under the header, the **🎟 BOOKING WINDOW** panel holds everything about the phase: the current phase (🛠 Staging, 🎪 Live Booking or 🔒 Closed), the opening and closing time, the timer switch and, for superusers, the switch for *right now*. Its summary line counts down to the next switch; click it to unfold the timeline and the controls.

| You want to … | Do this | Who |
| --- | --- | --- |
| Plan when booking opens and closes | <kbd>＋ Plan window</kbd> / <kbd>✎ Edit window</kbd>, then <kbd>Save window ✨</kbd> | admins: at least one day ahead and one day open |
| Let it run by itself | Flip the switch to **Timer armed** | admins |
| Hold it | Flip the switch back (paused, the times stay) | admins |
| Open, close or go back to Staging now | <kbd>⚡ Switch right now</kbd> | superusers only |
| Release every guest booking | The switch back to Staging asks: <kbd>Switch & release …</kbd> (every guest with an address or Telegram gets a *spot was released* message, unless *Don't notify the guests* is ticked — it is, once booking has closed) or <kbd>Switch & keep the bookings</kbd>; <kbd>🧨 Clear all bookings</kbd> (same place, Staging only, greyed out while no guest booking is left) does it later | superusers only |

Times are Europe/Berlin (CET/CEST). The rules and what each switch does to the timer are in [The booking window](../guide/phases#the-booking-window).

Below it, the row **♿ Special-needs requests: OPEN** (or **CLOSED**, with *· n waiting for a decision* while requests wait) opens or closes requests for guests with <kbd>Open requests</kbd> / <kbd>Close requests</kbd>, independent of the phase. <kbd>Review requests →</kbd> leads to the requests. See [Special-needs requests](./special-needs#_2-open-requests).

## Intel panel: the live picture

![Intel panel with occupancy and booking trend](../assets/screenshots/admin-intel.webp)

The panel updates itself. You don't need to reload the page to watch booking
come in: the numbers, the house cards and the map pins follow along every few
seconds, on their own.

| Widget | Shows |
| --- | --- |
| **LOAD** | The ring: how the active spots are split between taken, free, held back 🔒 and reserved ♿. The number in the middle is the share that is taken. The four slices always add up to the spots that exist. |
| **TAKEN · FREE · CHECKED IN · HELD BACK** | The same four numbers to read off, each in its own colour. *Checked in* counts guests the crew checked in at arrival, and is part of *taken*. |
| **New bookings · last 7 days** | Spots booked per day over the last week, by the day the spot got its ticket (event time). Today's bar is highlighted. A released spot drops out; a moved booking counts on the day of the move. |
| **Empty houses · Filling · Full · Not set up** | How many houses have no bookings yet, some bookings, no free spot left, or no spots at all. |
| **PLAYA PROTOCOLS** | Quick reminders of the editor gestures below. |

### Are these numbers current?

The chip next to **LIVE OPERATIONS INTEL** answers that, always:

| Chip | Meaning |
| --- | --- |
| 🟢 **Live · last change 12 s ago** | The page is talking to the server. The time is when a number last *moved*, not when it was last checked — "last change 2 h ago" on a quiet morning is normal. |
| 🟠 **Catching up…** | An answer is overdue. The page keeps trying. |
| 🔴 **No connection** | Several attempts failed. The numbers on screen are the last ones that arrived, so treat them as old. |
| 🔴 **Signed out** | Your session ran out (it does once a week). Sign in again — until then nothing updates. |

<kbd>↻</kbd> fetches immediately, for when you don't want to wait for the next
round. A tab in the background stops asking altogether and catches up the
moment you come back to it, so leaving the Control Center open on a second
screen all weekend is fine.

If another admin adds or deletes a *house* while your page is open, an orange
line offers a reload: spot numbers update by themselves, the camp layout does
not.

### The state colours

The same colour means the same thing everywhere on this page — on the ring, on
the tiles, on the house cards, on the map status bar. Anything in a state
carries a slowly breathing border in its colour, so a glance at the screen is
enough.

| Colour | State |
| --- | --- |
| 🟢 Green | **Open** — spots are free, nothing booked yet |
| 🟠 Orange | **Filling** — booked and free spots side by side |
| 🔴 Red | **Full** — nothing left to book |
| 🟣 Violet | **Held back** — locked 🔒 by the crew, not bookable |
| 🩷 Pink | **Reserved ♿** — kept for special-needs requests, and the colour of Live Booking |
| 🩵 Turquoise | **Checked in**, and the colour of Staging Mode |
| ⚪️ Grey | **Not set up** — no active spots at all |

> [!NOTE]
> A house with nothing but locked or ♿ spots left counts as **full**: a guest
> has nothing to book there. The tiles tell you why.

If animations bother you, the browser setting *reduce motion* (macOS: System
Settings → Accessibility → Display; Windows: Settings → Accessibility → Visual
effects) stops the breathing — the colours stay.

## When something is refused

Every form in the admin area — a new house, a room, a spot, a ticket's address,
the ticket search, message texts — says no the same way:

- the field to fix gets a **red border**, one soft ping and a short sideways
  nudge, and the cursor jumps into it (the first one, if several are wrong);
- the reason stands **right under the field**, starting with ⚠️;
- a refusal about the whole form (the server couldn't be reached, the layout is
  locked) appears as a **red box** above the buttons;
- a dialog that says no — *Switch not changed*, *House not deleted* — rings a
  few times in red or orange before it holds still. Dialogs that only ask
  (*Delete this house?*) stay calm.

The red disappears the moment you start correcting the field. Clicking the
button again with the same mistake nudges the field again — it never fails
silently.

### Locked: not now

During Live Booking and after booking closed, everything that changes the camp
layout is locked (see [below](#during-live-booking-and-after-it-closed)). Those
buttons and fields don't disappear: they stay where they are, **greyed out with
a small padlock**, and they still answer. Click one or type into the field and
it shakes its head once, the padlock rattles, and a small bubble next to it says
why and who can lift the lock — for example *Locked during Live Booking: … To
delete spots, a superuser has to switch back to Staging Mode first.* Spot
buttons add what works instead (*lock it 🔒*). The bubble goes away by itself
after a few seconds, with <kbd>Esc</kbd> or a click elsewhere. Hovering a
locked control shows the same title.

> [!TIP]
> On a ticket, a half-typed e-mail address isn't an error yet: the field only
> turns red once you leave it or press <kbd>Save</kbd>. <kbd>Save</kbd> stays
> clickable and tells you what's missing instead of greying out.

## Red alert: sanity checks

When the layout has gaps, a red **RED ALERT: THE CAMP LAYOUT IS INCOMPLETE** panel (with the number of issues) lists them, each with a shortcut to fix it:

| Warning | Fix button | Where it takes you |
| --- | --- | --- |
| **This house has no rooms yet.** | <kbd>ADD ROOMS ➕</kbd> | The house page, to add rooms |
| **This room has no spots yet.** | <kbd>ADD SPOTS 🛌</kbd> | The room page, to add spots |

> [!TIP]
> During Live Booking and after booking closed, houses without any active spot don't appear on the guest map. Clear the red alert before booking opens.

## Map view: the editor

In Staging Mode the map is a live editor. A status bar reads *🛠 EDITOR ACTIVE* next to an open padlock, and while an opening time is armed it says when the layout will lock. During Live Booking and after booking closed the padlock swings shut, the bar switches to *LOCKED* and the map becomes read-only: a dragged pin shakes its head and stays put, a click on an empty place starts no new house, and the *HOUSE INTEL* sidebar turns *VIEW ONLY* — name, position, <kbd>MOVE PIN</kbd> and <kbd>SYNC MODULE</kbd> greyed out, <kbd>CLOSE</kbd> instead of *ABORT*. Each of them [says why](#locked-not-now) when you try it. If the phase changes while the page is open (the timer opens booking, a superuser switches), the page locks or unlocks in place.

Pins are teal while a house has free spots, red when none is left, and grey while it has no active spots at all.

| Gesture | Result |
| --- | --- |
| **Click an empty place** | Sidebar *GENERATE SANCTUARY*: name the new house and set its initial number of beds, then <kbd>IGNITE HOUSE ✨</kbd>. |
| **Drag a house** | Moves it. The new position is saved when you let go. |
| **Arrow keys** on a selected pin | Move it one unit per press (with <kbd>Shift</kbd>: ten), saved when you let go of the key. |
| **Click a house** | Sidebar *HOUSE INTEL*: rename it (<kbd>SYNC MODULE ✨</kbd>), type an exact **MAP POSITION 📍** (X 0–1000, Y 0–700) and press <kbd>MOVE PIN</kbd>, <kbd>MANAGE ROOMS ⚙️</kbd>, or <kbd>VANISH FROM PLAYA 🌪️</kbd> to delete it. Moves are saved right away. |

![A selected house with the House Intel sidebar](../assets/screenshots/admin-house-selected.webp)

## List view: house cards

![House cards in list view](../assets/screenshots/admin-list-view.webp)

Every house as a card with its occupancy badge (*n spots free*, *Fully booked* or *Not setup*), **Spots Claimed** with a progress bar, and its map coordinates. The card's border breathes in [the colour of its state](#the-state-colours). Locked 🔒 and special-needs ♿ spots never count as free, and deactivated spots don't count at all. These numbers update live, the same way the Intel panel does.

- Click a card to manage its rooms.
- <kbd>VANISH 🌪️</kbd> deletes the house after a confirmation.
- <kbd>RENAME ✏️</kbd> and the **Ignite New House** card switch to the map view and open the editor sidebar there. A new house starts in the middle of the map (or at the nearest free place, if a pin is already there), ready to be dragged into place.

## During Live Booking and after it closed

![Control Center during Live Booking](../assets/screenshots/admin-live.webp)

The Control Center stays fully usable for watching: statistics, occupancy, template export. Structural buttons and fields stay in place, greyed out with a padlock, and [explain themselves](#locked-not-now) when you try them; the server refuses those changes too. The house, room and new-house pages say at the top whether the layout can be changed right now. What you can still change: on the [room page](./camp-layout#spots), lock or unlock single spots and mark spots ♿ special or normal; on ♿ **Special needs**, decide requests and book spots for them.

## Next

- [Houses, rooms & spots](./camp-layout): building the camp in detail
- [Tickets & e-mail addresses](./tickets): find a ticket, fix its address, hand it over, load the ticket list
- [Special-needs requests](./special-needs): mark ♿ spots, decide requests, book spots for guests
- [Layout templates](./templates): export, compare and import
- [Notifications](./notifications): booking e-mails, Telegram for guests and the crew group, [message texts](./notifications#message-texts)
- [Booking passes & check-in](./passes): checking guests in with the QR code, the spot states, undoing a check-in
- [Event checklist](./event-checklist): from the first layout to after the burn
- [Legal pages](./legal): legal notice, privacy policy and booking rules
