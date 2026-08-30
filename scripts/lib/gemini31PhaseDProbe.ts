/**
 * Phase D — Gemini 3.1 Pro reasoning continuity / CI stream probe helpers.
 * Privacy: never persist raw reasoning prose; key inventory + hashes/lengths only.
 */
import crypto from "node:crypto";

import {
  CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL,
  adaptCheaperInferenceChatBody,
  buildCheaperInferenceHeaders,
  resolveCheaperInferenceApiKey,
} from "../../src/lib/cheaperInferenceConfig";
import { CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL } from "../../src/lib/chatModels";
import { DEFAULT_TARGET_RESPONSE_CHARS } from "../../src/lib/responseLengthConstants";
import { parseReasoningTokens } from "../../src/lib/openRouterUsage";
import {
  OPENROUTER_CHAT_COMPLETIONS_URL,
  buildOpenRouterHeaders,
  resolveOpenRouterApiKey,
} from "../../src/lib/openRouterConfig";
import { buildOpenRouterRequestBody } from "../../src/lib/openRouterClient";

export const PHASE_D_MODEL = CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL;
export const OPENROUTER_PHASE_D_MODEL = "google/gemini-3.1-pro-preview";

export type ReasoningDetailBlockSummary = {
  index: number;
  type: string | null;
  format: string | null;
  byteLength: number;
  sha256: string;
  hasEncrypted: boolean;
  hasSignature: boolean;
  extraKeys: string[];
};

export type SseChunkInventory = {
  chunkIndex: number;
  topLevelKeys: string[];
  deltaKeys: string[];
  choiceKeys: string[];
  reasoningPresent: boolean;
  reasoningByteLength: number;
  reasoningSha256: string | null;
  reasoningDetailsPresent: boolean;
  reasoningDetailsBlockCount: number;
  reasoningDetailsSummaries: ReasoningDetailBlockSummary[];
  emptyContentChunk: boolean;
  hasUsage: boolean;
  finishReason: string | null;
  signatureLikeKeys: string[];
};

export type StreamProbeResult = {
  provider: "cheaperinference" | "openrouter";
  requestBodyKeys: string[];
  reasoningEffort: unknown;
  thinking: unknown;
  reasoning: unknown;
  firstSseMs: number | null;
  firstVisibleMs: number | null;
  providerCompleteMs: number;
  preVisibleGapMs: number | null;
  finishReason: string | null;
  promptTokens: number;
  completionTokens: number;
  reasoningTokens: number;
  visibleChars: number;
  chunkInventories: SseChunkInventory[];
  finalAssistantKeys: string[];
  reasoningDetailsPresentAny: boolean;
  reasoningDetailsBlockCountMax: number;
  reasoningDetailsBytesTotal: number;
  emptyContentMetadataChunks: number;
  capturedReasoningDetails: unknown[] | null;
};

function sha256(data: string): string {
  return crypto.createHash("sha256").update(data, "utf8").digest("hex");
}

function collectKeys(obj: unknown): string[] {
  if (!obj || typeof obj !== "object") return [];
  return Object.keys(obj as Record<string, unknown>).sort();
}

function findSignatureLikeKeys(obj: unknown, prefix = ""): string[] {
  if (!obj || typeof obj !== "object") return [];
  const out: string[] = [];
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (/signature|encrypted|thought/i.test(k)) out.push(path);
    if (v && typeof v === "object") out.push(...findSignatureLikeKeys(v, path));
  }
  return out.sort();
}

