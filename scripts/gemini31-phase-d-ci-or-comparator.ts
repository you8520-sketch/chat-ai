/**
 * Phase D §18–19 — CI LOW vs OpenRouter LOW comparator (5 runs each).
 *
 *   node --conditions=react-server --import tsx scripts/gemini31-phase-d-ci-or-comparator.ts
 */
import fs from "node:fs";
import path from "node:path";

import { loadEnvLocal } from "./load-env-local";
import {
  PHASE_D_MINIMAL_SYSTEM,
  PHASE_D_USER_TURNS,
  median,
  probeProviderStream,
} from "./lib/gemini31PhaseDProbe";

loadEnvLocal();

const OUT_DIR = "/opt/cursor/artifacts/gemini31-phase-d-reasoning";
const OUT = path.join(OUT_DIR, "ci-or-comparator.json");
const RUNS = 5;

async function main() {
  console.log("CI vs OpenRouter LOW comparator —", RUNS, "runs each");
  const ciRuns = [];
  const orRuns = [];

  for (let i = 0; i < RUNS; i++) {
    const userMessage = PHASE_D_USER_TURNS[i % PHASE_D_USER_TURNS.length]!;
    console.log(`\nRun ${i + 1}/${RUNS}: CI...`);
    const ci = await probeProviderStream({
      provider: "cheaperinference",
      messages: [{ role: "user", content: userMessage }],
      systemPrompt: PHASE_D_MINIMAL_SYSTEM,
    });
    ciRuns.push({
      run: i + 1,
      reasoning_tokens: ci.reasoningTokens,
      provider_wait_ms: ci.providerCompleteMs,
      visible_ttft_ms: ci.firstVisibleMs,
      pre_visible_gap_ms: ci.preVisibleGapMs,
      reasoning_tokens_per_previsible_second:
        ci.preVisibleGapMs != null && ci.preVisibleGapMs > 0
          ? ci.reasoningTokens / (ci.preVisibleGapMs / 1000)
          : null,
      visible_chars: ci.visibleChars,
      finish_reason: ci.finishReason,
      reasoning_details_present: ci.reasoningDetailsPresentAny,
    });

    await new Promise((r) => setTimeout(r, 2000));

    console.log(`Run ${i + 1}/${RUNS}: OpenRouter...`);
    const or = await probeProviderStream({
      provider: "openrouter",
      messages: [{ role: "user", content: userMessage }],
      systemPrompt: PHASE_D_MINIMAL_SYSTEM,
    });
    orRuns.push({
      run: i + 1,
      reasoning_tokens: or.reasoningTokens,
      provider_wait_ms: or.providerCompleteMs,
      visible_ttft_ms: or.firstVisibleMs,
      pre_visible_gap_ms: or.preVisibleGapMs,
      reasoning_tokens_per_previsible_second:
        or.preVisibleGapMs != null && or.preVisibleGapMs > 0
          ? or.reasoningTokens / (or.preVisibleGapMs / 1000)
          : null,
      visible_chars: or.visibleChars,
      finish_reason: or.finishReason,
      reasoning_details_present: or.reasoningDetailsPresentAny,
    });

    if (i < RUNS - 1) await new Promise((r) => setTimeout(r, 2000));
  }

  const ciReasoningP50 = median(ciRuns.map((r) => r.reasoning_tokens));
  const orReasoningP50 = median(orRuns.map((r) => r.reasoning_tokens));
  const ciGapP50 = median(
    ciRuns.map((r) => r.pre_visible_gap_ms).filter((n): n is number => n != null)
  );
  const orGapP50 = median(
    orRuns.map((r) => r.pre_visible_gap_ms).filter((n): n is number => n != null)
  );

  let decision = "INCONCLUSIVE";
  if (ciReasoningP50 != null && orReasoningP50 != null) {
    const ratio = ciReasoningP50 / Math.max(orReasoningP50, 1);
    if (ratio > 1.5) decision = "D-A CI reasoning >> OR";
    else if (ratio < 0.67) decision = "D-A OR reasoning >> CI (unexpected)";
    else if (ciGapP50 != null && orGapP50 != null && ciGapP50 > orGapP50 * 1.3) {
      decision = "D-B similar reasoning, CI slower pre-visible gap";
    } else if (Math.abs(ratio - 1) < 0.2 && ciGapP50 != null && orGapP50 != null && Math.abs(ciGapP50 - orGapP50) < 5000) {
      decision = "D-C similar reasoning and gaps";
    }
  }

  const report = {
    generatedAt: new Date().toISOString(),
    CI_LOW_VS_OR_LOW: "RUN",
    CI_REASONING_P50: ciReasoningP50,
    OR_REASONING_P50: orReasoningP50,
    CI_PRE_VISIBLE_GAP_P50: ciGapP50,
    OR_PRE_VISIBLE_GAP_P50: orGapP50,
    CI_REASONING_THROUGHPUT_P50: median(
      ciRuns
        .map((r) => r.reasoning_tokens_per_previsible_second)
        .filter((n): n is number => n != null)
    ),
    OR_REASONING_THROUGHPUT_P50: median(
      orRuns
        .map((r) => r.reasoning_tokens_per_previsible_second)
        .filter((n): n is number => n != null)
    ),
    COMPARATOR_DECISION: decision,
    ci_runs: ciRuns,
    or_runs: orRuns,
  };

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log("\n" + JSON.stringify(report, null, 2));
  console.log("\nWritten:", OUT);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
