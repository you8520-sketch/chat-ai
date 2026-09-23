/**
 * Phase D.1 §14 — Production-like paired comparator (3 pairs, minimal system replaced).
 *
 *   node --conditions=react-server --import tsx scripts/gemini31-phase-d1-production-like.ts
 */
import fs from "node:fs";
import path from "node:path";

import { loadEnvLocal } from "./load-env-local";
import {
  PHASE_D1_PRODUCTION_LIKE_SYSTEM,
  PHASE_D_USER_TURNS,
  median,
  pairedProviderOrder,
  probeProviderStream,
  summarizeProbeRun,
} from "./lib/gemini31PhaseDProbe";

loadEnvLocal();

const OUT = "/opt/cursor/artifacts/gemini31-phase-d1-reasoning/production-like-comparator.json";
const PAIRS = 4;

async function main() {
  const paired = [];

  for (let i = 0; i < PAIRS; i++) {
    const userMessage = PHASE_D_USER_TURNS[i + 2] ?? PHASE_D_USER_TURNS[i]!;
    const order = pairedProviderOrder(i);
    const row: Record<string, unknown> = { pair: i + 1, order: [...order] };

    for (const provider of order) {
      console.log(`Production-like pair ${i + 1} ${provider}...`);
      const probe = await probeProviderStream({
        provider,
        messages: [{ role: "user", content: userMessage }],
        systemPrompt: PHASE_D1_PRODUCTION_LIKE_SYSTEM,
        orVisibility: "hidden",
      });
      row[provider] = summarizeProbeRun(probe);
      await new Promise((r) => setTimeout(r, 1200));
    }

    const ci = row.cheaperinference as ReturnType<typeof summarizeProbeRun>;
    const or = row.openrouter as ReturnType<typeof summarizeProbeRun>;
    row.reasoning_ratio = or.reasoning_tokens > 0 ? ci.reasoning_tokens / or.reasoning_tokens : null;
    row.first_visible_delta_ms =
      ci.request_to_first_visible_ms != null && or.request_to_first_visible_ms != null
        ? ci.request_to_first_visible_ms - or.request_to_first_visible_ms
        : null;
    paired.push(row);
    if (i < PAIRS - 1) await new Promise((r) => setTimeout(r, 1500));
  }

  const report = {
    generatedAt: new Date().toISOString(),
    PRODUCTION_LIKE_DIFFERENCE_REPRODUCED:
      median(paired.map((p) => p.reasoning_ratio as number | null).filter((n): n is number => n != null)) != null
        ? "YES"
        : "NOT_RUN",
    PAIRED_REASONING_RATIO_P50: median(
      paired.map((p) => p.reasoning_ratio as number | null).filter((n): n is number => n != null)
    ),
    PAIRED_FIRST_VISIBLE_DELTA_P50: median(
      paired
        .map((p) => p.first_visible_delta_ms as number | null)
        .filter((n): n is number => n != null)
    ),
    paired,
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
