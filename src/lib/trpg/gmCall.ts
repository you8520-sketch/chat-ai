import {
  CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
  isCheaperInferenceModel,
  normalizeDeepSeekV4ProModelId,
} from "@/lib/chatModels";
import {
  buildCheaperInferenceHeaders,
  CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL,
  resolveCheaperInferenceApiKey,
} from "@/lib/cheaperInferenceConfig";
import { isMockApiMode } from "@/lib/mockApiMode";
import { adaptTrpgBotChatBody, adaptTrpgGmChatBody, trpgProviderRequestContract } from "./gmClient";
import type { TrpgModelUsage } from "./billing";
import { parseProviderUsageCostUsd } from "./roundEconomics";
import { attachTrpgCallFailureMeta } from "./startFailure";
import { TRPG_BOT_MAX_TOKENS, TRPG_BOT_MODEL, TRPG_GM_MAX_TOKENS, TRPG_GM_MODEL } from "./types";
import {
  createGmStreamParser,
  feedGmStreamParser,
  gmStreamParserComplete,
} from "./gmStreamParser";
import type { GmProviderTimings } from "./gmNarrationDraft";
import { feedGmProviderSseBytes } from "./gmProviderSse";

/** GM transport only: first attempt + one retry on known transient HTTP 5xx. */
export const GM_MAX_PROVIDER_ATTEMPTS = 2;
/** Bot-seat stays one provider attempt. Do not add a 5xx retry here. */
export const BOT_MAX_PROVIDER_ATTEMPTS = 1;
export const GM_PROVIDER_TIMEOUT_MS = 180_000;
export const GM_PROVIDER_5XX_RETRY_DELAY_MS = 1000;

/** Max wall-clock for a healthy GM provider attempt sequence (both tries + retry delay). */
export function healthyGmProviderWallMs(
  timeoutMs: number = GM_PROVIDER_TIMEOUT_MS,
  maxAttempts: number = GM_MAX_PROVIDER_ATTEMPTS,
  retryDelayMs: number = GM_PROVIDER_5XX_RETRY_DELAY_MS
): number {
  return timeoutMs * maxAttempts + retryDelayMs;
}
export const GM_RETRYABLE_HTTP_STATUSES = [500, 502, 503, 504] as const;

export type TrpgGmCallResult = {
  text: string;
  usage?: TrpgModelUsage;
  elapsedMs?: number;
  reasoningTokens?: number | "unavailable";
  providerTimings?: GmProviderTimings;
};

export type TrpgGmStreamCallbacks = {
  onProviderChunk?: (rawChunk: string) => void;
  onNarrationChunk?: (narrationText: string, delta: string) => void;
  onProviderTimings?: (timings: GmProviderTimings) => void;
};

export function isGmRetryableHttpStatus(status: number): boolean {
  return (GM_RETRYABLE_HTTP_STATUSES as readonly number[]).includes(status);
}

function maxProviderAttempts(role: "gm" | "bot"): number {
  switch (role) {
    case "gm":
      return GM_MAX_PROVIDER_ATTEMPTS;
    case "bot":
      return BOT_MAX_PROVIDER_ATTEMPTS;
    default: {
      const _exhaustive: never = role;
      return _exhaustive;
    }
  }
}

function waitGmProviderRetryDelay(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, GM_PROVIDER_5XX_RETRY_DELAY_MS);
  });
}

export function reasoningTokensFromProviderUsage(usage: {
  completion_tokens_details?: { reasoning_tokens?: unknown };
  reasoning_tokens?: unknown;
} | undefined): number | "unavailable" {
  const fromDetails = usage?.completion_tokens_details?.reasoning_tokens;
  if (typeof fromDetails === "number" && Number.isFinite(fromDetails)) return fromDetails;
  const fromUsage = usage?.reasoning_tokens;
  if (typeof fromUsage === "number" && Number.isFinite(fromUsage)) return fromUsage;
  return "unavailable";
}

const MOCK_GM = `<<<NARRATION>>>
낡은 등불이 흔들린다. 당신은 문턱에 서서 다음 한 수를 고른다. 안에서 숨소리가 들린다.
<<<DELTA>>>
{"players":[],"location":"문턱","next_round_context":"문 너머를 조사하거나 말을 건넨다.","campaign_finished":false}`;

const MOCK_BOT = `*창가에 붙어 낮게* "…먼저 나가지 마. 내가 볼게."`;