/** Summarize reasoning_details blocks without storing prose. */
export function summarizeReasoningDetails(raw: unknown): {
  blockCount: number;
  summaries: ReasoningDetailBlockSummary[];
  totalBytes: number;
} {
  if (!Array.isArray(raw) || raw.length === 0) {
    return { blockCount: 0, summaries: [], totalBytes: 0 };
  }
  const summaries: ReasoningDetailBlockSummary[] = [];
  let totalBytes = 0;
  for (let i = 0; i < raw.length; i++) {
    const block = raw[i];
    if (!block || typeof block !== "object") continue;
    const b = block as Record<string, unknown>;
    const serialized = JSON.stringify(block);
    const byteLength = Buffer.byteLength(serialized, "utf8");
    totalBytes += byteLength;
    const extraKeys = collectKeys(block).filter(
      (k) => !["type", "format", "data", "text", "summary", "encrypted", "signature"].includes(k)
    );
    summaries.push({
      index: i,
      type: typeof b.type === "string" ? b.type : null,
      format: typeof b.format === "string" ? b.format : null,
      byteLength,
      sha256: sha256(serialized),
      hasEncrypted: "encrypted" in b,
      hasSignature: "signature" in b || "thought_signature" in b || "thoughtSignature" in b,
      extraKeys,
    });
  }
  return { blockCount: raw.length, summaries, totalBytes };
}

/** Inventory one parsed SSE JSON object — no reasoning plaintext in output. */
export function inventorySseChunk(json: unknown, chunkIndex: number): SseChunkInventory {
  const root = (json && typeof json === "object" ? json : {}) as Record<string, unknown>;
  const choice = (Array.isArray(root.choices) ? root.choices[0] : null) as
    | Record<string, unknown>
    | null
    | undefined;
  const delta = (choice?.delta && typeof choice.delta === "object"
    ? choice.delta
    : null) as Record<string, unknown> | null;
  const message = (choice?.message && typeof choice.message === "object"
    ? choice.message
    : null) as Record<string, unknown> | null;

  const reasoningSource =
    (delta?.reasoning != null ? String(delta.reasoning) : null) ??
    (message?.reasoning != null ? String(message.reasoning) : null);
  const reasoningPresent = reasoningSource != null && reasoningSource.length > 0;

  const detailsRaw =
    delta?.reasoning_details ??
    message?.reasoning_details ??
    (choice as Record<string, unknown> | null)?.reasoning_details;
  const { blockCount, summaries, totalBytes } = summarizeReasoningDetails(detailsRaw);

  const contentRaw = delta?.content ?? message?.content ?? null;
  const visibleFromChunk =
    typeof contentRaw === "string"
      ? contentRaw
      : Array.isArray(contentRaw)
        ? contentRaw.map((p) => (typeof p === "object" && p && "text" in p ? String((p as { text?: string }).text ?? "") : "")).join("")
        : "";

  const finishReason =
    (typeof choice?.finish_reason === "string" ? choice.finish_reason : null) ??
    (typeof root.stop_reason === "string" ? root.stop_reason : null);

  return {
    chunkIndex,
    topLevelKeys: collectKeys(root),
    deltaKeys: collectKeys(delta),
    choiceKeys: collectKeys(choice),
    reasoningPresent,
    reasoningByteLength: reasoningPresent ? Buffer.byteLength(reasoningSource!, "utf8") : 0,
    reasoningSha256: reasoningPresent ? sha256(reasoningSource!) : null,
    reasoningDetailsPresent: blockCount > 0,
    reasoningDetailsBlockCount: blockCount,
    reasoningDetailsSummaries: summaries,
    emptyContentChunk: !visibleFromChunk.trim(),
    hasUsage: root.usage != null,
    finishReason,
    signatureLikeKeys: findSignatureLikeKeys(root),
  };
}

/** Merge reasoning_details arrays from stream chunks (order preserved). */
export function mergeReasoningDetailsFromChunks(
  chunks: unknown[]
): unknown[] | null {
  const merged: unknown[] = [];
  for (const json of chunks) {
    if (!json || typeof json !== "object") continue;
    const root = json as Record<string, unknown>;
    const choice = Array.isArray(root.choices) ? root.choices[0] : null;
    if (!choice || typeof choice !== "object") continue;
    const c = choice as Record<string, unknown>;
    const delta = c.delta && typeof c.delta === "object" ? (c.delta as Record<string, unknown>) : null;
    const message =
      c.message && typeof c.message === "object" ? (c.message as Record<string, unknown>) : null;
    for (const src of [delta?.reasoning_details, message?.reasoning_details, c.reasoning_details]) {
      if (Array.isArray(src) && src.length > 0) {
        merged.push(...src);
      }
    }
  }
  return merged.length > 0 ? merged : null;
}

