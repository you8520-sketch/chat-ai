#!/usr/bin/env bash
# TEMPORARY bounded Railway live proof for official-supply shot diversity.
# One attempt only; never writes DB/official assets. Remove after evidence is captured.
set -uo pipefail

QA_DIR="/data/official-shot-qa-v2"
ATTEMPTED="$QA_DIR/attempted"

if [ ! -f "$ATTEMPTED" ]; then
  mkdir -p "$QA_DIR"
  touch "$ATTEMPTED"

  OFFICIAL_QUALITY_SHOT_QA_LIVE=1 \
  OFFICIAL_QUALITY_SHOT_QA_ARTIFACT_DIR="$QA_DIR" \
  OFFICIAL_QUALITY_SHOT_QA_REFERENCE_PATH="/data/uploads/official-pilot-rf-v4-03__rep-a1.webp" \
  OFFICIAL_QUALITY_SHOT_QA_CONTACT_SHEET_PATH="/data/uploads/official-shot-qa-v2-contact-sheet.png" \
  node --conditions=react-server --import tsx scripts/official-supply-quality-shot-qa.ts

  QA_STATUS=$?
  echo "[official-shot-qa-v2] exit=$QA_STATUS"

  if [ -f "$QA_DIR/report.json" ]; then
    echo "[official-shot-qa-v2] report"
    cat "$QA_DIR/report.json"
  elif [ -f "$QA_DIR/STOP.json" ]; then
    echo "[official-shot-qa-v2] STOP"
    cat "$QA_DIR/STOP.json"
  else
    echo "[official-shot-qa-v2] no report produced"
  fi
else
  echo "[official-shot-qa-v2] already attempted; no retry"
  if [ -f "$QA_DIR/report.json" ]; then cat "$QA_DIR/report.json"; fi
  if [ -f "$QA_DIR/STOP.json" ]; then cat "$QA_DIR/STOP.json"; fi
fi

exec npm run start
