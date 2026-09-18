#!/usr/bin/env bash
# Encrypted, versioned backup of the whole server (CozyNights, Vaultwarden,
# Listmonk, nginx/certificates, .env files) with restic. Installed as
# /usr/local/sbin/server-backup and run hourly by server-backup.timer as root;
# setup and restore: deploy/backup/README.md.
#
# Where the repository lives is configuration only (RESTIC_REPOSITORY):
#   /var/backups/restic/<host>       local directory (stage 1)
#   sftp:storagebox:restic/<host>    Hetzner Storage Box (stage 2, off-site)
# A local repository is created root-only, is never part of its own snapshots
# and has its filesystem watched for free space. Everything else is identical.
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
#        server-backup --init     create the repository (once, during setup)
# Exit: 0 ok · 3 snapshot created, but the disk of the local repository is
#       running full · anything else: the run failed
set -Eeuo pipefail

mode=run
case "${1:-}" in
'') ;;
--check) mode=check ;;
--init) mode=init ;;
*)
	echo "usage: server-backup [--check|--init]" >&2
	exit 2
	;;
esac

CONFIG="${SERVER_BACKUP_CONFIG:-/etc/server-backup/backup.conf}"
# shellcheck source=/dev/null
source "$CONFIG"

: "${RESTIC_REPOSITORY:?RESTIC_REPOSITORY missing in $CONFIG}"
: "${RESTIC_PASSWORD_FILE:?RESTIC_PASSWORD_FILE missing in $CONFIG}"
export RESTIC_REPOSITORY RESTIC_PASSWORD_FILE
# systemd starts the service without HOME; restic wants it for its cache.
export HOME="${HOME:-/root}"
WORK_DIR="${WORK_DIR:-/var/backups/server-backup}"
KEEP_HOURLY="${KEEP_HOURLY:-24}"
KEEP_DAILY="${KEEP_DAILY:-14}"
KEEP_WEEKLY="${KEEP_WEEKLY:-8}"
KEEP_MONTHLY="${KEEP_MONTHLY:-12}"
PRUNE_HOUR="${PRUNE_HOUR:-3}"
CHECK_WEEKDAY="${CHECK_WEEKDAY:-7}"
MIN_FREE_GB="${MIN_FREE_GB:-5}"
MIN_FREE_PERCENT="${MIN_FREE_PERCENT:-15}"
ALERT_WEBHOOK_URL="${ALERT_WEBHOOK_URL:-}"
HEALTHCHECK_URL="${HEALTHCHECK_URL:-}"
[[ -n "${SQLITE_DBS+set}" ]] || SQLITE_DBS=()
[[ -n "${PG_DUMPS+set}" ]] || PG_DUMPS=()
[[ -n "${BACKUP_PATHS+set}" ]] || BACKUP_PATHS=()
[[ -n "${EXCLUDES+set}" ]] || EXCLUDES=()

HOST="$(hostname)"
TAG=server-backup
DUMP_DIR="$WORK_DIR/dumps"
LOW_SPACE_STAMP="$WORK_DIR/.low-space-alerted"
FAIL_REASON=''

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
	# set -E also fires the trap inside $(...): the parent shell reports, once.
	[[ $BASH_SUBSHELL -eq 0 ]] || exit "$rc"
	log "FAILED (exit $rc, line $line)"
	alert "❌ Backup auf $HOST fehlgeschlagen${FAIL_REASON:+: $FAIL_REASON} (exit $rc, Zeile $line). Details: journalctl -u server-backup -n 100"
	healthcheck /fail
	exit "$rc"
}
trap 'on_error $LINENO' ERR

fail() {
	FAIL_REASON="$*"
	log "ERROR: $*"
	return 1
}

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

