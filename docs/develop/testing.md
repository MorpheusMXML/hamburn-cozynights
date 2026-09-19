# Testing & release checks

How we make sure a change works **before** it reaches the staging server, and that a deployment really works **after** it got there.

One command runs everything that GitHub runs:

```bash
npm run verify
```

It needs Node and a running Docker (Docker Desktop on a Mac). Nothing else — no `.env`, no local database, no accounts. It never touches your dev database. Like all app commands, it runs in the inner `hamburn-cozynights/` folder (see [Local development](./)).

## The layers

| Layer | Command | Needs | What it proves |
| --- | --- | --- | --- |
| Type check | `npm run check` | – | The code compiles; Svelte components and server code agree on their types. |
| Unit | `npm test` | – | The logic in isolation, PocketBase mocked: admin sign-in flow and session handling, role checks, booking rules, encryption, rate limit, special-needs requests (with the in-memory stand-in `tests/fake-pb.ts`), and every guest message text for each mix of spot change and request news (`tests/notify-messages.test.ts`). Fast (< 1 s) — run it all the time. |
| Integration | `npm run test:integration` | Docker | The **database**: a real, empty PocketBase applies `pb_migrations/` and loads `pb_hooks/`; then availability, schema, read/write, API rules, admin roles, booking service. |
| Smoke | `npm run test:smoke` | Docker | The **whole app**: the same Docker image staging builds, driven over HTTP — guest login, booking, admin area protection, superuser-only actions. |
| Post-deploy | `npm run smoke:remote` | a URL | A **deployment**: the read-only part of the smoke tests against a real site. Runs automatically after every staging deploy. |
| Browser E2E | `npm run test:e2e` | dev setup | Optional, local: Playwright clicks through the UI against your dev server and dev database. Not part of the automatic checks. |
| Title & legal E2E | `npx playwright test tests/e2e/landing.test.ts tests/e2e/legal.test.ts` | `npx vite dev` | Optional, local: the start page title and the legal pages in Chromium and on an emulated iPhone (WebKit). Needs no PocketBase. |

### What the integration tests cover

In `tests/integration/`:

- **Availability** – PocketBase answers and the app can sign in to it, the same way it does on a server — so a broken hooks file fails the run right there.
- **Database works** – create / read / update / delete, relations, cascade delete, validation, the unique ticket hash.
- **Guests** – can read the map data, can never read tickets or write anything, cannot sign up anywhere.
- **Admin access model** – no password login; admin records can't be created through the API; every new record is born `pending` and `@mauersegler.art`; a pending account has no rights and can't approve itself; an approved admin can manage the structure but not read tickets or change roles; approval and removal take effect on the very next request.
- **Booking** – ticket-code login incl. imported tickets, one ticket = one bed, taken / locked / deactivated beds, two guests racing for one bed, release.
- **Booking passes** – a code appears when a ticket gets a spot and stays with the ticket through moves and releases, codes are unique, only the service account may request one, and the confirmation e-mail and Telegram message carry the pass link.
- **Special-needs requests** – only the service account can read them, one per ticket, gone with the ticket, stored encrypted; a bed the crew booked can still be deleted; the guest hears about a new request, an approval with a booking (one e-mail with the pass), a decline, nothing about a withdrawal (a new request later is news again) and sees the status on Telegram; the crew group gets no names or texts; who opened or closed requests; `forget-contacts` deletes them.
- **Tickets & template review** – a ticket handed over gets a new pass and a confirmation to the new address, the old holder's Telegram and burner name are gone, the old pass is dead; a corrected address keeps pass and Telegram; the search finds codes in any case (also hash-only ones) and addresses with `+`/`_` exactly; the ticket list import creates and updates only the chosen tickets; applying chosen template changes moves, renames, adds and removes only those, keeps the other bookings, makes a backup and tells the released guest.
- **Notifications** – confirmation e-mails (booked, one "changed" for a move, released by the guest or with a deleted room), no mail for tickets without an address, a newly imported address, retries and the crew alert after the last one; Telegram link, `/stop`, blocked bot, unknown links; crew alerts for access changes, phase switches with the admin's name, an outage of Telegram, and a real OAuth2 sign-in through the admin guard; `cozy-admin tickets import` (dry run, broken file, stdin) and `notify status` / `test`.

### What the smoke tests cover

In `tests/smoke/`:

