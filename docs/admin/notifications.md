# Notifications

CozyNights can tell **guests** about their booking by e-mail and, if they want, on Telegram, and it keeps the **crew** in the loop through a Telegram group. Everything is optional: without mail or Telegram settings nothing is sent and the app works as before.

## At a glance

```mermaid
flowchart LR
  guest["🛏️ Booking, move,<br/>release"] --> pb["PocketBase"]
  crew["🛠 Admin changes:<br/>freed spot, deleted room,<br/>clear all, template"] --> pb
  access["🔐 Admin access,<br/>sign-ins, Live Booking"] --> pb
  pb --> mail["📧 E-mail to the<br/>ticket's address"]
  pb --> tg["✈️ The guest's<br/>Telegram chat (optional)"]
  pb --> group["👥 Crew group<br/>on Telegram"]
```

## Guests: booking confirmations

A guest hears from CozyNights when their spot changes:

| When | Message |
| --- | --- |
| A spot is booked | **Your CozyNights spot:** house, room and spot, with a link to the room |
| The spot changes (the guest moves, or the crew moves them) | **Your CozyNights spot changed**, with the old and the new spot |
| The spot is gone (released by the guest, freed by an admin, its room or house deleted, **Clear all bookings**, a template import) | **Your CozyNights spot was released**, with a link to the map |

- **One message per change.** A move is one "changed" message, never "released" plus "booked". Changes within about ten seconds are combined, and two messages about the same ticket are at least two minutes apart.
- **E-mail goes to the address of the ticket.** Guests never type an address: it comes with the [ticket import](#ticket-codes-with-e-mail-addresses). On their room page they see where confirmations go, shortened to `m•••@example.com`.
- **Telegram is the guest's choice.** On their room page, <kbd>Get updates on Telegram</kbd> opens a chat with the CozyNights bot. After <kbd>START</kbd> the bot confirms the current spot and sends every change from then on. <kbd>Turn off</kbd> on the room page or `/stop` in the chat ends it. The link works once and for 30 minutes.
- **No secrets in messages.** They show the spot and a link, never the ticket code. Messages are in English. On staging every subject and message starts with `[STAGING]`.
- **Delivery problems are retried** after 1, 5, 15 and 60 minutes. After that the crew group gets 📭 *Could not notify ticket …* with the reason.

## Crew group

Every message here is also kept in the audit log (collection `admin_events` in the PocketBase dashboard); `./scripts/cozy-admin.sh notify status` shows the latest entries.

| Message | Sent when |
| --- | --- |
| 🛎️ Admin access request | Someone signs in to `/admin` for the first time, with the command to approve them |
| ✉️ Admin invited · ✅ approved · 🔁 role changed · 🚫 removed | Access changes, with `cozy-admin` or in the PocketBase dashboard |
| 🔐 Admin sign-in | An approved admin signs in with Google (at least once a week, see [Sessions](./access#sessions)) |
| 🎪 LIVE BOOKING switched ON · 🛠 Booking closed | Somebody flips the phase switch, with their name |
| ⏰ Go-live timer set · removed | With the opening time and who set it |
| 🎪 Booking is LIVE now | The go-live timer fired |
| 🧨 All bookings cleared | With the number of released spots |
| 🗺️ Layout template imported | With the template's size, released bookings and the backup |
| 🏚️ House deleted | Only when bookings went with it |
| 📭 Could not notify ticket | A guest message failed for good |

If Telegram is down, the messages wait and go out later.

## Ticket codes with e-mail addresses

Confirmations need the ticket holders' addresses, and they come with the ticket list. Export the list from the ticket shop as a CSV file and load it on the server:

```bash
./scripts/cozy-admin.sh tickets import roster.csv --dry-run   # check the file, change nothing
./scripts/cozy-admin.sh tickets import roster.csv             # create and update the tickets
```

The file needs a header row with a **code** column and an **email** column; a **name** column is optional. Other spellings work too (`Order code`, `Ticket`, `E-Mail`, `Attendee name`, …), and so do commas, semicolons or tabs between the columns:

```csv
code;email;name
HB-1001;ada@example.com;Ada Lovelace
HB-1002;grace@example.org;Grace Hopper
```

- **The whole file is checked first.** One broken line, and nothing is imported; the tool lists what's wrong.
- **Existing codes are updated.** A new address replaces the old one; an empty cell keeps the stored value. If the ticket already holds a spot, the new address gets a confirmation right away.
- **Nothing is deleted.** Tickets that aren't in the file stay; the tool says how many.
- **Several tickets may share one address,** for example when one person bought for friends. Each ticket gets its own messages.

A single ticket: `./scripts/cozy-admin.sh tickets add HB-1003 --email linus@example.com --name "Linus"`. `tickets list` shows the address and a Telegram link per ticket. More on codes: [Ticket codes](./event-checklist#ticket-codes).

## Setting it up

Operators put the settings into the server's `.env` (the template `deploy/staging.env.template` describes each value) and deploy again. Two rules:

- **One Telegram bot per environment.** The server reads the bot's messages itself (no public webhook), and two servers can't read the same bot. Add the bot to a **private** crew group, and turn off "Allow groups" for it in @BotFather afterwards, so nobody can add it elsewhere.
- **E-mail from an address of your own domain**, through that domain's mail provider, so the messages don't end up in spam.

Then check on the server:

```bash
./scripts/cozy-admin.sh notify status                            # what is on, queued, the latest events
./scripts/cozy-admin.sh notify test --email you@mauersegler.art  # test message to the group + a test e-mail
```

## After the event

```bash
./scripts/cozy-admin.sh tickets forget-contacts --yes
```

Deletes every guest address and Telegram link. The ticket codes stay, and so does the audit log.

## When something doesn't arrive

| What you see | Why | What to do |
| --- | --- | --- |
| `notify test`: *crew chat: FAILED — 401* | The bot token is wrong. | Check the token in `.env`. |
| `notify test`: *403* or *chat not found* | The bot isn't in the group, or the group id is wrong. | Add the bot to the group; group ids are negative numbers. |
| `notify status`: *WARNING: this bot has a webhook* | Something else registered a webhook for the bot, so the server can't read its messages. | Remove the webhook, or give this environment its own bot. |
| Guests see no <kbd>Get updates on Telegram</kbd> | No bot is set up, or `TELEGRAM_GUEST_UPDATES=off`. | `notify status`. |
| The room page shows no address | E-mail isn't set up, or the ticket has no address. | `notify status`, `tickets list`. |
| 📭 *Could not notify ticket* in the group | The address bounced or the mail server refused. | Fix the address in the ticket list and import it again. |
| Nothing at all | Look at the queue, then at the server log. | `notify status` (queued / retrying), PocketBase log lines with `[cozy-notify]`. |
