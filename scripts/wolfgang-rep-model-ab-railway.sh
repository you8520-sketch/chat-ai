#!/usr/bin/env bash
# One-off wrapper for scripts/wolfgang-rep-model-ab.ts. Runs the PR HEAD owners in a throwaway copy of
# the deployed tree (never in /app itself), then returns only the output directory. Classify for cleanup
# once the A/B evidence is archived.
#
#   scripts/wolfgang-rep-model-ab-railway.sh preflight|post OUT_DIR
#   LOCAL_APP_DIR=/path/to/main-checkout scripts/wolfgang-rep-model-ab-railway.sh preflight OUT_DIR   (simulation, no Railway)
set -euo pipefail

MODE="${1:?preflight|post}"
OUT_LOCAL="${2:?local output dir}"
RAILWAY_ARGS=(-p 072644e5-ce50-49bb-ab2e-1f13bae6b149 -s chat-ai -e production)
SSH_IDENTITY="${AB_SSH_IDENTITY:-$HOME/.ssh/id_ed25519}"
REF_DIR="docs/official-supply/reviews/assets/wolfgang-asset-redesign/reattach-2026-10-17"
OWNER_FILES=(
  src/lib/officialSupply/imagePrompt.ts
  src/lib/officialSupply/shotPlan.ts
  src/lib/officialSupply/style.ts
  src/lib/officialSupply/runner.ts
  src/lib/officialSupply/referencePreparation.ts
  src/lib/officialSupply/imageProfile.ts
  src/lib/openAiImageEdit.ts
)

cd "$(git rev-parse --show-toplevel)"
git diff --quiet HEAD -- src scripts docs || { echo "worktree not clean" >&2; exit 2; }
PR_HEAD="$(git rev-parse HEAD)"
BASE="$(git merge-base origin/main HEAD)"

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
mkdir "$STAGE/ov"
while IFS= read -r file; do
  mkdir -p "$STAGE/ov/$(dirname "$file")"
  git show "HEAD:$file" > "$STAGE/ov/$file"
done < <(git diff --name-only --diff-filter=AM "$BASE" HEAD -- src scripts | grep -E '\.ts$' | grep -vE '\.test\.ts$')
for ref in 07 04 08; do
  mkdir -p "$STAGE/ov/$REF_DIR"
  cp "$REF_DIR/$ref-eval_style.webp" "$STAGE/ov/$REF_DIR/"
done
cp src/lib/officialSupply/pilot/fixtures/pilot-rf-02-approved-asset-plan-f.json "$STAGE/ov/approved-plan.json"
{
  echo "{"
  first=1
  for file in "${OWNER_FILES[@]}"; do
    [ $first = 1 ] || echo ","
    first=0
    printf '"%s":"%s"' "$file" "$(git show "HEAD:$file" | sha256sum | cut -d' ' -f1)"
  done
  echo "}"
} > "$STAGE/ov/owners.json"
echo "$PR_HEAD" > "$STAGE/ov/pr-head.txt"

REMOTE='set -e
APP="${LOCAL_APP_DIR:-/app}"
W=$(mktemp -d /tmp/wolfgang-ab.XXXXXX)
trap "rm -rf $W" EXIT
mkdir "$W/in" && tar xz -C "$W/in"
cp -r "$APP/src" "$APP/scripts" "$APP/package.json" "$APP/tsconfig.json" "$W/"
mkdir -p "$W/docs"
cp -r "$W/in/." "$W/"
mkdir -p "$W/src/lib/officialSupply/pilot/fixtures"
cp "$W/approved-plan.json" "$W/src/lib/officialSupply/pilot/fixtures/pilot-rf-02-approved-asset-plan-f.json"
ln -s "$APP/node_modules" "$W/node_modules"
cd "$W"
mkdir out
node --no-warnings --conditions=react-server --import tsx scripts/wolfgang-rep-model-ab.ts '"$MODE"' --out "$W/out" --owners-manifest "$W/owners.json" 1>&2
tar cz -C "$W/out" . | base64 -w0'

mkdir -p "$OUT_LOCAL"
if [ -n "${LOCAL_APP_DIR:-}" ]; then
  tar cz -C "$STAGE/ov" . | LOCAL_APP_DIR="$LOCAL_APP_DIR" WOLFGANG_REP_AB_LIVE="${WOLFGANG_REP_AB_LIVE:-}" sh -c "$REMOTE" | base64 -d | tar xz -C "$OUT_LOCAL"
else
  tar cz -C "$STAGE/ov" . | railway ssh "${RAILWAY_ARGS[@]}" -i "$SSH_IDENTITY" -- sh -c "WOLFGANG_REP_AB_LIVE=${WOLFGANG_REP_AB_LIVE:-} $REMOTE" | base64 -d | tar xz -C "$OUT_LOCAL"
fi
echo "pr_head=$PR_HEAD out=$OUT_LOCAL"