export type ProbeMessages = Array<{
  role: "system" | "user" | "assistant";
  content: string;
  reasoning_details?: unknown[];
}>;

export function buildCiWireBody(
  messages: ProbeMessages,
  stream = true
): Record<string, unknown> {
  const base = buildOpenRouterRequestBody(
    PHASE_D_MODEL,
    messages,
    stream,
    DEFAULT_TARGET_RESPONSE_CHARS,
    "gemini31-phase-d-probe"
  ) as Record<string, unknown>;
  return adaptCheaperInferenceChatBody(base);
}

export function buildOpenRouterLowBody(
  messages: ProbeMessages,
  stream = true
): Record<string, unknown> {
  const body = buildOpenRouterRequestBody(
    OPENROUTER_PHASE_D_MODEL,
    messages,
    stream,
    DEFAULT_TARGET_RESPONSE_CHARS,
    "gemini31-phase-d-probe"
  ) as Record<string, unknown>;
  body.reasoning = { effort: "low" };
  body.include_reasoning = false;
  delete body.reasoning_effort;
  delete body.thinking;
  return body;
}

export async function probeProviderStream(opts: {
  provider: "cheaperinference" | "openrouter";
  messages: ProbeMessages;
  systemPrompt?: string;
}): Promise<StreamProbeResult> {
  const messages: ProbeMessages = opts.systemPrompt
    ? [{ role: "system", content: opts.systemPrompt }, ...opts.messages]
    : opts.messages;

  const isCi = opts.provider === "cheaperinference";
  const requestBody = isCi ? buildCiWireBody(messages, true) : buildOpenRouterLowBody(messages, true);
  const endpoint = isCi ? CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL : OPENROUTER_CHAT_COMPLETIONS_URL;
  const headers = isCi
    ? buildCheaperInferenceHeaders(resolveCheaperInferenceApiKey())
    : buildOpenRouterHeaders(resolveOpenRouterApiKey());

  const t0 = performance.now();
  let firstSseMs: number | null = null;
  let firstVisibleMs: number | null = null;
  let visibleChars = 0;
  let finishReason: string | null = null;
  let promptTokens = 0;
  let completionTokens = 0;
  let reasoningTokens = 0;
  const chunkInventories: SseChunkInventory[] = [];
  const rawChunks: unknown[] = [];
  let chunkIndex = 0;

  const res = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(requestBody),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`${opts.provider} HTTP ${res.status}: ${errText.slice(0, 500)}`);
  }
  if (!res.body) throw new Error(`${opts.provider} empty body`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value?.byteLength && firstSseMs == null) {
      firstSseMs = performance.now() - t0;
    }
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const json = JSON.parse(payload) as unknown;
        rawChunks.push(json);
        const inv = inventorySseChunk(json, chunkIndex++);
        chunkInventories.push(inv);
        if (inv.finishReason) finishReason = inv.finishReason;

        const root = json as Record<string, unknown>;
        if (root.usage && typeof root.usage === "object") {
          const u = root.usage as Record<string, unknown>;
          promptTokens = Number(u.prompt_tokens) || promptTokens;
          completionTokens = Number(u.completion_tokens) || completionTokens;
          reasoningTokens = parseReasoningTokens(u) || reasoningTokens;
        }

        const choice = Array.isArray(root.choices) ? root.choices[0] : null;
        const delta =
          choice &&
          typeof choice === "object" &&
          (choice as Record<string, unknown>).delta &&
          typeof (choice as Record<string, unknown>).delta === "object"
            ? ((choice as Record<string, unknown>).delta as Record<string, unknown>)
            : null;
        const text =
          typeof delta?.content === "string"
            ? delta.content
            : typeof delta?.text === "string"
              ? delta.text
              : "";
        if (text) {
          if (firstVisibleMs == null) firstVisibleMs = performance.now() - t0;
          visibleChars += text.length;
        }
      } catch {
        /* incomplete JSON */
      }
    }
  }

  const providerCompleteMs = performance.now() - t0;
  const capturedReasoningDetails = mergeReasoningDetailsFromChunks(rawChunks);

  let finalAssistantKeys: string[] = [];
  for (let i = rawChunks.length - 1; i >= 0; i--) {
    const root = rawChunks[i] as Record<string, unknown>;
    const choice = Array.isArray(root.choices) ? root.choices[0] : null;
    if (!choice || typeof choice !== "object") continue;
    const msg = (choice as Record<string, unknown>).message;
    if (msg && typeof msg === "object") {
      finalAssistantKeys = collectKeys(msg);
      break;
    }
  }

  const detailsSummary = summarizeReasoningDetails(capturedReasoningDetails);
  const emptyContentMetadataChunks = chunkInventories.filter(
    (c) => c.emptyContentChunk && (c.reasoningDetailsPresent || c.reasoningPresent || c.hasUsage || c.finishReason)
  ).length;

  return {
    provider: opts.provider,
    requestBodyKeys: collectKeys(requestBody),
    reasoningEffort: requestBody.reasoning_effort ?? null,
    thinking: requestBody.thinking ?? null,
    reasoning: requestBody.reasoning ?? null,
    firstSseMs,
    firstVisibleMs,
    providerCompleteMs,
    preVisibleGapMs:
      firstSseMs != null && firstVisibleMs != null ? firstVisibleMs - firstSseMs : null,
    finishReason,
    promptTokens,
    completionTokens,
    reasoningTokens,
    visibleChars,
    chunkInventories,
    finalAssistantKeys,
    reasoningDetailsPresentAny: detailsSummary.blockCount > 0,
    reasoningDetailsBlockCountMax: Math.max(
      0,
      ...chunkInventories.map((c) => c.reasoningDetailsBlockCount)
    ),
    reasoningDetailsBytesTotal: detailsSummary.totalBytes,
    emptyContentMetadataChunks,
    capturedReasoningDetails,
  };
}

