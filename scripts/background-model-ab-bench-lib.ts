/**
 * Shared transport + scoring for background model A/B bench (read-only, no DB).
 */
import fs from "fs";
import path from "path";
import {
  CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL,
  adaptCheaperInferenceChatBody,
  buildCheaperInferenceHeaders,
  resolveCheaperInferenceApiKey,
} from "../src/lib/cheaperInferenceConfig";
import {
  CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_MODEL,
  CHEAPER_INFERENCE_GPT_56_LUNA_MODEL,
  isCheaperInferenceDeepSeekV4FlashModel,
  isGpt56LunaModel,
} from "../src/lib/chatModels";
import { resolveOpenRouterCompletionTimeoutMs } from "../src/lib/openRouterCompletion";
import { parseOpenRouterUsage } from "../src/lib/openRouterUsage";
import { resolveBackgroundMaxOutputTokens } from "../src/lib/ai";
import { extractFencedHtmlBlock } from "../src/lib/chatRichContent";
import {
  oocFlashHtmlMustBeRejected,
  visiblePlainFromHtmlInner,
} from "../src/lib/htmlVisualCardPolicy";
import {
  isRollingSummaryGroundedInDialogue,
  validateSummaryNarrative,
} from "../src/lib/memory/memory-summary-integrity";
import { clampMemoryRecordSummary } from "../src/lib/memory/memory-summary-clamp";
import {
  ROLLING_SUMMARY_MAX_CHARS,
  ROLLING_SUMMARY_MIN_CHARS,
} from "../src/lib/memory/memory-constants";

export const MODEL_A = CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_MODEL;
export const MODEL_B = CHEAPER_INFERENCE_GPT_56_LUNA_MODEL;
export const OUT_DIR = path.resolve("output/background-model-ab");

export type BenchModel = "deepseek" | "luna";

export function benchModelId(kind: BenchModel): string {
  return kind === "deepseek" ? MODEL_A : MODEL_B;
}

export type DirectCallResult = {
  ok: boolean;
  empty: boolean;
  timeout: boolean;
  httpStatus: number | null;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  finishReason: string | null;
  text: string;
  error: string | null;
  outboundThinkingOff: boolean;
  outboundReasoningNone: boolean;
};

export function verifyOutboundReasoningFlags(body: Record<string, unknown>, model: string): {
  deepseekThinkingOff: boolean;
  lunaReasoningNone: boolean;
} {
  const thinking = body.thinking as { type?: string } | undefined;
  const reasoning = body.reasoning as { effort?: string } | undefined;
  const deepseekThinkingOff =
    isCheaperInferenceDeepSeekV4FlashModel(model) &&
    thinking?.type === "disabled" &&
    body.reasoning_effort == null;
  const lunaReasoningNone =
    isGpt56LunaModel(model) &&
    reasoning?.effort === "none" &&
    body.reasoning_effort === "none";
  return { deepseekThinkingOff, lunaReasoningNone };
}

