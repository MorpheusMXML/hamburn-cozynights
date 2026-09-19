# FAQ & troubleshooting

## For guests

::: details "We could not find this ticket code. Check it for typos (0 vs. O, 1 vs. I) and try again…"
Check the code for typos: it's on your ticket and contains only letters, digits, `-` and `_`. Copy and paste works best. Only **Indoor memberships** include a bed, so only their codes work here; Camper memberships don't need CozyNights. Still not working? Contact the Hamburn crew; your ticket may not be in the ticket list yet.
:::

::: details "Ticket codes only contain letters, digits, - and _. Check for spaces or typos."
The code contains a character that can't be part of a ticket code, often a space or a stray punctuation mark from copy and paste. Only letters, digits, `-` and `_` are allowed.
:::

::: details "Too many wrong ticket codes from your connection. Please wait up to 10 minutes…"
After many wrong codes from the same network, CozyNights pauses sign-in attempts for a while to stop people from guessing codes. Wait a few minutes (at most ten) and try again. Correct codes never count towards this limit.
:::

::: details "The booking system is not reachable right now. Your code was not checked…"
CozyNights couldn't reach its database for a moment. Your code is fine. Try again shortly.
:::

::: details The map is blurry and houses don't open ("Booking is not open yet…")
Booking hasn't opened yet. The countdown shows when it starts; the map unlocks by itself when it ends. <kbd>📡 RELOAD SENSORS</kbd> refreshes the page state.
:::

::: details I can't book or change my spot any more ("Booking has closed")
The booking window is over, so spots are final. Your spot stays yours and your booking pass keeps working. If something has to change, ask the crew. Releasing is closed too: *Booking is closed right now, so your spot cannot be released. It stays reserved for you.*
:::

::: details "You are not signed in anymore. Go to the start page and enter your ticket code again."
Your browser has forgotten your ticket code: it remembers it for 30 days, unless you signed out or somebody entered another code on this device. Enter your code on the start page again; your booking is still there. *Your ticket code was not found* instead means the ticket is no longer in the ticket list: ask the crew.
:::

::: details "Something went wrong while booking…", "The booking system has a technical problem…", "This spot doesn't exist anymore…"
First look at the room page: if the spot shows as **Your Spot**, all is fine. *Something went wrong* means the booking may or may not have gone through, so check before booking again. *Technical problem. Nothing was booked* is one for the crew. *This spot doesn't exist anymore* means the crew changed the layout meanwhile: pick another spot.
:::

::: details Destiny Roulette says "Someone was faster", "The roll was incomplete" or "You already have a spot"
Roll again: another guest took that spot in the meantime, or the roll didn't finish. *You already have a spot* means the roulette only hands out spots to tickets without one; release yours first if you want to roll.
:::

::: details "This house doesn't exist (anymore)", "This room doesn't exist (anymore)", "The map could not be loaded right now"
The crew changed the camp layout while you had the page open, or the map data didn't arrive. Go back to the map and pick again; if the map itself won't load, try again in a minute.
:::

