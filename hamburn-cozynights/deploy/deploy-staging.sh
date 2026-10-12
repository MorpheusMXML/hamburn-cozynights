#!/usr/bin/env bash
# Server deploy for every stack (staging, production). Runs on the server as
# the restricted `deploy` user and is used as the SSH forced command (see
# deploy/README.md). One copy per environment, and the copy's name picks the
# configuration:
#   /usr/local/bin/deploy-cozynights-staging     → /etc/cozynights/deploy-staging.conf
#   /usr/local/bin/deploy-cozynights-production  → /etc/cozynights/deploy-production.conf
# (any other name, e.g. this file in the checkout, means staging). GitHub
# Actions sends "deploy <commit-sha>"; only that 40-char SHA is taken from the
# request, everything else is ignored.
#
# The deploy runs detached from the SSH session (its own session, output into
# $BACKUP_DIR/deploy-<UTC>-<sha7>.log); the SSH side only streams that log and
# exits with the deploy's exit code. A dropped connection no longer kills a
# deploy halfway.
#
# Steps: refuse what must not go live (branch, downgrade, signatures, compose
# pin) → tag the running app image <image>:prev → checkout SHA → build app
# image (old containers keep serving) → stop PocketBase → back up its volume →
# up -d → health check (/api/health: 200 only when the app's service account
# can talk to PocketBase).
# If the health check fails, the previous commit is started again from the
# :prev image (rebuilt only when there is none); the database is NOT rolled
# back (see the warning below). Any other failure after the checkout puts the
# checkout and PocketBase back as they were (EXIT trap).
#
# Exit codes: 0 deployed · 1 health check failed, rolled back · 2 usage ·
# 3 another deploy runs · 4 local changes in the checkout · 5 commit not on
# origin · 6 build failed · 7 no PocketBase volume · 8 helper image pull failed ·
# 9 snapshot failed · 10 not on a REQUIRE_BRANCH · 11 downgrade refused ·
# 12 commit not signed by a trusted key · 13 compose file not approved (pin) ·
# 14 signature/pin configuration broken · 15 unexpected error (state restored) ·
# 129/130/143 stopped by a signal (state restored).
set -Eeuo pipefail

self="$(basename "$0")"
env_name="${self#deploy-cozynights-}"
if [[ "$env_name" == "$self" || ! "$env_name" =~ ^[a-z]+$ ]]; then
	env_name=staging
fi
CONFIG="/etc/cozynights/deploy-${env_name}.conf"
# shellcheck source=/dev/null
source "$CONFIG"
: "${APP_DIR:?APP_DIR missing in $CONFIG}"
: "${COMPOSE_PROJECT_NAME:?COMPOSE_PROJECT_NAME missing in $CONFIG}"
if [[ "$env_name" == staging ]]; then
	# Staging's values, for its config from before there was a second stack.
	COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.staging.yml}"
	BACKUP_DIR="${BACKUP_DIR:-/var/backups/cozynights-staging}"
	HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:3001/api/health}"
	PB_CONTAINER="${PB_CONTAINER:-cozynights-staging-pocketbase}"
fi
# Every other stack names all four: a staging default there would stop and
# archive the wrong database.
: "${COMPOSE_FILE:?COMPOSE_FILE missing in $CONFIG}"
: "${BACKUP_DIR:?BACKUP_DIR missing in $CONFIG}"
: "${HEALTH_URL:?HEALTH_URL missing in $CONFIG}"
: "${PB_CONTAINER:?PB_CONTAINER missing in $CONFIG}"
BACKUP_KEEP="${BACKUP_KEEP:-10}"
DEPLOY_LOG_KEEP="${DEPLOY_LOG_KEEP:-20}"
HEALTH_TRIES="${HEALTH_TRIES:-30}"
HEALTH_INTERVAL="${HEALTH_INTERVAL:-2}"
export COMPOSE_PROJECT_NAME

