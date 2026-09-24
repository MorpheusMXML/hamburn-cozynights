# Guests: every ticket at a glance

One row per ticket, with everything that belongs to it: the spot, the check-in, where a special-needs request stands, which messages went out, whether the pass is in a wallet, and the ticket's own history. Open it with <kbd>👥 Guests</kbd> in the admin menu (group *Guests*, `/admin/guests`).

The page **changes nothing**. Every row only links to the page that does: the ticket card, the room, the requests.

> [!TIP] Bookings or Guests?
> [Bookings & check-ins](./bookings) lists **spots** that hold a ticket and has the <kbd>Check in</kbd> / <kbd>Undo</kbd> buttons. Guests lists **tickets** — the ones without a spot too — and is where you look when the question is about a guest rather than a bed: *did they get their e-mail?*, *who has no address?*, *whose wallet pass is failing?*

## What a row shows

| Column | What you see |
| --- | --- |
| **Guest** | The ticket holder's name, else the burner name, else *Ticket H•••*. Under it 🔥 the burner name (when the ticket has both), the masked e-mail address and the masked ticket code: *m•••@example.org · Ticket H•••*. Tags: *no e-mail address* (red), ♿ *request waits for a decision*, ♿ *request approved* (pink), ♿ *request declined* (grey). |
| **Spot** | *B1 · Blue Room #2 · Villa*, linked to the room page, and *booked Mon 21 Sep · 14:02*. ♿ *assigned through a request* when the crew booked it for a request, ♿ *special-needs spot* when it is one. Without a spot: *No spot*. |
| **Check-in** | ✅ with the time and *by crew@…*; *not yet* while the spot waits for the guest; — without a spot. |
| **Messages** | ✉️ *mailed to m•••@…* once a booking e-mail went to that address, else ✉️ *no e-mail sent*. 💬 *Telegram linked* when a chat is connected. ⏳ *message queued* while one waits to be sent or retried, ⚠️ *delivery failed* when the last one could not be delivered and is not retried any more. See [Notifications](./notifications#when-something-doesn-t-arrive). |
| **Wallet** | *Apple Wallet · up to date* / *Google Wallet · up to date* when the pass in the wallet is the ticket's current pass; *old pass* when the ticket got a new pass code since (a [hand-over](./tickets#a-ticket-passed-on-to-someone-else)); *update failing* when the wallet could not be told about the last change. — when the guest never added the pass. See [Wallet passes](./passes#wallet-passes-apple-wallet-google-wallet). |
| **Ticket** | *imported* when the ticket list brought it, *handed over 3 days ago* if it was passed on, and *signed in* or *never signed in*. |
| **Links** | <kbd>Ticket →</kbd> opens the full ticket card on [Tickets](./tickets) (address, pass code, hand-over). <kbd>Room →</kbd> opens the spot's room page. <kbd>Requests →</kbd> leads to the [requests page](./special-needs#_3-decide-and-book) when the ticket has a request. |

The row's left edge carries [the state colour](./index#the-state-colours): **turquoise** the guest is checked in, **red** the ticket holds a spot, **grey** it holds none — **orange** once booking has closed, because then a ticket without a spot needs the crew. A line above the tiles says what the list means in the current phase.

## What is masked, and why

A guest is shown the way the [check-in desk](./passes#checking-guests-in) and the [bookings list](./bookings#what-a-booking-shows) show them — enough to recognise them, never enough to sign in as them:

| Shown | Not shown |
| --- | --- |
| The holder's name and the burner name | Names like *Ticket HB-1002* (the default of a ticket without a name): the row says *Ticket H•••* instead |
| The e-mail address, masked: *m•••@example.org* | The full address |
| The ticket code, masked: *H•••* (long codes: *LAY•••69*) | The full code — it signs the guest in and can change their booking |
| That a request exists and how it was decided | What the guest wrote or ticked: that stays on the [requests page](./special-needs), for admins, and nowhere else |
| That a message went out, waits or failed | The message itself, or the Telegram chat |
| That the pass is in a wallet, and whether it is current | The pass code or serial |

Names and addresses are read by the page itself and by its own endpoint only; the [live numbers](./index#are-these-numbers-current) that every admin page polls stay numbers.

## Tiles, filters and search

The eight counts on top are buttons: press one and the list narrows to it, press it again for all tickets. They carry the state colours too — *with a spot* red, *checked in* turquoise, *no e-mail* red as a warning, *♿ open requests* pink; *without a spot* is grey while booking runs and orange once it has closed.

| Tile | Counts |
| --- | --- |
| **tickets** | Every ticket |
| **with a spot** / **without a spot** | Tickets that hold a spot / hold none |
| **checked in** | Guests the crew checked in at arrival |
| **no e-mail** | Tickets without an address: nobody can e-mail them |
| **♿ open requests** | Special-needs requests waiting for a decision (approved and declined ones show as tags on the rows, and are reached with <kbd>Requests →</kbd>) |
| **Telegram** | Tickets with a linked Telegram chat |
| **wallet pass** | Tickets whose pass is in Apple Wallet or Google Wallet, current or not |

Next to them:

| Field | Does |
| --- | --- |
| **House** | One house, or all. Tickets without a spot belong to no house, so they only show under *All houses*; the counts follow the choice. |
| **Show** | The tiles' filters, plus *Got an e-mail* (the address got a booking e-mail) and *Handed over* (the ticket was passed on to somebody else). |
| **Order** | *Guest name* (named tickets first, then the ones that only have a code), *Newest booking first* or *Newest ticket first*. |
| **Find a guest or spot** | Every word must appear in the holder's name, the burner name, the spot, room or house; accents don't matter (*walder* finds *Wälderhaus*). The search never looks at e-mail addresses or ticket codes: both are masked in the rows, and a box that finds a code would be a way to guess one. |
| <kbd>↻ Refresh</kbd> | Asks the server for the list again, right now (see below). |

The list opens with what fits the [phase](../guide/phases): during Live Booking the newest bookings first, otherwise by name, the way the crew looks people up. House, filter and order stay in the address (`?house=…&show=nospot&sort=booked`), so a reload or a link from a colleague opens the same view; what you type in the search doesn't, because guest names don't belong in any server log.

## Live refresh and its limits

While the page is open it follows the [live numbers](./index#are-these-numbers-current) like the bookings list: a booking, a move, a release or a check-in anywhere in the camp fetches the rows again within seconds, and the line under the filters says *live* — or *no connection, the list may be out of date*, or *the last update failed*.

Some changes don't move those numbers: a **hand-over**, a **new e-mail address**, a **linked Telegram chat**, a **pass added to a wallet** or a message that went out. For them the page asks again whenever its tab comes back to the front, and <kbd>↻ Refresh</kbd> asks right now. So after fixing an address on [Tickets](./tickets), come back to the tab or press <kbd>↻ Refresh</kbd>.

## Where it is linked from

- The admin menu: <kbd>👥 Guests</kbd>, the first entry of the *Guests* group.
- The Control Center's *Needs attention*: 🎟 *… tickets have no spot yet* (Live Booking) and *… have no spot, and booking is closed* open the list narrowed to them (<kbd>Who</kbd>), 📭 *… tickets have no e-mail address* to the ones without an address (<kbd>Which</kbd>).
- The Intel panel: <kbd>Guests →</kbd> next to *SPOTS & BOOKINGS* opens the list for the house you picked.
- <kbd>Ticket →</kbd> on the [bookings list](./bookings) and here lead to the same ticket card.

## When something looks wrong

| What you see | Why | What to do |
| --- | --- | --- |
| *No tickets yet. Load the ticket list on the tickets page.* | No ticket has been imported. | A superuser [loads the ticket list](./tickets#load-the-ticket-list). |
| *No ticket matches … Try another filter.* | Filter, house and search together leave nothing. | Press the pressed tile again, choose *All houses*, clear the search. |
| *The guest list could not be read from the database. Reload the page in a minute.* | PocketBase didn't answer. | Reload; if it stays, look at the server. |
| A hand-over or a new address is missing | Those don't move the live numbers. | Come back to the tab or press <kbd>↻ Refresh</kbd>. |
| *Apple Wallet · update failing* | The last change could not be pushed to the wallet. | See [Wallet passes: when something doesn't work](./passes#when-something-doesn-t-work-1). |

## Privacy

- For approved admins only. Without a session, `/admin/guests` sends you to the sign-in and the data behind it (`/admin/api/guests`) answers *403*.
- Browsers and proxies are told not to keep the answers (`no-store, private`).
- A request's text, a guest's full address, a full ticket code, a pass serial or a Telegram chat id never appear here.
- Nothing is written from this page.
