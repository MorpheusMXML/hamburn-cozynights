#!/usr/bin/env bash
# Runs on the server as the restricted `deploy` user (forced command via
# authorized_keys — see docs/DEPLOYMENT.md). Deploys the `main` branch to staging.
set -euo pipefail

cd /opt/hamburn-cozynights-staging

git fetch origin main
git reset --hard origin/main

# The SvelteKit project (Dockerfile, compose files) lives in the nested
# hamburn-cozynights/ subfolder of this repo, not at its root.
cd hamburn-cozynights

docker compose -f docker-compose.staging.yml pull pocketbase
docker compose -f docker-compose.staging.yml build app
# --remove-orphans: drops containers of services that no longer exist in the
# compose file (e.g. the former oauth2-proxy login gate).
docker compose -f docker-compose.staging.yml up -d --remove-orphans
docker image prune -f