log() { printf '[deploy %s] %s\n' "$(date -u +%H:%M:%S)" "$*"; }

request="${SSH_ORIGINAL_COMMAND:-${1:-}}"
sha="$(grep -oE '\b[0-9a-f]{40}\b' <<<"$request" | head -n1 || true)"
if [[ -z "$sha" ]]; then
	echo "usage: deploy <40-char commit sha>" >&2
	exit 2
fi

mkdir -p "$BACKUP_DIR"

# ── Detach from the SSH session ──────────────────────────────────────────────
# The forced command re-runs itself in a new session (setsid), stdin from
# /dev/null, all output into a log file, and only streams that log. If the SSH
# connection drops, the stream dies with it (SIGPIPE/SIGHUP) but the deploy
# itself runs to its end, rollback included, and leaves the log behind.
if [[ "${COZY_DEPLOY_CHILD:-}" != 1 ]]; then
	# Only the log is private; the deploy itself keeps the session's umask
	# (git checks the files out with it, PocketBase reads pb_hooks/ from there).
	logfile="$BACKUP_DIR/deploy-$(date -u +%Y%m%dT%H%M%SZ)-${sha:0:7}.log"
	if ! (umask 027 && set -C && : >"$logfile") 2>/dev/null; then
		logfile="${logfile%.log}-$$.log"
		(umask 027 && : >"$logfile")
	fi
	log "log: $logfile" >>"$logfile"
	# setsid -w: should setsid have to fork, it still waits and passes on the
	# exit code.
	env -u SSH_ORIGINAL_COMMAND COZY_DEPLOY_CHILD=1 \
		setsid -w "$BASH" "$0" "deploy $sha" </dev/null >>"$logfile" 2>&1 &
	child=$!
	tail -n +1 -f --pid="$child" "$logfile" || true
	rc=0
	wait "$child" || rc=$?
	exit "$rc"
fi

# ── From here on: the detached deploy ────────────────────────────────────────
phase=0          # 1 checked out $sha · 2 PocketBase stopped · 3 new stack started · 9 done
prev=""
app_image=""     # the tag the app container runs, e.g. hamburn-cozynights-app:latest
prev_image=""    # <image>:prev, the running image saved before the build
gnupg_tmp=""
unexpected=""

compose() { docker compose -f "$APP_DIR/hamburn-cozynights/$COMPOSE_FILE" "$@"; }

healthy() {
	for _ in $(seq 1 "$HEALTH_TRIES"); do
		if curl -fsS -o /dev/null --max-time 5 "$HEALTH_URL"; then return 0; fi
		sleep "$HEALTH_INTERVAL"
	done
	return 1
}

# Back to $prev after the new stack was started: checkout first (PocketBase
# bind-mounts pb_hooks/ and pb_migrations/ from it), then the :prev image under
# the running tag, `up -d --no-build`. Rebuilds $prev only without a :prev image.
rollback() {
	if ! git -C "$APP_DIR" checkout --quiet --detach "$prev"; then
		log "checkout of $prev FAILED — the stack stays as it is"
		return 1
	fi
	if [[ -n "$prev_image" ]] && docker image inspect "$prev_image" >/dev/null 2>&1 &&
		docker tag "$prev_image" "$app_image"; then
		log "app image: $prev_image → $app_image (no rebuild)"
		compose up -d --no-build --remove-orphans
	else
		log "no :prev image of this deploy — rebuilding $prev"
		GIT_SHA="$prev" compose build app && compose up -d --remove-orphans
	fi
}

