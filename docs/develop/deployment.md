# Environments & deployment

## Environments

| Environment | Address | Purpose | Data |
| --- | --- | --- | --- |
| **Local** | `http://localhost:5173` | Development on your machine | Your own `pb_data/`, never shared |
| **Staging** | [test-cozynights.hamburn.de](https://test-cozynights.hamburn.de) | Testing with real Google sign-ins before anything goes live | Separate and disposable |
| **Production** | the event's address | The live event | Real tickets and bookings |

Staging behaves exactly like production: no extra login gate in front of it, guests use ticket codes, admins use Google.

### How environments stay apart

Even on the same physical server, every environment is a **separate stack**: its own containers, Docker network, database volume, configuration and encryption key. Nothing staging does can touch production data.

```mermaid
flowchart LR
  internet(("🌍 Internet")) --> nginx["nginx on the host<br/>TLS for every domain"]
  subgraph staging["Staging stack"]
    sapp["app"] --> spb[("PocketBase")]
  end
  subgraph production["Production stack"]
    papp["app"] --> ppb[("PocketBase")]
  end
  nginx -- "test-cozynights.…" --> sapp
  nginx -- "event domain" --> papp
```

- Containers bind to the server's **loopback interface only**; nginx is the single public entry point and terminates TLS.
- **PocketBase is never public.** The app reaches it over the stack's internal network.
- **No secrets in git.** Each environment's `.env` exists only on its server (plus a copy in the team's password manager). The staging layout of that file is described in `deploy/staging.env.template`.

## Deploying to staging

Staging is deployed **on demand** with a button in GitHub Actions. It runs **`integration/staging`** (see [Branches, integration & releases](./integration)): deploying a single feature branch would drop every other feature from the server.

::: code-group

```text [GitHub UI]
Actions → Deploy staging → Run workflow → choose the branch
→ approve the "staging" deployment in the run
```

```bash [gh CLI]
gh workflow run deploy-staging.yml --ref <branch>
gh run watch
```

:::

```mermaid
flowchart TD
  run(["▶ Run workflow on a branch"]) --> verify["🧪 verify — the same checks as every pull request:<br/>type check · unit tests<br/>integration tests against an empty PocketBase<br/>smoke tests against the staging Docker image"]
  verify -- fails --> stop1["❌ Server untouched"]
  verify --> approve{"Reviewer<br/>approval"}
  approve --> server["🖥️ deploy — on the server, via a key that can only start the deploy script:<br/>check out the commit · build the image · back up PocketBase · restart"]
  server --> health{"Health check<br/>within 60 s"}
  health -- fails --> rollback["↩ Previous commit restarted,<br/>job turns red"]
  health -- ok --> smoke["🔎 smoke — read-only checks against<br/>test-cozynights.hamburn.de from the outside"]
  smoke -- ok --> done["✅ Deployed"]
  smoke -- fails --> red["❌ Run turns red; the new version stays up,<br/>look at the site"]
```

The old containers keep serving while the new image builds.

