#!/usr/bin/env bash
# One real Main RP evaluation turn on an isolated DB snapshot.
#
# Copies the snapshot, starts the canonical production-mode verification
# server on it (PROMPT_DEBUG=1 for the final wire dump), sends one /api/chat
# message, waits for post-processing, stops the owned server and keeps:
# stream, prompt dump, token breakdown, final assistant text, cost ledger rows.
#
# Usage: eval-run.sh <snapshot_dir> <out_dir> <question_id> <message> [port]
# Env: env.sh exports (production flags), B7_TOKEN (session=...), provider keys.
set -euo pipefail
SNAP="$1"; OUT="$2"; QID="$3"; MESSAGE="$4"; PORT="${5:-3100}"
WORKSPACE=/workspace
RUN_DIR="/tmp/b7/run/$QID"
SESSION="b7-eval-$QID"

rm -rf "$RUN_DIR" "$WORKSPACE/debug"
mkdir -p "$RUN_DIR" "$OUT"
cp -r "$SNAP"/. "$RUN_DIR"/

tmux -f /exec-daemon/tmux.portal.conf new-session -d -s "$SESSION" -c "$WORKSPACE" -- bash -lc \
  "source /tmp/b7/env.sh && PROMPT_DEBUG=1 ./node_modules/.bin/tsx scripts/memory-verification-prod-server.ts pr --port $PORT --data-dir $RUN_DIR > $RUN_DIR/server.log 2>&1"

for _ in $(seq 1 90); do
  if curl -s -m 2 "http://localhost:$PORT/health" | grep -q ok; then break; fi
  sleep 1
done

node -e '
const [port, token, message, out] = process.argv.slice(1);
const t0 = Date.now();
const res = await fetch(`http://localhost:${port}/api/chat`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Cookie: token },
  body: JSON.stringify({ characterId: 18, chatId: 1, message }),
});
const text = await res.text();
(await import("node:fs")).writeFileSync(out, text);
console.log(JSON.stringify({ status: res.status, bytes: text.length, ms: Date.now() - t0 }));
' "$PORT" "$B7_TOKEN" "$MESSAGE" "$OUT/$QID.stream.txt" --input-type=module

sleep 25
cp "$WORKSPACE/debug/prompt_dump.txt" "$OUT/$QID.prompt_dump.txt" 2>/dev/null || echo "no prompt dump"
cp "$WORKSPACE/debug/token_breakdown.json" "$OUT/$QID.token_breakdown.json" 2>/dev/null || true

tmux -f /exec-daemon/tmux.portal.conf send-keys -t "$SESSION:0.0" C-c
for _ in $(seq 1 30); do
  tmux -f /exec-daemon/tmux.portal.conf has-session -t "=$SESSION" 2>/dev/null || break
  sleep 1
done

node "$(dirname "$0")/extract-run.cjs" "$RUN_DIR" "$OUT" "$QID"
