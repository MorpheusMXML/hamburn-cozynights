#!/usr/bin/env bash
# Runs the tests that need real services against a throwaway Docker stack
# (docker-compose.test.yml): an empty PocketBase with the committed migrations
# and hooks, and — for the smoke tests — the app built from the staging Dockerfile.
#
# Usage (normally through npm, see package.json):
#   scripts/test-stack.sh integration          PocketBase only  → tests/integration
#   scripts/test-stack.sh smoke                PocketBase + app → tests/smoke
#   scripts/test-stack.sh integration smoke    both, one stack
#   scripts/test-stack.sh down                 remove a stack left behind
#
# KEEP_STACK=1 leaves the stack running afterwards (debugging); the generated
# connection details are printed so you can re-run vitest by hand.
# TEST_PB_PORT / TEST_APP_PORT change the local ports (default 8290 / 3290).
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$APP_DIR"

export TEST_PB_PORT="${TEST_PB_PORT:-8290}"
export TEST_APP_PORT="${TEST_APP_PORT:-3290}"
PB_FLAGS=(--dir=/pb_data --hooksDir=/pb_hooks --migrationsDir=/pb_migrations)

compose() { docker compose -f "$APP_DIR/docker-compose.test.yml" "$@"; }
log() { printf '\n[test-stack] %s\n' "$*"; }

[[ $# -ge 1 ]] || { sed -n '2,/^set -euo pipefail$/p' "${BASH_SOURCE[0]}" | sed '$d' | sed 's/^# \{0,1\}//'; exit 1; }

# Throwaway credentials for this run only. The database lives in a tmpfs and
# is gone afterwards, so nothing here is worth keeping (or committing).
export PB_ADMIN_EMAIL="app-service@cozynights.test"
export PB_ADMIN_PASSWORD="${PB_ADMIN_PASSWORD:-$(openssl rand -hex 16)}"
export ENCRYPTION_KEY="${ENCRYPTION_KEY:-$(openssl rand -hex 32)}"

if [[ "$1" == "down" ]]; then
	compose --profile app down --volumes --remove-orphans
	exit 0
fi

for suite in "$@"; do
	[[ "$suite" == "integration" || "$suite" == "smoke" ]] || { echo "unknown suite: $suite" >&2; exit 1; }
done

status=0
cleanup() {
	if [[ $status -ne 0 ]]; then
		log "FAILED — last container logs:"
		compose --profile app logs --tail 40 || true
	fi
	if [[ "${KEEP_STACK:-0}" == 1 ]]; then
		log "KEEP_STACK=1 — stack left running (remove it with: scripts/test-stack.sh down)"
		echo "  PB_TEST_URL=$PB_TEST_URL SMOKE_BASE_URL=${SMOKE_BASE_URL:-} PB_ADMIN_EMAIL=$PB_ADMIN_EMAIL PB_ADMIN_PASSWORD=$PB_ADMIN_PASSWORD"
	else
		compose --profile app down --volumes --remove-orphans >/dev/null 2>&1 || true
	fi
}
trap 'status=$?; cleanup' EXIT

log "starting an empty PocketBase on 127.0.0.1:$TEST_PB_PORT"
compose --profile app down --volumes --remove-orphans >/dev/null 2>&1 || true
compose up -d --wait pocketbase
export PB_TEST_URL="http://127.0.0.1:$TEST_PB_PORT"

# Same path as on a server (scripts/cozy-admin.sh service-account). It only
# works if pb_hooks/cozy_admin.pb.js loaded and the migrations have run.
log "creating the app's service account (cozy-admin service-account)"
compose exec -T -e COZY_SU_PASSWORD="$PB_ADMIN_PASSWORD" pocketbase \
	/usr/local/bin/pocketbase cozy-admin service-account "$PB_ADMIN_EMAIL" "${PB_FLAGS[@]}" 2>&1

for suite in "$@"; do
	if [[ "$suite" == "smoke" ]]; then
		log "building and starting the app image on 127.0.0.1:$TEST_APP_PORT"
		compose --profile app up -d --build --wait app
		export SMOKE_BASE_URL="http://127.0.0.1:$TEST_APP_PORT"
		export SMOKE_FULL=1
	fi
	log "running tests/$suite"
	npx vitest run --config vitest.stack.config.ts "tests/$suite"
done

log "all good: $*"