- **`verify`** reuses [`.github/workflows/ci.yml`](https://github.com/MorpheusMXML/hamburn-cozynights/blob/main/.github/workflows/ci.yml), the workflow behind the `Verify` check on every pull request, for exactly the commit being deployed. What it runs is described in [Testing & release checks](./testing).
- **`deploy`** waits for approval in the `staging` GitHub environment, then runs the deploy script on the server.
- **`smoke`** runs `npm run smoke:remote` against the live site: pages are served, `/api/health` confirms the service account, a ticket lookup reaches the database, the admin login page offers Google sign-in, the admin area is closed, the security headers are present and PocketBase is not reachable from outside. Read-only, no credentials.
- The script **refuses to deploy** and changes nothing if the server checkout has local changes, the build fails, or the backup can't be written.
- The **PocketBase version** comes from the compose file of the deployed commit. It is pinned and never updated implicitly.
- The one-time server setup, restoring a data backup, and maintenance are in the operator runbook [`hamburn-cozynights/deploy/README.md`](https://github.com/MorpheusMXML/hamburn-cozynights/blob/main/hamburn-cozynights/deploy/README.md) (German).

### After a deploy

Check that all migrations went through:

```bash
docker compose -f docker-compose.staging.yml logs pocketbase | grep -iE 'failed to (apply|execute)' || echo ok
```

The `smoke` job has already confirmed that pages are served and the app reaches its database. Then sign in to `/admin` once and open the camp map with a test ticket code.

## Backups and where data lives

| What | Source of truth |
| --- | --- |
| Code, schema (`pb_migrations/`), hooks, location templates | Git |
| Secrets (each environment's `.env`, `ENCRYPTION_KEY`) | the server, the team's password manager and an offline emergency sheet |
| Live data (ticket codes, bookings, admins) | the PocketBase volume on the server, plus backups |

The live database stays on the server's local disk. SQLite must not run on a network share: file locking over the network is unreliable and can corrupt the database. A Storage Box is a backup target only.

Backups come in layers. The first two need no setup:

- **Hourly ZIPs:** PocketBase writes ZIP backups into its volume (`pb_hooks/cozy_backups.pb.js`, `PB_BACKUP_CRON` / `PB_BACKUP_KEEP`; default: hourly, keep 72). A quick undo from the dashboard.
- **Before every deploy:** the deploy script archives the volume.
- **Versioned server backup, hourly:** `deploy/backup/server-backup.sh` copies all live databases of the server consistently and stores them, together with configuration and certificates, in an encrypted [restic](https://restic.net) repository (24 hourly, 14 daily, 8 weekly and 12 monthly snapshots). It alerts on failure and on a disk running full, and test-restores the databases weekly.

The restic repository is set up in two stages that differ by one line of configuration:

| Stage | Repository | Survives |
| --- | --- | --- |
| **1, now** | a root-only directory on the server | mistakes, bad deploys, a broken database |
| **2, later** | a Hetzner Storage Box (off-site) | also losing or compromising the server |

During stage 1 every layer shares the server's disk. Until the Storage Box is there, a weekly pull of the encrypted repository to a laptop and Hetzner's server backups bridge that gap.

Setup, restore, the move to the Storage Box and the emergency sheet are in the operator runbook [`hamburn-cozynights/deploy/backup/README.md`](https://github.com/MorpheusMXML/hamburn-cozynights/blob/main/hamburn-cozynights/deploy/backup/README.md) (German).

::: warning Keep the encryption key outside the server too
Without an environment's `ENCRYPTION_KEY`, a restored database is useless: burner names can't be decrypted and ticket codes no longer match.
:::

## Google sign-in per environment

Each environment needs the Google OAuth client to know its address:

- OAuth client type **Web application**, ideally with an **Internal** consent screen in the `mauersegler.art` Google Workspace.
- Authorized redirect URI: `https://<domain>/auth/callback/google`.
- The client ID and secret are part of the environment's server configuration. PocketBase picks up changes on restart.

## Notifications per environment

Booking confirmations and crew alerts are sent by PocketBase (`pb_hooks/cozy_notify.pb.js`); what and when is described in [Notifications](../admin/notifications). All settings are optional values in the environment's `.env`, passed to the PocketBase container by the compose file:

| Setting | For |
| --- | --- |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD`, `SMTP_TLS`, `MAIL_FROM_ADDRESS`, `MAIL_FROM_NAME`, `MAIL_REPLY_TO` | E-mail to guests. Applied to PocketBase's mail settings on every start. |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` (`TELEGRAM_THREAD_ID`) | The crew group, and guests' Telegram updates (off: `TELEGRAM_GUEST_UPDATES=off`). |
| `COZY_ADMIN_WEBHOOK_URL` | Older crew webhook (Slack, Google Chat, Discord, Telegram URL), used when `TELEGRAM_*` are empty. |
| `COZY_APP_URL`, `COZY_ENV_LABEL` | Links in messages and the `[STAGING]` marker. Set in the compose file, not in `.env`. |

- **One Telegram bot per environment.** The server reads the bot's messages by polling; two environments with the same bot would steal each other's messages.
- **The mail password is stored twice.** PocketBase keeps its own copy of the SMTP settings in its database, so it is also in every database backup. Use credentials that can only send mail — an SMTP user of a sending service, one per environment — never the password of a mailbox.
- **Check after setting it up**, on the server: `./scripts/cozy-admin.sh notify status` and `./scripts/cozy-admin.sh notify test --email <you>`.

## Adding an environment

Production, for example:

<div class="steps">

1. **Compose file.** Copy `docker-compose.staging.yml` to `docker-compose.<env>.yml` and give containers, ports, volume and `ORIGIN` their own values, so nothing collides with other environments. Also set `COZY_APP_URL` (the links in guest messages) and `COZY_ENV_LABEL` (empty for production: no `[STAGING]` marker).
2. **Configuration.** Create the environment's `.env` on the server, following `deploy/staging.env.template`. Never commit it. It also holds the operator details for the Impressum and the privacy policy (`LEGAL_*`, see [Legal pages](../admin/legal)).
3. **Domain.** Add an nginx vhost for the domain (see `deploy/nginx/`), issue a certificate, and add the redirect URI to the Google OAuth client.
4. **Pipeline.** Add a workflow mirroring `deploy-staging.yml`, with its own GitHub environment and required approval, and a deploy user scoped to that environment only.
5. **First admins.** Invite the crew with the admin tool, pointed at the new stack: `COZY_COMPOSE_FILE=docker-compose.<env>.yml COMPOSE_PROJECT_NAME=<project of that stack>` (or `COZY_DEPLOY_CONF=/etc/cozynights/<env>.conf`). The tool refuses to guess the project name, because a guess would silently target the staging containers. See [Admin access & roles](../admin/access#managing-admins).
6. **Keep the stacks apart.** Give the new compose file a fixed volume name and its own `container_name`s and ports; the deploy script gets its own config in `/etc/cozynights/` and its own backup folder; the forced-command deploy key is a second key. Both stacks share one Docker daemon, so never prune images while the other stack builds.

</div>

## Documentation site

These docs are built and published by their own workflow. See [Working on these docs](./docs).
