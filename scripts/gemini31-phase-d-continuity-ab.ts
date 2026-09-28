/**
 * Phase D §10–12 — Ephemeral reasoning-continuity A/B (in-memory only, direct CI).
 *
 *   node --conditions=react-server --import tsx scripts/gemini31-phase-d-continuity-ab.ts
 */
import fs from "node:fs";
import path from "node:path";

import { loadEnvLocal } from "./load-env-local";
import {
  PHASE_D_MINIMAL_SYSTEM,
  PHASE_D_USER_TURNS,
  buildContinuityAssistantMessage,
  buildCiWireBody,
  median,
  mergeReasoningDetailsFromChunks,
  probeProviderStream,
  summarizeReasoningDetails,
  type ContinuityTurnMetrics,
  type ProbeMessages,
} from "./lib/gemini31PhaseDProbe";
import {
  CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL,
  buildCheaperInferenceHeaders,
  resolveCheaperInferenceApiKey,
} from "../src/lib/cheaperInferenceConfig";
import { parseReasoningTokens } from "../src/lib/openRouterUsage";

loadEnvLocal();

const OUT_DIR = "/opt/cursor/artifacts/gemini31-phase-d-reasoning";
const OUT = path.join(OUT_DIR, "continuity-ab.json");
const TURN_COUNT = 8;

