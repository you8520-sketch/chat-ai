/**
 * Same-snapshot Gemini 3.1 vs Opus 5 payload + optional live CI usage.
 * Does not write chats or charge user points.
 *
 *   node --conditions=react-server --import tsx scripts/diagnose-opus-gemini-same-snapshot.ts
 *   node --conditions=react-server --import tsx scripts/diagnose-opus-gemini-same-snapshot.ts --live
 */
import Module from "module";

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "server-only") return {};
  return originalLoad.call(this, request, parent, isMain);
} as typeof Module._load;

import fs from "node:fs";
import path from "node:path";
import {
  buildLikeScaleSnapshot,
  diagnoseSameSnapshot,
  type SameSnapshotReport,
} from "../src/lib/opusGeminiSameSnapshotDiagnostic";
import { assemblePrimaryRpRequest } from "../src/lib/openRouterAdult";
import { buildContext } from "../src/services/contextBuilder";
import {
  CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL,
  buildCheaperInferenceHeaders,
} from "../src/lib/cheaperInferenceConfig";
import { parseOpenRouterUsage } from "../src/lib/openRouterUsage";
import { DEFAULT_TARGET_RESPONSE_CHARS } from "../src/lib/responseLengthConstants";

const LIVE = process.argv.includes("--live");
const OUT = path.join("/opt/cursor/artifacts", "opus_gemini_same_snapshot_report.log");

function redact(value: unknown): unknown {
  if (value && typeof value === "object") {
    const copy = { ...(value as Record<string, unknown>) };
    delete copy.Authorization;
    delete copy.authorization;
    return copy;
  }
  return value;
}

async function liveProbe(modelId: string, snapshot: ReturnType<typeof buildLikeScaleSnapshot>) {
  const key = process.env.CHEAPER_INFERENCE_API_KEY?.trim();
  if (!key) throw new Error("CHEAPER_INFERENCE_API_KEY missing");

  const built = buildContext({
    ...snapshot,
    modelId,
    provider: "cheaperinference",
  });
  const assembled = assemblePrimaryRpRequest({
    system: built.systemPrompt,
    history: built.history ?? [],
    modelId,
    targetResponseChars: DEFAULT_TARGET_RESPONSE_CHARS,
    stream: false,
    messageOpts: {
      transportProvider: "cheaperinference",
      systemSplit: built.openRouterSystemSplit,
      charName: snapshot.charName,
    },
  });

  const calls: Array<Record<string, unknown>> = [];
  for (let i = 0; i < 3; i++) {
    const body = structuredClone(assembled.requestBody) as Record<string, unknown>;
    body.max_tokens = 8;
    body.stream = false;
    if (i > 0 && Array.isArray(body.messages)) {
      const msgs = body.messages as Array<{ role?: string; content?: unknown }>;
      const last = msgs[msgs.length - 1];
      if (last && typeof last.content === "string") {
        last.content = `${last.content}\n[diag-warm-${i}]`;
      }
    }
    const res = await fetch(CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL, {
      method: "POST",
      headers: buildCheaperInferenceHeaders(key),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(180_000),
    });
    const rawText = await res.text();
    let json: Record<string, unknown> = {};
    try {
      json = JSON.parse(rawText) as Record<string, unknown>;
    } catch {
      json = { parseError: rawText.slice(0, 240) };
    }
    const usage = parseOpenRouterUsage(json.usage, res.headers);
    calls.push({
      call: i + 1,
      httpStatus: res.status,
      prompt_tokens: usage.promptTokens,
      completion_tokens: usage.completionTokens,
      reasoning_tokens: usage.reasoningTokens,
      cacheReadTokens: usage.cacheReadTokens,
      cacheWriteTokens: usage.cacheWriteTokens,
      standardInputTokens: usage.standardInputTokens,
      cacheHitPct:
        usage.promptTokens > 0
          ? Math.round((usage.cacheReadTokens / usage.promptTokens) * 1000) / 10
          : 0,
      upstreamCostUsd: usage.upstreamCostUsd ?? null,
      upstreamPromptCostUsd: usage.upstreamPromptCostUsd ?? null,
      upstreamCompletionCostUsd: usage.upstreamCompletionCostUsd ?? null,
      cacheDiscountUsd: usage.cacheDiscountUsd ?? null,
      prompt_tokens_details: usage.promptTokensDetailsRaw ?? json.usage ?? null,
      finish_reason:
        Array.isArray(json.choices) && json.choices[0] && typeof json.choices[0] === "object"
          ? (json.choices[0] as { finish_reason?: string }).finish_reason
          : null,
    });
  }
  return { modelId, calls, headerKeys: redact({}) };
}

