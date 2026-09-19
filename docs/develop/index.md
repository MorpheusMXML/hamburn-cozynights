# Local development

Get CozyNights running on your machine: a local PocketBase in Docker plus the SvelteKit dev server with hot reload.

## Prerequisites

- **Node.js 22** or newer, with npm
- **Docker** with Docker Compose, for the local PocketBase
- **Git**

## Setup

<div class="steps">

1. **Clone the repository**

   ```bash
   git clone https://github.com/MorpheusMXML/hamburn-cozynights.git
   cd hamburn-cozynights/hamburn-cozynights
   ```

   The app lives in the inner `hamburn-cozynights/` folder; all commands below run there.

2. **Configure your environment**

   ```bash
   cp .env.example .env
   ```

   Fill in `.env`. The comments in the file explain every value and how to generate the encryption key. `.env` is git-ignored; never commit it.

3. **Start PocketBase**

   ```bash
   docker compose up -d
   ```

   PocketBase applies the schema from `pb_migrations/` on start and listens on `127.0.0.1:8090`. Its dashboard is at [http://127.0.0.1:8090/\_/](http://127.0.0.1:8090/_/). Your local data lives in `pb_data/`, which is git-ignored too.

4. **Install and run the app**

   ```bash
   npm ci
   npm run dev
   ```

   Open [http://localhost:5173](http://localhost:5173). Before the dev server starts, a health check verifies that PocketBase is reachable, the app can sign in to it and the schema is complete, and it tells you what to fix if not.

5. **Turn on the secret check** (once per clone, from the repository root)

   ```bash
   brew install gitleaks
   git config core.hooksPath .githooks
   ```

   From now on every commit is scanned with [gitleaks](https://github.com/gitleaks/gitleaks) before it is written, with the rules in `.gitleaks.toml`: passwords on command lines, values of `PB_ADMIN_PASSWORD`, `SMTP_PASSWORD`, `TELEGRAM_BOT_TOKEN`, `ENCRYPTION_KEY` and the like, plus gitleaks' own rules for tokens and private keys. A hit refuses the commit and names the line; the same scan runs over the whole history in CI (`Secrets` job). Without gitleaks installed the hook refuses every commit, on purpose.

</div>

> [!TIP] Test data
> `npm run test:setup` prepares your local database for the end-to-end tests: it creates a test ticket, opens booking and frees all spots. Build a small camp in the Control Center or import a [layout template](../admin/templates) to have something to click through.

## Admin sign-in locally

The admin area needs Google sign-in, also locally:

1. Create an OAuth client of type **Web application** in the Google Cloud console with the redirect URI `http://localhost:5173/auth/callback/google`.
2. Put its ID and secret into `PB_GOOGLE_CLIENT_ID` and `PB_GOOGLE_CLIENT_SECRET` in `.env` and restart PocketBase with `docker compose up -d`.
3. Invite yourself with the admin tool, pointed at the local compose file:

   ```bash
   COZY_COMPOSE_FILE=docker-compose.yml ./scripts/cozy-admin.sh add you@mauersegler.art
   ```

4. Sign in at [http://localhost:5173/admin/login](http://localhost:5173/admin/login).

Without a Google client the login page says *Google sign-in is not configured on this server yet*. Everything guest-facing still works.

::: tip Several instances on one machine
Cookies belong to a host name, not to a port. Two CozyNights instances on `localhost:5173` and `localhost:5174` in the same browser share the admin cookie, and the one that doesn't know the session deletes it for both: you get signed out at random. Give each instance its own name under `.localhost`, which browsers send to your machine anyway, for example `http://tickets.localhost:5173` and `http://staging-copy.localhost:5174`.
:::

## Everyday commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server with hot reload, after the health check |
| `npm run check` | Svelte and TypeScript type check |
| `npm run lint` | Prettier and ESLint |
| `npm test` | Vitest unit and security tests |
| `npm run test:ui` | Vitest with its browser UI |
| `npm run test:integration` | Integration tests against a real, empty PocketBase in Docker |
| `npm run test:smoke` | Smoke tests against the staging Docker image, driven over HTTP |
| `npm run verify` | Type check, unit, integration and smoke tests — everything CI runs |
| `npm run smoke:remote` | The read-only smoke tests against a deployed site (`SMOKE_BASE_URL`) |
| `npm run test:e2e` | Playwright end-to-end tests; starts the dev server if needed |
| `npm run test:e2e:ui` | Playwright in UI mode |
| `npm run health` | Just the health check |
| `npm run build` / `npm run preview` | Production build and a local preview of it |
| `npm run typegen` | Regenerates `src/lib/pocketbase-types.ts` from your local schema |

## Tests

::: code-group

```bash [Everything CI runs]
npm run verify
```

```bash [Unit & security]
npm test
```

```bash [Integration & smoke]
npm run test:integration
npm run test:smoke
```

```bash [End-to-end]
npm run test:setup
npm run test:e2e
```

:::

- **`npm run verify`** runs the type check and the unit, integration and smoke tests — the same checks GitHub runs on every pull request. It needs Docker and nothing else, and it never touches your dev database.
- **Vitest** (`tests/*.test.ts`) covers booking rules, the admin sign-in checks, encryption and hashing, UI helpers, the [start page title](./effigy-title) and the legal page settings. It runs without a database.
- **Integration tests** (`tests/integration/`) start a real, empty PocketBase in Docker, apply the migrations and hooks, and check the schema, API rules, admin roles and the booking service.
- **Smoke tests** (`tests/smoke/`) build the same Docker image staging builds and drive it over HTTP. `npm run smoke:remote` runs their read-only part against a deployed site.
- **Playwright** (`tests/e2e/`) walks through the real guest journey in Chromium against your local stack: sign in with a code, open the map, book and release a spot. Optional and local only.
- **Start page title and legal pages** (`tests/e2e/landing.test.ts`, `tests/e2e/legal.test.ts`) need no PocketBase. Start the dev server without the health check, then run them in a second terminal:

  ```bash
  npx vite dev
  npx playwright test tests/e2e/landing.test.ts tests/e2e/legal.test.ts
  ```

  They run in Chromium and in WebKit on an emulated iPhone (`npx playwright install webkit` once).

The layers, the throwaway test stack and the release routine are described in [Testing & release checks](./testing).

## Changing the database schema

Schema and API rules are code: `pb_migrations/*.js`, applied by PocketBase on start.

- **Locally**, PocketBase writes a new migration file into `pb_migrations/` whenever you change a collection in its dashboard. Review that file before you commit it.
- **On servers** PocketBase runs with `--automigrate=false`, so schema changes only ever arrive through committed migrations.
- Environments may start from a restored backup that already contains parts of the schema. Write migrations so they tolerate existing collections and fields; the existing migrations show the pattern.
- After changing the schema, run `npm run typegen` so the TypeScript types match.
- Hooks in `pb_hooks/` and the migrations use the JavaScript API of the pinned PocketBase version (see `docker-compose.yml`). Read the PocketBase changelog and back up the data before bumping it.

## Conventions

- **One feature per branch, merged into `integration/staging` with a signed merge commit**, released to `main` by pull request. See [Branches, integration & releases](./integration).
- **Never commit data or secrets.** The repository is public: `.env` files, `pb_data/` and database snapshots (encrypted or not) stay out of git, and no password, token or key goes into a script, a compose file or `package.json`; scripts read them from the environment. The gitleaks hook (setup step 5) and the `Secrets` CI job refuse the obvious cases. Share data through a private channel.
- Format with Prettier and satisfy ESLint: `npm run lint` must pass.
- Server-only code goes to `src/lib/server/`; it must never be imported by client components.
- Every read of ticket data happens on the server, and page data is trimmed to what the page shows. See [Security & privacy](../reference/security).
- Document exported functions with JSDoc (`@param`, `@returns`) and give complex modules a short overview comment.
- The event runs in Europe/Berlin: use the helpers in `src/lib/time.ts` for anything admins enter as a date or time.