function resolveTrpgProModel(modelId: string): string {
  const normalized = normalizeDeepSeekV4ProModelId(modelId);
  return isCheaperInferenceModel(normalized)
    ? normalized
    : CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL;
}

function usageFromResponse(
  modelId: string,
  data: {
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      prompt_tokens_details?: { cached_tokens?: number };
      cost?: unknown;
      total_cost?: unknown;
      cost_usd?: unknown;
      total_cost_usd?: unknown;
      cost_details?: unknown;
      completion_tokens_details?: { reasoning_tokens?: unknown };
      reasoning_tokens?: unknown;
    };
  }
): TrpgModelUsage | undefined {
  const prompt = Number(data.usage?.prompt_tokens ?? 0);
  const completion = Number(data.usage?.completion_tokens ?? 0);
  const cached = Number(data.usage?.prompt_tokens_details?.cached_tokens ?? 0);
  const upstreamCostUsd = parseProviderUsageCostUsd(data.usage);
  if (prompt <= 0 && completion <= 0) return undefined;
  return {
    modelId,
    inputTokens: prompt,
    outputTokens: completion,
    cacheReadTokens: cached > 0 ? cached : undefined,
    upstreamCostUsd,
  };
}

async function postTrpgChat(opts: {
  model: string;
  body: Record<string, unknown>;
  timeoutMs: number;
  role: "gm" | "bot";
}): Promise<{ text: string; usage?: TrpgModelUsage; elapsedMs: number; reasoningTokens: number | "unavailable" }> {
  const contract = trpgProviderRequestContract(opts.body);
  console.info(`[TRPG][${opts.role}] request_contract`, contract);
  const started = Date.now();
  const serializedBody = JSON.stringify(opts.body);
  const headers = buildCheaperInferenceHeaders(resolveCheaperInferenceApiKey());
  const maxAttempts = maxProviderAttempts(opts.role);
  try {
    let previousHttpStatus: number | undefined;
    let lastHttpError: Error | undefined;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      if (attempt > 1) {
        console.info("[TRPG][gm] provider_retry", {
          attempt,
          previousHttpStatus,
          delayMs: GM_PROVIDER_5XX_RETRY_DELAY_MS,
        });
        await waitGmProviderRetryDelay();
      }
      const res = await fetch(CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL, {
        method: "POST",
        headers,
        body: serializedBody,
        signal: AbortSignal.timeout(opts.timeoutMs),
      });
      if (!res.ok) {
        const errText = await res.text();
        lastHttpError = attachTrpgCallFailureMeta(new Error(`[TRPG] ${res.status}: ${errText.slice(0, 240)}`), {
          httpStatus: res.status,
          reasoningTokens: "unavailable",
        });
        if (opts.role === "gm" && attempt < maxAttempts && isGmRetryableHttpStatus(res.status)) {
          previousHttpStatus = res.status;
          continue;
        }
        throw lastHttpError;
      }
      const data = (await res.json()) as {
        choices?: { message?: { content?: string } }[];
        usage?: {
          prompt_tokens?: number;
          completion_tokens?: number;
          prompt_tokens_details?: { cached_tokens?: number };
          completion_tokens_details?: { reasoning_tokens?: unknown };
          reasoning_tokens?: unknown;
          cost?: unknown;
          total_cost?: unknown;
          cost_usd?: unknown;
          total_cost_usd?: unknown;
          cost_details?: unknown;
        };
      };
      const reasoningTokens = reasoningTokensFromProviderUsage(data.usage);
      const elapsedMs = Date.now() - started;
      console.info(`[TRPG][${opts.role}] response_meta`, {
        model: opts.model,
        elapsedMs,
        reasoningTokens,
      });
      const text = data.choices?.[0]?.message?.content?.trim() ?? "";
      if (!text) {
        throw attachTrpgCallFailureMeta(new Error("[TRPG] empty completion"), {
          elapsedMs,
          reasoningTokens,
        });
      }
      return { text, usage: usageFromResponse(opts.model, data), elapsedMs, reasoningTokens };
    }
    throw lastHttpError ?? new Error("[TRPG] provider retry exhausted");
  } catch (error) {
    const elapsedMs = Date.now() - started;
    throw attachTrpgCallFailureMeta(error, { elapsedMs });
  }
}

type StreamUsagePayload = Parameters<typeof usageFromResponse>[1];

