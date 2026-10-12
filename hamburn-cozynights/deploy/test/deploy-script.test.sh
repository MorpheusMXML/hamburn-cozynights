#!/usr/bin/env bash
# Tests for deploy/deploy-staging.sh, the server deploy script.
#
#   bash hamburn-cozynights/deploy/test/deploy-script.test.sh
#
# Starts a throwaway debian:12 container (no ports, no compose, removed
# afterwards), installs git, gnupg and curl there and runs every case against
# the real script, installed as on the server (root-owned
# /usr/local/bin/deploy-cozynights-<env>, config in /etc/cozynights) and run as
# an unprivileged `deploy` user. Docker is a stub (test/fake-docker) that
# records calls and simulates build, images, tags and containers; the health URL
# is a file the stub creates while a healthy image "runs". Origin is a local
# bare repository with commits signed by throwaway keys: "Max" (signing
# subkey), "GitHub" (merges) and a foreign one.
#
# Inside a container that already has the tools (faster while iterating):
#   bash /deploy/test/deploy-script.test.sh --inside
# SHOW_OUTPUT=1 prints the deploy output of passing cases too.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ "${1:-}" != --inside ]]; then
	exec docker run --rm -v "$here/..:/deploy:ro" debian:12 bash /deploy/test/deploy-script.test.sh --inside
fi
if [[ ! -e /.dockerenv && "${COZY_DEPLOY_TEST_FORCE:-}" != 1 ]]; then
	echo "refusing: this creates users and writes /etc, /opt, /srv — run it in a throwaway container" >&2
	exit 2
fi

D=/deploy
if ! command -v git >/dev/null || ! command -v gpg >/dev/null || ! command -v curl >/dev/null; then
	echo "installing git gnupg curl …"
	export DEBIAN_FRONTEND=noninteractive
	apt-get update -qq >/dev/null
	apt-get install -y -qq --no-install-recommends git gnupg curl ca-certificates >/dev/null
fi

# ── World ───────────────────────────────────────────────────────────────────
T=/tmp/deploy-test
rm -rf "$T" /srv/work /srv/origin.git /opt/app /etc/cozynights /var/backups/cozy /var/lib/fakedocker /root/signer
mkdir -p "$T"
git config --system safe.directory '*'
git config --system init.defaultBranch main
id deploy >/dev/null 2>&1 || useradd -m -s /bin/bash deploy

install -m 755 "$D/test/fake-docker" /usr/local/bin/docker
SCRIPT="${DEPLOY_SCRIPT:-$D/deploy-staging.sh}"   # another copy: DEPLOY_SCRIPT=/path
install -m 755 "$SCRIPT" /usr/local/bin/deploy-cozynights-staging
install -m 755 "$SCRIPT" /usr/local/bin/deploy-cozynights-production
install -d -m 755 /etc/cozynights

# As the deploy user with a clean environment, like the SSH forced command:
#   as_deploy [NAME=value…] command…
DEPLOY_RUN=(setpriv --reuid=deploy --regid=deploy --init-groups --
	env -i HOME=/home/deploy USER=deploy LOGNAME=deploy PATH=/usr/local/bin:/usr/bin:/bin LANG=C.UTF-8)
as_deploy() { "${DEPLOY_RUN[@]}" "$@"; }

# Keys: Max = certify-only primary key with a signing subkey (like a YubiKey
# setup), GitHub = the web-flow stand-in, Eve = anybody else.
export GNUPGHOME=/root/signer
install -d -m 700 "$GNUPGHOME"
gk() { gpg --batch --quiet --pinentry-mode loopback --passphrase '' "$@" 2>/dev/null; }
fpr_of() { gpg --with-colons --list-keys "$1" 2>/dev/null | awk -F: '/^fpr:/ { print $10; exit }'; }
gk --quick-gen-key 'Max Test <max@test.invalid>' ed25519 cert never
MAX_FPR="$(fpr_of max@test.invalid)"
gk --quick-add-key "$MAX_FPR" ed25519 sign never
MAX_SUB="$(gpg --with-colons --list-keys "$MAX_FPR" 2>/dev/null | awk -F: '/^fpr:/ { n++; if (n == 2) { print $10; exit } }')"
gk --quick-gen-key 'GitHub Test <noreply@github.invalid>' ed25519 sign never
GH_FPR="$(fpr_of noreply@github.invalid)"
gk --quick-gen-key 'Eve Test <eve@test.invalid>' ed25519 sign never
EVE_FPR="$(fpr_of eve@test.invalid)"

