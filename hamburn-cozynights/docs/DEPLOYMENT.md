# 🚀 Deployment & Environments

This describes how Hamburn Cozynights moves from a developer's machine to a
publicly reachable environment, and how staging and production are meant to
stay isolated from each other despite sharing one physical server.

## 1. Environments

| Environment | Purpose                                    | Data                                              |
| :---------- | :------------------------------------------ | :------------------------------------------------- |
| **Local**   | Development on your own machine (`npm run dev` + `npm run db:up`). | Your own local `pb_data/`, never shared. |
| **Staging** | Testing with real users before things go live — its own subdomain, its own PocketBase instance, its own `.env`. | Isolated. Treat as disposable. |
| **Production** | The live event. | Real bookings. |

Staging and production are **fully separate stacks** (separate containers,
separate Docker network, separate database volume, separate `ENCRYPTION_KEY`).
Nothing staging does can touch production data, and vice versa, even though
both may run on the same physical server. See `docker-compose.staging.yml`
for the pattern — a production compose file follows the same shape with
different values.

## 2. Secrets

No secret (admin password, `ENCRYPTION_KEY`, OAuth client secret, …) is ever
committed to this repository, regardless of the repo's visibility. Each
environment has its own `.env` file that:

- lives only on the machine that runs it (a developer's laptop, or the
  server itself),
- is listed in `.gitignore`,
- is created once by hand and then left alone — the deploy pipeline never
  needs to read or write secret values, only application code.

The team keeps a copy of each environment's real values in a password
manager, not in chat, not in a text file inside the repo.

## 3. Deployment pipeline

Pushing to `main` (paths under `hamburn-cozynights/`) triggers a GitHub
Actions workflow (`.github/workflows/deploy-staging.yml`) that deploys to
staging automatically. The workflow authenticates as a dedicated,
non-privileged **deploy user** on the server whose SSH key can run exactly
one thing — the deploy script for that environment — and nothing else. It
cannot log in interactively, read other files, or touch any other service on
the server. Regular administrative access to the server (system updates,
other applications, etc.) uses a separate, personally-held credential and is
never shared with CI.

A production workflow can be added later by copying the staging one with a
different target directory, domain, and GitHub Environment (so it can
require manual approval before deploying).

## 4. Server-side layout

Each environment's container(s) bind only to the server's own loopback
address — they are never directly reachable from the internet. A single
nginx instance on the host terminates TLS (via Certbot) and reverse-proxies
each environment's subdomain to its own local port, the same pattern already
used for the server's other applications. This keeps every environment's
attack surface limited to "does nginx route this domain correctly," rather
than each container managing its own public exposure.

## 5. Access model on public environments

There is no login gate in front of staging or production anymore: guests reach
the site with their ticket code, exactly like on production. (Staging used to
sit behind an `oauth2-proxy` Google gate; it was removed so staging behaves
like production.)

- **PocketBase is not public.** nginx only proxies the SvelteKit app. The app
  talks to PocketBase over the compose network (`PB_URL=http://pocketbase:8090`),
  and the dashboard (`/_/`) is only reachable through an SSH tunnel:
  `ssh -N -L 8091:127.0.0.1:8091 root@<server>`, then http://127.0.0.1:8091/_/.
- **The admin area** (`/admin`) is protected by the app's own Google sign-in,
  limited to approved `@mauersegler.art` Workspace accounts. See
  [SECURITY.md](SECURITY.md#2-admin-access) for the full model.

### Admin access (run on the server as root)

Team members sign in at `/admin/login` with Google. Their first sign-in
creates an access request (role `pending`, no rights). Approve or manage
access with `scripts/cozy-admin.sh`, next to the compose file — or in the
PocketBase dashboard (collection `admins`, field `role`):

```bash
cd /opt/hamburn-cozynights-staging/hamburn-cozynights
./scripts/cozy-admin.sh list                               # pending requests, admins, superusers
./scripts/cozy-admin.sh approve someone@mauersegler.art    # approve a request (role admin)
./scripts/cozy-admin.sh add someone@mauersegler.art        # or invite up front
./scripts/cozy-admin.sh superuser max@mauersegler.art      # prompts for a password
./scripts/cozy-admin.sh remove someone@mauersegler.art     # reject/revoke immediately
./scripts/cozy-admin.sh service-account                    # create/rotate PB_ADMIN_* in .env
```

New requests can be announced in a chat: set `COZY_ADMIN_WEBHOOK_URL`
(Telegram, Slack, Google Chat or Discord webhook, see `.env.example`) and run
`docker compose -f docker-compose.staging.yml up -d pocketbase`.

- `superuser` sets a PocketBase superuser (dashboard login with that password)
  **and** grants the app role `superuser`. In the app, everyone signs in with
  Google — the password is only for the PocketBase dashboard.
- `service-account` manages the app's own superuser (`PB_ADMIN_EMAIL` /
  `PB_ADMIN_PASSWORD`). Never use a person's account for it: rotating its
  password revokes the app's token.

### Google OAuth client

PocketBase needs a Google OAuth client ("Web application") for the `admins`
collection, provided as `PB_GOOGLE_CLIENT_ID` / `PB_GOOGLE_CLIENT_SECRET` in the
environment's `.env` (the secret in single quotes). Authorized redirect URI:
`https://<domain>/auth/callback/google`. Use an **Internal** consent screen in
the mauersegler.art Google Workspace if possible. The values are synced into
PocketBase on every start (`pb_hooks/cozy_admin.pb.js`), so rotating the secret
is an `.env` change plus `docker compose up -d pocketbase`.

## 6. Adding a new environment

1. Copy `docker-compose.staging.yml` to `docker-compose.<env>.yml`, adjust
   container names, ports, volume names and `ORIGIN` so they don't collide with
   any existing environment. `scripts/cozy-admin.sh` targets it with
   `COZY_COMPOSE_FILE=docker-compose.<env>.yml`.
2. Create that environment's `.env` on the server (never in git).
3. Add an nginx vhost for its subdomain (see `deploy/nginx/` for the
   pattern) and issue a certificate for it. Add
   `https://<subdomain>/auth/callback/google` to the Google OAuth client.
4. Add a GitHub Actions workflow mirroring `deploy-staging.yml`, pointed at
   a deploy user scoped to that environment's directory only.

## 7. Schema migrations

The collection schema and API rules live in `pb_migrations/` and are applied by
PocketBase on start (`--automigrate=false`, so dashboard edits never write new
migration files into the checkout). Migrations are written to be idempotent,
because an environment may start from a restored database backup that already
contains the collections. After every deploy, check that nothing failed:

```bash
docker compose -f docker-compose.staging.yml logs pocketbase | grep -iE 'failed to (apply|execute)' || echo ok
```

The PocketBase image is pinned (`ghcr.io/muchobien/pocketbase:0.40.4`): hooks and
migrations use its JavaScript API, and PocketBase's own system migrations are
one-way. Back up the data volume before bumping it.
