#!/usr/bin/env bash
# Deploy variant to Railway via git push, wait, run production canary harness.
set -euo pipefail
cd /workspace

VARIANT="${1:?usage: orchestrator.sh VARIANT [MAX_TURNS] [RUNS]}"
MAX_TURNS="${2:-4}"
RUNS="${3:-3}"

case "$VARIANT" in
  dialogue_root_baseline) OUT_SUB="01-baseline" ;;
  greeting_dialogue_bundled) OUT_SUB="02-greeting-dialogue-bundled" ;;
  terminal_continuous_scene) OUT_SUB="03-terminal-continuous-scene" ;;
  dialogue_reference_scope) OUT_SUB="04-dialogue-reference-scope" ;;
  greeting_terminal_combined) OUT_SUB="06-best-structure-t07" ;;
  best_structure_temp_05) OUT_SUB="07-best-structure-t05" ;;
  best_structure_temp_06) OUT_SUB="08-best-structure-t06" ;;
  *) OUT_SUB="$VARIANT" ;;
esac

# Screening uses 2 turns; full validation uses 4
if [[ "$MAX_TURNS" == "2" ]]; then
  case "$VARIANT" in
    greeting_dialogue_bundled|terminal_continuous_scene|dialogue_reference_scope) ;;
    *) echo "screening max_turns=2 only for A/B/C variants"; exit 1 ;;
  esac
fi

export TERRA_PROMPT_CANARY_VARIANT="$VARIANT"
sed -i "s/export TERRA_PROMPT_CANARY_VARIANT=.*/export TERRA_PROMPT_CANARY_VARIANT=\"${VARIANT}\"/" scripts/railway-canary-start.sh

git add scripts/railway-canary-start.sh
git commit -m "chore(canary): deploy variant ${VARIANT} for dialogue-root experiment" || true
git push -u origin "$(git branch --show-current)"

echo "Waiting 120s for Railway deploy..."
sleep 120

for i in 1 2 3 4 5 6; do
  if curl -sf "${PROD_BASE:-https://chat-ai-production-3e84.up.railway.app}/health" >/dev/null; then
    break
  fi
  sleep 20
done

VARIANT_LABEL="$OUT_SUB" \
MAX_TURNS="$MAX_TURNS" \
RUNS="$RUNS" \
OUT_DIR="/opt/cursor/artifacts/terra-dialogue-root-final/${OUT_SUB}" \
ART_DIR="/opt/cursor/artifacts/terra-dialogue-root-final/${OUT_SUB}" \
npx tsx scripts/terra-dialogue-root-final-canary.ts

echo "Completed variant ${VARIANT} → ${OUT_SUB}"