# The live databases share the disk with a local repository: running low is
# worth an alert long before restic or SQLite start to fail.
low_space=0
check_free_space() {
	local used avail total
	read -r used avail < <(df -Pk "$REPO_DIR" | awk 'NR == 2 { print $3, $4 }') || true
	[[ "$used" =~ ^[0-9]+$ && "$avail" =~ ^[0-9]+$ ]] || fail "cannot read the free space of $REPO_DIR from df"
	total=$((used + avail))
	if ((total == 0 || (avail >= MIN_FREE_GB * 1048576 && avail * 100 >= MIN_FREE_PERCENT * total))); then
		rm -f "$LOW_SPACE_STAMP"
		return 0
	fi
	low_space=1
	local free="$((avail / 1048576)) GB ($((avail * 100 / total)) %)"
	log "WARNING: only $free free on the disk of $REPO_DIR (minimum: $MIN_FREE_GB GB and $MIN_FREE_PERCENT %)"
	# The condition usually lasts longer than an hour: one message a day is enough.
	if [[ -z "$(find "$LOW_SPACE_STAMP" -mmin -1440 2>/dev/null)" ]]; then
		alert "⚠️ Platte auf $HOST läuft voll: nur noch $free frei bei $REPO_DIR (Minimum: $MIN_FREE_GB GB und $MIN_FREE_PERCENT %). Das Backup läuft weiter, solange Platz ist."
		touch "$LOW_SPACE_STAMP"
	fi
}

for bin in restic jq curl flock; do
	command -v "$bin" >/dev/null || fail "$bin is not installed"
