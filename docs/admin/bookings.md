# Bookings & check-ins

Who booked which spot, who is already on site, who is still on the road. Open it with <kbd>🛏️ Bookings</kbd> in the admin menu (group *Guests*). The same booking also shows on the spot itself: on the room page, on the house page and next to the map. For the tickets that hold *no* spot, and for everything else attached to a ticket — messages, wallet passes, the state of a special-needs request — see [Guests: every ticket at a glance](./guests).

## At a glance

| Where | What you see |
| --- | --- |
| <kbd>🛏️ Bookings</kbd> (`/admin/bookings`) | Every booked spot of the camp as one list, with filters, search and <kbd>Check in</kbd> / <kbd>Undo</kbd>. |
| Control Center, **BOOKINGS & CHECK-INS 🛏️** | The four counts and the five latest bookings — after booking closed, the five latest check-ins. |
| Room page, on each spot card | Who holds the spot, when it was booked, the check-in, <kbd>Open ticket →</kbd>. |
| House page, **🛏️ Who is here** | The house's bookings room by room (folds away). |
| <kbd>🗺️ Map & houses</kbd>, a house's sidebar | **WHO IS HERE 🛏️**: the house's bookings room by room, short; point at one for the details. |
| Intel panel | <kbd>Who booked →</kbd> next to *SPOTS & BOOKINGS* opens the list for the house you picked; *… booked guests are not checked in yet* leads to the ones still to arrive. |
| <kbd>👥 Guests</kbd> (`/admin/guests`) | Every ticket, with or without a spot, and next to the spot its check-in, request state, messages and wallet passes. See [Guests](./guests). |

## What a booking shows

A booking is shown the way the [check-in desk](./passes#checking-guests-in) shows a guest — enough to recognise them, never enough to sign in as them:

| Shown | Example | Not shown |
| --- | --- | --- |
| The ticket holder's name | *Mia Muster* | Names like *Ticket HB-1002* (the default of a ticket without a name): the list says *Ticket H•••* instead |
| The burner name | *🔥 Sparkle* | |
| The e-mail address, masked | *m•••@example.org* | The full address |
| The ticket code, masked | *Ticket H•••* (long codes: *LAY•••69*) | The full code — it signs the guest in and can change their booking |
| When the spot was booked | *Mon 21 Sep · 14:02* | |
| The check-in: when and by whom | *✅ Mon 21 Sep · 18:30 by crew@…* | |
| ♿ *assigned through a request* | | What the guest wrote in the request |

The colour says the state, the same way as [everywhere else](./index#the-state-colours): **red** 🎟 *Booked* (the ticket holds the spot), **turquoise** ✅ *Checked in*, **violet** 🛠 *Crew* — marked 🔄 TAKEN on the room page, without a ticket. A spot that is deactivated or 🔒 locked for guests but still holds a booking says so; the booking stands.

<kbd>Open ticket →</kbd> (<kbd>Ticket →</kbd> in the list) opens the full ticket card in [Tickets](./tickets): address, pass code, hand-over. The code stays hidden there too, like for a ticket found by its address — search for the code if you need it in full.

## The bookings list

The four counts on top are also the filter: <kbd>booked</kbd> shows everything, <kbd>checked in</kbd>, <kbd>still to arrive</kbd> and <kbd>held by the crew</kbd> (taken without a ticket, or ♿ assigned) only those. Next to them:

| Field | Does |
| --- | --- |
| **House** | One house, or all. The counts follow it. |
| **Show** | The same four filters as the counts. |
| **Order** | *House · room · spot*, *Newest booking first*, *Latest check-in first* or *Guest name*. |
| **Find a guest or spot** | Every word must appear in the holder's name, the burner name, the spot, room or house; accents don't matter (*walder* finds *Wälderhaus*). |

House, filter and order stay in the address, so a reload or a link from a colleague opens the same view. What you type in the search doesn't: guest names don't belong in any server log.

The list opens with what fits the [phase](../guide/phases):

| Phase | Opens with | Why |
| --- | --- | --- |
| 🛠 Staging | Everything, by house · room · spot | No guest has booked yet: what shows are spots the crew holds and test bookings. |
| 🎪 Live Booking | Everything, newest booking first | Bookings, moves and releases come in all the time. |
| 🔒 Closed | *Still to arrive*, by house · room · spot | The guests arrive: who is still missing? |

**It updates itself.** While the page is open it follows the live numbers of the [Intel panel](./#are-these-numbers-current): when a booking, a move, a release or a check-in happens, the list is fetched again within seconds. The line under the filters says *live*, or that the connection is gone and the list may be out of date.

## Checking a guest in from the list

The usual way is the booking pass at the [check-in desk](./passes#checking-guests-in). For a guest whose phone is dead and who has no pass with them, the list does the same:

1. Find them: search for their name, or filter *still to arrive*.
2. <kbd>Check in</kbd> → the dialog shows name and spot once more. Compare the name with the guest — without the pass, this is the only check — and confirm.
3. Wrong guest? <kbd>Undo</kbd> takes the check-in back (after a confirmation); the booking stays and the crew chat gets a note, like an undo at the desk.

The same rules as at the desk apply: only approved admins and superusers can do it, it is written with your own admin session, and a guest who is checked in can no longer give up the spot themselves. A ticket that holds no spot any more (released or moved meanwhile) is refused with a note, and the list is reloaded.

## Privacy

- Everything here is for approved admins only. Without a session, `/admin/bookings`, the room and house pages and the data behind them (`/admin/api/bookings`) send you to the sign-in or answer *403*.
- The live numbers of the Intel panel stay numbers: the names are fetched only by the pages that show them, and only after something changed, never with every tick of the poll.
- Browsers and proxies are told not to keep the answers (`no-store, private`).
- A request's text, a guest's full address and a full ticket code never appear in any of these views.
