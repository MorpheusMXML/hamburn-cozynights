# Event checklist

From an empty map to the morning after: everything the crew does in CozyNights for one burn, in order. Tick the boxes as you go; your browser remembers them.

```mermaid
timeline
  section 🛠 Staging
    Weeks before : Build or import the layout : Check spot states, clear the red alert : Mark special-needs spots, open requests
    Days before : Load tickets, test with a code : Book special-needs spots : Plan the booking window, arm the timer
  section 🎪 Live Booking
    Opening day : Guests book their beds
  section 🔒 Closed
    Closing time : Spots are final
    During the event : Watch occupancy : Lock broken beds
  section 🌅 After the burn
    Morning after : Export the layout : Back to staging, clear bookings
```

## Weeks before: build the camp

- [ ] **Admin access sorted.** Everyone on the crew has signed in once and been approved. See [Admin access & roles](./access).
- [ ] **Start from last year.** A superuser drops last year's template on *Compare & Import* and applies it, or you build from scratch. See [Layout templates](./templates).
- [ ] **Houses on the map.** Every house is placed where it really is. See [Houses, rooms & spots](./camp-layout).
- [ ] **Rooms and spots complete.** Room names and numbers match the signs on the doors.
- [ ] **Spot states checked.** New spots are active right away. Deactivate ❄️ the ones that aren't in use; after a template import, look for ⚪️ INACTIVE spots that should be bookable.
- [ ] **Red alert gone.** No _NO ROOMS DETECTED_ or _EMPTY MODULE_ warnings in the Control Center.
- [ ] **Crew beds locked.** Beds that guests shouldn't book are locked 🔒.
- [ ] **Special-needs spots marked.** Spots that suit guests with special needs (lower bunks, step-free, quiet, near a toilet, with a socket) are marked ♿ on their room pages. See [Special-needs requests](./special-needs).
- [ ] **Special-needs requests opened** in the Control Center, once the tickets are loaded, and announced to guests together with the booking date.
- [ ] **Backup.** Export a template of the finished layout.

## Days before: get ready to open