function deltaContentFromSsePayload(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const obj = payload as {
    choices?: Array<{ delta?: { content?: unknown; reasoning?: unknown; reasoning_content?: unknown } }>;
  };
  const delta = obj.choices?.[0]?.delta;
  if (!delta || typeof delta.content !== "string") return "";
  return delta.content;
}

function usageFromSsePayload(payload: unknown): StreamUsagePayload | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const usage = (payload as { usage?: StreamUsagePayload["usage"] }).usage;
  return usage ? { usage } : undefined;
}

async function readGmProviderSseStream(opts: {
  response: Response;
  callbacks?: TrpgGmStreamCallbacks;
  timings: GmProviderTimings;
}): Promise<{ text: string; usage?: TrpgModelUsage; reasoningTokens: number | "unavailable" }> {
  const reader = opts.response.body?.getReader();
  if (!reader) throw new Error("[TRPG] empty stream body");
  const decoder = new TextDecoder();
  const sseState = { buffer: "" };
  let rawText = "";
  let usagePayload: StreamUsagePayload | undefined;
  const parser = createGmStreamParser();
  let sawFirstChunk = false;

  const emitRaw = (piece: string) => {
    if (!piece) return;
    rawText += piece;
    opts.callbacks?.onProviderChunk?.(piece);
    if (!sawFirstChunk) {
      sawFirstChunk = true;
      opts.timings.firstChunkAtMs = Date.now();
      opts.callbacks?.onProviderTimings?.({ ...opts.timings });
    }
    const delta = feedGmStreamParser(parser, piece);
    if (delta) opts.callbacks?.onNarrationChunk?.(parser.narration, delta);
  };

  const onSsePayload = (payload: unknown) => {
    const content = deltaContentFromSsePayload(payload);
    if (content) emitRaw(content);
    const usage = usageFromSsePayload(payload);
    if (usage) usagePayload = usage;
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      const tail = decoder.decode();
      if (tail) feedGmProviderSseBytes(sseState, tail, onSsePayload, true);
      else feedGmProviderSseBytes(sseState, "", onSsePayload, true);
      break;
    }
    feedGmProviderSseBytes(sseState, decoder.decode(value, { stream: true }), onSsePayload, false);
  }

  gmStreamParserComplete(parser);
  opts.timings.completeAtMs = Date.now();
  opts.callbacks?.onProviderTimings?.({ ...opts.timings });

  const reasoningTokens = reasoningTokensFromProviderUsage(usagePayload?.usage);
  const text = rawText.trim();
  if (!text) {
    throw attachTrpgCallFailureMeta(new Error("[TRPG] empty completion"), {
      reasoningTokens,
    });
  }
  return {
    text,
    usage: usagePayload ? usageFromResponse(CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL, usagePayload) : undefined,
    reasoningTokens,
  };
}

async function postTrpgGmStream(opts: {
  model: string;
  body: Record<string, unknown>;
  timeoutMs: number;
  callbacks?: TrpgGmStreamCallbacks;
}): Promise<{ text: string; usage?: TrpgModelUsage; elapsedMs: number; reasoningTokens: number | "unavailable"; providerTimings: GmProviderTimings }> {
  const contract = trpgProviderRequestContract(opts.body);
  console.info("[TRPG][gm] request_contract", contract);
  const started = Date.now();
  const timings: GmProviderTimings = {
    startAtMs: started,
    firstChunkAtMs: null,
    completeAtMs: null,
  };
  opts.callbacks?.onProviderTimings?.({ ...timings });
  const serializedBody = JSON.stringify(opts.body);
  const headers = buildCheaperInferenceHeaders(resolveCheaperInferenceApiKey());
  const maxAttempts = GM_MAX_PROVIDER_ATTEMPTS;
  try {
    let previousHttpStatus: number | undefined;
    let lastHttpError: Error | undefined;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      if (attempt > 1) {
        console.info("[TRPG][gm] provider_retry", {
          attempt,
          previousHttpStatus,
          delayMs: GM_PROVIDER_5XX_RETRY_DELAY_MS,
        });
        await waitGmProviderRetryDelay();
        timings.startAtMs = Date.now();
        timings.firstChunkAtMs = null;
        timings.completeAtMs = null;
        opts.callbacks?.onProviderTimings?.({ ...timings });
      }
      const res = await fetch(CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL, {
        method: "POST",
        headers,
        body: serializedBody,
        signal: AbortSignal.timeout(opts.timeoutMs),
      });
      if (!res.ok) {
        const errText = await res.text();
        lastHttpError = attachTrpgCallFailureMeta(new Error(`[TRPG] ${res.status}: ${errText.slice(0, 240)}`), {
          httpStatus: res.status,
          reasoningTokens: "unavailable",
        });
        if (attempt < maxAttempts && isGmRetryableHttpStatus(res.status)) {
          previousHttpStatus = res.status;
          continue;
        }
        throw lastHttpError;
      }
      const streamResult = await readGmProviderSseStream({
        response: res,
        callbacks: opts.callbacks,
        timings,
      });
      const elapsedMs = Date.now() - started;
      console.info("[TRPG][gm] response_meta", {
        model: opts.model,
        elapsedMs,
        reasoningTokens: streamResult.reasoningTokens,
        firstChunkMs:
          timings.firstChunkAtMs != null ? timings.firstChunkAtMs - timings.startAtMs : null,
        totalProviderMs:
          timings.completeAtMs != null ? timings.completeAtMs - timings.startAtMs : null,
      });
      return {
        text: streamResult.text,
        usage: streamResult.usage,
        elapsedMs,
        reasoningTokens: streamResult.reasoningTokens,
        providerTimings: timings,
      };
    }
    throw lastHttpError ?? new Error("[TRPG] provider retry exhausted");
  } catch (error) {
    const elapsedMs = Date.now() - started;
    throw attachTrpgCallFailureMeta(error, { elapsedMs });
  }
}

