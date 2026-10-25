#!/usr/bin/env bash
# Read-only production measurement. Does not change app source.
set -euo pipefail
BASE="${PROD_BASE:-https://chat-ai-production-3e84.up.railway.app}"
COOKIE_FILE="${PROD_COOKIE_FILE:-/tmp/smoke559_cookies.txt}"
BODY="${1:-docs/audits/scenario-ai-baseline/empty-fill-empty.json}"
OUT_DIR="${2:-docs/audits/scenario-ai-baseline/raw}"
LABEL="${3:-sample}"
mkdir -p "$OUT_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="$OUT_DIR/${LABEL}-${STAMP}.json"
echo "POST $BASE/api/trpg/scenarios/ai-draft -> $OUT"
START_MS="$(date +%s%3N)"
HTTP="$(curl -sS -o "$OUT" -w "%{http_code}" \
  -b "$COOKIE_FILE" \
  -H "Content-Type: application/json" \
  -X POST "$BASE/api/trpg/scenarios/ai-draft" \
  --data-binary @"$BODY")"
END_MS="$(date +%s%3N)"
echo "HTTP=$HTTP elapsed_ms=$((END_MS - START_MS))"
python3 - "$OUT" "$HTTP" "$((END_MS - START_MS))" <<'PY'
import json, sys
path, http, elapsed = sys.argv[1], sys.argv[2], sys.argv[3]
raw = open(path, encoding="utf-8").read()
try:
    data = json.loads(raw)
except json.JSONDecodeError:
    print("JSON_PARSE=FAIL")
    print(raw[:400])
    raise SystemExit(1)
meta = {
    "http": int(http),
    "elapsed_ms": int(elapsed),
    "error": data.get("error"),
    "title": (data.get("draft") or {}).get("title"),
    "startingSituation": ((data.get("draft") or {}).get("plan") or {}).get("startingSituation"),
    "centralConflict": ((data.get("draft") or {}).get("plan") or {}).get("centralConflict"),
    "goal": ((data.get("draft") or {}).get("plan") or {}).get("goal"),
    "endingConditions": ((data.get("draft") or {}).get("plan") or {}).get("endingConditions"),
    "provenance": ((data.get("draft") or {}).get("plan") or {}).get("provenance"),
    "lint": data.get("lint"),
}
print(json.dumps(meta, ensure_ascii=False, indent=2))
PY
