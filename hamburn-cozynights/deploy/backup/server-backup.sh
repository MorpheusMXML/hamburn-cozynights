#!/usr/bin/env bash
# Encrypted off-site backup of the whole server (CozyNights, Vaultwarden,
# Listmonk, nginx/certificates, .env files) with restic to a Hetzner Storage
# Box. Installed as /usr/local/sbin/server-backup and run hourly by
# server-backup.timer as root; setup and restore: deploy/backup/README.md.
#
# Each run:
#   1. consistent copies of all live databases into $WORK_DIR/dumps
#      (SQLite via the online backup API, PostgreSQL via pg_dump)
#   2. restic backup of the dumps plus the configured files/directories
#   3. once a day (PRUNE_HOUR): apply the retention policy and prune
#   4. once a week (CHECK_WEEKDAY at PRUNE_HOUR): verify part of the repository
#      and test-restore the latest database dumps
# Any failure is reported to ALERT_WEBHOOK_URL; HEALTHCHECK_URL (optional) is a
# dead man's switch that also notices when the timer stops running at all.
#
# Usage: server-backup            regular run (what the timer does)
#        server-backup --check    force steps 3 and 4 now
set -Eeuo pipefail

CONFIG="${SERVER_BACKUP_CONFIG:-/etc/server-backup/backup.conf}"
# shellcheck source=/dev/null
source "$CONFIG"

: "${RESTIC_REPOSITORY:?RESTIC_REPOSITORY missing in $CONFIG}"
: "${RESTIC_PASSWORD_FILE:?RESTIC_PASSWORD_FILE missing in $CONFIG}"
export RESTIC_REPOSITORY RESTIC_PASSWORD_FILE
WORK_DIR="${WORK_DIR:-/var/backups/server-backup}"
KEEP_HOURLY="${KEEP_HOURLY:-24}"
KEEP_DAILY="${KEEP_DAILY:-14}"
KEEP_WEEKLY="${KEEP_WEEKLY:-8}"
KEEP_MONTHLY="${KEEP_MONTHLY:-12}"
PRUNE_HOUR="${PRUNE_HOUR:-3}"
CHECK_WEEKDAY="${CHECK_WEEKDAY:-7}"
ALERT_WEBHOOK_URL="${ALERT_WEBHOOK_URL:-}"
HEALTHCHECK_URL="${HEALTHCHECK_URL:-}"
[[ -v SQLITE_DBS ]] || SQLITE_DBS=()
[[ -v PG_DUMPS ]] || PG_DUMPS=()
[[ -v BACKUP_PATHS ]] || BACKUP_PATHS=()
[[ -v EXCLUDES ]] || EXCLUDES=()

HOST="$(hostname)"
TAG=server-backup
DUMP_DIR="$WORK_DIR/dumps"

log() { printf '[server-backup] %s\n' "$*"; }

