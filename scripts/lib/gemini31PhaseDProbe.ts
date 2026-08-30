/**
 * Phase D / D.1 — Gemini 3.1 Pro reasoning probe helpers.
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

/** Canonical stream timing — never alias stream-complete as provider wait. */
export type CanonicalStreamTimings = {
  request_to_first_byte_ms: number | null;
  request_to_first_sse_ms: number | null;
  request_to_first_reasoning_ms: number | null;
  request_to_first_visible_ms: number | null;
  request_to_stream_complete_ms: number;
  reasoning_to_visible_gap_ms: number | null;
};

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
  includeReasoning: unknown;
  timings: CanonicalStreamTimings;
  /** @deprecated Use timings.request_to_first_sse_ms — kept for backward compat in old artifacts */
  firstSseMs: number | null;
  /** @deprecated Use timings.request_to_first_visible_ms */
  firstVisibleMs: number | null;
  /** @deprecated Use timings.request_to_stream_complete_ms — NOT provider wait */
  providerCompleteMs: number;
  /** @deprecated Use timings.reasoning_to_visible_gap_ms */
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
  providerRequestId: string | null;
  orRoutedProvider: string | null;
  responseModelId: string | null;
  ciRouteMetadata: unknown;
  reasoningChunksInStream: number;
  visibleChunksInStream: number;
};

export type CiReasoningVariant = "low" | "default" | "high";
export type OrReasoningVisibility = "hidden" | "visible";

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

/** Pure timing derivation for unit tests and live probes. */
export function computeStreamTimings(input: {
  firstByteMs: number | null;
  firstSseMs: number | null;
  firstReasoningMs: number | null;
  firstVisibleMs: number | null;
  streamCompleteMs: number;
}): CanonicalStreamTimings {
  const reasoning_to_visible_gap_ms =
    input.firstReasoningMs != null && input.firstVisibleMs != null
      ? input.firstVisibleMs - input.firstReasoningMs
      : input.firstSseMs != null && input.firstVisibleMs != null
        ? input.firstVisibleMs - input.firstSseMs
        : null;

  return {
    request_to_first_byte_ms: input.firstByteMs,
    request_to_first_sse_ms: input.firstSseMs,
    request_to_first_reasoning_ms: input.firstReasoningMs,
    request_to_first_visible_ms: input.firstVisibleMs,
    request_to_stream_complete_ms: input.streamCompleteMs,
    reasoning_to_visible_gap_ms,
  };
}

/** Deterministic provider order for paired runs: alternates CI/OR. */
export function pairedProviderOrder(pairIndex: number): ["cheaperinference", "openrouter"] | ["openrouter", "cheaperinference"] {
  return pairIndex % 2 === 0
    ? ["cheaperinference", "openrouter"]
    : ["openrouter", "cheaperinference"];
}

export function chunkHasReasoning(json: unknown): boolean {
  if (!json || typeof json !== "object") return false;
  const root = json as Record<string, unknown>;
  const choice = Array.isArray(root.choices) ? root.choices[0] : null;
  if (!choice || typeof choice !== "object") return false;
  const c = choice as Record<string, unknown>;
  const delta = c.delta && typeof c.delta === "object" ? (c.delta as Record<string, unknown>) : null;
  const message = c.message && typeof c.message === "object" ? (c.message as Record<string, unknown>) : null;
  if (delta?.reasoning && String(delta.reasoning).length > 0) return true;
  if (message?.reasoning && String(message.reasoning).length > 0) return true;
  for (const src of [delta?.reasoning_details, message?.reasoning_details, c.reasoning_details]) {
    if (Array.isArray(src) && src.length > 0) return true;
  }
  return false;
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
  const { blockCount, summaries } = summarizeReasoningDetails(detailsRaw);

  const contentRaw = delta?.content ?? message?.content ?? null;
  const visibleFromChunk =
    typeof contentRaw === "string"
      ? contentRaw
      : Array.isArray(contentRaw)
        ? contentRaw
            .map((p) =>
              typeof p === "object" && p && "text" in p
                ? String((p as { text?: string }).text ?? "")
                : ""
            )
            .join("")
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

export function mergeReasoningDetailsFromChunks(chunks: unknown[]): unknown[] | null {
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
      if (Array.isArray(src) && src.length > 0) merged.push(...src);
    }
  }
  return merged.length > 0 ? merged : null;
}

export type ProbeMessages = Array<{
  role: "system" | "user" | "assistant";
  content: string;
  reasoning_details?: unknown[];
}>;

