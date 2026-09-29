#!/usr/bin/env bash
# Runs the tests that need real services against a throwaway Docker stack
# (docker-compose.test.yml): an empty PocketBase with the committed migrations
# and hooks, and — for the smoke and layout tests — the app built from the
# staging Dockerfile.
#
# Usage (normally through npm, see package.json):
#   scripts/test-stack.sh integration          PocketBase only  → tests/integration
#   scripts/test-stack.sh smoke                PocketBase + app → tests/smoke
#   scripts/test-stack.sh layout               PocketBase + app → tests/layout (Playwright)
#   scripts/test-stack.sh integration smoke    several, one stack
#   scripts/test-stack.sh down                 remove a stack left behind
#
# KEEP_STACK=1 leaves the stack running afterwards (debugging); the generated
# connection details are printed so you can re-run vitest by hand.
# LAYOUT_ARGS are passed on to Playwright, e.g. LAYOUT_ARGS=--project=chromium
# (the layout test needs its browsers once: npx playwright install chromium webkit).
# TEST_PB_PORT / TEST_APP_PORT / TEST_MOCK_PORT / TEST_MAILPIT_PORT change the
# local ports (default 8290 / 3290 / 8292 / 8293).
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$APP_DIR"

export TEST_PB_PORT="${TEST_PB_PORT:-8290}"
export TEST_APP_PORT="${TEST_APP_PORT:-3290}"
export TEST_MOCK_PORT="${TEST_MOCK_PORT:-8292}"
export TEST_MAILPIT_PORT="${TEST_MAILPIT_PORT:-8293}"
PB_FLAGS=(--dir=/pb_data --hooksDir=/pb_hooks --migrationsDir=/pb_migrations --encryptionEnv=PB_ENCRYPTION_KEY)

compose() { docker compose -f "$APP_DIR/docker-compose.test.yml" "$@"; }
log() { printf '\n[test-stack] %s\n' "$*"; }

