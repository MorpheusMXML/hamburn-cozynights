# Security & privacy

CozyNights holds ticket data and the names burners choose for themselves. The design follows three rules: **keep as little as possible, do everything on the server, check twice.**

> [!NOTE] Scope of this page
> This page describes the protections, not how to operate them. Server credentials and their handling are deliberately not documented here.

## Guests

### Ticket codes are keys

Whoever has a ticket code can book for that ticket, so CozyNights treats codes like keys:

- **Looked up by a keyed hash.** Sign-in compares a keyed hash (HMAC-SHA256) of the code, not the code itself.
- **Never logged.** Neither successful nor failed codes end up in log files.
- **Kept in a protected cookie.** The browser stores the code in an `HttpOnly`, `Secure`, `SameSite=Lax` cookie that scripts on the page can't read.
- **Guessing is slowed down.** Too many wrong codes from one address pause sign-in for that address for a few minutes. Correct codes never count, so a crowd behind one festival network isn't locked out.

### Names and visibility

- **Burner names are encrypted at rest** with AES-256-GCM.
- **Other guests only see what's needed:** which spots are taken, and the burner name on them. Pages are trimmed on the server, so other guests' ticket codes or ticket names never reach the browser, not even hidden in page data.

### Fair booking

- **One ticket, one spot**, enforced on the server, including under parallel requests.
- **No double bookings.** Simultaneous clicks on the same spot are serialized; exactly one guest gets it.
- **Locked and inactive spots** are refused by the server, not just hidden in the interface.

## Admin sign-in

- **Google only.** No passwords in the app, no sign-up form, no invitation or approval screens that could be abused from a browser.
- **Workspace accounts only.** The address must end in `@mauersegler.art`, be verified by Google, and belong to the Google Workspace. This is checked by the database before a session is issued, and checked again by the app.
- **New accounts have no rights.** A first sign-in creates an access request with the role *pending*. Nobody can approve themselves; approvals happen outside the web app.
- **Checked on every request.** The role is re-read with each click, so removing someone takes effect immediately. Admin form actions and API calls without an approved session are refused centrally.
- **Protected sign-in flow.** The OAuth `state` is bound to the browser with a short-lived cookie and PKCE is used for the code exchange; forms are protected by SvelteKit's origin check against cross-site requests.
- **Session cookie** is `HttpOnly`, `Secure`, `SameSite=Lax`, valid for three days and renewed while in use.
- **Least privilege.** Clearing all bookings and importing templates are superuser-only, and no admin action ever deletes the ticket list.

## Database

- **Not on the internet.** nginx only forwards to the app. PocketBase is reachable from the app's internal network, and its dashboard only from the server itself.
- **Strict API rules.** Only the camp layout and the phase settings are publicly readable. Layout changes require an approved admin, the ticket list is closed to the public API entirely, admin accounts can't be listed, and PocketBase's default user sign-up is closed.
- **Rules as code.** Schema and rules are versioned migrations. They are re-applied to restored backups, so an old backup can't bring back old, looser rules.

## Operations

- **No secrets in git.** Each environment's configuration lives only on the machine that runs it and is kept in the team's password manager.
- **Isolated environments.** Staging and production run as separate stacks: own containers, network, database and encryption key.
- **Careful deploys.** Deploys are started by hand and need an approval. The deploy key can run exactly one command on the server. Every deploy backs up the database first and returns to the previous version automatically if the health check fails. See [Environments & deployment](../develop/deployment).
- **Pinned database version.** The PocketBase image is pinned; upgrades are deliberate and come after a backup.

## Found a problem?

Please report security issues privately to the maintainers instead of opening a public issue.
