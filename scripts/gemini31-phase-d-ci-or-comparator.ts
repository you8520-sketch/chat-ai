/**
 * Phase D §18–19 — DEPRECATED: use gemini31-phase-d1-ci-or-comparator.ts
 * Retained as thin wrapper with corrected metric names.
 */
import fs from "node:fs";
import path from "node:path";

import { loadEnvLocal } from "./load-env-local";
import {
  PHASE_D_MINIMAL_SYSTEM,
  PHASE_D_USER_TURNS,
  median,
  probeProviderStream,
  summarizeProbeRun,
} from "./lib/gemini31PhaseDProbe";

loadEnvLocal();

const OUT_DIR = "/opt/cursor/artifacts/gemini31-phase-d-reasoning";
const OUT = path.join(OUT_DIR, "ci-or-comparator.json");
const RUNS = 5;

async function main() {
  console.warn("DEPRECATED: prefer scripts/gemini31-phase-d1-ci-or-comparator.ts");
  const ciRuns = [];
  const orRuns = [];

  for (let i = 0; i < RUNS; i++) {
    const userMessage = PHASE_D_USER_TURNS[i % PHASE_D_USER_TURNS.length]!;
    const ci = await probeProviderStream({
      provider: "cheaperinference",
      messages: [{ role: "user", content: userMessage }],
      systemPrompt: PHASE_D_MINIMAL_SYSTEM,
    });
    ciRuns.push({ run: i + 1, ...summarizeProbeRun(ci) });
    await new Promise((r) => setTimeout(r, 2000));
    const or = await probeProviderStream({
      provider: "openrouter",
      messages: [{ role: "user", content: userMessage }],
      systemPrompt: PHASE_D_MINIMAL_SYSTEM,
    });
    orRuns.push({ run: i + 1, ...summarizeProbeRun(or) });
    if (i < RUNS - 1) await new Promise((r) => setTimeout(r, 2000));
  }

  const report = {
    generatedAt: new Date().toISOString(),
    DEPRECATED: true,
    USE_INSTEAD: "scripts/gemini31-phase-d1-ci-or-comparator.ts",
    CI_REASONING_P50: median(ciRuns.map((r) => r.reasoning_tokens)),
    OR_REASONING_P50: median(orRuns.map((r) => r.reasoning_tokens)),
    CI_FIRST_VISIBLE_P50: median(
      ciRuns.map((r) => r.request_to_first_visible_ms).filter((n): n is number => n != null)
    ),
    OR_FIRST_VISIBLE_P50: median(
      orRuns.map((r) => r.request_to_first_visible_ms).filter((n): n is number => n != null)
    ),
    ci_runs: ciRuns,
    or_runs: orRuns,
  };

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