[[ $# -ge 1 ]] || { sed -n '2,/^set -euo pipefail$/p' "${BASH_SOURCE[0]}" | sed '$d' | sed 's/^# \{0,1\}//'; exit 1; }

# Throwaway credentials for this run only. The database lives in a tmpfs and
# is gone afterwards, so nothing here is worth keeping (or committing).
export PB_ADMIN_EMAIL="app-service@cozynights.test"
export PB_ADMIN_PASSWORD="${PB_ADMIN_PASSWORD:-$(openssl rand -hex 16)}"
export ENCRYPTION_KEY="${ENCRYPTION_KEY:-$(openssl rand -hex 32)}"
# PocketBase's settings key (--encryptionEnv in docker-compose.test.yml), 32 characters.
export PB_ENCRYPTION_KEY="${PB_ENCRYPTION_KEY:-$(openssl rand -hex 16)}"

# Wallet passes (src/lib/server/wallet): a throwaway certificate chain instead
# of Apple's, and a throwaway key instead of a Google service account, so the
# smoke tests can download a real .pkpass and save a Google pass. Apple's push
# service and Google's API are pointed at the stand-ins (tests/fixtures/
# mock-services.mjs) — nothing here ever reaches Apple or Google.
wallet_credentials() {
	local dir
	dir="$(mktemp -d)"
	trap 'rm -rf "$dir"' RETURN
	openssl req -x509 -newkey rsa:2048 -nodes -keyout "$dir/wwdr.key" -out "$dir/wwdr.pem" \
		-days 2 -subj "/CN=CozyNights Test WWDR" >/dev/null 2>&1
	openssl req -newkey rsa:2048 -nodes -keyout "$dir/pass.key" -out "$dir/pass.csr" \
		-subj "/CN=Pass Type ID: pass.test.cozynights" >/dev/null 2>&1
	openssl x509 -req -in "$dir/pass.csr" -CA "$dir/wwdr.pem" -CAkey "$dir/wwdr.key" \
		-CAcreateserial -days 2 -out "$dir/pass.pem" >/dev/null 2>&1
	openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out "$dir/google.key" >/dev/null 2>&1
	export WALLET_APPLE_CERT WALLET_APPLE_KEY WALLET_APPLE_WWDR WALLET_GOOGLE_SERVICE_ACCOUNT
	WALLET_APPLE_CERT="$(base64 < "$dir/pass.pem" | tr -d '\n')"
	WALLET_APPLE_KEY="$(base64 < "$dir/pass.key" | tr -d '\n')"
	WALLET_APPLE_WWDR="$(base64 < "$dir/wwdr.pem" | tr -d '\n')"
	WALLET_GOOGLE_SERVICE_ACCOUNT="$(node -e '
		const fs = require("fs");
		const account = {
			type: "service_account",
			client_email: "wallet@cozynights.test.iam.gserviceaccount.com",
			private_key: fs.readFileSync(process.argv[1], "utf8")
		};
		process.stdout.write(Buffer.from(JSON.stringify(account)).toString("base64"));
	' "$dir/google.key")"
}
wallet_credentials

if [[ "$1" == "down" ]]; then
	compose --profile app down --volumes --remove-orphans
	exit 0
fi

for suite in "$@"; do
	[[ "$suite" =~ ^(integration|smoke|layout)$ ]] || { echo "unknown suite: $suite" >&2; exit 1; }
done

status=0
cleanup() {
	if [[ $status -ne 0 ]]; then
		log "FAILED — last container logs:"
		compose --profile app logs --tail 40 || true
	fi
	if [[ "${KEEP_STACK:-0}" == 1 ]]; then
		log "KEEP_STACK=1 — stack left running (remove it with: scripts/test-stack.sh down)"
		echo "  PB_TEST_URL=$PB_TEST_URL MOCK_URL=${MOCK_URL:-} MAILPIT_URL=${MAILPIT_URL:-} SMOKE_BASE_URL=${SMOKE_BASE_URL:-} PB_ADMIN_EMAIL=$PB_ADMIN_EMAIL PB_ADMIN_PASSWORD=$PB_ADMIN_PASSWORD"
	else
		compose --profile app down --volumes --remove-orphans >/dev/null 2>&1 || true
	fi
}
trap 'status=$?; cleanup' EXIT

log "starting an empty PocketBase on 127.0.0.1:$TEST_PB_PORT (+ mail catcher and service stand-ins)"
compose --profile app down --volumes --remove-orphans >/dev/null 2>&1 || true
compose up -d --wait mailpit mocks pocketbase
export PB_TEST_URL="http://127.0.0.1:$TEST_PB_PORT"
export MOCK_URL="http://127.0.0.1:$TEST_MOCK_PORT"
export MAILPIT_URL="http://127.0.0.1:$TEST_MAILPIT_PORT"

# Same path as on a server (scripts/cozy-admin.sh service-account). It only
# works if pb_hooks/cozy_admin.pb.js loaded and the migrations have run.
log "creating the app's service account (cozy-admin service-account)"
compose exec -T -e COZY_SU_PASSWORD="$PB_ADMIN_PASSWORD" pocketbase \
	/usr/local/bin/pocketbase cozy-admin service-account "$PB_ADMIN_EMAIL" "${PB_FLAGS[@]}" 2>&1

app_started=0
for suite in "$@"; do
	if [[ "$suite" != "integration" && $app_started == 0 ]]; then
		log "building and starting the app image on 127.0.0.1:$TEST_APP_PORT"
		compose --profile app up -d --build --wait app
		export SMOKE_BASE_URL="http://127.0.0.1:$TEST_APP_PORT"
		export SMOKE_FULL=1
		app_started=1
	fi
	log "running tests/$suite"
	if [[ "$suite" == "layout" ]]; then
		# shellcheck disable=SC2086 # LAYOUT_ARGS may hold several arguments
		LAYOUT_BASE_URL="$SMOKE_BASE_URL" npx playwright test --config playwright.layout.config.ts ${LAYOUT_ARGS:-}
	else
		npx vitest run --config vitest.stack.config.ts "tests/$suite"
	fi
done

log "all good: $*"