# The EXIT trap: whatever ended the deploy early (a refusal after the checkout,
# set -e, a signal), the checkout, the app image tag and PocketBase go back to
# how they were before.
# shellcheck disable=SC2329 # runs from the traps below
restore() {
	log "deploy did not finish — restoring $prev"
	if ((phase >= 3)); then
		if rollback && healthy; then
			log "restored: $prev is running and healthy"
		else
			log "restore of $prev is NOT healthy — manual intervention needed"
		fi
		return 0
	fi
	local back=0
	if git -C "$APP_DIR" checkout --quiet --detach "$prev" &&
		[[ "$(git -C "$APP_DIR" rev-parse HEAD)" == "$prev" ]]; then
		back=1
		log "restored: checkout on $prev"
	else
		log "checkout of $prev FAILED"
	fi
	if [[ -n "$prev_image" ]] && docker tag "$prev_image" "$app_image"; then
		log "restored: $app_image is the running image again"
	fi
	if ((phase >= 2)); then
		if ((back)); then
			if compose start pocketbase; then
				log "restored: PocketBase started again on $prev"
			else
				log "PocketBase did NOT start again — manual intervention needed"
			fi
		else
			# Its hooks and migrations come from the checkout: never start it on
			# $sha's files without a snapshot.
			log "PocketBase stays stopped (checkout not on $prev) — manual intervention needed"
		fi
	fi
}

# shellcheck disable=SC2329 # runs from the traps below
cleanup_gnupg() {
	if [[ -n "$gnupg_tmp" && -d "$gnupg_tmp" ]]; then
		gpgconf --homedir "$gnupg_tmp" --kill all >/dev/null 2>&1 || true
		rm -rf -- "$gnupg_tmp"
	fi
}

# shellcheck disable=SC2329 # runs from the traps below
on_exit() {
	local rc=$?
	trap - EXIT ERR
	set +e
	if [[ -n "$unexpected" && "$rc" -ne 0 && "$rc" -lt 128 ]]; then rc=15; fi
	if ((phase >= 1 && phase < 9)) && [[ -n "$prev" ]]; then restore; fi
	cleanup_gnupg
	log "exit $rc"
	exit "$rc"
}

# shellcheck disable=SC2329 # runs from the traps below
on_err() {
	# Command substitutions inherit the trap (set -E); report once, from the
	# deploy shell itself.
	if [[ "$BASHPID" != "$$" ]]; then return 0; fi
	unexpected="line $2: $3 (exit $1)"
	if [[ "$4" != main ]]; then unexpected+=" in $4(), called from line $5"; fi
	log "unexpected error at $unexpected"
}

trap on_exit EXIT
trap 'on_err "$?" "$LINENO" "$BASH_COMMAND" "${FUNCNAME[0]:-main}" "${BASH_LINENO[0]:-}"' ERR
trap 'exit 143' TERM
trap 'exit 130' INT
trap '' HUP

log "pid $$ · $env_name · target $sha"

exec 9>"$BACKUP_DIR/.deploy.lock"
if ! flock -n 9; then
	echo "another deploy is already running" >&2
	exit 3
fi
# Only the newest logs stay (this one is the newest).
{ ls -1t "$BACKUP_DIR"/deploy-*.log 2>/dev/null || true; } |
	tail -n +"$((DEPLOY_LOG_KEEP + 1))" | xargs -r rm -f --

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

# ── What may go live ─────────────────────────────────────────────────────────
# REQUIRE_BRANCH: one or more branches, separated by spaces (staging:
# "integration/staging main", production: "main"). Only code on one of them,
# even if the workflow or the GitHub environment were ever set up to allow more.
if [[ -n "${REQUIRE_BRANCH:-}" ]]; then
	read -r -a branches <<<"$REQUIRE_BRANCH"
	on_branch=0
	for b in "${branches[@]}"; do
		if git merge-base --is-ancestor "$sha" "origin/$b" 2>/dev/null; then
			on_branch=1
			break
		fi
	done
	if ((!on_branch)); then
		echo "refusing to deploy: $sha is not on ${branches[*]/#/origin/}" >&2
		exit 10
	fi
fi

