#!/usr/bin/env bash
# Admin access and ticket code management for CozyNights — run on the server as root.
#
# Admins sign in to /admin with Google (verified @mauersegler.art Workspace
# accounts only). Access is granted here, never in the app: either invite
# someone up front (`add`), or approve the access request their first Google
# sign-in created (`approve`; or change the role in the PocketBase dashboard).
#
# Usage:
#   scripts/cozy-admin.sh list                          pending requests, admins, superusers
#   scripts/cozy-admin.sh approve <email> [admin|superuser]  approve an access request
#   scripts/cozy-admin.sh add <email> [<email> ...]     invite admin(s) up front
#   scripts/cozy-admin.sh superuser <email>             PocketBase superuser (prompts for a
#                                                       password) + app role superuser
#   scripts/cozy-admin.sh remove <email>                reject/revoke app access + superuser
#   scripts/cozy-admin.sh service-account               create/update the app's service superuser
#                                                       from PB_ADMIN_EMAIL/PASSWORD in .env
#                                                       (generates the password if missing) and
#                                                       recreate the app container
#
# Ticket codes (the guests' logins, collection `orders`); the app has no import for them:
#   scripts/cozy-admin.sh tickets generate <count> [--prefix TEST] [--name <label>]
#                                                       create random codes like TEST-7F3K9Q
#                                                       and print them, one per line
#   scripts/cozy-admin.sh tickets add <code> [<code> ...] [--name <label>]
#                                                       create tickets for known codes; a whole
#                                                       roster: xargs scripts/cozy-admin.sh tickets add <codes.txt
#   scripts/cozy-admin.sh tickets list                  codes with sign-in and booking state
#   scripts/cozy-admin.sh tickets remove <code> [<code> ...]  delete tickets that hold no bed
#
# Targets docker-compose.staging.yml next to this script's parent folder;
# override with COZY_COMPOSE_FILE=/path/to/docker-compose.<env>.yml (and COZY_ENV_FILE).
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="${COZY_COMPOSE_FILE:-$APP_DIR/docker-compose.staging.yml}"
ENV_FILE="${COZY_ENV_FILE:-$APP_DIR/.env}"
# Same compose project as the deploy script (deploy/README.md), otherwise
# `docker compose` would not find the running containers.
DEPLOY_CONF=/etc/cozynights/deploy-staging.conf
if [[ -z "${COMPOSE_PROJECT_NAME:-}" && -z "${COZY_COMPOSE_FILE:-}" && -r "$DEPLOY_CONF" ]]; then
	COMPOSE_PROJECT_NAME="$(sed -n 's/^COMPOSE_PROJECT_NAME=//p' "$DEPLOY_CONF" | tail -n1 | tr -d "'\"")"
	if [[ -n "$COMPOSE_PROJECT_NAME" ]]; then export COMPOSE_PROJECT_NAME; fi
fi
# Always explicit: without --dir the binary silently uses an empty database
# next to itself, and the cozy-admin command from pb_hooks isn't loaded.
PB_FLAGS=(--dir=/pb_data --hooksDir=/pb_hooks --migrationsDir=/pb_migrations)
MIN_PASSWORD_LENGTH=12

die() {
	echo "error: $*" >&2
	exit 1
}

usage() {
	sed -n '2,/^set -euo pipefail$/p' "${BASH_SOURCE[0]}" | sed '$d' | sed 's/^# \{0,1\}//'
	exit "${1:-0}"
}

compose() {
	docker compose -f "$COMPOSE_FILE" "$@"
}