function formatReport(report: SameSnapshotReport, live?: Record<string, unknown>): string {
  const g = report.gemini;
  const o = report.opus;
  const lines = [
    "A. SAME SNAPSHOT PHYSICAL PROMPT",
    "",
    "Gemini 3.1 Pro (cheaperinference)",
    `- system chars: ${g.assembled.system}`,
    `- systemRules chars: ${g.assembled.systemRules}`,
    `- characterSettings chars: ${g.assembled.characterSettings}`,
    `- dynamic chars: ${g.assembled.dynamic}`,
    `- history chars: ${g.assembled.history}`,
    `- current user chars: ${g.assembled.currentUser}`,
    `- total chars: ${g.assembled.total}`,
    `- payload total chars / utf8: ${g.payload.totalChars} / ${g.payload.totalUtf8Bytes}`,
    `- estimateTokens(): ${g.payload.estimateTokens}`,
    `- cache_control blocks: ${g.payload.cacheControlBlocks}`,
    `- assistant prefill: ${g.payload.hasAssistantPrefill}`,
    "",
    "Opus 5 (cheaperinference)",
    `- system chars: ${o.assembled.system}`,
    `- systemRules chars: ${o.assembled.systemRules}`,
    `- characterSettings chars: ${o.assembled.characterSettings}`,
    `- dynamic chars: ${o.assembled.dynamic}`,
    `- history chars: ${o.assembled.history}`,
    `- current user chars: ${o.assembled.currentUser}`,
    `- total chars: ${o.assembled.total}`,
    `- payload total chars / utf8: ${o.payload.totalChars} / ${o.payload.totalUtf8Bytes}`,
    `- estimateTokens(): ${o.payload.estimateTokens}`,
    `- cache_control blocks: ${o.payload.cacheControlBlocks}`,
    `- assistant prefill: ${o.payload.hasAssistantPrefill}`,
    `- thinking: ${JSON.stringify(o.thinking)}`,
    `- output_config: ${JSON.stringify(o.outputConfig)}`,
    `- reasoning_effort: ${JSON.stringify(o.reasoningEffort)}`,
    "",
    "DELTA (Opus - Gemini chars)",
    JSON.stringify(report.physicalDelta, null, 2),
    "",
    "B. ACTUAL PROVIDER USAGE",
    live ? JSON.stringify(live, null, 2) : "(no --live, or key missing)",
    "",
    "C. SYSTEM DIFF",
    `same: ${report.sectionDiff.same.join(", ") || "(none)"}`,
    `opus-only: ${JSON.stringify(report.sectionDiff.opusOnly)}`,
    `gemini-only: ${JSON.stringify(report.sectionDiff.geminiOnly)}`,
    `different-content: ${JSON.stringify(report.sectionDiff.differentContent)}`,
    "",
    "D. RECEIPT SIMULATION (estimated_section_allocation of fake 28k/53k draftInput)",
    JSON.stringify(report.receiptSimulation, null, 2),
  ];
  return lines.join("\n");
}

async function main() {
  process.env.NODE_TEST_CONTEXT = process.env.NODE_TEST_CONTEXT || "1";
  const snapshot = buildLikeScaleSnapshot();
  const report = diagnoseSameSnapshot(snapshot);
  let live: Record<string, unknown> | undefined;
  if (LIVE) {
    live = {
      gemini: await liveProbe("gemini-3.1-pro-preview", snapshot),
      opus: await liveProbe("claude-opus-5", snapshot),
    };
  }
  const text = formatReport(report, live);
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, text, "utf8");
  console.log(text);
  console.log(`\nWrote ${OUT}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