# No downgrades by accident: a commit the running one already contains is an
# old version. A code rollback on purpose: ALLOW_DOWNGRADE=1 in the config.
downgrade=0
if [[ "$sha" != "$prev" ]] && git merge-base --is-ancestor "$sha" "$prev"; then
	downgrade=1
	if [[ "${ALLOW_DOWNGRADE:-0}" != 1 ]]; then
		echo "refusing to deploy: $sha is older than the running $prev (a downgrade)" >&2
		echo "A code rollback on purpose: ALLOW_DOWNGRADE=1 in $CONFIG, deploy, remove it again (deploy/README.md, Rollback)." >&2
		exit 11
	fi
	log "WARNING: downgrade to an older commit (ALLOW_DOWNGRADE=1 in $CONFIG)"
fi

# ── Signature gate (only with TRUSTED_GNUPGHOME in the config) ───────────────
# Every new commit must be signed: by a key in TRUSTED_SIGNERS (Max), or — only
# merge commits — by a key in TRUSTED_MERGE_SIGNERS (GitHub's web-flow key for
# merges in the web UI). A merge that only GitHub signed must be a clean merge
# of its two parents: no conflict resolution, no extra content hidden in it.
fpr_in() {
	local want="${1^^}" f
	shift
	if [[ -z "$want" ]]; then return 1; fi
	for f in "$@"; do
		if [[ "${f^^}" == "$want" ]]; then return 0; fi
	done
	return 1
}