function stripOpenRouterOnlyKeys(body: Record<string, unknown>): Record<string, unknown> {
  const next = { ...body };
  delete next.session_id;
  delete next.frequency_penalty;
  delete next.presence_penalty;
  delete next.repetition_penalty;
  delete next.reasoning;
  delete next.include_reasoning;
  return next;
}

/** Production-canonical CI LOW wire. */
export function buildCiWireBody(messages: ProbeMessages, stream = true): Record<string, unknown> {
  const base = buildOpenRouterRequestBody(
    PHASE_D_MODEL,
    messages,
    stream,
    DEFAULT_TARGET_RESPONSE_CHARS,
    "gemini31-phase-d-probe"
  ) as Record<string, unknown>;
  return adaptCheaperInferenceChatBody(base);
}

/** Diagnostic CI body — bypasses production policy for self-control (D.1 only). */
export function buildCiDiagnosticBody(
  messages: ProbeMessages,
  variant: CiReasoningVariant,
  stream = true
): Record<string, unknown> {
  const base = buildOpenRouterRequestBody(
    PHASE_D_MODEL,
    messages,
    stream,
    DEFAULT_TARGET_RESPONSE_CHARS,
    "gemini31-phase-d1-probe"
  ) as Record<string, unknown>;
  const adapted = stripOpenRouterOnlyKeys(base);
  delete adapted.thinking;
  if (variant === "low") {
    adapted.reasoning_effort = "low";
  } else if (variant === "high") {
    adapted.reasoning_effort = "high";
  } else {
    delete adapted.reasoning_effort;
  }
  return adapted;
}

/** OpenRouter LOW with visibility control per current repo owner (openRouterClient.ts). */
export function buildOpenRouterLowBody(
  messages: ProbeMessages,
  stream = true,
  visibility: OrReasoningVisibility = "hidden"
): Record<string, unknown> {
  const body = buildOpenRouterRequestBody(
    OPENROUTER_PHASE_D_MODEL,
    messages,
    stream,
    DEFAULT_TARGET_RESPONSE_CHARS,
    "gemini31-phase-d-probe"
  ) as Record<string, unknown>;
  body.reasoning = { effort: "low" };
  body.include_reasoning = visibility === "visible";
  delete body.reasoning_effort;
  delete body.thinking;
  return body;
}

export type RequestParityInventory = {
  MODEL: string;
  MESSAGES_HASH: string;
  SYSTEM_HASH: string;
  MAX_TOKENS: unknown;
  TEMPERATURE: unknown;
  TOP_P: unknown;
  STREAM: unknown;
  CI_REASONING_CONTROL: unknown;
  OR_REASONING_CONTROL: unknown;
  CI_REASONING_VISIBILITY_CONTROL: string;
  OR_REASONING_VISIBILITY_CONTROL: string;
  OTHER_NON_PROVIDER_FIELD_MISMATCHES: string[];
  SEMANTIC_DIFFERENCE: string[];
  TRANSPORT_DIFFERENCE: string[];
  PROVIDER_REQUIRED_DIFFERENCE: string[];
};

