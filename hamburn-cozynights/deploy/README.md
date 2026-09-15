# Staging deploy — one-time setup checklist

`deploy-staging.sh` and `.github/workflows/deploy-staging.yml` already exist
and are correct, but the pipeline has never actually run end-to-end: the
GitHub Actions side needs two repo secrets it doesn't have yet, and the
server side needs the restricted `deploy` user, the initial checkout, and
the nginx vhost. None of this can be done from inside a coding session — it
needs someone with SSH access to the target server and admin access to the
GitHub repo. This is that checklist, in order.

See `docs/DEPLOYMENT.md` for the _why_ behind this design (isolated
environments, no secrets in git, a deploy user restricted to one command).
This file is the concrete _how_.

## 1. On the server: create the restricted `deploy` user

```bash
sudo adduser --disabled-password --gecos "" deploy
sudo mkdir -p /home/deploy/.ssh
```

Generate a dedicated keypair **on your own machine** (not the server) — this
becomes the GitHub secret, never a personal key:

```bash
ssh-keygen -t ed25519 -f ./hamburn-staging-deploy-key -N "" -C "github-actions-staging-deploy"
```

Install the **public** key on the server, restricted to run only the deploy
script — this is what makes the key safe to hand to CI:

```bash
# on the server, as root/sudo:
echo 'command="/opt/hamburn-cozynights-staging/hamburn-cozynights/deploy/deploy-staging.sh",no-port-forwarding,no-X11-forwarding,no-agent-forwarding,no-pty ssh-ed25519 AAAA...your-public-key... github-actions-staging-deploy' \
  | sudo tee /home/deploy/.ssh/authorized_keys
sudo chown -R deploy:deploy /home/deploy/.ssh
sudo chmod 700 /home/deploy/.ssh
sudo chmod 600 /home/deploy/.ssh/authorized_keys
```

The `command=` prefix means this key can _only_ ever run
`deploy-staging.sh`, regardless of what the client sends — this is what the
workflow's `script: echo "triggering forced deploy command"` comment refers
to.

## 2. On the server: initial checkout and environment

```bash
sudo mkdir -p /opt/hamburn-cozynights-staging
sudo chown deploy:deploy /opt/hamburn-cozynights-staging
sudo -u deploy git clone <this-repo-url> /opt/hamburn-cozynights-staging
cd /opt/hamburn-cozynights-staging/hamburn-cozynights
cp .env.example .env
# Fill in .env by hand: PUBLIC_PB_URL=https://test-cozynights.hamburn.de/pb,
# a freshly generated ENCRYPTION_KEY, and a new PB_ADMIN_EMAIL/PASSWORD you
# choose for this environment — never reuse a password from another
# environment or from git history.
docker compose -f docker-compose.staging.yml up -d
```

## 3. On the server: nginx + TLS

```bash
sudo cp deploy/nginx/test-cozynights.hamburn.de.conf /etc/nginx/sites-available/
sudo ln -s /etc/nginx/sites-available/test-cozynights.hamburn.de.conf /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d test-cozynights.hamburn.de
```

DNS for `test-cozynights.hamburn.de` must already point at this server
before requesting the certificate.

## 4. In GitHub: repo secrets + environment

Repo → Settings → Environments → New environment → name it `staging`
(matches `environment: staging` in the workflow — required, since the
workflow's `secrets.*` are read from this environment, not repo-level
secrets). Inside that environment, add:

| Secret                   | Value                                                          |
| :----------------------- | :------------------------------------------------------------- |
| `STAGING_SSH_HOST`       | the server's hostname or IP                                    |
| `STAGING_DEPLOY_SSH_KEY` | the **private** half of the keypair from step 1, full contents |

Delete the private key file from your own machine once it's pasted in.

## 5. Verify

Push any change under `hamburn-cozynights/` to `main`, then check the
Actions tab — the "Deploy staging" workflow should run and succeed. If it
fails on the SSH step, re-check the `authorized_keys` line (a single typo
breaks the forced-command restriction) and that `deploy-staging.sh` is
executable (`chmod +x`).

## Production

Not set up yet — see `docs/DEPLOYMENT.md` §5 ("Adding a new environment")
for the pattern once you're ready: it's this same checklist again with a
separate compose file, `.env`, subdomain, and GitHub Environment, so a
production deploy can also require manual approval before it runs.