::: details I can't click a free spot, it says "Release your other spot first"
Your ticket already holds a spot somewhere else. One ticket code = one spot. Release the old spot first, then book the new one. See [Changing your mind](./booking#changing-your-mind).
:::

::: details Someone grabbed the bed I wanted at the same moment
First come, first served. If two people click the same spot at the same time, exactly one of them gets it; the other sees _This spot is already claimed._ Pick another one.
:::

::: details I booked on another device
Enter your ticket code on the start page of the new device. Your booking is attached to the ticket, not to the device.
:::

::: details Can I book for a friend?
Only with their ticket code. On a shared device, entering another code switches that browser to the other ticket, so switch back to your own code afterwards.
:::

::: details I didn't get a confirmation e-mail
It goes to the address that belongs to your ticket, usually within a minute. Check your spam folder. Your room page shows where confirmations go; if that address is wrong or missing, ask the crew to fix it in the ticket list.
:::

::: details Where is my booking pass?
On your room page (<kbd>🎫 Show booking pass</kbd>), as the small ticket on every other house and room (and on the map once booking has closed), and behind the link in your confirmation e-mail or Telegram message. The link keeps working after you release your spot, but then it says that your ticket holds no spot right now. A screenshot of it is fine.
:::

::: details My pass link says "This booking pass is unknown" or "Too many unknown passes from your connection"
*Unknown* means no ticket has this pass code any more: an old link after your ticket was passed on, or a typo in the link. Open your room page and press <kbd>🎫 Show booking pass</kbd> for the current one. *Too many unknown passes* means many wrong codes came from your network (a shared Wi-Fi, for example) within a few minutes: wait a little and open the link again.
:::

::: details How do I stop the Telegram messages?
Press <kbd>Turn off</kbd> next to "Updates on Telegram are on" on your room page, or send `/stop` to the bot.
:::

::: details I need a special spot (lower bunk, step-free, quiet, a socket for a medical device)
Ask the crew for a special-needs spot, even before booking opens: sign in with your ticket code and follow the link on the map while the crew accepts requests. See [Special-needs spot](./special-needs).
:::

::: details My special-needs request won't send, or says the crew has already decided
The form needs at least one ticked need (or *Something else*), a few words of text (5 to 500 characters) and the ticked consent box. *You sent your request 10 times within an hour* is a limit: it works again within the hour. *The crew has already decided on your request* means it can't be changed anymore; the page shows the decision. If something changed, contact the crew. You can still withdraw the request.
:::

::: details A spot says "Not available · Reserved by the crew"
The crew has locked or deactivated it, for example because the bed is broken, kept free on purpose or not in use. Pick another spot.
:::

::: details The burning title is too much for me
Press the pause button ⏸ next to the title; your browser remembers it. If your device is set to reduce motion (for example on iPhone: Settings → Accessibility → Motion → Reduce Motion), the title doesn't move at all. And if you like it: move the cursor over the standing letters or tap them to set them on fire yourself.
:::

::: details Who runs CozyNights, and what happens with my data?
Every page of CozyNights links the **legal notice** (who runs it and how to reach them), the **privacy policy** and the **booking rules** at the bottom. In short: your ticket code, the e-mail address of your order, your spot and the burner name you choose; no tracking, no ads, no cookie banner needed.
:::

<!-- audience:admin -->

## For admins

::: details I'm stuck on "ACCESS REQUESTED"
Your Google sign-in worked, and your access request is waiting for a superuser. Ask one of them to approve it, then reload the page. See [Admin access & roles](../admin/access).
:::

::: details "WEEKLY CHECK 🔐" at sign-in
Admins sign in with Google again every 7 days, even when they use the admin area every day. Press the Google button once and you're back. See [Sessions](../admin/access#sessions).
:::

::: details "WRONG ACCOUNT 🛑" at sign-in
You picked a Google account outside the `@mauersegler.art` Workspace (for example a private Gmail address). Sign in again and choose your Workspace account, or use <kbd>USE ANOTHER ACCOUNT</kbd>.
:::

::: details "… is locked during Live Booking" / "… while booking is closed" 🔒
Structural changes only work in Staging Mode. During Live Booking and after booking closed, only a superuser can switch back to staging. If you only want to take a spot out of service, lock it: that works in every phase. See [Staging, Live Booking & Closed](./phases).
:::

::: details Guests can't book a spot
Check the spot on its room page. Guests can't book **LOCKED 🔒** or ⚪️ **INACTIVE 🧊** spots: unlock it, or activate it with ⚡️ in Staging Mode. New spots are active from the start, but a template import keeps the states stored in the file. See [Houses, rooms & spots](../admin/camp-layout#spots).
:::

::: details A house won't move when I drag it
Either the layout is locked (Live Booking, or booking closed: dragging is switched off), or you are pushing it right on top of another house: houses keep a small distance from each other. Wait for Staging, or drop it a little further away.
:::

::: details I can't find "Clear all bookings" or the template import
Both are superuser-only. Regular admins see the import card with a lock 🔒 and aren't offered to clear bookings.
:::

::: details The camera on "Check passes" won't open
The browser needs permission for the camera on this site, and the page must come over HTTPS. Allow it in the site settings, or just use the phone's own camera app: it opens the pass link, and signed in, you see the check result on top. Details in [Booking passes](../admin/passes#when-something-doesn-t-work).
:::

<!-- /audience -->
