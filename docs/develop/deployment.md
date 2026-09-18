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

Staging is deployed **on demand**, from any branch, with a button in GitHub Actions.

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
  run(["▶ Run workflow on a branch"]) --> verify["CI: npm ci · npm test · docker build"]
  verify -- fails --> stop1["❌ Server untouched"]
  verify --> approve{"Reviewer<br/>approval"}
  approve --> server["🖥️ On the server, via a key that can only start the deploy script:<br/>check out the commit · build the image · back up PocketBase · restart"]
  server --> health{"Health check<br/>within 60 s"}
  health -- ok --> done["✅ Deployed"]
  health -- fails --> rollback["↩ Previous commit restarted,<br/>job turns red"]
```

The old containers keep serving while the new image builds.

- The script **refuses to deploy** and changes nothing if the server checkout has local changes, the build fails, or the backup can't be written.
- The **PocketBase version** comes from the compose file of the deployed commit. It is pinned and never updated implicitly.
- The one-time server setup, restoring a data backup, and maintenance are in the operator runbook [`hamburn-cozynights/deploy/README.md`](https://github.com/MorpheusMXML/hamburn-cozynights/blob/main/hamburn-cozynights/deploy/README.md) (German).

### After a deploy

Check that all migrations went through:

```bash
docker compose -f docker-compose.staging.yml logs pocketbase | grep -iE 'failed to (apply|execute)' || echo ok
```

Then sign in to `/admin` once and open the camp map with a test ticket code.

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

Optionally, a crew-chat webhook (Telegram, Slack, Google Chat or Discord) announces new admin access requests.

## Adding an environment

Production, for example:

<div class="steps">

1. **Compose file.** Copy `docker-compose.staging.yml` to `docker-compose.<env>.yml` and give containers, ports, volume and `ORIGIN` their own values, so nothing collides with other environments.
2. **Configuration.** Create the environment's `.env` on the server, following `deploy/staging.env.template`. Never commit it.
3. **Domain.** Add an nginx vhost for the domain (see `deploy/nginx/`), issue a certificate, and add the redirect URI to the Google OAuth client.
4. **Pipeline.** Add a workflow mirroring `deploy-staging.yml`, with its own GitHub environment and required approval, and a deploy user scoped to that environment only.
5. **First admins.** Invite the crew with the admin tool, pointed at the new compose file (`COZY_COMPOSE_FILE=docker-compose.<env>.yml`). See [Admin access & roles](../admin/access#managing-admins).

</div>

## Documentation site

These docs are built and published by their own workflow. See [Working on these docs](./docs).