why=""
signed_as=""
check_commit() {
	local c="$1" obj hdr out line want tree
	local -a f parents
	why=""
	signed_as=""
	obj="$(git cat-file commit "$c")"
	hdr=$'\n'"${obj%%$'\n\n'*}"
	if [[ "$hdr" != *$'\n'"gpgsig "* && "$hdr" != *$'\n'"gpgsig-sha256 "* ]]; then
		why="not signed"
		return 1
	fi
	# git -c beats the checkout's own .git/config: OpenPGP through gpg only,
	# SSH and X.509 signatures never verify.
	if out="$(git -c gpg.program=gpg -c gpg.openpgp.program=gpg -c gpg.format=openpgp \
		-c gpg.ssh.allowedSignersFile=/dev/null -c gpg.x509.program=false \
		verify-commit --raw "$c" 2>&1 >/dev/null)" &&
		[[ "$out" == *"[GNUPG:] GOODSIG "* ]]; then
		line="$(grep -m1 '^\[GNUPG:\] VALIDSIG ' <<<"$out" || true)"
	else
		line=""
	fi
	if [[ -z "$line" ]]; then
		case "$out" in
		*"[GNUPG:] NO_PUBKEY "* | *"[GNUPG:] ERRSIG "*) why="signed by an unknown key" ;;
		*"[GNUPG:] EXPKEYSIG "*) why="signed by an expired key" ;;
		*"[GNUPG:] REVKEYSIG "*) why="signed by a revoked key" ;;
		*"[GNUPG:] BADSIG "*) why="bad signature (changed after signing)" ;;
		*) why="signature not valid" ;;
		esac
		return 1
	fi
	# VALIDSIG <signing-key fpr> <date> <ts> <expire> <ver> <res> <pk> <hash> <class> <primary fpr>:
	# Max signs with a subkey, so both the subkey and the primary key count.
	read -r -a f <<<"$line"
	if fpr_in "${f[2]}" "${trusted_signers[@]}" || fpr_in "${f[11]:-}" "${trusted_signers[@]}"; then
		signed_as=trusted
		return 0
	fi
	if fpr_in "${f[2]}" "${merge_signers[@]}" || fpr_in "${f[11]:-}" "${merge_signers[@]}"; then
		read -r -a parents <<<"$(git rev-list --parents -n1 "$c")"
		if ((${#parents[@]} != 3)); then
			why="signed by the merge key (GitHub) but not a merge: a web edit, squash merge or Dependabot commit"
			return 1
		fi
		if ! want="$(git merge-tree --write-tree "${parents[1]}" "${parents[2]}" 2>/dev/null)"; then
			why="merge signed by GitHub with conflicts resolved in it"
			return 1
		fi
		want="${want%%$'\n'*}"
		tree="$(git rev-parse "$c^{tree}")"
		if [[ "$want" != "$tree" ]]; then
			why="merge signed by GitHub whose content is not the clean merge of its parents"
			return 1
		fi
		signed_as=merge
		return 0
	fi
	why="signed by ${f[11]:-${f[2]}}, not a trusted key"
	return 1
}

if [[ -n "${TRUSTED_GNUPGHOME:-}" ]]; then
	read -r -a trusted_signers <<<"${TRUSTED_SIGNERS:-}"
	read -r -a merge_signers <<<"${TRUSTED_MERGE_SIGNERS:-}"
	if ((${#trusted_signers[@]} == 0)); then
		echo "signature gate: TRUSTED_SIGNERS is empty in $CONFIG" >&2
		exit 14
	fi
	for f in "${trusted_signers[@]}" "${merge_signers[@]}"; do
		if [[ ! "$f" =~ ^[0-9A-Fa-f]{40}([0-9A-Fa-f]{24})?$ ]]; then
			echo "signature gate: '$f' in $CONFIG is not a full key fingerprint (40 hex digits, no spaces)" >&2
			exit 14
		fi
	done
	if [[ ! -d "$TRUSTED_GNUPGHOME" || ! -r "$TRUSTED_GNUPGHOME" ]]; then
		echo "signature gate: TRUSTED_GNUPGHOME $TRUSTED_GNUPGHOME is not a readable directory" >&2
		exit 14
	fi
	if ! command -v gpg >/dev/null; then
		echo "signature gate: gpg is not installed (apt-get install gnupg)" >&2
		exit 14
	fi
	# gpg wants a writable home: a private copy of the root-owned keyring.
	gnupg_tmp="$(mktemp -d)"
	chmod 700 "$gnupg_tmp"
	keyring=0
	for k in pubring.kbx pubring.gpg; do
		if [[ -e "$TRUSTED_GNUPGHOME/$k" ]]; then
			if ! cp -- "$TRUSTED_GNUPGHOME/$k" "$gnupg_tmp/" 2>/dev/null; then
				echo "signature gate: cannot read $TRUSTED_GNUPGHOME/$k (root: chmod 644)" >&2
				exit 14
			fi
			keyring=1
		fi
	done
	if ((!keyring)); then
		echo "signature gate: no keyring (pubring.kbx) in $TRUSTED_GNUPGHOME" >&2
		exit 14
	fi
	cp -- "$TRUSTED_GNUPGHOME/trustdb.gpg" "$gnupg_tmp/" 2>/dev/null || true
	export GNUPGHOME="$gnupg_tmp"

	# The new commits; for a downgrade or a redeploy of the running commit
	# (nothing new) the target commit itself.
	if ((downgrade)) || [[ "$sha" == "$prev" ]]; then
		commits=("$sha")
	else
		range="$(git rev-list "$prev..$sha")"
		mapfile -t commits <<<"$range"
		if [[ -z "$range" ]]; then commits=("$sha"); fi
	fi
	bad=0
	n_trusted=0
	n_merge=0
	for c in "${commits[@]}"; do
		if check_commit "$c"; then
			if [[ "$signed_as" == merge ]]; then n_merge=$((n_merge + 1)); else n_trusted=$((n_trusted + 1)); fi
		else
			if ((bad == 0)); then
				echo "refusing to deploy: commits without a trusted signature:" >&2
			fi
			bad=$((bad + 1))
			echo "  $(git log -1 --format='%h %an: %s' "$c") — $why" >&2
		fi
	done
	if ((bad)); then
		echo "Each of them must be re-signed by Max (deploy/README.md, Signaturen)." >&2
		exit 12
	fi
	log "signatures ok: ${#commits[@]} commit(s), $n_trusted by a trusted key, $n_merge clean GitHub merge(s)"
fi

# ── Compose pin ──────────────────────────────────────────────────────────────
# The deploy user is in the docker group, and docker is root on this host,
# which also runs Vaultwarden: a compose file can start a privileged container
# or mount / — so whoever controls the compose file controls the server. With a
# pin (/etc/cozynights/<compose file>.sha256, or COMPOSE_PIN in the config) the
# compose file of the commit must be exactly the one root approved; every
# change to it needs root's review first. Approve no compose file that uses
# include: or extends: (the pin covers this one file only).
pin_file="/etc/cozynights/${COMPOSE_FILE##*/}.sha256"
pin=""
pin_src=""
if [[ -n "${COMPOSE_PIN:-}" ]]; then
	pin="$(grep -oE '\b[0-9a-f]{64}\b' <<<"${COMPOSE_PIN,,}" | head -n1 || true)"
	pin_src="COMPOSE_PIN in $CONFIG"
elif [[ -e "$pin_file" ]]; then
	pin="$(grep -oE '\b[0-9a-f]{64}\b' "$pin_file" | head -n1 || true)"
	pin_src="$pin_file"
fi
if [[ -n "$pin_src" ]]; then
	if [[ ! "$pin" =~ ^[0-9a-f]{64}$ ]]; then
		echo "compose pin: $pin_src holds no sha256" >&2
		exit 14
	fi
	compose_path="hamburn-cozynights/$COMPOSE_FILE"
	if ! git cat-file -e "$sha:$compose_path" 2>/dev/null; then
		echo "refusing to deploy: $compose_path does not exist in $sha" >&2
		exit 13
	fi
	have="$(git cat-file blob "$sha:$compose_path" | sha256sum)"
	have="${have%% *}"
	if [[ "$have" != "$pin" ]]; then
		{
			echo "refusing to deploy: $compose_path in ${sha:0:7} is not the approved compose file"
			echo "  approved ($pin_src): $pin"
			echo "  this commit: $have"
			echo "Root approves it after reading the change:"
			echo "  sudo -u deploy git -C $APP_DIR diff $prev $sha -- $compose_path"
			if [[ -n "${COMPOSE_PIN:-}" ]]; then
				echo "  sed -i 's/^COMPOSE_PIN=.*/COMPOSE_PIN=$have/' $CONFIG"
			else
				echo "  echo '$have  ${COMPOSE_FILE##*/}' > $pin_file"
			fi
		} >&2
		exit 13
	fi
	log "compose file approved ($pin_src)"
fi

# ── The running app image, kept as <image>:prev for the rollback ─────────────
# A plain `docker image prune` (no -a) only removes dangling images, so :prev
# survives the prune below; the :prev of the deploy before loses its tag here
# and goes with that prune.
app_cid="$(compose ps -q app 2>/dev/null | head -n1 || true)"
if [[ -n "$app_cid" ]]; then
	ref="$(docker inspect -f '{{.Config.Image}}' "$app_cid" 2>/dev/null || true)"
	id="$(docker inspect -f '{{.Image}}' "$app_cid" 2>/dev/null || true)"
	if [[ "$ref" =~ ^[a-z0-9][a-z0-9._/-]*(:[A-Za-z0-9._-]+)?$ && -n "$id" ]]; then
		if [[ "${ref##*/}" != *:* ]]; then ref="$ref:latest"; fi
		if docker tag "$id" "${ref%:*}:prev"; then
			app_image="$ref"
			prev_image="${ref%:*}:prev"
			log "running app image ${id:0:19} kept as $prev_image"
		fi
	else
		log "app container runs '${ref:-?}' — no :prev tag, a rollback rebuilds $prev"
	fi
else
	log "no app container running — a rollback rebuilds $prev"
fi

# Build first: the running containers keep serving until `up -d`.
phase=1
git checkout --quiet --detach "$sha"
log "building app image"
# GIT_SHA reaches the image as a build argument: the version badge and
# /api/health then name the deployed commit.
if ! GIT_SHA="$sha" compose build app; then
	log "build failed — nothing changed, still serving $prev"
	exit 6
fi

# The snapshot helper image, pulled BEFORE PocketBase is stopped: a failed pull
# must not leave the database down. Pinned, like everything else.
HELPER_IMAGE="${HELPER_IMAGE:-alpine:3.21}"
if ! docker pull -q "$HELPER_IMAGE" >/dev/null 2>&1; then
	log "cannot pull $HELPER_IMAGE for the snapshot — nothing changed, still serving $prev"
	exit 8
fi

# Consistent PocketBase snapshot: stop it briefly, archive the volume.
volume="$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/pb_data"}}{{.Name}}{{end}}{{end}}' "$PB_CONTAINER" 2>/dev/null || true)"
if [[ -n "$volume" ]]; then
	backup="pb_data-$(date -u +%Y%m%dT%H%M%SZ)-${prev:0:7}.tar.gz"
	log "backing up volume $volume → $BACKUP_DIR/$backup"
	phase=2
	compose stop pocketbase
	# backups/ holds PocketBase's own auto-backup ZIPs (pb_hooks/cozy_backups.pb.js):
	# not needed to roll back a deploy, and they would bloat every archive.
	if ! docker run --rm -v "$volume":/pb_data:ro -v "$BACKUP_DIR":/backup "$HELPER_IMAGE" \
		tar czf "/backup/$backup" --exclude=./backups -C /pb_data .; then
		rm -f "$BACKUP_DIR/$backup"
		# The EXIT trap checks out $prev BEFORE PocketBase starts again: pb_hooks
		# and pb_migrations are bind-mounted from it, and $sha's migrations must
		# not touch a volume that has no snapshot.
		log "snapshot failed — nothing changed, restarting PocketBase on $prev"
		exit 9
	fi
	{ ls -1t "$BACKUP_DIR"/pb_data-*.tar.gz 2>/dev/null || true; } |
		tail -n +"$((BACKUP_KEEP + 1))" | xargs -r rm --
elif [[ "${ALLOW_NO_BACKUP:-0}" == 1 ]]; then
	log "WARNING: $PB_CONTAINER not found, skipping backup (ALLOW_NO_BACKUP=1)"
else
	log "no PocketBase volume found on $PB_CONTAINER — aborting, still serving $prev"
	log "(first deploy without a running stack: set ALLOW_NO_BACKUP=1 in $CONFIG)"
	exit 7
fi

log "starting stack"
phase=3
if compose up -d --remove-orphans; then
	if healthy; then
		# Only this stack's old images: both stacks share one Docker daemon, and
		# compose labels every image it builds with its project.
		phase=9
		docker image prune -f --filter "label=com.docker.compose.project=$COMPOSE_PROJECT_NAME" >/dev/null ||
			log "WARNING: image prune failed (the deploy itself is fine)"
		log "deployed $sha"
		exit 0
	fi
	log "health check failed on $HEALTH_URL — rolling back to $prev"
else
	log "starting the new stack failed — rolling back to $prev"
fi
compose logs --tail 40 app || true
if [[ -n "$(git diff --name-only "$prev" "$sha" -- hamburn-cozynights/pb_migrations/ 2>/dev/null)" ]]; then
	log "WARNING: $sha changed pb_migrations/ — the rollback restores the code, not the database."
	log "If $prev fails on the new schema, restore the snapshot ${backup:-in $BACKUP_DIR} (deploy/README.md, Restore)."
fi
if rollback && healthy; then
	log "rollback to $prev succeeded"
else
	log "rollback to $prev is ALSO unhealthy — manual intervention needed"
fi
phase=9
exit 1