done
[[ ${#SQLITE_DBS[@]} -eq 0 ]] || command -v sqlite3 >/dev/null || fail "sqlite3 is not installed"
[[ -f "$RESTIC_PASSWORD_FILE" ]] || fail "password file $RESTIC_PASSWORD_FILE not found"
[[ "$MIN_FREE_GB" =~ ^[0-9]+$ && "$MIN_FREE_PERCENT" =~ ^[0-9]+$ ]] ||
	fail "MIN_FREE_GB and MIN_FREE_PERCENT must be whole numbers"

# No backend prefix (sftp:, rest:, s3:, ...) means a local directory.
REPO_DIR=''
case "$RESTIC_REPOSITORY" in
local:*) REPO_DIR="${RESTIC_REPOSITORY#local:}" ;;
*:*) ;;
*) REPO_DIR="$RESTIC_REPOSITORY" ;;
esac
[[ -z "$REPO_DIR" || "$REPO_DIR" == /* ]] || fail "a local RESTIC_REPOSITORY must be an absolute path: $REPO_DIR"

install -d -m 700 "$WORK_DIR"
exec 9>"$WORK_DIR/.lock"
if ! flock -n 9; then
	log "another run is still active, skipping"
	exit 0
fi

if [[ $mode == init ]]; then
	if restic cat config >/dev/null 2>&1; then
		log "repository already exists: $RESTIC_REPOSITORY"
		exit 0
	fi
	if [[ -n "$REPO_DIR" ]]; then
		# Never turn a directory that is already in use into the repository.
		[[ ! -e "$REPO_DIR" || -z "$(ls -A "$REPO_DIR")" ]] || fail "$REPO_DIR exists and is not empty"
		install -d -m 700 "$REPO_DIR"
	fi
	restic init
	log "repository created: $RESTIC_REPOSITORY"
	exit 0
fi

healthcheck /start

REPO_REAL=''
if [[ -n "$REPO_DIR" ]]; then
	[[ -f "$REPO_DIR/config" ]] || fail "no restic repository in $REPO_DIR (first time: server-backup --init)"
	REPO_REAL="$(readlink -f "$REPO_DIR")"
	# Step 1 replaces $DUMP_DIR wholesale.
	[[ "$REPO_REAL/" != "$(readlink -f "$WORK_DIR")/dumps"* ]] || fail "the repository must not live inside $DUMP_DIR"
	[[ "$(stat -c %a "$REPO_REAL")" == 700 ]] ||
		log "WARNING: $REPO_REAL should be root-only: chmod 700 $REPO_REAL"
	check_free_space
fi
restic cat config >/dev/null ||
	fail "cannot open the repository $RESTIC_REPOSITORY (not created yet: server-backup --init; else password, network, SSH key)"
# A failed restore test leaves its directory behind.
rm -rf "$WORK_DIR"/restore-test.*

# --- 1. consistent database copies ---------------------------------------
rm -rf "$DUMP_DIR.new"
install -d -m 700 "$DUMP_DIR.new"

for entry in "${SQLITE_DBS[@]}"; do
	name="${entry%%=*}"
	src="$(resolve_path "${entry#*=}")"
	[[ -f "$src" ]] || fail "SQLite database not found: $src ($name)"
	# Online backup API: consistent even while the application is writing.
	sqlite3 -cmd ".timeout 30000" "$src" ".backup '$DUMP_DIR.new/$name.db'"
	sqlite_ok "$DUMP_DIR.new/$name.db" || fail "integrity check failed for the copy of $name"
	log "sqlite  $name ($(du -h "$DUMP_DIR.new/$name.db" | cut -f1))"
done

for entry in "${PG_DUMPS[@]}"; do
	name="${entry%%=*}"
	IFS=: read -r container user database <<<"${entry#*=}"
	docker exec "$container" pg_dump -U "$user" -Fc "$database" >"$DUMP_DIR.new/$name.pgdump"
	[[ -s "$DUMP_DIR.new/$name.pgdump" ]] || fail "empty pg_dump for $name"
	log "pg_dump $name ($(du -h "$DUMP_DIR.new/$name.pgdump" | cut -f1))"
done

rm -rf "$DUMP_DIR"
mv "$DUMP_DIR.new" "$DUMP_DIR"

# --- 2. restic backup -----------------------------------------------------
sources=("$DUMP_DIR")
for spec in "${BACKUP_PATHS[@]}"; do
	path="$(resolve_path "$spec")"
	# A missing path is a configuration error, not something to skip silently.
	[[ -e "$path" ]] || fail "backup path not found: $path"
	sources+=("$path")
done
exclude_args=()
for pattern in "${EXCLUDES[@]}"; do
	exclude_args+=(--exclude "$pattern")
done
if [[ -n "$REPO_DIR" ]]; then
	# A local repository under a backed-up path (say /var/backups) would
	# otherwise swallow itself and grow with every run. Excluding it must not
	# silently drop a source, though.
	for path in "${sources[@]}"; do
		[[ "$(readlink -f "$path")/" != "$REPO_REAL/"* ]] || fail "$path lies inside the repository $REPO_DIR"
	done
	exclude_args+=(--exclude "$REPO_DIR")
	[[ "$REPO_REAL" == "$REPO_DIR" ]] || exclude_args+=(--exclude "$REPO_REAL")
fi

restic backup --quiet --host "$HOST" --tag "$TAG" "${exclude_args[@]}" "${sources[@]}"
log "snapshot created ($(restic snapshots --host "$HOST" --tag "$TAG" --json | jq -r 'max_by(.time).short_id'))"

# --- 3. retention (daily) --------------------------------------------------
if [[ $mode == check || "$(date +%-H)" -eq "$PRUNE_HOUR" ]]; then
	# A run killed half-way (reboot, OOM) leaves its lock behind and prune would
	# refuse to start. This only removes locks whose process is gone.
	restic unlock --quiet
	restic forget --quiet --host "$HOST" --tag "$TAG" --prune \
		--keep-hourly "$KEEP_HOURLY" --keep-daily "$KEEP_DAILY" \
		--keep-weekly "$KEEP_WEEKLY" --keep-monthly "$KEEP_MONTHLY"
	log "retention applied"
fi

# --- 4. verification and restore test (weekly) ----------------------------
if [[ $mode == check || ("$(date +%u)" -eq "$CHECK_WEEKDAY" && "$(date +%-H)" -eq "$PRUNE_HOUR") ]]; then
	restic check --quiet --read-data-subset=10%
	restore_dir="$(mktemp -d "$WORK_DIR/restore-test.XXXXXX")"
	restic restore --quiet latest --host "$HOST" --tag "$TAG" --target "$restore_dir" --include "$DUMP_DIR"
	for entry in "${SQLITE_DBS[@]}"; do
		name="${entry%%=*}"
		sqlite_ok "$restore_dir$DUMP_DIR/$name.db" || fail "restore test failed for $name"
	done
	for entry in "${PG_DUMPS[@]}"; do
		name="${entry%%=*}"
		[[ -s "$restore_dir$DUMP_DIR/$name.pgdump" ]] || fail "restore test failed for $name"
	done
	rm -rf "$restore_dir"
	log "repository check and restore test passed"
fi

if [[ $low_space -eq 1 ]]; then
	healthcheck /fail
	log "done, but the disk is running full (see the WARNING above)"
	exit 3
fi
healthcheck ""
log "done"