# The trusted keyring as the runbook installs it: root-owned, 0755, files 0644.
G=/etc/cozynights/gnupg
install -d -m 755 "$G"
gpg --export --armor "$MAX_FPR" >"$T/max.asc"
gpg --export "$GH_FPR" >"$T/web-flow.gpg"
gpg --homedir "$G" --batch --quiet --import "$T/max.asc" "$T/web-flow.gpg" 2>/dev/null
gpgconf --homedir "$G" --kill all 2>/dev/null || true
find "$G" -type f -exec chmod 644 {} +
# A second one that also knows Eve's key: a key in the keyring is not trust.
G2=/etc/cozynights/gnupg-with-eve
install -d -m 755 "$G2"
gpg --export "$EVE_FPR" >"$T/eve.gpg"
gpg --homedir "$G2" --batch --quiet --import "$T/max.asc" "$T/web-flow.gpg" "$T/eve.gpg" 2>/dev/null
gpgconf --homedir "$G2" --kill all 2>/dev/null || true
find "$G2" -type f -exec chmod 644 {} +

# ── Repository ──────────────────────────────────────────────────────────────
git init -q --bare /srv/origin.git
git init -q /srv/work
W=/srv/work
cd "$W"
git remote add origin /srv/origin.git
export GIT_COMMITTER_NAME=Test GIT_COMMITTER_EMAIL=t@test.invalid

