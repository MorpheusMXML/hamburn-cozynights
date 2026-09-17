# 🧪 Testing & Release Checks

How we make sure a change works **before** it reaches the staging server, and
that a deployment really works **after** it got there.

One command runs everything that GitHub runs:

```bash
npm run verify
```

It needs Node and a running Docker (Docker Desktop on a Mac). Nothing else — no
`.env`, no local database, no accounts. It never touches your dev database.

## The layers

| Layer       | Command                    | Needs     | What it proves                                                                                                                                                              |
| ----------- | -------------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Type check  | `npm run check`            | –         | The code compiles; Svelte components and server code agree on their types.                                                                                                  |
| Unit        | `npm test`                 | –         | The logic in isolation, PocketBase mocked: admin sign-in flow and session handling, role checks, booking rules, encryption, rate limit. Fast (< 1 s) — run it all the time. |
| Integration | `npm run test:integration` | Docker    | The **database**: a real, empty PocketBase applies `pb_migrations/` and loads `pb_hooks/`; then availability, schema, read/write, API rules, admin roles, booking service.  |
| Smoke       | `npm run test:smoke`       | Docker    | The **whole app**: the same Docker image staging builds, driven over HTTP — guest login, booking, admin area protection, superuser-only actions.                            |
| Post-deploy | `npm run smoke:remote`     | a URL     | A **deployment**: the read-only part of the smoke tests against a real site. Runs automatically after every staging deploy.                                                 |
| Browser E2E | `npm run test:e2e`         | dev setup | Optional, local: Playwright clicks through the UI against your dev server and dev database. Not part of the automatic checks.                                               |

### What the integration tests cover (`tests/integration/`)

- **Availability** – PocketBase answers, the app's service account can sign in
  (it is created the same way as on a server, through the `cozy-admin` command,
  so a broken hooks file fails the run right there).
- **Database works** – create / read / update / delete, relations, cascade
  delete, validation, the unique ticket hash.
- **Guests** – can read the map data, can never read tickets or write anything,
  cannot sign up anywhere.
- **Admin access model** – no password login; admin records can't be created
  through the API; every new record is born `pending` and `@mauersegler.art`;
  a pending account has no rights and can't approve itself; an approved admin
  can manage the structure but not read tickets or change roles; approval and
  removal take effect on the very next request.
- **Booking** – ticket-code login incl. imported tickets, one ticket = one bed,
  taken / locked / deactivated beds, two guests racing for one bed, release.

### What the smoke tests cover (`tests/smoke/`)

- _Any deployment (read-only):_ pages are served; an unknown ticket code is
  answered with "not found" — which only happens if app → PocketBase → service
  account all work; the admin login page reaches the backend (and offers Google
  sign-in where expected); the admin area refuses requests without or with a
  forged session.
- _Full flow (throwaway stack only):_ guest login sets an httpOnly cookie, map
  and room pages render, booking is refused while closed, a booked bed can't be
  taken by the next guest, other guests never see ticket codes or customer
  names, admin area opens for approved admins only, a removed admin is out on
  the next request, "clear all bookings" is superuser-only and keeps the tickets.

### What no automatic test covers

The Google consent screen itself. Everything around it is tested (who may get
an account, what each role may do, the callback logic), but the real round trip
to Google needs a human: **after a deploy that touches the login, sign in once
on staging.**

## The test stack

`scripts/test-stack.sh` starts `docker-compose.test.yml`: PocketBase with an
in-memory database (always empty at start) and, for the smoke tests, the app
image. Credentials are random per run and thrown away with the stack. It uses
its own compose project (`cozynights-verify`) and ports (8290 / 3290), so it
can't collide with a dev or staging stack on the same machine.

```bash
KEEP_STACK=1 npm run test:smoke      # leave it running to poke around
bash scripts/test-stack.sh down      # remove it again
TEST_PB_PORT=8390 TEST_APP_PORT=3390 npm run verify   # ports already taken?
```

Check a deployment by hand (read-only, no credentials needed):

```bash
SMOKE_BASE_URL=https://test-cozynights.hamburn.de SMOKE_EXPECT_GOOGLE=1 npm run smoke:remote
```

## Release routine

1. **Branch + pull request.** Never commit to `main` directly.
2. **`npm run verify` locally** before pushing (or at least `npm test` while
   working, `verify` before the pull request).
3. **CI must be green.** `.github/workflows/ci.yml` runs the same verification
   on every pull request and on `main`.
4. **Deploy to staging** (Actions → "Deploy staging"). The workflow runs the
   verification again for exactly the commit it deploys, deploys with backup
   and rollback, then smoke-tests the live site from the outside.
5. **Look at it yourself** on staging — and sign in with Google if the login
   was touched.
6. **Merge** once staging is fine.

## Rules of thumb

- **Every bug gets a test first.** Reproduce it in a test, watch it fail, fix
  it. That bug never comes back unnoticed.
- **Test at the lowest layer that can catch it.** Logic → unit test. API rule,
  migration, hook → integration test. "Does it hang together" → smoke test.
  Few smoke tests, many unit tests.
- **Every new migration or hook gets an integration test** for the rule it
  introduces — these files are the security boundary, and the integration run
  is the only place they execute before the server.
- **Every new admin action gets a line in the smoke or unit tests** showing it
  is refused without a session (and for the wrong role).
- **A test must be able to fail.** When you add one, break the code once on
  purpose and see it go red.
- **Tests own their data.** They create what they need with unique names and
  never rely on records in somebody's database.
- **No real secrets in tests, ever.** The test stack generates its own.
- **Red CI is a stop sign**, not a suggestion: fix or revert, don't deploy
  around it.
- **Keep it fast.** The whole verification takes a few minutes. If it gets
  slow, people stop running it.
