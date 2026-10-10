#!/usr/bin/env bash
# Operator-only. Creates or reloads the MAIN_RP_STYLE_LENGTH golden snapshot
# INSIDE the Railway production container so raw rows never cross SSH.
# Public stdout is hash-only JSON.
#
# usage:
#   VERIFICATION_MODE=overlay scripts/railway-main-rp-style-length-golden.sh \
#     create 1 <expected-production-sha>
#   VERIFICATION_MODE=overlay scripts/railway-main-rp-style-length-golden.sh \
#     reload 1 <expected-production-sha>
#   VERIFICATION_MODE=overlay scripts/railway-main-rp-style-length-golden.sh \
#     current-live 1 <expected-production-sha>
set -euo pipefail

ACTION="${1:?action required: create|reload|current-live}"
VERSION="${2:?snapshot version required}"
EXPECTED_SHA="${3:?expected production SHA required}"
VERIFICATION_MODE="${VERIFICATION_MODE:-overlay}"
if [ "$VERIFICATION_MODE" != "overlay" ] && [ "$VERIFICATION_MODE" != "deployed" ]; then
  echo "VERIFICATION_MODE must be overlay or deployed" >&2
  exit 2
fi
RAILWAY_ARGS=(-p 072644e5-ce50-49bb-ab2e-1f13bae6b149 -s chat-ai -e production)
SSH_IDENTITY="${PRECALL_SSH_IDENTITY:-$HOME/.ssh/railway_cursor_trpg}"

cd "$(git rev-parse --show-toplevel)"
PR_HEAD="$(git rev-parse HEAD)"
git diff --quiet HEAD -- src scripts || { echo "worktree not clean under src/scripts" >&2; exit 2; }

RUNNER="scripts/rp-main-rp-style-length-golden.ts --action $ACTION --version $VERSION --deploy-sha $EXPECTED_SHA --db /data/app.db --root /data/private-golden-fixtures"

if [ "$VERIFICATION_MODE" = "deployed" ]; then
  railway ssh "${RAILWAY_ARGS[@]}" -i "$SSH_IDENTITY" -- sh -c \
    "set -e; cd /app; node --no-warnings --conditions=react-server --import tsx $RUNNER"
  exit 0
fi

BASE="$(git merge-base origin/main HEAD)"
mapfile -t OVERLAY < <(git diff --name-only --diff-filter=AM "$BASE" HEAD -- src scripts \
  | grep -E '\.ts$' | grep -vE '\.test\.ts$')
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
mkdir "$STAGE/ov"
for file in "${OVERLAY[@]}"; do
  mkdir -p "$STAGE/ov/$(dirname "$file")"
  git show "HEAD:$file" > "$STAGE/ov/$file"
done

REMOTE='set -e
W=$(mktemp -d /tmp/golden-ov.XXXXXX)
trap "rm -rf $W" EXIT
mkdir "$W/in" && tar xz -C "$W/in"
cp -r /app/src /app/scripts /app/package.json /app/tsconfig.json "$W/"
cp -r "$W/in/." "$W/"
ln -s /app/node_modules "$W/node_modules"
cd "$W"
node --no-warnings --conditions=react-server --import tsx '"$RUNNER"

tar cz -C "$STAGE/ov" . | railway ssh "${RAILWAY_ARGS[@]}" -i "$SSH_IDENTITY" -- sh -c "$REMOTE"
