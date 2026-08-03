#!/usr/bin/env bash
# DeepSeek V4 Pro common-root matrix orchestrator (§5–§11).
set -euo pipefail

ROOT="${ART_ROOT:-/opt/cursor/artifacts/deepseek-common-root-audit}"
export PROD_BASE="${PROD_BASE:-https://chat-ai-production-3e84.up.railway.app}"
export PROD_COOKIE_FILE="${PROD_COOKIE_FILE:-/tmp/terra_axis_cookies.txt}"
export MODEL_UI="${MODEL_UI:-deepseek-v4-pro}"
export RUNS="${RUNS:-2}"
export MAX_TURNS="${MAX_TURNS:-2}"

run_variant() {
  local label="$1"
  local dir="$2"
  local expected="${3:-$label}"
  echo "=== variant ${label} (expected=${expected}) ==="
  VARIANT_LABEL="$label" EXPECTED_VARIANT="$expected" OUT_DIR="$ROOT/$dir" ART_DIR="$ROOT/$dir" \
    node --import tsx scripts/deepseek-common-root-audit.ts
}

mkdir -p "$ROOT/00-integrity"

echo "=== D0 manual reanalysis (no new calls) ==="
node --import tsx scripts/pro-baseline-d0-manual-reanalysis.ts

echo "=== Fail-closed tests ==="
node --conditions=react-server --import tsx --test src/lib/rpDiagnosticCanary.failClosed.test.ts

echo "=== P0 pipeline parity ==="
run_variant "ds_pipeline_baseline" "01-postprocess/ds_pipeline_baseline" "ds_pipeline_baseline"

echo "=== P1 display grouping bypass ==="
run_variant "ds_display_grouping_bypass" "01-postprocess/ds_display_grouping_bypass" "ds_display_grouping_bypass"

echo "=== D1 dialogue control ==="
run_variant "ds_dialogue_control" "03-ds-dialogue-control" "ds_dialogue_control"

echo "=== D2a common-only style off ==="
run_variant "ds_common_only" "04-ds-common-only" "ds_common_only"

node --import tsx scripts/deepseek-common-root-aggregate.ts
echo "Matrix orchestration pass complete. See $ROOT/FINAL_STATS.json"
