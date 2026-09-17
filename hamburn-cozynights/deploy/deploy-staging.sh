#!/usr/bin/env bash
# Staging deploy. Runs on the server as the restricted `deploy` user, installed
# at /usr/local/bin/deploy-cozynights-staging and used as the SSH forced command
# (see deploy/README.md). GitHub Actions sends "deploy <commit-sha>"; only that
# 40-char SHA is taken from the request, everything else is ignored.
#
# Steps: checkout SHA → build app image (old containers keep serving) →
# stop PocketBase → back up its volume → up -d → health check.
# If the health check fails, the previous commit is rebuilt and started again.
set -euo pipefail

CONFIG=/etc/cozynights/deploy-staging.conf
# shellcheck source=/dev/null
source "$CONFIG"
: "${APP_DIR:?APP_DIR missing in $CONFIG}"
: "${COMPOSE_PROJECT_NAME:?COMPOSE_PROJECT_NAME missing in $CONFIG}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.staging.yml}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/cozynights-staging}"
BACKUP_KEEP="${BACKUP_KEEP:-10}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:3001/}"
PB_CONTAINER="${PB_CONTAINER:-cozynights-staging-pocketbase}"
export COMPOSE_PROJECT_NAME

log() { printf '[deploy %s] %s\n' "$(date -u +%H:%M:%S)" "$*"; }

request="${SSH_ORIGINAL_COMMAND:-${1:-}}"
sha="$(grep -oE '\b[0-9a-f]{40}\b' <<<"$request" | head -n1 || true)"
if [[ -z "$sha" ]]; then
	echo "usage: deploy <40-char commit sha>" >&2
	exit 2
fi

mkdir -p "$BACKUP_DIR"
exec 9>"$BACKUP_DIR/.deploy.lock"
if ! flock -n 9; then
	echo "another deploy is already running" >&2
	exit 3
fi

cd "$APP_DIR"
if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
	echo "refusing to deploy: tracked files in $APP_DIR have local changes:" >&2
	git status --short --untracked-files=no >&2
	exit 4
fi

prev="$(git rev-parse HEAD)"
log "current: $prev"
log "target:  $sha"

git fetch --prune --quiet origin '+refs/heads/*:refs/remotes/origin/*'
if ! git cat-file -e "${sha}^{commit}" 2>/dev/null; then
	echo "commit $sha not found on origin" >&2
	exit 5
fi

compose() { docker compose -f "$APP_DIR/hamburn-cozynights/$COMPOSE_FILE" "$@"; }

build_and_start() {
	git -C "$APP_DIR" checkout --quiet --detach "$1"
	compose build app
	compose up -d --remove-orphans
}

healthy() {
	for _ in $(seq 1 30); do
		if curl -fsS -o /dev/null --max-time 5 "$HEALTH_URL"; then return 0; fi
		sleep 2
	done
	return 1
}

# Build first: the running containers keep serving until `up -d`.
git checkout --quiet --detach "$sha"
log "building app image"
if ! compose build app; then
	git checkout --quiet --detach "$prev"
	log "build failed — nothing changed, still serving $prev"
	exit 6
fi

# Consistent PocketBase snapshot: stop it briefly, archive the volume.
volume="$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/pb_data"}}{{.Name}}{{end}}{{end}}' "$PB_CONTAINER" 2>/dev/null || true)"
if [[ -n "$volume" ]]; then
	backup="pb_data-$(date -u +%Y%m%dT%H%M%SZ)-${prev:0:7}.tar.gz"
	log "backing up volume $volume → $BACKUP_DIR/$backup"
	compose stop pocketbase
	# backups/ holds PocketBase's own hourly ZIPs (pb_hooks/cozy_backups.pb.js):
	# not needed to roll back a deploy, and they would bloat every archive.
	docker run --rm -v "$volume":/pb_data:ro -v "$BACKUP_DIR":/backup alpine \
		tar czf "/backup/$backup" --exclude=./backups -C /pb_data .
	ls -1t "$BACKUP_DIR"/pb_data-*.tar.gz | tail -n +"$((BACKUP_KEEP + 1))" | xargs -r rm --
elif [[ "${ALLOW_NO_BACKUP:-0}" == 1 ]]; then
	log "WARNING: $PB_CONTAINER not found, skipping backup (ALLOW_NO_BACKUP=1)"
else
	git checkout --quiet --detach "$prev"
	log "no PocketBase volume found on $PB_CONTAINER — aborting, still serving $prev"
	log "(first deploy without a running stack: set ALLOW_NO_BACKUP=1 in $CONFIG)"
	exit 7
fi

log "starting stack"
compose up -d --remove-orphans

if healthy; then
	docker image prune -f >/dev/null
	log "deployed $sha"
	exit 0
fi

log "health check failed on $HEALTH_URL — rolling back to $prev"
compose logs --tail 40 app || true
build_and_start "$prev"
if healthy; then
	log "rollback to $prev succeeded"
else
	log "rollback to $prev is ALSO unhealthy — manual intervention needed"
fi
exit 1