/** Extract visible text from stream without storing reasoning prose in artifacts. */
async function runContinuityTurn(opts: {
  variant: "A" | "B";
  turnIndex: number;
  history: ProbeMessages;
  userMessage: string;
}): Promise<{
  metrics: ContinuityTurnMetrics;
  assistantVisible: string;
  reasoningDetails: unknown[] | null;
}> {
  const messages: ProbeMessages = [
    ...opts.history,
    { role: "user", content: opts.userMessage },
  ];
  const body = buildCiWireBody([{ role: "system", content: PHASE_D_MINIMAL_SYSTEM }, ...messages], true);
  const headers = buildCheaperInferenceHeaders(resolveCheaperInferenceApiKey());

  const t0 = performance.now();
  let firstSseMs: number | null = null;
  let firstVisibleMs: number | null = null;
  let visible = "";
  let finishReason: string | null = null;
  let promptTokens = 0;
  let completionTokens = 0;
  let reasoningTokens = 0;
  const rawChunks: unknown[] = [];

  const res = await fetch(CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`CI HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  if (!res.body) throw new Error("empty body");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value?.byteLength && firstSseMs == null) firstSseMs = performance.now() - t0;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const json = JSON.parse(payload) as Record<string, unknown>;
        rawChunks.push(json);
        if (json.usage && typeof json.usage === "object") {
          const u = json.usage as Record<string, unknown>;
          promptTokens = Number(u.prompt_tokens) || promptTokens;
          completionTokens = Number(u.completion_tokens) || completionTokens;
          reasoningTokens = parseReasoningTokens(u) || reasoningTokens;
        }
        const choice = Array.isArray(json.choices) ? json.choices[0] : null;
        if (!choice || typeof choice !== "object") continue;
        const c = choice as Record<string, unknown>;
        if (typeof c.finish_reason === "string") finishReason = c.finish_reason;
        const delta =
          c.delta && typeof c.delta === "object" ? (c.delta as Record<string, unknown>) : null;
        const text = typeof delta?.content === "string" ? delta.content : "";
        if (text) {
          if (firstVisibleMs == null) firstVisibleMs = performance.now() - t0;
          visible += text;
        }
      } catch {
        /* skip */
      }
    }
  }

  const providerWaitMs = performance.now() - t0;
  const preVisibleGapMs =
    firstSseMs != null && firstVisibleMs != null ? firstVisibleMs - firstSseMs : null;

  const reasoningDetails = mergeReasoningDetailsFromChunks(rawChunks);
  const detailsSummary = summarizeReasoningDetails(reasoningDetails);
  const detailsCount = detailsSummary.blockCount;
  const detailsBytes = detailsSummary.totalBytes;

  const rtps =
    preVisibleGapMs != null && preVisibleGapMs > 0 && reasoningTokens > 0
      ? reasoningTokens / (preVisibleGapMs / 1000)
      : null;

  return {
    metrics: {
      turnIndex: opts.turnIndex,
      variant: opts.variant,
      provider_prompt_tokens: promptTokens,
      provider_completion_tokens: completionTokens,
      reasoning_tokens: reasoningTokens,
      provider_wait_ms: providerWaitMs,
      visible_ttft_ms: firstVisibleMs,
      pre_visible_gap_ms: preVisibleGapMs,
      reasoning_tokens_per_previsible_second: rtps,
      visible_chars: visible.length,
      finish_reason: finishReason,
      reasoning_details_present: detailsCount > 0,
      reasoning_details_block_count: detailsCount,
      reasoning_details_bytes: detailsBytes,
      input_token_delta_vs_a: null,
    },
    assistantVisible: visible,
    reasoningDetails,
  };
}

async function runVariant(variant: "A" | "B"): Promise<ContinuityTurnMetrics[]> {
  const history: ProbeMessages = [];
  const turns: ContinuityTurnMetrics[] = [];
  const aPromptTokens: number[] = [];

  for (let i = 0; i < TURN_COUNT; i++) {
    const userMessage = PHASE_D_USER_TURNS[i] ?? `턴 ${i + 1} 계속해줘.`;
    const result = await runContinuityTurn({
      variant,
      turnIndex: i + 1,
      history,
      userMessage,
    });
    if (variant === "A") aPromptTokens.push(result.metrics.provider_prompt_tokens);
    if (variant === "B" && aPromptTokens[i] != null) {
      result.metrics.input_token_delta_vs_a =
        result.metrics.provider_prompt_tokens - aPromptTokens[i]!;
    }
    turns.push(result.metrics);

    history.push(
      buildContinuityAssistantMessage(result.assistantVisible, result.reasoningDetails, variant)
    );

    if (i < TURN_COUNT - 1) await new Promise((r) => setTimeout(r, 1500));
  }
  return turns;
}

async function main() {
  // Cost guard
  const expectedCalls = TURN_COUNT * 2;
  console.log("EXPECTED_CALLS:", expectedCalls);
  console.log("EXPECTED_APPROX_COST: ~", expectedCalls, "× Gemini 3.1 Pro LOW turns (diagnostic budget)");

  // Preflight: does CI return reasoning_details at all?
  const preflight = await probeProviderStream({
    provider: "cheaperinference",
    messages: [{ role: "user", content: PHASE_D_USER_TURNS[0]! }],
    systemPrompt: PHASE_D_MINIMAL_SYSTEM,
  });

  if (!preflight.reasoningDetailsPresentAny && preflight.emptyContentMetadataChunks === 0) {
    const blocked = {
      generatedAt: new Date().toISOString(),
      CONTINUITY_AB: "BLOCKED",
      reason: "CI did not return reasoning_details or empty-content metadata chunks in preflight",
      preflight: {
        reasoning_details_present: preflight.reasoningDetailsPresentAny,
        empty_content_metadata_chunks: preflight.emptyContentMetadataChunks,
        delta_key_union: [...new Set(preflight.chunkInventories.flatMap((c) => c.deltaKeys))],
      },
    };
    fs.mkdirSync(OUT_DIR, { recursive: true });
    fs.writeFileSync(OUT, JSON.stringify(blocked, null, 2));
    console.log(JSON.stringify(blocked, null, 2));
    return;
  }

  console.log("\nRunning variant A (visible-only history)...");
  const aTurns = await runVariant("A");
  console.log("\nRunning variant B (visible + reasoning_details)...");
  const bTurns = await runVariant("B");

  const report = {
    generatedAt: new Date().toISOString(),
    CONTINUITY_AB: "COMPLETED",
    A_TURNS: aTurns.length,
    B_TURNS: bTurns.length,
    A_REASONING_P50: median(aTurns.map((t) => t.reasoning_tokens)),
    B_REASONING_P50: median(bTurns.map((t) => t.reasoning_tokens)),
    A_PROVIDER_WAIT_P50: median(aTurns.map((t) => t.provider_wait_ms)),
    B_PROVIDER_WAIT_P50: median(bTurns.map((t) => t.provider_wait_ms)),
    A_PRE_VISIBLE_GAP_P50: median(
      aTurns.map((t) => t.pre_visible_gap_ms).filter((n): n is number => n != null)
    ),
    B_PRE_VISIBLE_GAP_P50: median(
      bTurns.map((t) => t.pre_visible_gap_ms).filter((n): n is number => n != null)
    ),
    A_VISIBLE_TTFT_P50: median(
      aTurns.map((t) => t.visible_ttft_ms).filter((n): n is number => n != null)
    ),
    B_VISIBLE_TTFT_P50: median(
      bTurns.map((t) => t.visible_ttft_ms).filter((n): n is number => n != null)
    ),
    A_VISIBLE_CHARS_P50: median(aTurns.map((t) => t.visible_chars)),
    B_VISIBLE_CHARS_P50: median(bTurns.map((t) => t.visible_chars)),
    INPUT_TOKEN_DELTA_P50: median(
      bTurns.map((t) => t.input_token_delta_vs_a).filter((n): n is number => n != null)
    ),
    a_turns: aTurns,
    b_turns: bTurns,
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
