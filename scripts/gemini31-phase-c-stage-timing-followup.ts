/**
 * Phase C.1 — minimal stage-timing follow-up (8–12 same-chat turns).
 * Captures PROVIDER_WAIT_MS + PROVIDER_VISIBLE_TTFT_MS not stored in original 36-run artifacts.
 *
 * Requires: GEMINI_TTFT_PHASE_AUDIT=1 dev server
 *   PHASE_C1_FOLLOWUP_TURNS=10 node --conditions=react-server --import tsx scripts/gemini31-phase-c-stage-timing-followup.ts
 */
import fs from "node:fs";
import path from "node:path";

import { loadEnvLocal } from "./load-env-local";
import { runPhaseCTurn } from "./lib/gemini31PhaseCCollect";

loadEnvLocal();

const OUT_DIR = "/opt/cursor/artifacts/gemini31-phase-c-ttft";
const TURNS = Math.max(8, Math.min(12, Number(process.env.PHASE_C1_FOLLOWUP_TURNS ?? "10") || 10));

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  console.log(`Phase C.1 stage-timing follow-up: ${TURNS} turns (fixture A)`);
  console.log("Estimated cost: ~", TURNS, "× ~250–350 user points + CI USD (read-only diagnostic)");

  const { token, chatId, characterId } = await runPhaseCTurn.setupSession("A");
  const turns = [];
  for (let i = 0; i < TURNS; i++) {
    const message = runPhaseCTurn.LIVE_MEASURE_TURNS[i % runPhaseCTurn.LIVE_MEASURE_TURNS.length]!;
    console.log(`  follow-up turn ${i + 1}/${TURNS} …`);
    const record = await runPhaseCTurn.consumeTurn({
      token,
      characterId,
      chatId,
      fixture: "A",
      turnIndex: i + 1,
      message,
    });
    turns.push(record);
    fs.appendFileSync(path.join(OUT_DIR, "stage-timing-followup.jsonl"), JSON.stringify(record) + "\n");
    console.log(
      `    wait=${record.provider_wait_ms ?? "n/a"} visible=${record.visible_ttft_ms ?? "n/a"} gap=${record.pre_visible_gap_ms ?? "n/a"} reasoning=${record.reasoning_tokens ?? "n/a"}`
    );
    if (i + 1 < TURNS) await new Promise((r) => setTimeout(r, 3000));
  }

  const wait = turns.map((t) => t.provider_wait_ms).filter((n): n is number => n != null);
  const visible = turns.map((t) => t.visible_ttft_ms).filter((n): n is number => n != null);
  const gap = turns.map((t) => t.pre_visible_gap_ms).filter((n): n is number => n != null);
  const med = (a: number[]) => {
    const s = [...a].sort((x, y) => x - y);
    const m = Math.floor(s.length / 2);
    return s.length ? (s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2) : null;
  };

  const summary = {
    generatedAt: new Date().toISOString(),
    turns: TURNS,
    PROVIDER_WAIT_P50: med(wait),
    VISIBLE_TTFT_P50: med(visible),
    PRE_VISIBLE_GAP_P50: med(gap),
    CASE:
      med(wait) != null && med(visible) != null && med(gap) != null
        ? med(gap)! < med(wait)! * 0.35
          ? "A_gateway_queue_prefill"
          : "B_hidden_pre_visible_generation"
        : "UNKNOWN",
  };

  fs.writeFileSync(path.join(OUT_DIR, "stage-timing-followup-summary.json"), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
