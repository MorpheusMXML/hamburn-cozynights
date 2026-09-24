# Security & privacy

CozyNights holds ticket data and the names burners choose for themselves. The design follows three rules: **keep as little as possible, do everything on the server, check twice.**

> [!NOTE] Scope of this page
> This page describes the protections, not how to operate them. Server credentials and their handling are deliberately not documented here.

## Guests

### Ticket codes are keys

Whoever has a ticket code can book for that ticket, so CozyNights treats codes like keys:

- **Looked up by a keyed hash.** Sign-in compares a keyed hash (HMAC-SHA256) of the code, not the code itself.
- **Never logged.** Neither successful nor failed codes end up in log files.
- **Kept in a protected cookie.** The browser stores the code in an `HttpOnly`, `Secure`, `SameSite=Lax` cookie (`bookingCode`, 30 days) that scripts on the page can't read. A second cookie next to it (`bookingRound`) holds the booking round it was signed in for.
- **Checked on every request.** The server looks the code up before any page runs (`src/lib/server/guest-session.ts`): a code that is no longer in the ticket list, and a code from an earlier booking round, end the session then and there — both cookies go and the start page asks for the code again. A PocketBase that can't be reached signs nobody out.
- **A reset ends every session.** Releasing all bookings (the switch back to Staging, 🧨 Clear all bookings) counts the round up in `app_settings.guest_round`, so a new round never starts with devices still signed in for the last one.
- **Guessing is slowed down.** Too many wrong codes from one address pause sign-in for that address for a few minutes. Correct codes never count, so a crowd behind one festival network isn't locked out.

### Names and visibility

- **Burner names are encrypted at rest** with AES-256-GCM.
- **Other guests only see what's needed:** which spots are taken, and the burner name on them. Pages are trimmed on the server, so other guests' ticket codes or ticket names never reach the browser, not even hidden in page data.

### Fair booking

- **One ticket, one spot**, enforced on the server, including under parallel requests.
- **No double bookings.** Simultaneous clicks on the same spot are serialized; exactly one guest gets it.
- **Locked, inactive and special-needs spots** are refused by the server, not just hidden in the interface.
- **Booking while booking is closed** happens in exactly one place: an admin books a spot for an approved special-needs request. The ticket comes from the guest's signed-in session, never from a form field.

### Messages to guests

- **Addresses come from the ticket list.** Guests never type one, so nobody can make CozyNights write to a stranger. The room page shows the address shortened (`m•••@example.com`).
- **Only about the spot.** Messages contain house, room, spot and a link — never the ticket code — and are only sent when the spot of that ticket changes.
- **Telegram is opt-in** through a one-time link that works for 30 minutes; only its hash is stored. `/stop` or <kbd>Turn off</kbd> removes the link, and a blocked bot is noticed and forgotten.
- **No inbound endpoint.** The server fetches the bot's messages itself; there is no public webhook to attack. The bot token lives in the server configuration only and never appears in logs or stored errors.
- **The mail password** is in the server configuration, and PocketBase keeps a copy in its settings, so it is part of the database and its backups. It belongs to a send-only SMTP user of a sending service (one per environment), never to a mailbox.
- **Deleted after the event** with `tickets forget-contacts`.

### Special-needs requests