cozy() {
	# Extra `docker compose exec` options (e.g. -e VAR) come before "--".
	local exec_opts=()
	while [[ $# -gt 0 && "$1" != "--" ]]; do
		exec_opts+=("$1")
		shift
	done
	shift
	# The console command prints to stderr; merge it so output can be piped.
	compose exec -T ${exec_opts[@]+"${exec_opts[@]}"} pocketbase /usr/local/bin/pocketbase cozy-admin "$@" "${PB_FLAGS[@]}" 2>&1
}

require_running() {
	[[ -f "$COMPOSE_FILE" ]] || die "compose file not found: $COMPOSE_FILE"
	if ! compose ps --status running --services 2>/dev/null | grep -qx pocketbase; then
		die "the pocketbase container is not running (cd $APP_DIR && docker compose -f $(basename "$COMPOSE_FILE") up -d)"
	fi
}

read_password() {
	local first second
	read -rsp "New password for $1 (min. $MIN_PASSWORD_LENGTH chars): " first
	echo >&2
	[[ ${#first} -ge $MIN_PASSWORD_LENGTH ]] || die "password too short"
	read -rsp "Repeat password: " second
	echo >&2
	[[ "$first" == "$second" ]] || die "passwords do not match"
	COZY_SU_PASSWORD="$first"
}

set_env_var() {
	local key="$1" value="$2"
	if grep -q "^${key}=" "$ENV_FILE"; then
		sed -i.bak "s|^${key}=.*|${key}=${value}|" "$ENV_FILE" && rm -f "$ENV_FILE.bak"
	else
		printf '%s=%s\n' "$key" "$value" >>"$ENV_FILE"
	fi
}

cmd="${1:-}"
[[ -n "$cmd" ]] || usage 1
shift

case "$cmd" in
	add)
		[[ $# -ge 1 ]] || die "usage: $0 add <email> [<email> ...]"
		require_running
		for email in "$@"; do
			cozy -- add "$email"
		done
		;;
	superuser)
		[[ $# -eq 1 ]] || die "usage: $0 superuser <email>"
		require_running
		read_password "$1"
		export COZY_SU_PASSWORD
		cozy -e COZY_SU_PASSWORD -- superuser "$1"
		unset COZY_SU_PASSWORD
		;;
	approve)
		[[ $# -ge 1 && $# -le 2 ]] || die "usage: $0 approve <email> [admin|superuser]"
		require_running
		cozy -- approve "$@"
		;;
	remove)
		[[ $# -eq 1 ]] || die "usage: $0 remove <email>"
		require_running
		cozy -- remove "$1"
		;;
	list)
		require_running
		cozy -- list
		;;
	tickets)
		case "${1:-}" in
			add | generate | list | remove) ;;
			*) die "usage: $0 tickets add|generate|list|remove ... (details: $0 --help)" ;;
		esac
		# --help in front of the PocketBase flags would keep the binary from
		# loading pb_hooks ("unknown command cozy-admin").
		for arg in "$@"; do
			if [[ "$arg" == "-h" || "$arg" == "--help" ]]; then usage 0; fi
		done
		require_running
		cozy -- tickets "$@"
		;;
	service-account)
		require_running
		[[ -f "$ENV_FILE" ]] || die ".env not found at $ENV_FILE"
		email="$(grep -E '^PB_ADMIN_EMAIL=' "$ENV_FILE" | tail -n1 | cut -d= -f2- | tr -d "\"' ")"
		email="${email:-app-service@cozynights.local}"
		# Use the password already in .env (e.g. generated locally and kept in a
		# password manager) if it is long enough; otherwise generate one and
		# write it to .env.
		COZY_SU_PASSWORD="$(grep -E '^PB_ADMIN_PASSWORD=' "$ENV_FILE" | tail -n1 | cut -d= -f2- | tr -d "\"'")"
		keep_password=1
		if [[ ${#COZY_SU_PASSWORD} -lt 24 ]]; then
			COZY_SU_PASSWORD="$(openssl rand -hex 24)"
			keep_password=0
		fi
		export COZY_SU_PASSWORD
		cozy -e COZY_SU_PASSWORD -- service-account "$email"
		if [[ $keep_password -eq 1 ]]; then
			echo "used PB_ADMIN_PASSWORD from $ENV_FILE (unchanged)"
		else
			cp -p "$ENV_FILE" "$ENV_FILE.before-service-account"
			set_env_var PB_ADMIN_EMAIL "$email"
			set_env_var PB_ADMIN_PASSWORD "$COZY_SU_PASSWORD"
			echo "generated a new PB_ADMIN_PASSWORD and wrote it to $ENV_FILE (previous copy: .env.before-service-account)"
		fi
		unset COZY_SU_PASSWORD
		# env_file is only read when a container is created, so recreate the app.
		compose up -d --no-deps --force-recreate app
		;;
	-h | --help | help)
		usage 0
		;;
	*)
		echo "unknown command: $cmd" >&2
		usage 1
		;;
esac
