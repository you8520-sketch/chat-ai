#!/usr/bin/env bash
# Sequential matrix steps with variant polling (requires Railway env change between steps).
set -euo pipefail
export PROD_BASE="${PROD_BASE:-https://chat-ai-production-3e84.up.railway.app}"
export PROD_COOKIE_FILE="${PROD_COOKIE_FILE:-/tmp/terra_axis_cookies.txt}"
export MODEL_UI=deepseek-v4-pro
export RUNS=2
export MAX_TURNS=2
ROOT=/opt/cursor/artifacts/deepseek-common-root-audit
MAX_WAIT_MS="${MAX_WAIT_MS:-1200000}"

run_step() {
  local variant="$1"
  local out_sub="$2"
  echo "========== WAIT variant=$variant out=$out_sub =========="
  EXPECTED_VARIANT="$variant" \
  VARIANT_LABEL="$variant" \
  OUT_DIR="$ROOT/$out_sub" \
  ART_DIR="$ROOT/$out_sub" \
  MAX_WAIT_MS="$MAX_WAIT_MS" \
  node --import tsx scripts/wait-variant-and-run.ts
}

# P0 already complete
echo "P0 done — skipping"

run_step ds_display_grouping_bypass "01-postprocess/ds_display_grouping_bypass"
node --import tsx scripts/evaluate-p1-display.ts || true

run_step ds_dialogue_control "03-ds-dialogue-control"
node --import tsx scripts/evaluate-d1-npc.ts || true

run_step ds_common_only "04-ds-common-only"
node --import tsx scripts/evaluate-d2a.ts || true

# D2b only if D2a maintains fragmentation — script checks gate
if node --import tsx scripts/should-run-d2b.ts 2>/dev/null; then
  run_step ds_common_only_length_probe "04-ds-common-only-length-probe"
  node --import tsx scripts/evaluate-d2b.ts || true
fi

for c in \
  "common_creator_dialogue_scope:06-common-c1-creator-scope" \
  "common_layout_minimal:08-common-c2-layout" \
  "common_length_owner_minimal:09-common-c3-length" \
  "common_scene_directive_removed:10-common-c4-scene" \
  "common_rp_style_minimal:11-common-c5-rp-style"; do
  variant="${c%%:*}"
  dir="${c##*:}"
  if node --import tsx scripts/should-run-common-layers.ts 2>/dev/null; then
    run_step "$variant" "$dir"
  else
    echo "Skipping common layers — D2a showed Pro-specific cause"
    break
  fi
done

node --import tsx scripts/deepseek-common-root-aggregate.ts
node --import tsx scripts/matrix-final-report.ts
