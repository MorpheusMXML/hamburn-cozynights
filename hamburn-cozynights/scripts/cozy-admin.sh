#!/usr/bin/env bash
# Admin access management for CozyNights — run on the server as root.
#
# This is the ONLY way to grant access to the admin area: there is no invite
# or sign-up flow in the app. Admins sign in with Google (verified
# @mauersegler.art Workspace accounts only); this script just puts their email
# on the allowlist (PocketBase auth collection `admins`).
#
# Usage:
#   scripts/cozy-admin.sh add <email> [<email> ...]   invite admin(s)
#   scripts/cozy-admin.sh superuser <email>           PocketBase superuser (prompts for a
#                                                     password) + app role superuser
#   scripts/cozy-admin.sh remove <email>              revoke app access + PocketBase superuser
#   scripts/cozy-admin.sh list                        show admins and superusers
#   scripts/cozy-admin.sh service-account             create/rotate the app's service superuser
#                                                     (PB_ADMIN_EMAIL/PASSWORD in .env) and
#                                                     recreate the app container
#
# Targets docker-compose.staging.yml next to this script's parent folder;
# override with COZY_COMPOSE_FILE=/path/to/docker-compose.<env>.yml (and COZY_ENV_FILE).
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="${COZY_COMPOSE_FILE:-$APP_DIR/docker-compose.staging.yml}"
ENV_FILE="${COZY_ENV_FILE:-$APP_DIR/.env}"
# Always explicit: without --dir the binary silently uses an empty database
# next to itself, and the cozy-admin command from pb_hooks isn't loaded.
PB_FLAGS=(--dir=/pb_data --hooksDir=/pb_hooks --migrationsDir=/pb_migrations)
MIN_PASSWORD_LENGTH=12

die() {
	echo "error: $*" >&2
	exit 1
}

usage() {
	sed -n '2,23p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
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
	compose exec -T ${exec_opts[@]+"${exec_opts[@]}"} pocketbase /usr/local/bin/pocketbase cozy-admin "$@" "${PB_FLAGS[@]}"
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
	remove)
		[[ $# -eq 1 ]] || die "usage: $0 remove <email>"
		require_running
		cozy -- remove "$1"
		;;
	list)
		require_running
		cozy -- list
		;;
	service-account)
		require_running
		[[ -f "$ENV_FILE" ]] || die ".env not found at $ENV_FILE"
		email="$(grep -E '^PB_ADMIN_EMAIL=' "$ENV_FILE" | tail -n1 | cut -d= -f2- | tr -d "\"' ")"
		email="${email:-app-service@cozynights.local}"
		COZY_SU_PASSWORD="$(openssl rand -hex 24)"
		export COZY_SU_PASSWORD
		cozy -e COZY_SU_PASSWORD -- service-account "$email"
		cp -p "$ENV_FILE" "$ENV_FILE.before-service-account"
		set_env_var PB_ADMIN_EMAIL "$email"
		set_env_var PB_ADMIN_PASSWORD "$COZY_SU_PASSWORD"
		unset COZY_SU_PASSWORD
		echo "updated PB_ADMIN_EMAIL/PB_ADMIN_PASSWORD in $ENV_FILE (previous copy: .env.before-service-account)"
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