- [ ] **Ticket codes created.** Test codes for a trial run with testers, the real roster for the event, **with the ticket holders' e-mail addresses** for the confirmations. A superuser loads the ticket shop's list on the [Tickets](./tickets) page; test codes come from the server, see [Ticket codes](#ticket-codes).
- [ ] **Notifications checked.** `./scripts/cozy-admin.sh notify test --email you@mauersegler.art` reaches the crew group and your inbox; one booking with a test code brings a confirmation. See [Notifications](./notifications).
- [ ] **Test run.** Sign in with a real test ticket code in a private browser window. The map shows the countdown, rooms show the right spots.
- [ ] **Test bookings removed.** If you booked in staging, release those spots again.
- [ ] **Legal pages complete.** The legal notice, the privacy policy and the booking rules show no red note. See [Legal pages](./legal).
- [ ] **Special-needs requests decided.** Every request at ♿ **Special needs** is approved with a spot or declined before booking opens. Close requests when you want no more, and switch unneeded ♿ spots back to normal.
- [ ] **Booking window planned.** In the Control Center's 🎟 BOOKING WINDOW panel, set when booking opens and when it closes (Europe/Berlin time), save, and arm the timer. Admins need at least one day ahead and one day open. Announce the same times to guests. See [The booking window](../guide/phases#the-booking-window).

> [!TIP] Announce the ticket code, not a password
> Guests only need the link to CozyNights and their ticket code. Nobody needs to register.

## Opening day

- [ ] **Watch the switch.** At the opening time the panel turns 🎪 LIVE BOOKING by itself, and guests see the countdown to the closing time at the top of every page. The crew group gets *Booking is LIVE now*.
- [ ] **Need more time?** Move the closing time in the panel (at least one day from now for admins; a superuser can do anything).
- [ ] **Keep an eye on the Intel panel.** The LOAD chart and the house counters show how fast the camp fills up.
- [ ] **Be reachable.** Typical guest questions are answered in the [FAQ](../guide/faq).

## During the event

- [ ] **Check booking passes at arrival** where needed: phone camera on the guest's QR code, or 🎫 **Check passes** in the admin header (type the code or use a USB scanner). See [Booking passes](./passes).

- [ ] **Broken bed?** Lock it 🔒 on its room page. That works in every phase.
- [ ] **Resist restructuring.** Adding rooms or moving houses means a superuser switches back to staging, which freezes all guests' bookings meanwhile. Do it only when really needed, and switch back quickly.

## After the burn

- [ ] **Export the final layout** as a template for next year.
- [ ] **Switch back to staging** (superuser: ⚡ Switch right now → 🛠 Staging). Confirm the dialog; the timer is paused and **every guest booking is released** (spots free, burner names forgotten, ticket codes stay). Spots the crew booked for special-needs requests stay as long as their requests exist.
- [ ] **Clear all bookings** (superuser, in Staging Mode: 🎟 BOOKING WINDOW → ⚡ Switch right now → <kbd>🧨 Clear all bookings</kbd>) once more after **Forget the guests' contacts** below, so the special-needs spots are free too.
- [ ] **Delete the ticket list** within the period the [privacy policy](./legal) promises (default: four weeks after the event). An operator removes the codes on the server, see [Check and tidy up](#check-and-tidy-up).
- [ ] **No timer left armed**, so booking doesn't open again by accident: the panel's summary shows NO TIMER or NOT ARMED.
- [ ] **Tidy up admin access.** Remove accounts of people who have left the crew.
- [ ] **Forget the guests' contacts.** `./scripts/cozy-admin.sh tickets forget-contacts --yes` deletes every guest e-mail address, Telegram link and special-needs request; the ticket codes stay.

## Ticket codes

A ticket code is a guest's whole login, and the list of valid codes lives in the database. The real roster comes from the ticket shop: a superuser loads its CSV export on the [Tickets](./tickets) page, reviews it and picks what to take over. Everything else (test codes, single codes, removing codes) an operator does **on the server**, with the admin tool that ships with the app, the same one that [manages admin access](./access#managing-admins).

### Codes for a trial run

```bash
./scripts/cozy-admin.sh tickets generate 10 --prefix UT --name "Trial run"
```

This creates ten tickets with random codes like `UT-7F3K9Q` and prints them one per line, ready to paste into a spreadsheet or a message. The codes leave out look-alike characters (no `0` or `O`, no `1`, `I` or `L`). `--name` is a label that tells batches apart later.

### The real roster

The ticket shop's export, with e-mail addresses for the booking confirmations. In the app: 🎟️ **Tickets** → *Load the ticket list*, see [Tickets & e-mail addresses](./tickets#load-the-ticket-list). On the server:

```bash
./scripts/cozy-admin.sh tickets import roster.csv --dry-run   # check first, change nothing
./scripts/cozy-admin.sh tickets import roster.csv
```

The file format and what an import changes: [Notifications](./notifications#ticket-codes-with-e-mail-addresses). Codes without addresses work as well:

```bash
./scripts/cozy-admin.sh tickets add HB-1001 HB-1002 --name "Early bird"  # a few known codes
xargs ./scripts/cozy-admin.sh tickets add < codes.txt                     # a whole list, one code per line
```

**Only Indoor memberships.** Load the codes of Indoor memberships only: they include a bed, Camper memberships don't.

**With e-mail addresses.** To reach guests about their spot, for example when the crew has to move them, store each ticket's e-mail address as its label. From a file with one `code,email` pair per line and no header row (about a second per ticket):

```bash
tr -d '\r' < tickets.csv | while IFS=, read -r code email; do ./scripts/cozy-admin.sh tickets add "$code" --name "$email" < /dev/null; done
```

`< /dev/null` matters: the admin tool would otherwise read the rest of the file as its input. Delete `tickets.csv` from the server afterwards. `tickets list` then shows the address next to each code. Guests never see it; the privacy policy names it, and it goes with the ticket list after the event (see [After the burn](#after-the-burn)).

Codes may contain letters, digits, `-` and `_`, up to 64 characters. Stick to capitals and digits, because the sign-in field shows every code in capitals. Two codes that differ only in upper and lower case are refused. Codes that already exist are left alone, so the same list can be loaded again after late ticket sales.

### Check and tidy up

```bash
./scripts/cozy-admin.sh tickets list                        # every code: used to sign in? holds a bed?
./scripts/cozy-admin.sh tickets remove UT-7F3K9Q UT-X2M8PD  # delete codes again
```

`remove` refuses a ticket that holds a bed and names the bed. Free that spot first: in staging with 🔄 on its room page, or with **Clear all bookings**.

### Handing codes to testers

- **One code per person, sent privately.** Whoever knows a code can book and cancel with it, so don't post the list in a group chat.
- **Send the link to CozyNights along with the code.** Nothing else is needed, no account and no password.
- **Note who got which code.** Feedback like "my spot disappeared" is much easier to follow up with the code at hand.
- **Open the booking for the trial.** Testers can sign in at any time, but they can only book during 🎪 Live Booking.

### Reset between rounds

Switch **back to staging** in the Control Center, then let a superuser **clear all bookings**. All spots are free again, burner names are forgotten, and **the codes stay valid**, so the same testers can go again with the same codes. When the trials are over, `remove` the test codes before the real roster goes in.