# Same payload shapes as the admin access request webhook in
# pb_hooks/cozy_admin.pb.js (Telegram, Slack, Google Chat, Discord).
alert() {
	[[ -n "$ALERT_WEBHOOK_URL" ]] || return 0
	local text="$1" body
	if [[ "$ALERT_WEBHOOK_URL" == https://api.telegram.org/* ]]; then
		local chat_id
		chat_id="$(sed -n 's/.*[?&]chat_id=\([^&]*\).*/\1/p' <<<"$ALERT_WEBHOOK_URL")"
		body="$(jq -n --arg chat_id "$chat_id" --arg text "$text" '{chat_id: $chat_id, text: $text}')"
	elif [[ "$ALERT_WEBHOOK_URL" =~ ^https://(discord|discordapp)\.com/ ]]; then
		body="$(jq -n --arg text "$text" '{content: $text}')"
	else
		body="$(jq -n --arg text "$text" '{text: $text}')"
	fi
	curl -fsS -m 10 -o /dev/null -H 'content-type: application/json' -d "$body" "$ALERT_WEBHOOK_URL" ||
		log "WARNING: alert webhook failed"
}

healthcheck() {
	[[ -n "$HEALTHCHECK_URL" ]] || return 0
	curl -fsS -m 10 -o /dev/null --retry 3 "$HEALTHCHECK_URL$1" || log "WARNING: healthcheck ping failed"
}

on_error() {
	local rc=$? line=$1
	trap - ERR
	log "FAILED (exit $rc, line $line)"
	alert "❌ Backup auf $HOST fehlgeschlagen (exit $rc, Zeile $line). Details: journalctl -u server-backup -n 100"
	healthcheck /fail
	exit "$rc"
}
trap 'on_error $LINENO' ERR

# "volume:<docker volume>:<path inside the volume>" or an absolute host path.
resolve_path() {
	local spec="$1"
	if [[ "$spec" == volume:* ]]; then
		local rest="${spec#volume:}" volume mountpoint
		volume="${rest%%:*}"
		mountpoint="$(docker volume inspect -f '{{.Mountpoint}}' "$volume")"
		if [[ "$rest" == *:* ]]; then
			printf '%s/%s\n' "$mountpoint" "${rest#*:}"
		else
			printf '%s\n' "$mountpoint"
		fi
	else
		printf '%s\n' "$spec"
	fi
}

sqlite_ok() {
	[[ "$(sqlite3 "$1" 'PRAGMA integrity_check;')" == ok ]]
}

force_check=0
[[ "${1:-}" == --check ]] && force_check=1

install -d -m 700 "$WORK_DIR"
exec 9>"$WORK_DIR/.lock"
if ! flock -n 9; then
	log "another run is still active, skipping"
	exit 0
fi

healthcheck /start

# --- 1. consistent database copies ---------------------------------------
rm -rf "$DUMP_DIR.new"
install -d -m 700 "$DUMP_DIR.new"

for entry in "${SQLITE_DBS[@]}"; do
	name="${entry%%=*}"
	src="$(resolve_path "${entry#*=}")"
	[[ -f "$src" ]] || { log "SQLite database not found: $src ($name)"; false; }
	# Online backup API: consistent even while the application is writing.
	sqlite3 -cmd ".timeout 30000" "$src" ".backup '$DUMP_DIR.new/$name.db'"
	sqlite_ok "$DUMP_DIR.new/$name.db" || { log "integrity check failed for the copy of $name"; false; }
	log "sqlite  $name ($(du -h "$DUMP_DIR.new/$name.db" | cut -f1))"
done

for entry in "${PG_DUMPS[@]}"; do
	name="${entry%%=*}"
	IFS=: read -r container user database <<<"${entry#*=}"
	docker exec "$container" pg_dump -U "$user" -Fc "$database" >"$DUMP_DIR.new/$name.pgdump"
	[[ -s "$DUMP_DIR.new/$name.pgdump" ]] || { log "empty pg_dump for $name"; false; }
	log "pg_dump $name ($(du -h "$DUMP_DIR.new/$name.pgdump" | cut -f1))"
done

rm -rf "$DUMP_DIR"
mv "$DUMP_DIR.new" "$DUMP_DIR"

# --- 2. restic backup -----------------------------------------------------
sources=("$DUMP_DIR")
for spec in "${BACKUP_PATHS[@]}"; do
	path="$(resolve_path "$spec")"
	# A missing path is a configuration error, not something to skip silently.
	[[ -e "$path" ]] || { log "backup path not found: $path"; false; }
	sources+=("$path")
done
exclude_args=()
for pattern in "${EXCLUDES[@]}"; do
	exclude_args+=(--exclude "$pattern")
done

restic backup --quiet --host "$HOST" --tag "$TAG" "${exclude_args[@]}" "${sources[@]}"
log "snapshot created ($(restic snapshots --host "$HOST" --tag "$TAG" --latest 1 --json | jq -r '.[0].short_id'))"

# --- 3. retention (daily) --------------------------------------------------
if [[ $force_check -eq 1 || "$(date +%-H)" -eq "$PRUNE_HOUR" ]]; then
	restic forget --quiet --host "$HOST" --tag "$TAG" --prune \
		--keep-hourly "$KEEP_HOURLY" --keep-daily "$KEEP_DAILY" \
		--keep-weekly "$KEEP_WEEKLY" --keep-monthly "$KEEP_MONTHLY"
	log "retention applied"
fi

# --- 4. verification and restore test (weekly) ----------------------------
if [[ $force_check -eq 1 || ("$(date +%u)" -eq "$CHECK_WEEKDAY" && "$(date +%-H)" -eq "$PRUNE_HOUR") ]]; then
	restic check --quiet --read-data-subset=10%
	restore_dir="$(mktemp -d "$WORK_DIR/restore-test.XXXXXX")"
	restic restore --quiet latest --host "$HOST" --tag "$TAG" --target "$restore_dir" --include "$DUMP_DIR"
	for entry in "${SQLITE_DBS[@]}"; do
		name="${entry%%=*}"
		sqlite_ok "$restore_dir$DUMP_DIR/$name.db" || { log "restore test failed for $name"; false; }
	done
	for entry in "${PG_DUMPS[@]}"; do
		name="${entry%%=*}"
		[[ -s "$restore_dir$DUMP_DIR/$name.pgdump" ]] || { log "restore test failed for $name"; false; }
	done
	rm -rf "$restore_dir"
	log "repository check and restore test passed"
fi

healthcheck ""
log "done"
