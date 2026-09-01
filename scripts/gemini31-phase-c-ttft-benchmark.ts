/**
 * Phase C — Gemini 3.1 Pro / CheaperInference same-chat cache + TTFT benchmark.
 * Phase C.1: uses corrected analyzer semantics.
 */
import fs from "node:fs";
import path from "node:path";
import { loadEnvLocal } from "./load-env-local";
import { loadEnvLocal } from "./load-env-local";
import { buildPhaseC1Diagnosis, type FixtureKind } from "./lib/gemini31PhaseCAnalyzer";
import {
  LIVE_MEASURE_TURNS,
  MODEL,
  runPhaseCTurn,
} from "./lib/gemini31PhaseCCollect";

loadEnvLocal();

const OUT_DIR = "/opt/cursor/artifacts/gemini31-phase-c-ttft";
const TURNS = Math.max(10, Number(process.env.PHASE_C_TURNS ?? "12") || 12);
const FIXTURE_FILTER = (process.env.PHASE_C_FIXTURES ?? "A,B,C")
  .split(",")
  .map((s) => s.trim().toUpperCase())
  .filter((s) => s === "A" || s === "B" || s === "C") as FixtureKind[];

function fixtureLabel(kind: FixtureKind): string {
  if (kind === "A") return "healthy steady-state (summaries through turn 15)";
  if (kind === "B") return "one-summary-batch-behind (summaries through turn 10)";
  return "background catch-up active (no sealed summaries)";
}

async function runFixture(token: string, userId: number, fixture: FixtureKind) {
  console.log(`\n######## FIXTURE ${fixture} — ${fixtureLabel(fixture)} ########`);
  const { chatId, characterId } = runPhaseCTurn.seedChat(userId, fixture);
  const turns = [];

  for (let i = 0; i < TURNS; i++) {
    const message = LIVE_MEASURE_TURNS[i % LIVE_MEASURE_TURNS.length]!;
    console.log(`  turn ${i + 1}/${TURNS} chatId=${chatId} …`);
    const record = await runPhaseCTurn.consumeTurn({
      token,
      characterId,
      chatId,
      fixture,
      turnIndex: i + 1,
      message,
    });
    const prev = turns[turns.length - 1] ?? null;
    record.cache_drop_class = runPhaseCTurn.classifyCacheDrop(prev, record);
    turns.push(record);
    fs.appendFileSync(path.join(OUT_DIR, `turns-${fixture}.jsonl`), JSON.stringify(record) + "\n");
    console.log(
      `    cache=${record.cache_ratio ?? "NOT_MEASURABLE"} wait=${record.provider_wait_ms ?? "n/a"} visible=${record.visible_ttft_ms ?? "n/a"} gap=${record.pre_visible_gap_ms ?? "n/a"}`
    );
    if (i + 1 < TURNS) await new Promise((r) => setTimeout(r, 3000));
  }
  return turns;
}

async function main() {
  if (!process.env.OPENROUTER_API_KEY && !process.env.CHEAPER_INFERENCE_API_KEY) {
    throw new Error("OPENROUTER_API_KEY or CHEAPER_INFERENCE_API_KEY required");
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const { token, userId } = await runPhaseCTurn.ensureAuth();
  await runPhaseCTurn.waitForServer();

  const fixtures = FIXTURE_FILTER.length ? FIXTURE_FILTER : (["A", "B", "C"] as FixtureKind[]);
  const byFixture: Record<string, unknown> = {};
  const allTurns = [];

  for (const fixture of fixtures) {
    const turns = await runFixture(token, userId, fixture);
    byFixture[fixture] = { label: fixtureLabel(fixture), turns };
    allTurns.push(...turns);
  }

  const diagnosis = buildPhaseC1Diagnosis(allTurns, {
    stageTimingAvailable: allTurns.some((t) => t.provider_wait_ms != null),
  });

  const report = {
    generatedAt: new Date().toISOString(),
    phase: "C.1",
    readOnly: true,
    model: MODEL,
    provider: "CheaperInference",
    reasoning_effort: "low",
    productionChanges: "NONE",
    liveTurnsPerFixture: TURNS,
    fixtures: byFixture,
    ...diagnosis,
  };

  fs.writeFileSync(path.join(OUT_DIR, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(diagnosis, null, 2));
  console.log("Wrote", path.join(OUT_DIR, "report.json"));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