export function buildRequestParityInventory(
  messages: ProbeMessages,
  systemPrompt?: string
): RequestParityInventory {
  const fullMessages: ProbeMessages = systemPrompt
    ? [{ role: "system", content: systemPrompt }, ...messages]
    : messages;
  const ciBody = buildCiWireBody(fullMessages, true);
  const orBody = buildOpenRouterLowBody(fullMessages, true, "hidden");

  const semanticDiff: string[] = [];
  if (ciBody.model !== orBody.model) semanticDiff.push(`model: ${ciBody.model} vs ${orBody.model}`);
  if (JSON.stringify(ciBody.messages) !== JSON.stringify(orBody.messages)) {
    semanticDiff.push("messages shape differs (expected: provider model id only)");
  }

  const transportDiff: string[] = [];
  const ciKeys = new Set(Object.keys(ciBody));
  const orKeys = new Set(Object.keys(orBody));
  for (const k of ciKeys) if (!orKeys.has(k)) transportDiff.push(`ci-only:${k}`);
  for (const k of orKeys) if (!ciKeys.has(k)) transportDiff.push(`or-only:${k}`);

  const providerRequired: string[] = [];
  if (ciBody.reasoning_effort === "low" && (orBody.reasoning as { effort?: string })?.effort === "low") {
    providerRequired.push("reasoning LOW represented as reasoning_effort vs reasoning.effort");
  }
  if (ciBody.include_reasoning === undefined && orBody.include_reasoning === false) {
    providerRequired.push("OR include_reasoning=false; CI has no equivalent stream visibility knob");
  }

  const otherMismatches: string[] = [];
  for (const k of ["temperature", "max_tokens", "stream"]) {
    if (JSON.stringify(ciBody[k]) !== JSON.stringify(orBody[k])) {
      otherMismatches.push(`${k}: ${JSON.stringify(ciBody[k])} vs ${JSON.stringify(orBody[k])}`);
    }
  }

  const systemContent = systemPrompt ?? fullMessages.find((m) => m.role === "system")?.content ?? "";

  return {
    MODEL: `${ciBody.model} vs ${orBody.model}`,
    MESSAGES_HASH: sha256(JSON.stringify(fullMessages.map((m) => ({ role: m.role, content: m.content })))),
    SYSTEM_HASH: sha256(systemContent),
    MAX_TOKENS: ciBody.max_tokens ?? null,
    TEMPERATURE: ciBody.temperature ?? null,
    TOP_P: ciBody.top_p ?? null,
    STREAM: ciBody.stream ?? null,
    CI_REASONING_CONTROL: ciBody.reasoning_effort ?? "(omitted)",
    OR_REASONING_CONTROL: orBody.reasoning ?? null,
    CI_REASONING_VISIBILITY_CONTROL: "none — CI streams reasoning/reasoning_details in delta when upstream sends them",
    OR_REASONING_VISIBILITY_CONTROL: `include_reasoning=${String(orBody.include_reasoning)}`,
    OTHER_NON_PROVIDER_FIELD_MISMATCHES: otherMismatches,
    SEMANTIC_DIFFERENCE: semanticDiff,
    TRANSPORT_DIFFERENCE: transportDiff,
    PROVIDER_REQUIRED_DIFFERENCE: providerRequired,
  };
}

export async function probeStreamRequest(opts: {
  provider: "cheaperinference" | "openrouter";
  endpoint: string;
  headers: Record<string, string>;
  requestBody: Record<string, unknown>;
}): Promise<StreamProbeResult> {
  const t0 = performance.now();
  let firstByteMs: number | null = null;
  let firstSseMs: number | null = null;
  let firstReasoningMs: number | null = null;
  let firstVisibleMs: number | null = null;
  let visibleChars = 0;
  let finishReason: string | null = null;
  let promptTokens = 0;
  let completionTokens = 0;
  let reasoningTokens = 0;
  let reasoningChunksInStream = 0;
  let visibleChunksInStream = 0;
  const chunkInventories: SseChunkInventory[] = [];
  const rawChunks: unknown[] = [];
  let chunkIndex = 0;
  let providerRequestId: string | null = null;
  let orRoutedProvider: string | null = null;
  let responseModelId: string | null = null;
  let ciRouteMetadata: unknown = null;

  const res = await fetch(opts.endpoint, {
    method: "POST",
    headers: opts.headers,
    body: JSON.stringify(opts.requestBody),
  });
  firstByteMs = performance.now() - t0;

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
        if (firstSseMs == null) firstSseMs = performance.now() - t0;

        if (chunkHasReasoning(json)) {
          reasoningChunksInStream += 1;
          if (firstReasoningMs == null) firstReasoningMs = performance.now() - t0;
        }

        const inv = inventorySseChunk(json, chunkIndex++);
        chunkInventories.push(inv);
        if (inv.finishReason) finishReason = inv.finishReason;

        const root = json as Record<string, unknown>;
        if (typeof root.id === "string" && root.id.trim()) providerRequestId = root.id.trim();
        if (typeof root.model === "string" && root.model.trim()) responseModelId = root.model.trim();
        if (typeof root.provider === "string" && root.provider.trim()) orRoutedProvider = root.provider.trim();
        if (root.cheaper_inference != null) ciRouteMetadata = root.cheaper_inference;

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
          visibleChunksInStream += 1;
          if (firstVisibleMs == null) firstVisibleMs = performance.now() - t0;
          visibleChars += text.length;
        }
      } catch {
        /* incomplete JSON */
      }
    }
  }

  const streamCompleteMs = performance.now() - t0;
  const timings = computeStreamTimings({
    firstByteMs,
    firstSseMs,
    firstReasoningMs,
    firstVisibleMs,
    streamCompleteMs,
  });

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
    (c) =>
      c.emptyContentChunk &&
      (c.reasoningDetailsPresent || c.reasoningPresent || c.hasUsage || c.finishReason)
  ).length;

  return {
    provider: opts.provider,
    requestBodyKeys: collectKeys(opts.requestBody),
    reasoningEffort: opts.requestBody.reasoning_effort ?? null,
    thinking: opts.requestBody.thinking ?? null,
    reasoning: opts.requestBody.reasoning ?? null,
    includeReasoning: opts.requestBody.include_reasoning ?? null,
    timings,
    firstSseMs: timings.request_to_first_sse_ms,
    firstVisibleMs: timings.request_to_first_visible_ms,
    providerCompleteMs: timings.request_to_stream_complete_ms,
    preVisibleGapMs: timings.reasoning_to_visible_gap_ms,
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
    providerRequestId,
    orRoutedProvider,
    responseModelId,
    ciRouteMetadata,
    reasoningChunksInStream,
    visibleChunksInStream,
  };
}

