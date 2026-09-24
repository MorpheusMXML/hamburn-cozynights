# Booking a bed

All you need is the **ticket code** from your Hamburn ticket. There is no account to create and no password: your ticket code *is* your registration. Confirmations go to the e-mail address that belongs to your ticket.

Beds come with **Indoor memberships** only. Camper memberships (camper or tent) don't include a bed and don't need CozyNights.

> [!NOTE] Booking opens and closes at set times
> Before booking opens, the start page and the (still blurred) map count down to the start. You can already sign in with your code. While booking is open, a countdown on every page shows when it closes; after that, spots are final.

## At a glance

```mermaid
flowchart LR
  code["🎫 Ticket code"] --> map["🗺️ Camp map"]
  map --> pick["🛖 House → 🚪 Room<br/>→ 🛏️ free spot"]
  pick --> name["✍️ Burner name<br/>(optional)"] --> done["✅ Your Spot"]
  map --> roulette["🎰 Destiny<br/>Roulette"] --> done
```

## Step by step

<div class="steps">

1. **Enter your ticket code**

   Open the CozyNights start page, type your code into the **TICKET CODE** field and press <kbd>ENTER THE DUST 🌵</kbd>. (The small `v0.18.1` at the top right of the title is the version you are looking at; it helps when you report a problem.)

   If the code is refused, the box around it turns red and gives a short shake, the reason appears right under it, and the cursor is back in the field — fix the code and press the button again. The [FAQ](./faq#for-guests) explains every message.

   ![Start page with the ticket code field](../assets/screenshots/guest-landing.webp)

   Your browser remembers the code for 30 days. Back on the start page later, <kbd>Already signed in on this device? Continue to the map →</kbd> takes you straight to the map, and <kbd>Not your ticket? Sign out</kbd> removes the code from this device (see [Shared devices](#shared-devices)).

2. **Find a house on the map**

   Every pin is a house. **Teal** pins still have free spots, **red** pins have none left that you could book. Click a pin to open the house.

   ![Camp map during Live Booking](../assets/screenshots/guest-map-live.webp)

   The badge at the top shows the phase: 🎪 LIVE BOOKING, 🛠 STAGING MODE or 🔒 BOOKING CLOSED. Next to it are ♿ **Special-needs spot** (while the crew takes [special-needs requests](./special-needs)) and **Help & FAQ**. <kbd>🎰 DESTINY ROULETTE</kbd> at the bottom picks a spot for you (see [Destiny Roulette](#destiny-roulette)).

3. **Choose a room**

   The house page lists its rooms with the number of free spots. Full rooms are marked **Full**.

   ![House page with room cards](../assets/screenshots/guest-house.webp)

4. **Grab a free spot**

   Inside the room every spot shows its state (see the table below). Click an **Available** spot.

   A **bunk bed** shows as one stacked card: the upper bunk on top, a small ladder, the lower bunk below. Each half is a spot of its own, with its own state, and is booked on its own. A chip next to the label says **Upper bunk** or **Lower bunk**, and the line under it where the other level is (*above B1*, *below B2*); the booking dialog repeats it: *Spot B2 — the upper bunk above B1.*

   ![Room page with free, occupied and reserved spots](../assets/screenshots/guest-room-available.webp)

5. **Pick a burner name and book**

   Type the name other guests should see on your bed (up to 80 characters) and press <kbd>Save Spot</kbd>. Or leave the field empty and press <kbd>Save Spot</kbd> anyway: a slot machine rolls a burner name for you (something like *Cosmic Coyote #562*). <kbd>New Name 🎲</kbd> rolls again, <kbd>Accept Fate & Book 🌵</kbd> books the spot.

   ![Booking dialog with the burner name field](../assets/screenshots/guest-booking-modal.webp)

</div>

That's it: fireworks go up from your new spot 🎆, and the spot now shows **Your Spot** with your burner name. Above the spots, a **Welcome Home!** box holds your [booking pass](#your-booking-pass), the address your [confirmations](#confirmations) go to and the Telegram option.

## What the spots mean

| Spot card | Meaning |
| --- | --- |
| **Available** · *Grab it now!* | Free. Click it to book. |
| **Your Spot** · *your burner name* | That's you. Click it to rename it (any time until booking closes) or to release it (during Live Booking). |
| **Occupied** · *a burner name* | Taken by another guest. *Mystery Burner* means the spot has no name: the crew holds it, or its ticket changed hands. |
| **Not available** · *Reserved by the crew* | Held back by the crew, for example a broken bed, a spot that isn't in use or one kept for [guests with special needs](./special-needs). |
| **Unavailable** · *Release your other spot first* | You already have a spot somewhere else. One ticket code = one spot. |
| **Not open yet** · *Booking opens soon* | Booking hasn't opened yet. |
| **Booking closed** · *Spots are final* | The booking window is over. |

![A booked room: the Welcome Home box with the booking pass, the e-mail address and Telegram; your spot, other guests' burner names and spots reserved by the crew](../assets/screenshots/guest-room.webp)

## What a place is like

Houses and rooms can carry a few details, and spots say what kind of bed they are:

| You see | Meaning |
| --- | --- |
| 🏠 House · 🛖 Hut group · ⛺ Tent area | What the place on the map is. A hut group is one pin with several huts; the map pin carries the icon, and the house page then asks you to choose a **hut**. |
| ♿ Wheelchair accessible · ⬇️ Ground floor | A step-free way in with an accessible bathroom, or no stairs to the bed. |
| 🚻 Toilets + showers inside · 🛁 Own bathroom | In the building itself, or in the room. Nothing written means the toilets are somewhere else on the site — the description usually says where. |
| 🔥 Heated · ❄️ No heating | Late October nights are cold; this is worth reading. |
| 🤫 Quiet zone · 🔌 Power socket | A calm corner of the camp; a socket in the room or at the bed. |
| *Lower bunk · Upper bunk · Single bed · Double bed (shared) · Sofa · Mattress · Camp bed* | What you actually sleep in, under the spot's label. In a stacked bunk bed the level is on the chip next to the label, and the line says *above B1* or *below B2* instead. |

A room shows what its house says too, and the crew can add a sentence of their own ("Showers in the wash house, 50 m along the path").

> [!NOTE] Nothing is invented
> The app only shows what the crew filled in. An empty spot card means *nobody said*, not *no* — ask the crew if a detail matters to you. If you need a particular kind of spot, [ask for a special-needs spot](./special-needs) instead of guessing.

## Looking for something special?

Above the map, **Looking for…** turns your wishes on and off: <kbd>🛏️ No ladder</kbd>, <kbd>⬇️ Step-free</kbd>, <kbd>🚻 Toilets inside</kbd>, <kbd>🔥 Heated</kbd>, <kbd>🤫 Quiet</kbd>, <kbd>🔌 Power socket</kbd>.

- Houses without a fitting free spot fade back, and the bar says how many houses are left.
- Open a house and each room tells you how many of its free spots fit.
- The wishes are part of the address, so a filtered map can be shared or bookmarked. <kbd>Clear</kbd> shows everything again.

Only spots the crew described can match, so a wish never promises more than the crew wrote down.

## Destiny Roulette

Can't decide? On the map press <kbd>🎰 DESTINY ROULETTE</kbd>. A neon slot machine waits with three reels, **House**, **Room** and **Spot**: grab its lever, pull it down and let go, or press <kbd>SPIN 🎰</kbd>. The reels stop one after the other on a random free spot anywhere in the camp. Every free spot has the same chance; how hard you pull only changes how long the reels run.

**The reels respect…** on the machine, right under the reels, takes the same wishes as the map: tap <kbd>🛏️ No ladder</kbd> or <kbd>🔥 Heated</kbd> and only fitting spots go into the drum. The line next to the chips says how many that is. If none fits, the machine says so and offers <kbd>Spin without wishes</kbd>.

Then the burner name that goes with the spot:

- If your ticket already has a burner name, it is filled in. Keep it or change it.
- Type your own name into **Your burner name**, or press <kbd>🎲</kbd> to roll one (something like *Cosmic Coyote #562*). A rolled name can still be changed.
- <kbd>SPIN AGAIN 🎰</kbd> spins for another spot and keeps the name.
- <kbd>BOOK IT 🌵</kbd> books the spot. With the name field empty, the first tap rolls a name; the next one books.

*Destiny Fulfilled!* Fireworks go up and your [booking pass](#your-booking-pass) prints out on the card, with <kbd>Visit My Room</kbd> and <kbd>Back to Map</kbd>.

The 🔈 button on the machine turns its sounds on: lever, reels and the jackpot jingle. They are off until you turn them on, and the machine remembers your choice on that device.

![Destiny Roulette after a spin: the spot on the three reels, the name plate with the dice, BOOK IT and SPIN AGAIN](../assets/screenshots/guest-roulette.webp)

The roulette button is only on the map during Live Booking. Opened at another time, the machine rests with its lights down and says *Booking is not open yet. Come back when Live Booking starts.* or *Booking is closed. The roulette is resting until the next burn.*; with every spot taken, it says so and asks you to check back later.

### Already booked? ✨ Leave No Trace & Respin

The machine then shows your spot on its reels, with your booking pass below it, <kbd>Visit My Room</kbd> and <kbd>✨ Leave No Trace & Respin</kbd>. That button opens the Leave No Trace spell: hold the round <kbd>Hold to sweep ✨</kbd> button for two seconds (on a keyboard: hold Space). Letting go early, <kbd>Keep my spot</kbd> or <kbd>Esc</kbd> stops it. The moment the sweep is done, your booking is deleted, a little dust devil blows your spot away in glitter, and the machine spins a new spot for you. Your burner name stays on the name plate: keep it or change it before you book.

> [!WARNING] Swept means gone
> Your old spot is free for everyone the moment the sweep is done, and there is no undo. Until you book a new spot you have none, so don't leave the page halfway. The roulette may even hand you your old spot again.

## Changing your mind

::: tip Rename
Open your room, click **Your Spot**, change the burner name and press <kbd>Save Spot</kbd>. This works in every phase except Closed: before booking opens too, for example when a ticket was handed to you and its spot shows no name yet.
:::

::: tip Move to another bed
One ticket holds one spot, so release your current spot first: <kbd>Release</kbd> in the spot dialog or <kbd>Release Current Spot</kbd> on a house or room page. Then book the new one. Or leave it to fate: <kbd>✨ Leave No Trace & Respin</kbd> on the roulette page deletes your booking and spins a new spot right away.
:::

![Another house while you hold a spot: the note with your spot as a small ticket, and Release Current Spot](../assets/screenshots/guest-house-own-spot.webp)

> [!WARNING] Released means free for everyone
> Releasing asks first (*Release your spot?* → <kbd>Release spot</kbd> or <kbd>Keep my spot</kbd>). The moment you release a spot, anyone can grab it. There is no undo.

A spot the crew booked for your [special-needs request](./special-needs) can only get a new burner name: to move it or give it back, ask the crew.

Booking, moving and releasing a spot only work during Live Booking; the burner name of your spot can be changed until booking closes. After booking closes your spot is frozen: it stays yours and your booking pass keeps working (see [After booking closed](./phases#after-booking-closed)). Should the crew ever go back to Staging Mode to rebuild the camp, every guest booking is released and you get a *spot was released* e-mail; your ticket code keeps working, so you simply book again once booking reopens. Only spots the crew booked for [special-needs requests](./special-needs) stay.

## Confirmations

When your spot is booked, changes or is released, CozyNights sends an e-mail to the **address of your ticket**. You don't enter it anywhere; your room page shows where confirmations go, shortened like `m•••@example.com`. It usually arrives within a minute; right after booking opens, when many people book at once, it can take a few minutes. If the crew ever has to change the camp layout and your spot goes with it, you hear about it the same way, so you can pick a new one.

**Your room page** is the room that holds your spot: the room link in every confirmation takes you there, and so does <kbd>Visit My Room</kbd> on the roulette page. Every other house and room shows a *You already have a spot* note with your spot as a small ticket; tapping it opens your booking pass.

### Your booking pass

Once you hold a spot, your room page shows <kbd>🎫 Show booking pass</kbd>, every other house and room shows your spot as a small ticket that opens it (so do the roulette page and, once booking has closed, the map), and every confirmation links to it: a page with your spot, a QR code and a short code like `7F3K-9QXM-2CWD`. Show it when you arrive — or a screenshot of it: the crew scans it and checks you in. From then on your spot is final: you can still change your burner name while booking is open, but only the crew can release or move the spot.

<p align="center"><img src="../assets/screenshots/guest-pass.webp" alt="A booking pass on a phone: house, room, spot, burner name, QR code and pass code" width="300" /></p>

<kbd>Save QR code</kbd> stores the QR code as a picture (on a phone it goes to your photos), <kbd>Camp map</kbd> takes you back to the map. Before the check-in the pass stays valid when you move to another spot; the crew always sees the spot your ticket holds right now. Release your spot, and the same link says that your ticket holds no spot at the moment. The pass code is not your ticket code: it can only show your booking, never change it.

::: tip Updates on Telegram
Prefer Telegram? On your room page press <kbd>Get updates on Telegram</kbd>, then <kbd>START</kbd> in Telegram. The CozyNights bot confirms your spot right away and tells you about every change. The button's link works once and for 30 minutes; reload the room page afterwards, and it says *Updates on Telegram are on.* <kbd>Turn off</kbd> on the room page, or `/stop` in the chat, ends it.
:::

## On your phone

CozyNights works in any mobile browser, no app needed. If you booked on your laptop and now use your phone, enter your ticket code again on the start page.

<p align="center"><img src="../assets/screenshots/guest-room-mobile.webp" alt="Room page on a phone" width="300" /></p>

## Shared devices

Your ticket code stays on a device for 30 days. On a shared computer or somebody else's phone, sign out when you're done: on the start page, press <kbd>Not your ticket? Sign out</kbd>. The start page then says *Your ticket code was removed from this device.* Your booking stays; it belongs to the ticket, not to the device. Entering another code on the same device switches it to that ticket.

## Privacy: what others see

- Other guests see **which spots are taken** and the **burner name** on them. Nothing else.
- Other guests never see your ticket code or the e-mail address from your ticket order. The crew only uses that address to reach you about your spot, for example if they have to move you.
- Your burner name is stored encrypted, and your ticket code is never written to logs.
- Your e-mail address is only used for messages about your spot and is deleted after the event. Messages never contain your ticket code.

<!-- audience:admin -->
More details in [Security & privacy](../reference/security).
<!-- /audience -->
The **booking rules**, the privacy policy and the legal notice are linked at the bottom of every CozyNights page.

Something not working? See [FAQ & troubleshooting](./faq).
