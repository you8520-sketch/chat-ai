/**
 * Phase D — paired same-chat continuity replay.
 * Pass 1 captures A visible + reasoning_details; pass 2 replays B with identical visible text.
 *
 *   node --conditions=react-server --import tsx scripts/gemini31-phase-d-continuity-paired.ts
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
  summarizeReasoningDetails,
  type ProbeMessages,
} from "./lib/gemini31PhaseDProbe";
import {
  CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL,
  buildCheaperInferenceHeaders,
  resolveCheaperInferenceApiKey,
} from "../src/lib/cheaperInferenceConfig";
import { parseReasoningTokens } from "../src/lib/openRouterUsage";

loadEnvLocal();

const OUT = "/opt/cursor/artifacts/gemini31-phase-d-reasoning/continuity-paired.json";
const TURNS = 6;

type CapturedTurn = {
  userMessage: string;
  visible: string;
  reasoningDetails: unknown[] | null;
  reasoningTokens: number;
  preVisibleGapMs: number | null;
  promptTokens: number;
};

async function runTurn(messages: ProbeMessages): Promise<CapturedTurn & { userMessage: string }> {
  const userMessage = messages[messages.length - 1]!.content;
  const body = buildCiWireBody([{ role: "system", content: PHASE_D_MINIMAL_SYSTEM }, ...messages], true);
  const headers = buildCheaperInferenceHeaders(resolveCheaperInferenceApiKey());
  const t0 = performance.now();
  let firstSseMs: number | null = null;
  let firstVisibleMs: number | null = null;
  let visible = "";
  let reasoningTokens = 0;
  let promptTokens = 0;
  const rawChunks: unknown[] = [];

  const res = await fetch(CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`CI ${res.status}`);
  const reader = res.body!.getReader();
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
        if (json.usage) reasoningTokens = parseReasoningTokens(json.usage) || reasoningTokens;
        if (json.usage && typeof json.usage === "object") {
          promptTokens = Number((json.usage as Record<string, unknown>).prompt_tokens) || promptTokens;
        }
        const choice = Array.isArray(json.choices) ? json.choices[0] : null;
        const delta =
          choice && typeof choice === "object" && (choice as Record<string, unknown>).delta
            ? ((choice as Record<string, unknown>).delta as Record<string, unknown>)
            : null;
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

  const reasoningDetails = mergeReasoningDetailsFromChunks(rawChunks);
  return {
    userMessage,
    visible,
    reasoningDetails,
    reasoningTokens,
    preVisibleGapMs:
      firstSseMs != null && firstVisibleMs != null ? firstVisibleMs - firstSseMs : null,
    promptTokens,
  };
}

async function main() {
  const captured: CapturedTurn[] = [];
  const historyA: ProbeMessages = [];

  console.log("Pass 1: capture A (visible-only)...");
  for (let i = 0; i < TURNS; i++) {
    const turn = await runTurn([...historyA, { role: "user", content: PHASE_D_USER_TURNS[i]! }]);
    captured.push(turn);
    historyA.push(buildContinuityAssistantMessage(turn.visible, turn.reasoningDetails, "A"));
    if (i < TURNS - 1) await new Promise((r) => setTimeout(r, 1500));
  }

  const paired: Array<{
    turnIndex: number;
    a_reasoning_tokens: number;
    b_reasoning_tokens: number;
    a_pre_visible_gap_ms: number | null;
    b_pre_visible_gap_ms: number | null;
    input_token_delta: number;
    same_visible_prefix: true;
  }> = [];

  console.log("Pass 2: replay B (visible + reasoning_details) with frozen A visible text...");
  for (let i = 1; i < TURNS; i++) {
    const historyB: ProbeMessages = [];
    for (let j = 0; j < i; j++) {
      const c = captured[j]!;
      historyB.push(buildContinuityAssistantMessage(c.visible, c.reasoningDetails, "B"));
    }
    const bTurn = await runTurn([
      ...historyB,
      { role: "user", content: PHASE_D_USER_TURNS[i]! },
    ]);
    const aTurn = captured[i]!;
    paired.push({
      turnIndex: i + 1,
      a_reasoning_tokens: aTurn.reasoningTokens,
      b_reasoning_tokens: bTurn.reasoningTokens,
      a_pre_visible_gap_ms: aTurn.preVisibleGapMs,
      b_pre_visible_gap_ms: bTurn.preVisibleGapMs,
      input_token_delta: bTurn.promptTokens - aTurn.promptTokens,
      same_visible_prefix: true,
    });
    if (i < TURNS - 1) await new Promise((r) => setTimeout(r, 1500));
  }

  const report = {
    generatedAt: new Date().toISOString(),
    methodology: "paired — identical visible assistant prefix; B adds captured reasoning_details",
    turns: TURNS,
    paired,
    B_REASONING_DELTA_P50: median(paired.map((p) => p.b_reasoning_tokens - p.a_reasoning_tokens)),
    B_GAP_DELTA_P50: median(
      paired
        .map((p) =>
          p.a_pre_visible_gap_ms != null && p.b_pre_visible_gap_ms != null
            ? p.b_pre_visible_gap_ms - p.a_pre_visible_gap_ms
            : null
        )
        .filter((n): n is number => n != null)
    ),
    INPUT_TOKEN_DELTA_P50: median(paired.map((p) => p.input_token_delta)),
    captured_turn_summaries: captured.map((c, i) => ({
      turn: i + 1,
      visible_chars: c.visible.length,
      reasoning_details_blocks: summarizeReasoningDetails(c.reasoningDetails).blockCount,
      reasoning_tokens: c.reasoningTokens,
    })),
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
