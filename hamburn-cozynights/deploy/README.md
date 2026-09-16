# Staging deploy

Staging (`https://test-cozynights.hamburn.de`) runs from a checkout of this repo
at `/opt/hamburn-cozynights-staging` on the server. `deploy-staging.sh` resets
that checkout to `origin/main`, rebuilds the `app` image and restarts the stack.
PocketBase data lives in the `pb_data_staging` volume and survives deploys.

See `docs/DEPLOYMENT.md` for the overall design.

## Manual deploy

From your own admin login on the server:

```bash
sudo -u deploy /usr/local/bin/deploy-cozynights-staging
```

(Before the deploy user exists, run `deploy-staging.sh` from the checkout as a
user with Docker access instead.) Verify afterwards:

```bash
docker ps --filter name=cozynights-staging
docker logs --tail 50 cozynights-staging-app
```

`set -euo pipefail` means a failed build aborts before `up -d`, so the
previous containers keep serving.

## One-time setup: automatic deploy on push to `main`

`.github/workflows/deploy-staging.yml` SSHes in as a restricted `deploy` user
whose key can only run the deploy script (forced command).

### 1. Server (as root)

```bash
adduser --disabled-password --gecos "" deploy
# Docker access is required to rebuild the stack. Note: docker group membership
# is effectively root-equivalent; the forced command below is what limits it.
usermod -aG docker deploy
chown -R deploy:deploy /opt/hamburn-cozynights-staging

# Install the script outside the checkout so a deploy can't rewrite the
# command that runs it. Re-copy it if deploy-staging.sh ever changes.
install -o root -g root -m 755 \
  /opt/hamburn-cozynights-staging/hamburn-cozynights/deploy/deploy-staging.sh \
  /usr/local/bin/deploy-cozynights-staging
```

### 2. Deploy key (on your machine, not the server)

```bash
ssh-keygen -t ed25519 -N "" -C "github-actions-staging" -f ./deploy_staging
```

Append the **public** key to `/home/deploy/.ssh/authorized_keys` (dir `700`,
file `600`, owned by `deploy`), prefixed with the forced command:

```text
command="/usr/local/bin/deploy-cozynights-staging",no-port-forwarding,no-X11-forwarding,no-agent-forwarding,no-pty ssh-ed25519 AAAA... github-actions-staging
```

### 3. GitHub secrets (environment `staging`)

```bash
gh secret set STAGING_SSH_HOST --env staging --body "<server hostname or IP>"
gh secret set STAGING_DEPLOY_SSH_KEY --env staging < ./deploy_staging
```

Then delete the local private key (`rm ./deploy_staging`) — GitHub holds the
only copy. If SSH runs on a non-default port, also add `port:` to the workflow.

### 4. Test

```bash
gh workflow run deploy-staging.yml
gh run watch
```
