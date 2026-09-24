#!/usr/bin/env bash
# scripts/release.sh — stamp the version on the state that is about to be
# deployed (docs/develop/deployment.md, "Versions and releases").
#
#   scripts/release.sh 0.18.1 "Deploy Nr. 18: admins see who booked each spot"
#
# The version follows the deploy numbering: 0.<deploy number>.<fix>. The
# script writes it into package.json and package-lock.json, makes a SIGNED
# commit and a SIGNED tag v<version>, and prints the push command. It pushes
# nothing. Pushing the tag creates the GitHub release
# (.github/workflows/release.yml), and the deploy of that commit shows the
# version next to the title, in the footer, in the admin menu and in
# /api/health.
#
# Signing asks for the YubiKey PIN (pinentry); if it seems to hang, the key
# is blinking and wants a touch.

set -euo pipefail

usage() {
	echo "usage: scripts/release.sh <0.<deploy>.<fix>> [\"one line what this deploy brings\"]" >&2
	exit 2
}

version="${1:-}"
note="${2:-}"
[[ -n "$version" ]] || usage
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "not a version: $version (expected e.g. 0.18.1)" >&2; exit 2; }
tag="v$version"

cd "$(dirname "$0")/.."

if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
	echo "the working tree has changes; commit or set them aside first:" >&2
	git status --short --untracked-files=no >&2
	exit 1
fi
if git rev-parse -q --verify "refs/tags/$tag" >/dev/null; then
	echo "tag $tag exists already ($(git rev-parse --short "$tag"))" >&2
	exit 1
fi
current="$(node -p "require('./package.json').version")"
if [[ "$current" == "$version" ]]; then
	echo "package.json is at $version already; nothing to stamp" >&2
	exit 1
fi
branch="$(git branch --show-current || true)"
if [[ "$branch" != "integration/staging" && "$branch" != "main" ]]; then
	echo "note: on branch '${branch:-detached}', not integration/staging — fine for a deploy branch, the tag lands where you push it"
fi

# The previous version tag, for the tag message and the check that we go up.
prev="$(git describe --tags --abbrev=0 --match 'v[0-9]*' 2>/dev/null || true)"
if [[ -n "$prev" ]] && [[ "$(printf '%s\n%s\n' "${prev#v}" "$version" | sort -V | tail -1)" != "$version" ]]; then
	echo "$version is not newer than the last tag $prev" >&2
	exit 1
fi

echo "==> $current → $version (tag $tag${prev:+, after $prev})"
npm version "$version" --no-git-tag-version >/dev/null
git add package.json package-lock.json
git commit -S -q -m "chore(release): $tag${note:+ — $note}"
git tag -s "$tag" -m "$tag${note:+: $note}"

echo "    commit $(git rev-parse --short HEAD) $(git log -1 --format='%G?' | sed 's/G/signed/;s/N/UNSIGNED/')"
echo "    tag    $tag $(git tag -v "$tag" >/dev/null 2>&1 && echo signed || echo 'signature not verified here')"
echo
echo "Push the branch and the tag together (the tag alone would not deploy anything):"
echo "    git push origin ${branch:-HEAD} $tag"