who_env() {
	case "$1" in
	gh) printf '%s\n' "GIT_AUTHOR_NAME=GitHub" "GIT_AUTHOR_EMAIL=noreply@github.invalid" ;;
	eve) printf '%s\n' "GIT_AUTHOR_NAME=Eve" "GIT_AUTHOR_EMAIL=eve@test.invalid" ;;
	*) printf '%s\n' "GIT_AUTHOR_NAME=Max" "GIT_AUTHOR_EMAIL=max@test.invalid" ;;
	esac
}
sign_args() {
	case "$1" in
	max) printf '%s\n' -c "user.signingkey=$MAX_SUB!" ;;
	gh) printf '%s\n' -c "user.signingkey=$GH_FPR!" ;;
	eve) printf '%s\n' -c "user.signingkey=$EVE_FPR!" ;;
	esac
}
# commit <who: max|gh|eve|none> <parent> <message> [<path> <content>]…  → prints the SHA
commit() {
	local who="$1" parent="$2" msg="$3" sflag=-S
	shift 3
	local -a sa we
	mapfile -t sa < <(sign_args "$who")
	mapfile -t we < <(who_env "$who")
	if [[ "$who" == none ]]; then sflag=--no-gpg-sign; fi
	if [[ "$parent" != - ]]; then git checkout -q --detach "$parent"; fi
	while (($#)); do
		mkdir -p "$(dirname "$1")"
		printf '%s\n' "$2" >"$1"
		git add "$1"
		shift 2
	done
	env "${we[@]}" git "${sa[@]}" commit -q --allow-empty "$sflag" -m "$msg"
	git rev-parse HEAD
}
# merge <who> <p1> <p2> [extra-path extra-content] → prints the SHA
merge() {
	local who="$1" p1="$2" p2="$3"
	local -a sa we
	mapfile -t sa < <(sign_args "$who")
	mapfile -t we < <(who_env "$who")
	git checkout -q --detach "$p1"
	env "${we[@]}" git merge -q --no-ff --no-commit "$p2" >/dev/null 2>&1 || true
	if (($# == 5)); then
		printf '%s\n' "$5" >"$4"
		git add "$4"
	fi
	env "${we[@]}" git "${sa[@]}" commit -q -S -m "Merge $p2 into $p1"
	git rev-parse HEAD
}

C=hamburn-cozynights
B="$(commit max - 'base' \
	"$C/docker-compose.staging.yml" 'services: { app: { build: . } }  # staging v1' \
	"$C/docker-compose.production.yml" 'services: { app: { build: . } }  # production v1' \
	"$C/pb_migrations/1_init.js" 'init' \
	"$C/version.txt" 'base')"
N1="$(commit max "$B" 'n1' "$C/version.txt" 'n1')"
N2="$(commit max "$N1" 'n2' "$C/version.txt" 'n2')"
BAD="$(commit max "$B" 'bad: unhealthy image' "$C/version.txt" 'bad')"
M1="$(commit max "$B" 'on main' "$C/version.txt" 'main-1')"
X1="$(commit max "$B" 'feature x' "$C/version.txt" 'x')"
U1="$(commit none "$B" 'unsigned' "$C/version.txt" 'u1')"
E1="$(commit eve "$B" 'signed by eve' "$C/version.txt" 'e1')"
U2="$(commit none "$B" 'unsigned in the middle' "$C/version.txt" 'u2')"
S2="$(commit max "$U2" 'signed on top' "$C/version.txt" 's2')"
L1="$(commit max "$B" 'line' "$C/a.txt" 'a')"
F1="$(commit max "$B" 'feature' "$C/b.txt" 'b')"
GHM="$(merge gh "$L1" "$F1")"
GHE="$(merge gh "$L1" "$F1" "$C/evil.txt" 'hidden')"
G1="$(commit gh "$B" 'web edit' "$C/version.txt" 'g1')"
CC="$(commit max "$B" 'compose change' "$C/docker-compose.staging.yml" 'services: { app: { build: ., privileged: true } }')"
git push -q origin \
	"$N2:refs/heads/integration/staging" "$M1:refs/heads/main" "$X1:refs/heads/feature/x" \
	"$BAD:refs/heads/t/bad" "$U1:refs/heads/sig/unsigned" "$E1:refs/heads/sig/foreign" \
	"$S2:refs/heads/sig/mixed" "$GHM:refs/heads/sig/gh-clean" "$GHE:refs/heads/sig/gh-evil" \
	"$G1:refs/heads/sig/gh-nonmerge" "$CC:refs/heads/compose/change"
cd /

# ── Per case ────────────────────────────────────────────────────────────────
S=/var/lib/fakedocker
BK=/var/backups/cozy
CONF=/etc/cozynights/deploy-staging.conf

# reset <running commit> [config lines…]
reset() {
	local running="$1"
	shift
	rm -rf "$S" "$BK" /opt/app "$T/out" "$T/fg.out"
	rm -f /etc/cozynights/*.sha256
	install -d -o deploy -g deploy -m 755 "$S"
	install -d -o deploy -g deploy -m 750 "$BK"
	install -d -o deploy -g deploy -m 755 /opt/app
	as_deploy git clone -q /srv/origin.git /opt/app
	as_deploy git -C /opt/app checkout -q --detach "$running"
	printf 'img0 %s 0\n' "$running" >"$S/images"
	printf 'hamburn-cozynights-app:latest img0\n' >"$S/tags"
	echo img0 >"$S/app_container"
	echo fake-pb >"$S/pb_container"
	echo 1 >"$S/pb_running"
	echo 0 >"$S/counter"
	: >"$S/health"
	: >"$S/calls.log"
	: >"$S/events.log"
	chown -R deploy:deploy "$S"
	{
		echo "APP_DIR=/opt/app"
		echo "COMPOSE_PROJECT_NAME=hamburn-cozynights"
		echo "BACKUP_DIR=$BK"
		echo "HEALTH_URL=file://$S/health"
		echo "PB_CONTAINER=fake-pb"
		echo "HEALTH_TRIES=3"
		echo "HEALTH_INTERVAL=0.1"
		printf '%s\n' "$@"
	} >"$CONF"
	chmod 644 "$CONF"
}
knob() { printf '%s\n' "${2:-1}" >"$S/knob_$1"; }

rc=0
# run [-e env] <SSH_ORIGINAL_COMMAND>
run() {
	local env=staging
	if [[ "$1" == -e ]]; then
		env="$2"
		shift 2
	fi
	as_deploy SSH_ORIGINAL_COMMAND="$1" "/usr/local/bin/deploy-cozynights-$env" >"$T/out" 2>&1
	rc=$?
}
head_now() { git -C /opt/app rev-parse HEAD; }

pass=0
fail=0
failed=()
cur=""
errs=()
begin() {
	cur="$1"
	errs=()
}
nok() { errs+=("$*"); }
expect_rc() { if [[ "$rc" != "$1" ]]; then nok "exit code $rc, expected $1"; fi; }
expect_head() { if [[ "$(head_now)" != "$1" ]]; then nok "checkout on $(head_now | cut -c1-7), expected ${1:0:7}"; fi; }
expect_out() { if ! grep -qF -- "$1" "$T/out"; then nok "output lacks: $1"; fi; }
expect_no_out() { if grep -qF -- "$1" "$T/out"; then nok "output has: $1"; fi; }
expect_event() { if ! grep -qF -- "$1" "$S/events.log"; then nok "no event: $1"; fi; }
expect_no_event() { if grep -qF -- "$1" "$S/events.log"; then nok "unexpected event: $1"; fi; }
expect_count() { # <n> <pattern>
	local n
	n="$(grep -cF -- "$2" "$S/events.log" || true)"
	if [[ "$n" != "$1" ]]; then nok "$n× '$2' in events, expected $1"; fi
}
expect_order() { # <first> <second>: first event before second
	local a b
	a="$(grep -nF -- "$1" "$S/events.log" | head -n1 | cut -d: -f1)"
	b="$(grep -nF -- "$2" "$S/events.log" | tail -n1 | cut -d: -f1)"
	if [[ -z "$a" || -z "$b" || "$a" -ge "$b" ]]; then nok "'$1' not before '$2'"; fi
}
expect_tag() { # <ref> <id>
	local id
	id="$(awk -v r="$1" '$1 == r { print $2 }' "$S/tags")"
	if [[ "$id" != "$2" ]]; then nok "tag $1 → ${id:-none}, expected $2"; fi
}
expect_healthy() { if [[ ! -e "$S/health" ]]; then nok "stack not healthy at the end"; fi; }
expect_pb_running() { if [[ "$(cat "$S/pb_running")" != 1 ]]; then nok "PocketBase not running at the end"; fi; }
expect_unchanged() { # nothing changed: checkout, running image, tag, PocketBase
	expect_head "$1"
	expect_tag hamburn-cozynights-app:latest img0
	if [[ "$(cat "$S/app_container")" != img0 ]]; then nok "app container changed"; fi
	expect_pb_running
	expect_no_event "up @"
}
end() {
	if ((${#errs[@]} == 0)); then
		pass=$((pass + 1))
		printf 'PASS  %s\n' "$cur"
		if [[ "${SHOW_OUTPUT:-}" == 1 ]]; then sed 's/^/      | /' "$T/out"; fi
	else
		fail=$((fail + 1))
		failed+=("$cur")
		printf 'FAIL  %s\n' "$cur"
		printf '      - %s\n' "${errs[@]}"
		sed 's/^/      | /' "$T/out"
		sed 's/^/      e /' "$S/events.log"
	fi
}
latest_log() { find "$BK" -maxdepth 1 -name 'deploy-*.log' -printf '%T@ %p\n' | sort -n | tail -n1 | cut -d' ' -f2-; }
wait_for() { # <seconds> <file> <fixed string>
	local i
	for ((i = 0; i < $1 * 10; i++)); do
		if [[ -n "$2" && -e "$2" ]] && grep -qF -- "$3" "$2"; then return 0; fi
		sleep 0.1
	done
	return 1
}

GATE=("TRUSTED_GNUPGHOME=$G" "TRUSTED_SIGNERS=$MAX_FPR" "TRUSTED_MERGE_SIGNERS=$GH_FPR")
pin_cmd() { # the runbook's command: sha256 of the compose file on a branch
	as_deploy git -C /opt/app show "$1:hamburn-cozynights/docker-compose.staging.yml" | sha256sum
}

echo "deploy script: $SCRIPT"
echo
# From here on a failed check is a FAIL line, never the end of the run.
set +eo pipefail

# ── Basics and the old exit codes ───────────────────────────────────────────
begin "usage: no SHA → exit 2, printed directly, no log"
reset "$B"
run "deploy something"
expect_rc 2
expect_out "usage: deploy <40-char commit sha>"
if [[ -n "$(latest_log)" ]]; then nok "a log file was written"; fi
end

begin "happy path: build → snapshot with PocketBase stopped → up → healthy → exit 0"
reset "$B"
run "deploy $N1"
expect_rc 0
expect_head "$N1"
expect_event "tag sha256:img0 hamburn-cozynights-app:prev"
expect_event "build $N1 -> img1 @$N1"
expect_event "snapshot pb_running=0"
expect_event "up @$N1 app=img1 sha=$N1 nobuild=0"
expect_event "prune -f --filter label=com.docker.compose.project=hamburn-cozynights"
expect_no_event "prune WITH -a"
expect_order "tag sha256:img0" "build $N1"
expect_order "stop pocketbase" "snapshot pb_running=0"
expect_out "deployed $N1"
expect_out "exit 0"
expect_tag hamburn-cozynights-app:prev img0
if ! grep -q '^img0 ' "$S/images"; then nok ":prev image was pruned"; fi
expect_healthy
if ! ls "$BK"/pb_data-*-"${B:0:7}".tar.gz >/dev/null 2>&1; then nok "no snapshot archive"; fi
logf="$(latest_log)"
if [[ -z "$logf" ]] || ! cmp -s "$logf" "$T/out"; then nok "streamed output differs from the log file"; fi
if [[ "$(stat -c %a "$logf")" != 640 ]]; then nok "log file mode $(stat -c %a "$logf"), expected 640"; fi
if [[ "$(stat -c %a /opt/app/hamburn-cozynights/version.txt)" != 644 ]]; then nok "checkout file mode changed (umask leak)"; fi
end

begin "redeploy of the running commit (the runbook's Probelauf) → exit 0"
reset "$N1"
run "deploy $N1"
expect_rc 0
expect_head "$N1"
expect_out "deployed $N1"
end

begin "local changes in the checkout → exit 4, nothing changed"
reset "$B"
echo dirty >>/opt/app/hamburn-cozynights/version.txt
run "deploy $N1"
expect_rc 4
expect_out "have local changes"
expect_no_event "build"
end

begin "commit not on origin → exit 5"
reset "$B"
run "deploy 0123456789abcdef0123456789abcdef01234567"
expect_rc 5
expect_unchanged "$B"
end

begin "another deploy holds the lock → exit 3"
reset "$B"
as_deploy flock "$BK/.deploy.lock" sleep 3 &
holder=$!
sleep 0.3
run "deploy $N1"
wait "$holder" || true
expect_rc 3
expect_out "another deploy is already running"
expect_unchanged "$B"
end

begin "build fails → exit 6, nothing changed (checkout, image tag)"
reset "$B"
knob fail_build
run "deploy $N1"
expect_rc 6
expect_out "build failed"
expect_unchanged "$B"
expect_no_event "stop pocketbase"
end

begin "snapshot helper pull fails → exit 8, nothing changed, image tag back on the running image"
reset "$B"
knob fail_pull
run "deploy $N1"
expect_rc 8
expect_unchanged "$B"
expect_event "build $N1 -> img1"
expect_event "tag hamburn-cozynights-app:prev hamburn-cozynights-app:latest"
expect_no_event "stop pocketbase"
end

begin "no PocketBase volume → exit 7, nothing changed"
reset "$B"
rm -f "$S/pb_container"
run "deploy $N1"
expect_rc 7
expect_unchanged "$B"
end

# ── Rollback by image tag ───────────────────────────────────────────────────
begin "health check fails → rollback by retagging :prev, no rebuild → exit 1"
reset "$B"
knob bad_sha "$BAD"
run "deploy $BAD"
expect_rc 1
expect_head "$B"
expect_count 1 "build "
expect_event "up @$BAD app=img1 sha=$BAD nobuild=0"
expect_event "tag hamburn-cozynights-app:prev hamburn-cozynights-app:latest"
expect_event "up @$B app=img0 sha=$B nobuild=1"
expect_order "up @$BAD" "up @$B"
expect_out "rollback to $B succeeded"
expect_healthy
end

begin "health check fails, no app container ran before → rollback rebuilds the old commit"
reset "$B"
: >"$S/app_container"
knob bad_sha "$BAD"
run "deploy $BAD"
expect_rc 1
expect_head "$B"
expect_out "no :prev image of this deploy"
expect_event "build $B -> img2 @$B"
expect_event "up @$B app=img2 sha=$B nobuild=0"
expect_healthy
end

begin "compose up fails → rollback by retag → exit 1"
reset "$B"
knob fail_up
run "deploy $N1"
expect_rc 1
expect_head "$B"
expect_event "up FAILED @$N1"
expect_out "starting the new stack failed"
expect_event "up @$B app=img0 sha=$B nobuild=1"
expect_healthy
end

# ── EXIT trap ───────────────────────────────────────────────────────────────
begin "trap: snapshot fails with PocketBase stopped → checkout back, then PocketBase started → exit 9"
reset "$B"
knob fail_snapshot
run "deploy $N1"
expect_rc 9
expect_head "$B"
expect_event "start pocketbase @$B"
expect_order "stop pocketbase" "start pocketbase @$B"
expect_no_event "start pocketbase @$N1"
expect_no_event "up @"
expect_tag hamburn-cozynights-app:latest img0
expect_pb_running
end

begin "trap: unexpected error after PocketBase stop → restored → exit 15"
reset "$B"
knob fail_stop
run "deploy $N1"
expect_rc 15
expect_out "unexpected error at line"
expect_out "in compose(), called from line"
expect_head "$B"
expect_event "start pocketbase @$B"
expect_tag hamburn-cozynights-app:latest img0
expect_pb_running
end

begin "trap: SIGTERM while PocketBase is stopped → restored → exit 143"
reset "$B"
knob slow_snapshot 2
as_deploy SSH_ORIGINAL_COMMAND="deploy $N1" /usr/local/bin/deploy-cozynights-staging >"$T/out" 2>&1 &
fg=$!
if wait_for 10 "$T/out" "backing up volume"; then
	pid="$(grep -oE 'pid [0-9]+' "$T/out" | head -n1 | cut -d' ' -f2)"
	kill -TERM "$pid"
else
	nok "deploy never reached the snapshot"
fi
wait "$fg"
rc=$?
expect_rc 143
expect_head "$B"
expect_event "start pocketbase @$B"
expect_no_event "up @"
expect_pb_running
end

# ── SSH drop ────────────────────────────────────────────────────────────────
begin "SSH drop: the streaming side dies mid-build, the deploy finishes, the log has the end"
reset "$B"
knob slow_build 2
setsid "${DEPLOY_RUN[@]}" SSH_ORIGINAL_COMMAND="deploy $N1" /usr/local/bin/deploy-cozynights-staging >"$T/fg.out" 2>&1 &
fg=$!
if wait_for 10 "$T/fg.out" "building app image"; then
	kill -KILL -- "-$fg" 2>/dev/null || true
	wait "$fg" 2>/dev/null || true
	logf="$(latest_log)"
	if ! wait_for 20 "$logf" "] exit "; then nok "the detached deploy did not finish"; fi
	cp "$logf" "$T/out"
	expect_out "deployed $N1"
	expect_out "exit 0"
	expect_head "$N1"
	expect_event "up @$N1 app=img1 sha=$N1 nobuild=0"
	expect_healthy
	if grep -qF "deployed $N1" "$T/fg.out"; then nok "the streaming side was not cut off"; fi
	run "deploy $N2"
	if [[ "$rc" != 0 ]]; then nok "next deploy after the drop failed (lock left behind?) rc=$rc"; fi
else
	nok "deploy never reached the build"
fi
end

# ── Branches and downgrades ─────────────────────────────────────────────────
begin "REQUIRE_BRANCH with two branches: commit on main → deployed"
reset "$B" 'REQUIRE_BRANCH="integration/staging main"'
run "deploy $M1"
expect_rc 0
expect_head "$M1"
end

begin "REQUIRE_BRANCH with two branches: commit on integration/staging → deployed"
reset "$B" 'REQUIRE_BRANCH="integration/staging main"'
run "deploy $N1"
expect_rc 0
end

begin "REQUIRE_BRANCH with two branches: feature branch → exit 10"
reset "$B" 'REQUIRE_BRANCH="integration/staging main"'
run "deploy $X1"
expect_rc 10
expect_out "is not on origin/integration/staging origin/main"
expect_unchanged "$B"
end

begin "production copy: own config, REQUIRE_BRANCH=main refuses integration/staging → exit 10"
reset "$B"
sed -e 's/^HEALTH_TRIES=.*/REQUIRE_BRANCH=main/' "$CONF" >/etc/cozynights/deploy-production.conf
echo "COMPOSE_FILE=docker-compose.production.yml" >>/etc/cozynights/deploy-production.conf
run -e production "deploy $N1"
expect_rc 10
expect_out "is not on origin/main"
run -e production "deploy $M1"
if [[ "$rc" != 0 ]]; then nok "production deploy of main failed: $rc"; fi
rm -f /etc/cozynights/deploy-production.conf
end

begin "downgrade (target is an ancestor of the running commit) → exit 11"
reset "$N2"
run "deploy $N1"
expect_rc 11
expect_out "ALLOW_DOWNGRADE=1"
expect_unchanged "$N2"
end

begin "downgrade with ALLOW_DOWNGRADE=1 (and the signature gate: the target alone) → deployed"
reset "$N2" ALLOW_DOWNGRADE=1 "${GATE[@]}"
run "deploy $N1"
expect_rc 0
expect_head "$N1"
expect_out "WARNING: downgrade"
expect_out "signatures ok: 1 commit(s), 1 by a trusted key"
end

# ── Signature gate ──────────────────────────────────────────────────────────
begin "gate: Max-signed (subkey; primary fingerprint trusted) → deployed"
reset "$B" "${GATE[@]}"
run "deploy $N1"
expect_rc 0
expect_out "signatures ok: 1 commit(s), 1 by a trusted key, 0 clean GitHub merge(s)"
if find /tmp -maxdepth 1 -user deploy -name 'tmp.*' | grep -q .; then nok "temporary GNUPGHOME left behind"; fi
end

begin "gate: only the subkey's fingerprint in TRUSTED_SIGNERS → deployed"
reset "$B" "TRUSTED_GNUPGHOME=$G" "TRUSTED_SIGNERS=$MAX_SUB"
run "deploy $N2"
expect_rc 0
expect_out "signatures ok: 2 commit(s), 2 by a trusted key"
end

begin "gate: unsigned commit → exit 12"
reset "$B" "${GATE[@]}"
run "deploy $U1"
expect_rc 12
expect_out "${U1:0:7} Max: unsigned — not signed"
expect_out "re-signed by Max"
expect_unchanged "$B"
end

begin "gate: unsigned commit under a Max-signed one → exit 12 (every commit counts)"
reset "$B" "${GATE[@]}"
run "deploy $S2"
expect_rc 12
expect_out "${U2:0:7}"
expect_no_out "${S2:0:7} Max"
expect_unchanged "$B"
end

begin "gate: foreign key, not in the keyring → exit 12"
reset "$B" "${GATE[@]}"
run "deploy $E1"
expect_rc 12
expect_out "signed by an unknown key"
expect_unchanged "$B"
end

begin "gate: foreign key in the keyring but not trusted → exit 12"
reset "$B" "TRUSTED_GNUPGHOME=$G2" "TRUSTED_SIGNERS=$MAX_FPR" "TRUSTED_MERGE_SIGNERS=$GH_FPR"
run "deploy $E1"
expect_rc 12
expect_out "signed by $EVE_FPR, not a trusted key"
expect_unchanged "$B"
end

begin "gate: GitHub-signed clean merge of Max-signed commits → deployed"
reset "$B" "${GATE[@]}"
run "deploy $GHM"
expect_rc 0
expect_out "signatures ok: 3 commit(s), 2 by a trusted key, 1 clean GitHub merge(s)"
end

begin "gate: GitHub-signed merge with extra content → exit 12"
reset "$B" "${GATE[@]}"
run "deploy $GHE"
expect_rc 12
expect_out "not the clean merge of its parents"
expect_unchanged "$B"
end

begin "gate: GitHub-signed merge without TRUSTED_MERGE_SIGNERS → exit 12"
reset "$B" "TRUSTED_GNUPGHOME=$G" "TRUSTED_SIGNERS=$MAX_FPR"
run "deploy $GHM"
expect_rc 12
expect_out "not a trusted key"
end

begin "gate: GitHub-signed non-merge commit (web edit, Dependabot) → exit 12"
reset "$B" "${GATE[@]}"
run "deploy $G1"
expect_rc 12
expect_out "not a merge"
expect_unchanged "$B"
end

begin "gate: redeploy of the running commit checks that commit (GitHub merge) → deployed"
reset "$GHM" "${GATE[@]}"
run "deploy $GHM"
expect_rc 0
expect_out "signatures ok: 1 commit(s), 0 by a trusted key, 1 clean GitHub merge(s)"
expect_head "$GHM"
end

begin "gate: redeploy of a running unsigned commit → exit 12"
reset "$U1" "${GATE[@]}"
run "deploy $U1"
expect_rc 12
expect_out "not signed"
expect_unchanged "$U1"
end

begin "gate off (no TRUSTED_GNUPGHOME): unsigned commit → deployed"
reset "$B"
run "deploy $U1"
expect_rc 0
expect_head "$U1"
expect_no_out "signatures ok"
end

begin "gate misconfigured: missing keyring → exit 14"
reset "$B" "TRUSTED_GNUPGHOME=/etc/cozynights/nope" "TRUSTED_SIGNERS=$MAX_FPR"
run "deploy $N1"
expect_rc 14
expect_unchanged "$B"
end

begin "gate misconfigured: keyring file not readable by deploy → exit 14"
G3=/etc/cozynights/gnupg-unreadable
rm -rf "$G3"
cp -a "$G" "$G3"
chmod 600 "$G3/pubring.kbx"
reset "$B" "TRUSTED_GNUPGHOME=$G3" "TRUSTED_SIGNERS=$MAX_FPR"
run "deploy $N1"
expect_rc 14
expect_out "cannot read $G3/pubring.kbx"
expect_unchanged "$B"
end

begin "gate misconfigured: empty TRUSTED_SIGNERS / spaced fingerprint → exit 14"
reset "$B" "TRUSTED_GNUPGHOME=$G"
run "deploy $N1"
expect_rc 14
expect_out "TRUSTED_SIGNERS is empty"
reset "$B" "TRUSTED_GNUPGHOME=$G" "TRUSTED_SIGNERS=\"${MAX_FPR:0:4} ${MAX_FPR:4}\""
run "deploy $N1"
expect_rc 14
expect_out "is not a full key fingerprint"
end

# ── Compose pin ─────────────────────────────────────────────────────────────
begin "compose pin matches (pin written with the runbook's command) → deployed"
reset "$B"
pin_cmd origin/integration/staging >/etc/cozynights/docker-compose.staging.yml.sha256
run "deploy $N1"
expect_rc 0
expect_out "compose file approved (/etc/cozynights/docker-compose.staging.yml.sha256)"
end

begin "compose pin mismatch → exit 13 with the approve command; running it lets the deploy through"
reset "$B"
pin_cmd origin/integration/staging >/etc/cozynights/docker-compose.staging.yml.sha256
run "deploy $CC"
expect_rc 13
new="$(pin_cmd "$CC" | cut -d' ' -f1)"
expect_out "this commit: $new"
expect_out "sudo -u deploy git -C /opt/app diff $B $CC -- hamburn-cozynights/docker-compose.staging.yml"
expect_out "echo '$new  docker-compose.staging.yml' > /etc/cozynights/docker-compose.staging.yml.sha256"
expect_unchanged "$B"
approve="$(grep -F "> /etc/cozynights/docker-compose.staging.yml.sha256" "$T/out" | sed 's/^ *//')"
bash -c "$approve"
run "deploy $CC"
expect_rc 0
expect_head "$CC"
end

begin "COMPOSE_PIN in the config: mismatch → exit 13 with a sed command that approves it"
reset "$B" "COMPOSE_PIN=$(pin_cmd "$B" | cut -d' ' -f1)"
run "deploy $CC"
expect_rc 13
approve="$(grep -F "sed -i 's/^COMPOSE_PIN=" "$T/out" | sed 's/^ *//')"
if [[ -z "$approve" ]]; then nok "no sed approve command"; fi
bash -c "$approve"
run "deploy $CC"
expect_rc 0
end

begin "compose pin file without a hash → exit 14"
reset "$B"
echo "approved" >/etc/cozynights/docker-compose.staging.yml.sha256
run "deploy $N1"
expect_rc 14
expect_unchanged "$B"
end

begin "everything on: gate + pin + two branches, normal deploy → deployed"
reset "$B" 'REQUIRE_BRANCH="integration/staging main"' "${GATE[@]}"
pin_cmd origin/integration/staging >/etc/cozynights/docker-compose.staging.yml.sha256
run "deploy $N2"
expect_rc 0
expect_head "$N2"
expect_out "signatures ok: 2 commit(s)"
expect_out "compose file approved"
end

# ── Logs ────────────────────────────────────────────────────────────────────
begin "deploy logs stay bounded (DEPLOY_LOG_KEEP, default 20)"
reset "$B"
for i in $(seq -w 1 25); do
	as_deploy touch -d "2026-01-01 00:00:$i" "$BK/deploy-20260101T0000${i}Z-aaaaaaa.log"
done
run "deploy $N1"
expect_rc 0
n="$(find "$BK" -maxdepth 1 -name 'deploy-*.log' | wc -l)"
if [[ "$n" != 20 ]]; then nok "$n deploy logs, expected 20"; fi
if [[ "$(latest_log)" != *"-${N1:0:7}.log" ]]; then nok "the newest log is gone"; fi
end

echo
echo "$pass passed, $fail failed"
if ((fail)); then
	printf '  failed: %s\n' "${failed[@]}"
	exit 1
fi