- **Any deployment (read-only):** pages are served; an unknown ticket code is answered with "not found" — which only happens if the app, PocketBase and the app's sign-in to it all work; the admin login page reaches the backend (and offers Google sign-in where expected); the admin area (including `/admin/requests`) refuses requests without or with a forged session, and `/special-needs` sends visitors without a ticket code to the start page.
- **Full flow (throwaway stack only):** guest login sets an httpOnly cookie, map and room pages render, booking is refused while closed, a booked bed can't be taken by the next guest, other guests never see ticket codes or customer names, admin area opens for approved admins only, a removed admin is out on the next request, a special-needs request sent while booking is closed gets a spot booked by an admin that the guest can't release, "clear all bookings" is superuser-only and keeps the tickets, admins find and change tickets while the ticket list import and applying a layout file are superuser-only.

> [!NOTE] Why the log ends with `7 passed | 8 skipped` against a real site
> The full-flow tests write data and need superuser access to the database, so they are skipped there on purpose. They have already run against the Docker image of the same commit in the `verify` job.

### What no automatic test covers

The Google consent screen itself. Everything around it is tested (who may get an account, what each role may do, the callback logic), but the real round trip to Google needs a human: **after a deploy that touches the login, sign in once on staging.**

## The test stack

`scripts/test-stack.sh` starts `docker-compose.test.yml`: PocketBase with an in-memory database (always empty at start) and, for the smoke tests, the app image. Two stand-ins replace the outside world: **Mailpit** catches every e-mail (web UI on port 8293) and `tests/fixtures/mock-services.mjs` plays the Telegram Bot API and Google's OAuth2 endpoints (port 8292). Credentials are random per run and thrown away with the stack. The stack lifts the per-minute cap on guest e-mails (`COZY_MAILS_PER_MINUTE`), so the suites' messages aren't held back. It uses its own compose project (`cozynights-verify`) and ports (8290 / 3290 / 8292 / 8293), so it can't collide with a dev or staging stack on the same machine.

Admin sessions in tests are PocketBase impersonation tokens. They need a recent `last_sign_in` on the `admins` record (what a real Google sign-in stores), otherwise the app asks for a fresh sign-in — `createAdmin` in `tests/stack-helpers.ts` sets it.

```bash
KEEP_STACK=1 npm run test:smoke      # leave it running to poke around
bash scripts/test-stack.sh down      # remove it again
TEST_PB_PORT=8390 TEST_APP_PORT=3390 TEST_MOCK_PORT=8392 TEST_MAILPIT_PORT=8393 npm run verify   # ports already taken?
```

Check a deployment by hand (read-only, no credentials needed):

```bash
SMOKE_BASE_URL=https://test-cozynights.hamburn.de SMOKE_EXPECT_GOOGLE=1 npm run smoke:remote
```

## Release routine

<div class="steps">

1. **Branch + pull request.** Never commit to `main` directly.
2. **`npm run verify` locally** before pushing (or at least `npm test` while working, `verify` before the pull request).
3. **CI must be green.** [`.github/workflows/ci.yml`](https://github.com/MorpheusMXML/hamburn-cozynights/blob/main/.github/workflows/ci.yml) runs the same verification on every pull request and on `main`; its `Verify` check is required before a pull request can merge. Its `Secrets` job scans the whole git history with gitleaks (`.gitleaks.toml`), the same rules the pre-commit hook applies locally.
4. **Deploy to staging** (Actions → "Deploy staging"). The workflow runs the verification again for exactly the commit it deploys, deploys with backup and rollback, then smoke-tests the live site from the outside. See [Environments & deployment](./deployment#deploying-to-staging).
5. **Look at it yourself** on staging — and sign in with Google if the login was touched.
6. **Merge** once staging is fine.

</div>

## Rules of thumb

- **Every bug gets a test first.** Reproduce it in a test, watch it fail, fix it. That bug never comes back unnoticed.
- **Test at the lowest layer that can catch it.** Logic → unit test. API rule, migration, hook → integration test. "Does it hang together" → smoke test. Few smoke tests, many unit tests.
- **Every new migration or hook gets an integration test** for the rule it introduces — these files are the security boundary, and the integration run is the only place they execute before the server.
- **Every new admin action gets a line in the smoke or unit tests** showing it is refused without a session (and for the wrong role).
- **A test must be able to fail.** When you add one, break the code once on purpose and see it go red.
- **Tests own their data.** They create what they need with unique names and never rely on records in somebody's database.
- **No real secrets in tests, ever.** The test stack generates its own.
- **Red CI is a stop sign**, not a suggestion: fix or revert, don't deploy around it.
- **Keep it fast.** The whole verification takes a few minutes. If it gets slow, people stop running it.
