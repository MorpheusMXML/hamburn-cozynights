# FAQ & troubleshooting

## For guests

::: details "This booking code was not found."
Check the code for typos: it's on your ticket and contains only letters, digits, `-` and `_`. Copy and paste works best. Still not working? Contact the Hamburn crew; your ticket may not be in the ticket list yet.
:::

::: details "Invalid booking code format."
The code contains a character that can't be part of a ticket code, often a space or a stray punctuation mark from copy and paste. Only letters, digits, `-` and `_` are allowed.
:::

::: details "Too many invalid codes. Please wait a few minutes."
After many wrong codes from the same network, CozyNights pauses sign-in attempts for a while to stop people from guessing codes. Wait a few minutes (at most ten) and try again. Correct codes never count towards this limit.
:::

::: details "The booking system is temporarily unavailable."
CozyNights couldn't reach its database for a moment. Your code is fine. Try again shortly.
:::

::: details The map is blurry and houses don't open ("PATIENCE, BURNER!")
Booking hasn't opened yet. The countdown shows when it starts. <kbd>📡 RELOAD SENSORS</kbd> refreshes the page state.
:::

::: details I can't click a free spot, it says "Release other spot first"
Your ticket already holds a spot somewhere else. One ticket code = one spot. Release the old spot first, then book the new one. See [Changing your mind](./booking#changing-your-mind).
:::

::: details Someone grabbed the bed I wanted at the same moment
First come, first served. If two people click the same spot at the same time, exactly one of them gets it; the other sees *This spot is already claimed.* Pick another one.
:::

::: details I booked on another device
Enter your ticket code on the start page of the new device. Your booking is attached to the ticket, not to the device.
:::

::: details Can I book for a friend?
Only with their ticket code. On a shared device, entering another code switches that browser to the other ticket, so switch back to your own code afterwards.
:::

::: details A spot says "Not available · Reserved by the crew"
The crew has locked or deactivated it, for example because the bed is broken, kept free on purpose or not in use. Pick another spot.
:::

## For admins

::: details I'm stuck on "ACCESS REQUESTED"
Your Google sign-in worked, and your access request is waiting for a superuser. Ask one of them to approve it, then reload the page. See [Admin access & roles](../admin/access).
:::

::: details "WRONG ACCOUNT 🛑" at sign-in
You picked a Google account outside the `@mauersegler.art` Workspace (for example a private Gmail address). Sign in again and choose your Workspace account, or use <kbd>USE ANOTHER ACCOUNT</kbd>.
:::

::: details "Management locked during live booking."
Structural changes only work in Staging Mode. Switch back to staging first, or, if you only want to take a spot out of service, lock it: that works during Live Booking too. See [Staging & Live Booking](./phases).
:::

::: details Guests can't book a spot
Check the spot on its room page. Guests can't book **LOCKED 🔒** or ⚪️ **INACTIVE 🧊** spots: unlock it, or activate it with ⚡️ in Staging Mode. New spots are active from the start, but a template import keeps the states stored in the file. See [Houses, rooms & spots](../admin/camp-layout#spots).
:::

::: details A house won't move when I drag it
Either Live Booking is active (dragging is switched off while the layout is locked), or you are pushing it right on top of another house: houses keep a small distance from each other. Switch to staging, or drop it a little further away.
:::

::: details I can't find "Clear all bookings" or the template import
Both are superuser-only. Regular admins see the import card with a lock 🔒 and aren't offered to clear bookings.
:::
