/**
 * Phase D.1 §9–12 — Parity-correct CI vs OR LOW comparator (alternating order, 8+ pairs).
 *
 *   node --conditions=react-server --import tsx scripts/gemini31-phase-d1-ci-or-comparator.ts
 */
import fs from "node:fs";
import path from "node:path";

import { loadEnvLocal } from "./load-env-local";
import {
  PHASE_D_MINIMAL_SYSTEM,
  PHASE_D_USER_TURNS,
  median,
  pairedProviderOrder,
  probeProviderStream,
  summarizeProbeRun,
} from "./lib/gemini31PhaseDProbe";

loadEnvLocal();

const OUT = "/opt/cursor/artifacts/gemini31-phase-d1-reasoning/ci-or-comparator-parity.json";
const PAIRS = 8;

async function main() {
  const paired: Array<{
    pair: number;
    prompt_hash_index: number;
    order: string[];
    ci: ReturnType<typeof summarizeProbeRun>;
    or: ReturnType<typeof summarizeProbeRun>;
    reasoning_delta: number;
    first_visible_delta_ms: number | null;
    reasoning_ratio: number | null;
    invalid_speed_win: boolean;
  }> = [];

  for (let i = 0; i < PAIRS; i++) {
    const userMessage = PHASE_D_USER_TURNS[i % PHASE_D_USER_TURNS.length]!;
    const order = pairedProviderOrder(i);
    const results: Partial<Record<"cheaperinference" | "openrouter", ReturnType<typeof summarizeProbeRun>>> = {};

    for (const provider of order) {
      console.log(`Pair ${i + 1}/${PAIRS} ${provider}...`);
      const probe = await probeProviderStream({
        provider,
        messages: [{ role: "user", content: userMessage }],
        systemPrompt: PHASE_D_MINIMAL_SYSTEM,
        orVisibility: "hidden",
      });
      results[provider] = summarizeProbeRun(probe);
      await new Promise((r) => setTimeout(r, 1200));
    }

    const ci = results.cheaperinference!;
    const or = results.openrouter!;
    const reasoning_delta = ci.reasoning_tokens - or.reasoning_tokens;
    const first_visible_delta_ms =
      ci.request_to_first_visible_ms != null && or.request_to_first_visible_ms != null
        ? ci.request_to_first_visible_ms - or.request_to_first_visible_ms
        : null;
    const invalid_speed_win =
      first_visible_delta_ms != null &&
      first_visible_delta_ms < -2000 &&
      ci.visible_chars < or.visible_chars * 0.7;

    paired.push({
      pair: i + 1,
      prompt_hash_index: i % PHASE_D_USER_TURNS.length,
      order: [...order],
      ci,
      or,
      reasoning_delta,
      first_visible_delta_ms,
      reasoning_ratio: or.reasoning_tokens > 0 ? ci.reasoning_tokens / or.reasoning_tokens : null,
      invalid_speed_win,
    });

    if (i < PAIRS - 1) await new Promise((r) => setTimeout(r, 1500));
  }

  const ciReasoningP50 = median(paired.map((p) => p.ci.reasoning_tokens));
  const orReasoningP50 = median(paired.map((p) => p.or.reasoning_tokens));
  const ciFirstVisibleP50 = median(
    paired.map((p) => p.ci.request_to_first_visible_ms).filter((n): n is number => n != null)
  );
  const orFirstVisibleP50 = median(
    paired.map((p) => p.or.request_to_first_visible_ms).filter((n): n is number => n != null)
  );
  const pairedReasoningRatio = median(
    paired.map((p) => p.reasoning_ratio).filter((n): n is number => n != null)
  );
  const pairedFirstVisibleDelta = median(
    paired.map((p) => p.first_visible_delta_ms).filter((n): n is number => n != null)
  );

  const report = {
    generatedAt: new Date().toISOString(),
    PAIRS,
    PARITY_CORRECT_CI_REASONING_P50: ciReasoningP50,
    PARITY_CORRECT_OR_REASONING_P50: orReasoningP50,
    PARITY_CORRECT_CI_FIRST_VISIBLE_P50: ciFirstVisibleP50,
    PARITY_CORRECT_OR_FIRST_VISIBLE_P50: orFirstVisibleP50,
    PAIRED_REASONING_RATIO: pairedReasoningRatio,
    PAIRED_FIRST_VISIBLE_DELTA: pairedFirstVisibleDelta,
    PAIRED_REASONING_DELTA_MEDIAN: median(paired.map((p) => p.reasoning_delta)),
    OR_ROUTED_PROVIDERS: [...new Set(paired.map((p) => p.or.or_routed_provider).filter(Boolean))],
    INVALID_SPEED_WINS: paired.filter((p) => p.invalid_speed_win).length,
    paired,
    NOTE: "Primary latency KPI is request_to_first_visible_ms. stream_complete is secondary.",
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
