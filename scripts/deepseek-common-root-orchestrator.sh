#!/usr/bin/env bash
# Run DeepSeek common-root audit variants in priority order (§16).
set -euo pipefail

ROOT="${ART_ROOT:-/opt/cursor/artifacts/deepseek-common-root-audit}"
export PROD_BASE="${PROD_BASE:-https://chat-ai-production-3e84.up.railway.app}"
export PROD_COOKIE_FILE="${PROD_COOKIE_FILE:-/tmp/terra_axis_cookies.txt}"
export RUNS="${RUNS:-3}"
export MAX_TURNS="${MAX_TURNS:-2}"

run_variant() {
  local label="$1"
  local dir="$2"
  local turns="${3:-2}"
  echo "=== variant ${label} (turns=${turns}) ==="
  VARIANT_LABEL="$label" EXPECTED_VARIANT="$label" OUT_DIR="$ROOT/$dir" MAX_TURNS="$turns" \
    npx tsx scripts/deepseek-common-root-audit.ts
}

mkdir -p "$ROOT"

run_variant "ds_postprocess_baseline" "01-postprocess/ds_postprocess_baseline"
run_variant "ds_paragraph_normalize_bypass" "01-postprocess/ds_paragraph_normalize_bypass"
run_variant "ds_real_production" "02-ds-real-production"
run_variant "ds_dialogue_control" "03-ds-dialogue-control"
run_variant "ds_common_only" "04-ds-common-only"

npx tsx scripts/deepseek-common-root-aggregate.ts

echo "Audit orchestration complete. See $ROOT/FINAL_STATS.json"