/** Single CheaperInference call — no OpenRouter fallback, no retry. */
export async function benchDirectCheaperInferenceCall(opts: {
  model: string;
  system: string;
  userContent: string;
  requestKind: string;
  temperature?: number;
  maxTokens?: number | null;
}): Promise<DirectCallResult> {
  const started = Date.now();
  const timeoutMs = resolveOpenRouterCompletionTimeoutMs(opts.requestKind);
  const maxTokens =
    opts.maxTokens === undefined
      ? resolveBackgroundMaxOutputTokens(opts.requestKind)
      : opts.maxTokens;
  const baseBody: Record<string, unknown> = {
    model: opts.model,
    messages: [
      { role: "system", content: opts.system.trim() },
      { role: "user", content: opts.userContent.trim() },
    ],
    stream: false,
    temperature: opts.temperature ?? 0.3,
    ...(maxTokens != null ? { max_tokens: maxTokens } : {}),
    reasoning: { effort: "none" as const },
    include_reasoning: false,
  };
  const outbound = adaptCheaperInferenceChatBody(baseBody);
  const flags = verifyOutboundReasoningFlags(outbound, opts.model);

  try {
    const res = await fetch(CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL, {
      method: "POST",
      headers: buildCheaperInferenceHeaders(resolveCheaperInferenceApiKey()),
      body: JSON.stringify(outbound),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const latencyMs = Date.now() - started;
    if (!res.ok) {
      const body = await res.text();
      return {
        ok: false,
        empty: false,
        timeout: false,
        httpStatus: res.status,
        latencyMs,
        inputTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
        finishReason: null,
        text: "",
        error: body.slice(0, 400),
        outboundThinkingOff: flags.deepseekThinkingOff,
        outboundReasoningNone: flags.lunaReasoningNone,
      };
    }
    const data = (await res.json()) as {
      choices?: { message?: { content?: string }; finish_reason?: string }[];
      usage?: unknown;
    };
    const text = data.choices?.[0]?.message?.content?.trim() ?? "";
    const parsed = parseOpenRouterUsage(data.usage, res.headers);
    const finishReason = data.choices?.[0]?.finish_reason ?? null;
    return {
      ok: text.length > 0,
      empty: text.length === 0,
      timeout: false,
      httpStatus: res.status,
      latencyMs,
      inputTokens: parsed.promptTokens,
      outputTokens: parsed.completionTokens,
      reasoningTokens: parsed.reasoningTokens,
      finishReason,
      text,
      error: text.length === 0 ? `empty completion (finish=${finishReason ?? "unknown"})` : null,
      outboundThinkingOff: flags.deepseekThinkingOff,
      outboundReasoningNone: flags.lunaReasoningNone,
    };
  } catch (e) {
    const latencyMs = Date.now() - started;
    const msg = (e as Error).message ?? String(e);
    const timeout = /timeout|aborted|AbortError/i.test(msg);
    return {
      ok: false,
      empty: false,
      timeout,
      httpStatus: null,
      latencyMs,
      inputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      finishReason: null,
      text: "",
      error: msg.slice(0, 400),
      outboundThinkingOff: flags.deepseekThinkingOff,
      outboundReasoningNone: flags.lunaReasoningNone,
    };
  }
}

export function scoreSummaryOutput(
  raw: string,
  dialogue: string
): {
  pass: boolean;
  outputChars: number;
  koreanProse: boolean;
  oocLeakage: boolean;
  instructionLeakage: boolean;
  narrativeOk: boolean;
  grounded: boolean;
} {
  const cleaned = clampMemoryRecordSummary(
    raw.replace(/\s+/g, " ").trim(),
    ROLLING_SUMMARY_MAX_CHARS,
    ROLLING_SUMMARY_MIN_CHARS
  );
  const narrative = validateSummaryNarrative(cleaned, "main_canon");
  const grounded =
    narrative.ok && isRollingSummaryGroundedInDialogue(narrative.text, dialogue);
  const text = narrative.ok ? narrative.text : cleaned;
  const hangulCount = (text.match(/[가-힣]/g) ?? []).length;
  const koreanProse = hangulCount >= 40;
  const oocLeakage = /\(OOC:|OOC:|SYSTEM:|HTML\s*카드|6턴\s*배치|요약한다\.|누락하지\s*않는다/i.test(
    text
  );
  const instructionLeakage =
    /CANONICAL GROUNDING|source 턴|점검표|히스토리 요약\]|\[\d+턴\s*배치/i.test(text);
  return {
    pass: narrative.ok && grounded && koreanProse && !oocLeakage && !instructionLeakage,
    outputChars: text.length,
    koreanProse,
    oocLeakage,
    instructionLeakage,
    narrativeOk: narrative.ok,
    grounded,
  };
}

export function scoreHtmlOutput(raw: string): {
  pass: boolean;
  nonempty: boolean;
  htmlParseable: boolean;
  hasRoot: boolean;
  closingTagsValid: boolean;
  noMarkdownFenceOutside: boolean;
  noProseOutside: boolean;
  koreanPreserved: boolean;
  instructionEcho: boolean;
  truncated: boolean;
  rejectedByPolicy: boolean;
} {
  const trimmed = raw.trim();
  const nonempty = trimmed.length > 0;
  const fence = extractFencedHtmlBlock(trimmed);
  const htmlParseable = fence != null && fence.length > 20;
  const inner = fence ?? "";
  const hasRoot = /<(div|section|article|main|table|ul|ol)\b/i.test(inner);
  const openTags = (inner.match(/<[a-z][a-z0-9]*\b[^>]*(?<!\/)>/gi) ?? []).length;
  const closeTags = (inner.match(/<\/[a-z][a-z0-9]*>/gi) ?? []).length;
  const closingTagsValid = openTags === 0 || closeTags >= Math.min(openTags, openTags);
  const strippedOutside = trimmed.replace(/```html[\s\S]*?```/i, "").trim();
  const noMarkdownFenceOutside = !/```/.test(strippedOutside);
  const noProseOutside = strippedOutside.length < 40;
  const plain = visiblePlainFromHtmlInner(inner);
  const koreanPreserved = /[가-힣]/.test(plain);
  const instructionEcho =
    /HTML GENERATION|Output exactly ONE|FORBIDDEN|REFERENCE skeleton|status window UI/i.test(
      plain
    );
  const truncated = /finish_reason=length|\.{3}\s*$/.test(trimmed) || inner.endsWith("…");
  const rejectedByPolicy = inner.length > 0 && oocFlashHtmlMustBeRejected(inner);
  const pass =
    nonempty &&
    htmlParseable &&
    hasRoot &&
    closingTagsValid &&
    noMarkdownFenceOutside &&
    noProseOutside &&
    koreanPreserved &&
    !instructionEcho &&
    !truncated &&
    !rejectedByPolicy;
  return {
    pass,
    nonempty,
    htmlParseable,
    hasRoot,
    closingTagsValid,
    noMarkdownFenceOutside,
    noProseOutside,
    koreanPreserved,
    instructionEcho,
    truncated,
    rejectedByPolicy,
  };
}

export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)]!;
}

export function writeArtifact(subdir: string, filename: string, text: string): void {
  const dir = path.join(OUT_DIR, subdir);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, filename), text, "utf8");
}

export function aggregateModelStats(
  rows: Array<{
    model: BenchModel;
    ok: boolean;
    empty: boolean;
    timeout: boolean;
    latencyMs: number;
    inputTokens: number;
    outputTokens: number;
    reasoningTokens: number;
    formatPass?: boolean;
    qualityPass?: boolean;
  }>,
  model: BenchModel
) {
  const xs = rows.filter((r) => r.model === model);
  const latencies = xs.map((r) => r.latencyMs);
  const success = xs.filter((r) => r.ok).length;
  const emptyOrTimeout = xs.filter((r) => r.empty || r.timeout).length;
  const formatPass = xs.filter((r) => r.formatPass === true).length;
  const qualityPass = xs.filter((r) => r.qualityPass === true).length;
  return {
    model,
    calls: xs.length,
    successRate: xs.length ? success / xs.length : 0,
    emptyRate: xs.length ? xs.filter((r) => r.empty).length / xs.length : 0,
    timeoutRate: xs.length ? xs.filter((r) => r.timeout).length / xs.length : 0,
    formatPassRate: xs.length ? formatPass / xs.length : 0,
    qualityPassRate: xs.length ? qualityPass / xs.length : 0,
    avgLatencyMs: latencies.length
      ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)
      : 0,
    p50LatencyMs: percentile(latencies, 50),
    p95LatencyMs: percentile(latencies, 95),
    avgInputTokens: xs.length
      ? Math.round(xs.reduce((s, r) => s + r.inputTokens, 0) / xs.length)
      : 0,
    avgOutputTokens: xs.length
      ? Math.round(xs.reduce((s, r) => s + r.outputTokens, 0) / xs.length)
      : 0,
    reasoningTokens: xs.reduce((s, r) => s + r.reasoningTokens, 0),
    emptyOrTimeout,
    formatPass,
    qualityPass,
  };
}
