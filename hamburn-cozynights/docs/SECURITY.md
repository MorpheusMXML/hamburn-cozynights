# 🛡️ Security Architecture

The Hamburn Cozynights system is designed with a **Privacy-First** approach to protect burner data and prevent unauthorized access to booking information.

## 1. The Trusted Proxy Model

Since the app uses booking codes instead of traditional user accounts for guests, we use a "Trusted Proxy" pattern to manage permissions.

- **Guest Context (`locals.pb`):** Represents an unauthenticated public visitor. This connection has very limited rights and can only see non-sensitive data (like house names and map coordinates).
- **Admin Context (`locals.pb` with an admin token):** After Google sign-in, the same per-request connection carries the admin's PocketBase token. Its rights come from the collection rules (`@request.auth.collectionName = "admins"`).
- **System Context (`locals.adminPb`):** A dedicated service-account superuser connection on the server side, authenticated with `PB_ADMIN_EMAIL` / `PB_ADMIN_PASSWORD` from `.env`. It is used for orders (ticket codes, PII) and guest bookings.

**Why it's safe:** PocketBase is never exposed to the browser or the internet (no public `/pb/` route; the dashboard is only reachable via SSH tunnel). The "Master Key" (`adminPb`) never leaves the server. The browser only receives the final HTML or specific success/error messages, and page data is mapped to the fields the page needs (e.g. the room page never ships other guests' orders).

## 2. Admin access

- **Who:** only records of the PocketBase auth collection `admins`, with role `superuser` or `admin`.
- **How they get there:** only on the server, with `scripts/cozy-admin.sh` (`add`, `superuser`, `remove`, `list`). There is **no** sign-up, invite or password login in the app, and the collection's `createRule` is `null`, so the PocketBase API cannot create admins either (not even via OAuth2).
- **Sign-in:** Google OAuth2 only. Allowed are Google-verified accounts of the Workspace domain `mauersegler.art` (email domain + `hd` claim) that match an invited record. Enforced three times:
  1. `pb_hooks/admins_oauth_guard.pb.js` rejects everything else before PocketBase issues a token,
  2. the OAuth callback re-checks the Google identity and the record (`src/lib/server/admin-auth.ts`),
  3. `hooks.server.ts` accepts only `admins` sessions, re-validates the token against PocketBase on every request and refuses admin form actions/API calls without one.
- **CSRF:** the OAuth `state` is checked against an httpOnly cookie (PocketBase itself does not check it); form actions use SvelteKit's origin check.
- **Session:** `pb_auth` cookie, `HttpOnly`, `Secure`, `SameSite=Lax`; token lifetime 3 days, refreshed on every request. `cozy-admin.sh remove` invalidates the session on the next request.
- **Roles:** `superuser` additionally may clear all bookings and import a location template. A `superuser` also has a PocketBase dashboard login (password set via the script).
- **Default `users` collection:** public sign-up is disabled (`createRule` null); its records have no rights.

## 3. Data Protection & Encryption

We use field-level encryption to ensure that even if the database is compromised, personal information remains unreadable.

- **AES-256-GCM Encryption:** `burner_name` is stored as encrypted ciphertext in the `orders` collection.
- **Deterministic Hashing:** We use `order_hash` (an HMAC-SHA256 of the booking code keyed with your `ENCRYPTION_KEY`) for lookups. Note: `order_number` is still stored in plain text for legacy imports.
- **No secrets in logs:** ticket codes are never logged.
- **GPG Backups:** The local database folder (`pb_data`) is ignored by Git. We use GPG-encrypted archives (`pb_data.tar.gz.gpg`) for backups and sharing the database state between developers. Such snapshots contain the Google OAuth client secret in plain text.
- **Secure Typegen (GPG):** The `npm run typegen` command is hardened to avoid storing plaintext passwords. It automatically attempts to decrypt credentials from `.env.gpg`, `secrets.gpg`, or `pb_password.gpg` using GPG if they are not provided in the environment.

## 4. Rights Management

| Action                              | Rights Enforced                                                                                                                   |
| :---------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------- |
| **Viewing the Map**                 | Public (house names, coordinates, free/taken beds).                                                                               |
| **Entering a ticket code**          | The code must match an existing order. Failed attempts are rate limited per IP. The code is kept in an httpOnly cookie.            |
| **Booking a Bed**                   | One ticket code = one booking: booking another bed moves the booking. Serialized per ticket and per bed, so parallel requests can't double-book. |
| **Releasing a Spot**                | Server looks up the order from the session cookie. A guest can **only** release their own bed.                                    |
| **Admin Actions**                   | Invited `admins` via Google sign-in (see section 2).                                                                              |
| **Clear all bookings / import template** | `superuser` role only. Ticket codes (orders) are never deleted by these actions.                                             |

## 5. Bed Locking & Deactivation

Admins can **Lock 🔒** or **Deactivate ❄️** individual beds.

- A **locked** bed is shown to guests as not available and cannot be booked by guests (admins can still book it).
- A **deactivated** bed does not exist for guests: it is hidden from the map and the roulette and cannot be booked by anyone.