export type ContinuityTurnMetrics = {
  turnIndex: number;
  variant: "A" | "B";
  provider_prompt_tokens: number;
  provider_completion_tokens: number;
  reasoning_tokens: number;
  provider_wait_ms: number;
  visible_ttft_ms: number | null;
  pre_visible_gap_ms: number | null;
  reasoning_tokens_per_previsible_second: number | null;
  visible_chars: number;
  finish_reason: string | null;
  reasoning_details_present: boolean;
  reasoning_details_block_count: number;
  reasoning_details_bytes: number;
  input_token_delta_vs_a: number | null;
};

/** Build assistant message for continuity variant B — exact provider reasoning_details preserved. */
export function buildContinuityAssistantMessage(
  visibleContent: string,
  reasoningDetails: unknown[] | null,
  variant: "A" | "B"
): ProbeMessages[number] {
  const msg: ProbeMessages[number] = { role: "assistant", content: visibleContent };
  if (variant === "B" && reasoningDetails && reasoningDetails.length > 0) {
    msg.reasoning_details = structuredClone(reasoningDetails);
  }
  return msg;
}

export function median(nums: number[]): number | null {
  const sorted = nums.filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

export const PHASE_D_MINIMAL_SYSTEM =
  "You are a Korean fiction RP assistant. Reply in immersive prose. Do not break character.";

export const PHASE_D_USER_TURNS = [
  "나는 렌이라고… 본 기억이 안 나는데… 나 알아?",
  "같이 갈래? *두리번*",
  "어디로 가? 안내해줘.",
  "*따라가며* 여기 처음이야.",
  "그 초커... 왜 차고 있어?",
  "귀 괜찮아? 방금 또 찡그린 것 같은데.",
  "잠깐 여기 서서 숨 좀 고를까.",
  "너는 여기서 오래 일했어?",
] as const;
