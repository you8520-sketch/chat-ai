/**
 * Phase D.1 §5 — OpenRouter reasoning visibility control (OR-VISIBLE vs OR-HIDDEN).
 *
 *   node --conditions=react-server --import tsx scripts/gemini31-phase-d1-or-visibility-control.ts
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

const OUT = "/opt/cursor/artifacts/gemini31-phase-d1-reasoning/or-visibility-control.json";
const PAIRS = 4;

async function main() {
  const visibleRuns = [];
  const hiddenRuns = [];

  for (let i = 0; i < PAIRS; i++) {
    const userMessage = PHASE_D_USER_TURNS[i]!;
    console.log(`Pair ${i + 1}/${PAIRS} OR-HIDDEN...`);
    const hidden = await probeProviderStream({
      provider: "openrouter",
      messages: [{ role: "user", content: userMessage }],
      systemPrompt: PHASE_D_MINIMAL_SYSTEM,
      orVisibility: "hidden",
    });
    hiddenRuns.push({ pair: i + 1, variant: "OR-HIDDEN", ...summarizeProbeRun(hidden) });

    await new Promise((r) => setTimeout(r, 1500));

    console.log(`Pair ${i + 1}/${PAIRS} OR-VISIBLE (include_reasoning=true)...`);
    const visible = await probeProviderStream({
      provider: "openrouter",
      messages: [{ role: "user", content: userMessage }],
      systemPrompt: PHASE_D_MINIMAL_SYSTEM,
      orVisibility: "visible",
    });
    visibleRuns.push({ pair: i + 1, variant: "OR-VISIBLE", ...summarizeProbeRun(visible) });

    if (i < PAIRS - 1) await new Promise((r) => setTimeout(r, 1500));
  }

  const hiddenReasoning = median(hiddenRuns.map((r) => r.reasoning_tokens));
  const visibleReasoning = median(visibleRuns.map((r) => r.reasoning_tokens));
  const hiddenFirstVisible = median(
    hiddenRuns.map((r) => r.request_to_first_visible_ms).filter((n): n is number => n != null)
  );
  const visibleFirstVisible = median(
    visibleRuns.map((r) => r.request_to_first_visible_ms).filter((n): n is number => n != null)
  );
  const hiddenReasoningChunks = median(hiddenRuns.map((r) => r.reasoning_chunks_in_stream));
  const visibleReasoningChunks = median(visibleRuns.map((r) => r.reasoning_chunks_in_stream));

  let decision: string = "INCONCLUSIVE";
  const reasoningSimilar =
    hiddenReasoning != null &&
    visibleReasoning != null &&
    Math.abs(hiddenReasoning - visibleReasoning) / Math.max(hiddenReasoning, 1) < 0.15;
  const firstVisibleSimilar =
    hiddenFirstVisible != null &&
    visibleFirstVisible != null &&
    Math.abs(hiddenFirstVisible - visibleFirstVisible) < 2000;
  const chunkShapeDiffers =
    hiddenReasoningChunks != null &&
    visibleReasoningChunks != null &&
    visibleReasoningChunks > hiddenReasoningChunks + 2;

  if (reasoningSimilar && firstVisibleSimilar && chunkShapeDiffers) {
    decision = "STREAM_VISIBILITY_ONLY";
  } else if (!reasoningSimilar || !firstVisibleSimilar) {
    decision = "MODEL_BEHAVIOR_CHANGE";
  } else if (hiddenReasoningChunks === visibleReasoningChunks) {
    decision = "NONE";
  }

  const report = {
    generatedAt: new Date().toISOString(),
    OR_REASONING_VISIBILITY_EFFECT: decision,
    OR_HIDDEN_REASONING_P50: hiddenReasoning,
    OR_VISIBLE_REASONING_P50: visibleReasoning,
    OR_HIDDEN_FIRST_VISIBLE_P50: hiddenFirstVisible,
    OR_VISIBLE_FIRST_VISIBLE_P50: visibleFirstVisible,
    OR_HIDDEN_REASONING_CHUNKS_P50: hiddenReasoningChunks,
    OR_VISIBLE_REASONING_CHUNKS_P50: visibleReasoningChunks,
    hidden_runs: hiddenRuns,
    visible_runs: visibleRuns,
    INTERPRETATION:
      decision === "STREAM_VISIBILITY_ONLY"
        ? "Phase D OR pre_visible_gap≈3ms was presentation-related (reasoning chunks hidden from SSE)."
        : "See per-run metrics.",
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