What a guest writes about their needs is often health data (Art. 9 GDPR), so it gets extra care. Details: [Special-needs requests](../admin/special-needs#privacy).

- **Explicit consent** with an unticked checkbox, stored with the time; withdrawing deletes the request right away.
- **The form asks what is needed, not why**, and says so.
- **Encrypted at rest** (AES-256-GCM, like burner names): what was ticked and written, and the burner name. The collection has no API rules, only the app's service account reads it; the pages are sent with `Cache-Control: no-store`.
- **Admins only.** Never part of e-mails, Telegram messages, the crew group, logs or the audit log. The crew group hears *that* a request arrived or was decided, without names.
- **No hint for other guests.** Guest pages and their data never say why a spot is taken or reserved (special-needs, locked or booked all look alike); a booked special-needs spot shows the burner name like any other.
- **Deleted after the event** with `tickets forget-contacts`.

### Booking passes

- **A separate, random code.** The pass code (12 characters) can only show a booking; the ticket code, which can change bookings, never appears on a pass, in a QR code or in a message.
- **Minimal content.** Anyone with a pass link sees the spot and the burner name (visible to other guests anyway). The name on the ticket, the shortened e-mail and the check-in only appear for signed-in admins.
- **Check-in by admins only.** Checking a pass checks the guest in. That happens only in the admin area (`/admin/check`, also the target of the button on the pass page): requests without an approved admin session are refused centrally, the actions check again, and the check-in is written with the admin's own PocketBase session, which the beds' rules accept from approved admins and superusers only. Opening a pass never writes anything. A ticket code can't check anybody in, and guests never see who checked them in or when.
- **Private links.** Pass pages send `Referrer-Policy: no-referrer`, `X-Robots-Tag: noindex` and `Cache-Control: no-store`; many unknown codes from one connection are blocked for a while. Only PocketBase creates pass codes, so two writers can't hand out different codes for one ticket. The pass's files — its QR images and the wallet passes — go through the same check and the same limit.
- **Wallet passes carry no more than the pass page**, and the Apple pass file is signed on our own server with the Pass Type ID certificate. A device asking for updates identifies itself with a token derived from the app's key for that one pass, so a token for one pass is useless for any other, and nothing about a pass is stored to check it. Subscribing to Telegram, on the other hand, always needs the ticket code: those messages also carry the crew's decision on a special-needs request, and pass links get shown around.

## Admin sign-in

- **Google only.** No passwords in the app, no sign-up form, no invitation or approval screens that could be abused from a browser.
- **Workspace accounts only.** The address must end in `@mauersegler.art`, be verified by Google, and belong to the Google Workspace. This is checked by the database before a session is issued, and checked again by the app.
- **New accounts have no rights.** A first sign-in creates an access request with the role _pending_. Nobody can approve themselves; approvals happen outside the web app.
- **Checked on every request.** The role is re-read with each click, so removing someone takes effect immediately. Admin form actions and API calls without an approved session are refused centrally.
- **Protected sign-in flow.** The OAuth `state` is bound to the browser with a short-lived cookie and PKCE is used for the code exchange; forms are protected by SvelteKit's origin check against cross-site requests.
- **Session cookie** is `HttpOnly`, `Secure`, `SameSite=Lax`, valid for three days and renewed while in use.
- **Weekly Google sign-in.** However active a session is, after 7 days the app asks Google again. A suspended Workspace account or newly required 2-Step Verification reaches every admin within a week.
- **2-Step Verification is Google's job.** It is enforced for the Workspace in the Google Admin console; CozyNights deliberately adds no weaker second factor of its own.
- **Crew alerts.** Access requests, approvals, role changes, removals, admin sign-ins, phase switches and bulk actions are logged (`admin_events`) and posted to the crew's Telegram group, see [Notifications](../admin/notifications#crew-group).
- **Least privilege.** Clearing all bookings and importing templates are superuser-only, and no admin action ever deletes the ticket list.

## Database

- **Not on the internet.** nginx only forwards to the app. PocketBase is reachable from the app's internal network, and its dashboard only from the server itself.
- **Strict API rules.** Only houses, rooms and the phase settings are publicly readable; beds are admin-only (they carry the booking's ticket, the special-needs flag and the booking time), so guests get spots only through the app's pages, which strip all of that. Layout changes require an approved admin, the ticket list is closed to the public API entirely, admin accounts can't be listed, and PocketBase's default user sign-up is closed. On a server the dashboard's schema editors are hidden (`PB_HIDE_CONTROLS`): the schema only ever comes from `pb_migrations/`.
- **Guards behind the rules.** Three PocketBase hooks repeat what the app already refuses, for the case that an admin token is used directly against the API: only a superuser can switch the booking phase right now (`pb_hooks/cozy_phase.pb.js`), houses, rooms and spots can only be created or deleted while booking is in Staging (`pb_hooks/cozy_layout.pb.js`), and a house or room can't claim 🔥 Heated and ❄️ No heating at once (`pb_hooks/cozy_features.pb.js`). If the phase cannot be read, the first two refuse.
- **A short request log without addresses.** PocketBase keeps its request log for two days (`PB_LOGS_DAYS`) and never records client IPs: a request URL can carry a ticket code on the first sign-in, and pass codes.
- **Rules as code.** Schema and rules are versioned migrations. They are re-applied to restored backups, so an old backup can't bring back old, looser rules.

## Operations

- **No secrets in git.** Each environment's configuration lives only on the machine that runs it and is kept in the team's password manager. Two nets catch a slip: GitHub's push protection and secret scanning for provider tokens, and gitleaks with the project's own rules (`.gitleaks.toml`) as a pre-commit hook on every developer machine and as the `Secrets` job over the whole history in CI. A password that once sat in a script in this repository was treated as compromised and rotated; the history keeps it, so the rules also allowlist those old commits by id.
- **Isolated environments.** Staging and production run as separate stacks: own containers, network, database and encryption keys.
- **Encrypted settings.** PocketBase's own settings (among them the SMTP password for booking e-mails) are stored encrypted with a per-environment key (`PB_ENCRYPTION_KEY`, PocketBase's `--encryptionEnv`), so a database backup alone doesn't give them away. A collection's OAuth2 provider settings stay outside that encryption, so backups remain secret material. Details: [Environments & deployment](../develop/deployment#pocketbase-settings-key).
- **Careful deploys.** Deploys are started by hand and need an approval. The deploy key can run exactly one command on the server. Every deploy backs up the database first and returns to the previous version automatically if the health check fails. See [Environments & deployment](../develop/deployment).
- **Pinned database version.** The PocketBase image is pinned; upgrades are deliberate and come after a backup.
- **Response headers.** Every page is sent with `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY` and `Content-Security-Policy: frame-ancestors 'none'` (the app can't be embedded in other sites), `Referrer-Policy: strict-origin-when-cross-origin` (booking passes: `no-referrer`), `Cross-Origin-Opener-Policy: same-origin`, a `Permissions-Policy` that allows the camera only for the pass scanner, and HSTS from the web server. A full Content-Security-Policy runs in report-only mode for now: enforcing it needs nonces for SvelteKit's inline bootstrap script (`kit.csp`) and is a planned follow-up.
- **Readiness, not just liveness.** `/api/health` answers 200 only when the app's service account is signed in to the database. The deploy script and the smoke tests use it, so a deploy with a broken service account is rolled back instead of serving error pages.

## Privacy policy

What guests are told is on the app's `/privacy` page. It has to stay true to this page and to the code; what to update when something changes is listed in [Legal pages](../admin/legal#keeping-the-privacy-policy-true).

## Found a problem?

Please report security issues privately to the maintainers instead of opening a public issue.
