#!/usr/bin/env bash
# Operator-only. Runs the PRECALL final-wire assembly INSIDE the Railway
# production container so raw rows never cross the SSH stream. Only the metadata
# JSON produced by scripts/rp-quality-precall-final-wire.ts comes back on stdout.
#
# usage:
#   scripts/railway-precall-final-wire.sh <expected-production-sha> \
#     [<supplied-hash-only-proof.json> <supplied-expected-sha>] > report.json
#
# <expected-production-sha> must come from `railway deployment list`, never from
# the PR HEAD. The container's own source is the base; only this PR's changed
# src/scripts .ts files are overlaid, in a throwaway /tmp dir (no DB or /app write).
set -euo pipefail

EXPECTED_SHA="${1:?expected production SHA required}"
SUPPLIED_PROOF="${2:-}"
SUPPLIED_SHA="${3:-}"
RAILWAY_ARGS=(-p 072644e5-ce50-49bb-ab2e-1f13bae6b149 -s chat-ai -e production)
SSH_IDENTITY="${PRECALL_SSH_IDENTITY:-$HOME/.ssh/id_ed25519}"

cd "$(git rev-parse --show-toplevel)"
PR_HEAD="$(git rev-parse HEAD)"
BASE="$(git merge-base origin/main HEAD)"
git diff --quiet HEAD -- src scripts || { echo "worktree not clean under src/scripts" >&2; exit 2; }

mapfile -t OVERLAY < <(git diff --name-only --diff-filter=AM "$BASE" HEAD -- src scripts \
  | grep -E '\.ts$' | grep -vE '\.test\.ts$')
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
mkdir "$STAGE/ov"
for file in "${OVERLAY[@]}"; do
  mkdir -p "$STAGE/ov/$(dirname "$file")"
  git show "HEAD:$file" > "$STAGE/ov/$file"
done
MAIN_SHA="${MAIN_SHA:-$EXPECTED_SHA}"
LIVE_TRANSPORT_FLAG=""
if [ "${LIVE_TRANSPORT_INCLUDED:-}" = "1" ]; then
  LIVE_TRANSPORT_FLAG=" --live-transport-included"
fi
RUNNER_ARGS="--expected-deploy-sha $EXPECTED_SHA --pr-head $PR_HEAD --main-sha $MAIN_SHA$LIVE_TRANSPORT_FLAG"
if [ -n "$SUPPLIED_PROOF" ]; then
  cp "$SUPPLIED_PROOF" "$STAGE/ov/supplied-proof.json"
  RUNNER_ARGS="$RUNNER_ARGS --supplied-proof supplied-proof.json --supplied-expected-sha $SUPPLIED_SHA"
fi

REMOTE='set -e
W=$(mktemp -d /tmp/precall-ov.XXXXXX)
trap "rm -rf $W" EXIT
mkdir "$W/in" && tar xz -C "$W/in"
cp -r /app/src /app/scripts /app/package.json /app/tsconfig.json "$W/"
cp -r "$W/in/." "$W/"
ln -s /app/node_modules "$W/node_modules"
cd "$W"
node --no-warnings --conditions=react-server --import tsx scripts/rp-quality-precall-final-wire.ts '"$RUNNER_ARGS"

tar cz -C "$STAGE/ov" . | railway ssh "${RAILWAY_ARGS[@]}" -i "$SSH_IDENTITY" -- sh -c "$REMOTE"