export async function probeProviderStream(opts: {
  provider: "cheaperinference" | "openrouter";
  messages: ProbeMessages;
  systemPrompt?: string;
  ciVariant?: CiReasoningVariant;
  orVisibility?: OrReasoningVisibility;
}): Promise<StreamProbeResult> {
  const messages: ProbeMessages = opts.systemPrompt
    ? [{ role: "system", content: opts.systemPrompt }, ...opts.messages]
    : opts.messages;

  const isCi = opts.provider === "cheaperinference";
  const requestBody = isCi
    ? opts.ciVariant && opts.ciVariant !== "low"
      ? buildCiDiagnosticBody(messages, opts.ciVariant, true)
      : buildCiWireBody(messages, true)
    : buildOpenRouterLowBody(messages, true, opts.orVisibility ?? "hidden");

  return probeStreamRequest({
    provider: opts.provider,
    endpoint: isCi ? CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL : OPENROUTER_CHAT_COMPLETIONS_URL,
    headers: isCi
      ? buildCheaperInferenceHeaders(resolveCheaperInferenceApiKey())
      : buildOpenRouterHeaders(resolveOpenRouterApiKey()),
    requestBody,
  });
}

export type ContinuityTurnMetrics = {
  turnIndex: number;
  variant: "A" | "B";
  provider_prompt_tokens: number;
  provider_completion_tokens: number;
  reasoning_tokens: number;
  request_to_stream_complete_ms: number;
  request_to_first_visible_ms: number | null;
  reasoning_to_visible_gap_ms: number | null;
  visible_chars: number;
  finish_reason: string | null;
  reasoning_details_present: boolean;
  reasoning_details_block_count: number;
  reasoning_details_bytes: number;
  input_token_delta_vs_a: number | null;
};

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

export function summarizeProbeRun(result: StreamProbeResult) {
  return {
    reasoning_tokens: result.reasoningTokens,
    prompt_tokens: result.promptTokens,
    completion_tokens: result.completionTokens,
    request_to_first_byte_ms: result.timings.request_to_first_byte_ms,
    request_to_first_sse_ms: result.timings.request_to_first_sse_ms,
    request_to_first_reasoning_ms: result.timings.request_to_first_reasoning_ms,
    request_to_first_visible_ms: result.timings.request_to_first_visible_ms,
    request_to_stream_complete_ms: result.timings.request_to_stream_complete_ms,
    reasoning_to_visible_gap_ms: result.timings.reasoning_to_visible_gap_ms,
    visible_chars: result.visibleChars,
    finish_reason: result.finishReason,
    reasoning_chunks_in_stream: result.reasoningChunksInStream,
    visible_chunks_in_stream: result.visibleChunksInStream,
    or_routed_provider: result.orRoutedProvider,
    provider_request_id: result.providerRequestId,
  };
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
  "일단 네 옆에서 걸어갈게. 갑자기 멈추면 말해.",
  "저기 안내판 뭐라고 써 있어?",
] as const;

/** Production-like frozen system (representative RP workload — no edits). */
export const PHASE_D1_PRODUCTION_LIKE_SYSTEM = [
  PHASE_D_MINIMAL_SYSTEM,
  "Character: 조태형 — S급 음압 센티넬, 에이지스 본부.",
  "World: central lobby, support bureau, sync chamber, ventilation ducts.",
  "Rules: third-person limited, Korean prose, no meta commentary, no scene reset.",
  "Memory: user is 렌, amnesiac, wearing an electronic choker.",
  "Pacing: react to user agency; preserve continuity across turns.",
  "Quality: vivid sensory detail, character voice, no repetition loops.",
].join("\n");
