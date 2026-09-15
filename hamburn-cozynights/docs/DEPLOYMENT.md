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

## 5. Staging access gate

Staging carries real booking data (restored from a backup) and is reachable
from the public internet, so before anyone outside the team is pointed at
it, the whole environment (guest flow included, not just `/admin`) sits
behind a Google login gate: `oauth2-proxy` in front of nginx, restricted to
the team's Workspace domain via `OAUTH2_PROXY_EMAIL_DOMAINS`. This is
separate from the app's own PocketBase OAuth (which only guards `/admin`)
— it's a blanket gate on the whole staging subdomain, implemented entirely
at the nginx/oauth2-proxy layer via `auth_request`, with no changes to the
app itself. See `docker-compose.staging.yml` and `deploy/nginx/` for the
concrete setup. Production is not expected to need this, since anyone with
a valid ticket code is supposed to reach it.

## 6. Adding a new environment

1. Copy `docker-compose.staging.yml` to `docker-compose.<env>.yml`, adjust
   container names, ports, and volume names so they don't collide with any
   existing environment.
2. Create that environment's `.env` on the server (never in git).
3. Add an nginx vhost for its subdomain (see `deploy/nginx/` for the
   pattern) and issue a certificate for it.
4. Add a GitHub Actions workflow mirroring `deploy-staging.yml`, pointed at
   a deploy user scoped to that environment's directory only.

## 7. Known gap: schema isn't version-controlled

The PocketBase collection schema (`houses`, `rooms`, `beds`, `orders`,
`app_settings`) and their API access rules currently exist only inside
whatever database is running — there are no exported migrations in this
repo. This means every fresh environment needs its schema recreated by
hand (or restored from a backup) before the app is usable, and there is no
single source of truth for what the correct API access rules should be.
Exporting PocketBase's collections via its migration feature and committing
the result would close this gap.