function simulateMockGmStream(
  text: string,
  callbacks?: TrpgGmStreamCallbacks
): GmProviderTimings {
  const timings: GmProviderTimings = {
    startAtMs: Date.now(),
    firstChunkAtMs: null,
    completeAtMs: null,
  };
  callbacks?.onProviderTimings?.({ ...timings });
  const parser = createGmStreamParser();
  const chunkSize = Math.max(8, Math.ceil(text.length / 4));
  for (let i = 0; i < text.length; i += chunkSize) {
    const piece = text.slice(i, i + chunkSize);
    callbacks?.onProviderChunk?.(piece);
    if (timings.firstChunkAtMs == null) timings.firstChunkAtMs = Date.now();
    const delta = feedGmStreamParser(parser, piece);
    if (delta) callbacks?.onNarrationChunk?.(parser.narration, delta);
  }
  gmStreamParserComplete(parser);
  timings.completeAtMs = Date.now();
  callbacks?.onProviderTimings?.({ ...timings });
  return timings;
}

/** Isolated GM Pro call. Must not go through RP adaptCheaperInferenceChatBody. */
export async function callTrpgGm(opts: {
  system: string;
  user: string;
  timeoutMs?: number;
  stream?: TrpgGmStreamCallbacks;
}): Promise<TrpgGmCallResult> {
  if (isMockApiMode()) {
    const timings = simulateMockGmStream(MOCK_GM, opts.stream);
    return { text: MOCK_GM, providerTimings: timings };
  }
  const model = resolveTrpgProModel(TRPG_GM_MODEL);
  const body = adaptTrpgGmChatBody({
    model,
    messages: [
      { role: "system", content: opts.system },
      { role: "user", content: opts.user },
    ],
    stream: true,
    temperature: 0.7,
    max_tokens: TRPG_GM_MAX_TOKENS,
  });
  const result = await postTrpgGmStream({
    model,
    body,
    timeoutMs: opts.timeoutMs ?? GM_PROVIDER_TIMEOUT_MS,
    callbacks: opts.stream,
  });
  return {
    text: result.text,
    usage: result.usage,
    elapsedMs: result.elapsedMs,
    reasoningTokens: result.reasoningTokens,
    providerTimings: result.providerTimings,
  };
}

/** Bot-seat Pro call (thinking off). Separate from GM narration. */
export async function callTrpgBot(opts: {
  system: string;
  user: string;
  timeoutMs?: number;
}): Promise<TrpgGmCallResult> {
  if (isMockApiMode()) {
    return { text: MOCK_BOT };
  }
  const model = resolveTrpgProModel(TRPG_BOT_MODEL);
  const body = adaptTrpgBotChatBody({
    model,
    messages: [
      { role: "system", content: opts.system },
      { role: "user", content: opts.user },
    ],
    stream: false,
    temperature: 0.85,
    max_tokens: TRPG_BOT_MAX_TOKENS,
  });
  return postTrpgChat({ model, body, timeoutMs: opts.timeoutMs ?? 90_000, role: "bot" });
}
