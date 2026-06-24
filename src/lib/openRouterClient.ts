import { resolveMaxOutputTokensForTarget } from "@/lib/responseLength";
import { normalizeOpenRouterModelId } from "@/lib/openRouterConfig";
import {
  isAnthropicModel,
  isGemini31ProModel,
  isGeminiFlashOpenRouterModel,
  isGeminiProOpenRouterModel,
} from "@/lib/chatModels";

/** OpenRouter — temperature + max_tokens + Claude 반복 억제 */
export const EURYALE_GENERATION_PARAMS = {
  temperature: 0.7,
} as const;

export type OpenRouterGenerationOverrides = {
  temperature?: number;
  top_p?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  repetition_penalty?: number;
};

/** Claude Opus — 문학·퇴폐 문체 보존 (penalty 비활성) */
export const CLAUDE_OPUS_GENERATION_PARAMS = {
  frequency_penalty: 0,
  presence_penalty: 0,
  repetition_penalty: 0,
} as const;

/** @deprecated CLAUDE_OPUS_GENERATION_PARAMS — Copy&Paste 루프 억제용 (문체 훼손으로 미사용) */
export const CLAUDE_OPUS_ANTI_LOOP_PARAMS = {
  frequency_penalty: 0.7,
  presence_penalty: 0.5,
  repetition_penalty: 1.1,
} as const;

/** DeepSeek V4 Pro — Gemini 2.5 tone migration (OpenRouter only) */
export const DEEPSEEK_V4_PRO_GENERATION_PARAMS = {
  temperature: 0.85,
  top_p: 0.92,
  frequency_penalty: 0.1,
  presence_penalty: 0.05,
} as const;

/** Anthropic prompt caching — OpenRouter는 content 블록 내부에 cache_control 필수 */
export type OpenRouterCacheControl = { type: "ephemeral"; ttl?: "1h" };

export type OpenRouterContentBlock = {
  type: "text";
  text: string;
  cache_control?: OpenRouterCacheControl;
};

export type OpenRouterChatMessage = {
  role: "system" | "user" | "assistant";
  content: string | OpenRouterContentBlock[];
};

const OPENROUTER_FORBIDDEN_KEYS = new Set([
  "stop",
  "stop_sequences",
  "stop_token_ids",
  "top_p",
]);

const GEMINI_FORBIDDEN_KEYS = new Set([
  "system_instruction",
  "contents",
  "generationConfig",
  "safetySettings",
  "topK",
  "topP",
  "maxOutputTokens",
  "thinkingConfig",
  ...OPENROUTER_FORBIDDEN_KEYS,
]);

function coerceFloat(value: unknown, fallback: number): number {
  const n = typeof value === "string" ? parseFloat(value) : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function coerceInt(value: unknown, fallback: number): number {
  const n = typeof value === "string" ? parseInt(value, 10) : Math.floor(Number(value));
  return Number.isFinite(n) ? n : fallback;
}

/** OpenRouter DeepSeek 계열 — RP generation tuning */
export function isDeepSeekOpenRouterModel(modelId: string): boolean {
  return modelId.trim().toLowerCase().includes("deepseek");
}

/** OpenRouter Qwen 계열 — qwen/qwen3.7-max 등 */
export function isQwenOpenRouterModel(modelId: string): boolean {
  return modelId.trim().toLowerCase().includes("qwen");
}

/**
 * RP primary·continuation — DeepSeek/Qwen: reasoning OFF (effort none).
 * Gemini 2.5 Pro: mandatory reasoning — thinkingBudget cap (max_tokens) + exclude.
 * Gemini 3.1 Pro: mandatory thinkingLevel — effort low (3.1 Pro는 minimal 미지원, 무시 시 high 기본).
 */
export function isOpenRouterRpReasoningDisabledModel(modelId: string): boolean {
  return isDeepSeekOpenRouterModel(modelId) || isQwenOpenRouterModel(modelId);
}

/** OpenRouter mandatory-reasoning endpoints (cannot send effort: "none"). */
export function isOpenRouterRpReasoningMandatoryModel(modelId: string): boolean {
  return isGeminiProOpenRouterModel(modelId);
}

export const OPENROUTER_RP_REASONING_OFF = {
  effort: "none",
  exclude: true,
} as const;

/** Gemini 2.5 Pro RP — thinkingBudget cap (effort none → 400). */
export const OPENROUTER_RP_REASONING_GEMINI_CAP = {
  max_tokens: 64,
  exclude: true,
} as const;

/** Gemini 3.1 Pro RP — thinkingLevel API. Pro는 minimal 미지원 → low가 최저. */
export const OPENROUTER_RP_REASONING_GEMINI_31 = {
  effort: "low",
  exclude: true,
} as const;

type Gemini31ReasoningEffort = "low" | "medium" | "high";

function resolveGemini31ReasoningEffort(): Gemini31ReasoningEffort {
  const raw = process.env.OPENROUTER_GEMINI_31_REASONING_EFFORT?.trim().toLowerCase();
  if (raw === "minimal") {
    console.warn(
      "[openrouter-reasoning] gemini-3.1-pro does not support minimal — using low instead"
    );
    return "low";
  }
  if (raw === "low" || raw === "medium" || raw === "high") return raw;
  return OPENROUTER_RP_REASONING_GEMINI_31.effort;
}

function resolveGeminiOpenRouterReasoningMaxTokens(): number {
  const raw = process.env.OPENROUTER_GEMINI_REASONING_MAX_TOKENS?.trim();
  if (raw) {
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 64) {
      return Math.min(4096, Math.floor(n));
    }
  }
  return OPENROUTER_RP_REASONING_GEMINI_CAP.max_tokens;
}

/** Gemini Flash RP — thinking minimal + exclude (Pro mandatory thinking 회피용 라우팅) */
export const OPENROUTER_RP_REASONING_GEMINI_FLASH = {
  effort: "minimal",
  exclude: true,
} as const;

function applyOpenRouterRpReasoningPolicy(body: Record<string, unknown>, modelId: string): void {
  delete body.reasoning_effort;
  body.include_reasoning = false;
  const normalized = normalizeOpenRouterModelId(modelId);

  if (isGeminiFlashOpenRouterModel(modelId)) {
    body.reasoning = { ...OPENROUTER_RP_REASONING_GEMINI_FLASH };
    console.log("[openrouter-reasoning] gemini-flash-minimal", {
      model: normalized,
      effort: OPENROUTER_RP_REASONING_GEMINI_FLASH.effort,
      exclude: true,
      include_reasoning: false,
    });
    return;
  }

  if (isOpenRouterRpReasoningMandatoryModel(modelId)) {
    if (isGemini31ProModel(modelId)) {
      const effort = resolveGemini31ReasoningEffort();
      body.reasoning = { effort, exclude: true };
      console.log("[openrouter-reasoning] gemini-3.1-thinkingLevel", {
        model: normalized,
        effort,
        exclude: true,
      });
    } else {
      const max_tokens = resolveGeminiOpenRouterReasoningMaxTokens();
      body.reasoning = { max_tokens, exclude: true };
      console.log("[openrouter-reasoning] gemini-2.5-budget-cap", {
        model: normalized,
        max_tokens,
        exclude: true,
      });
    }
    return;
  }

  if (!isOpenRouterRpReasoningDisabledModel(modelId)) return;

  body.reasoning = { ...OPENROUTER_RP_REASONING_OFF };
  const family = isQwenOpenRouterModel(modelId) ? "qwen" : "deepseek";
  console.log("[openrouter-reasoning] disabled: true", { model: normalized, family });
  if (family === "deepseek") {
    console.log("[deepseek-thinking] disabled: true", { model: normalized });
  }
}

/** OpenRouter Claude 등 — API max_tokens 상한 (3500+immersive ≈ 7680) */
export const OPENROUTER_MAX_OUTPUT_TOKENS = 8192;

/** OpenRouter — tier별 max_tokens (5,000자 상한에서 역산) */
export function resolveOpenRouterMaxTokens(
  targetResponseChars?: number | null,
  maxTokensOverride?: number,
  modelId?: string | null
): number {
  return (
    maxTokensOverride ??
    resolveMaxOutputTokensForTarget(targetResponseChars, modelId)
  );
}

/** DeepSeek V4 Pro — 통합 tier temperature */
export function resolveDeepSeekTemperatureForTarget(_targetResponseChars?: number | null): number {
  return 0.92;
}

/** Claude Opus — 통합 tier temperature */
export function resolveClaudeTemperatureForTarget(_targetResponseChars?: number | null): number {
  return 0.82;
}

/** OpenRouter generation 파라미터 — temperature + max_tokens (+ Claude 반복 억제) */
export function normalizeOpenRouterGenerationParams(
  maxTokens: number,
  modelId?: string,
  overrides?: OpenRouterGenerationOverrides,
  targetResponseChars?: number | null
) {
  const src = { ...EURYALE_GENERATION_PARAMS, ...overrides };
  const resolvedMax = coerceInt(maxTokens, OPENROUTER_MAX_OUTPUT_TOKENS);
  const base: Record<string, unknown> = {
    temperature: coerceFloat(src.temperature, 0.7),
    max_tokens: resolvedMax,
    stream_options: { include_usage: true as const },
  };

  if (modelId && isDeepSeekOpenRouterModel(modelId)) {
    base.temperature = resolveDeepSeekTemperatureForTarget(targetResponseChars);
    base.top_p = DEEPSEEK_V4_PRO_GENERATION_PARAMS.top_p;
    base.frequency_penalty = DEEPSEEK_V4_PRO_GENERATION_PARAMS.frequency_penalty;
    base.presence_penalty = DEEPSEEK_V4_PRO_GENERATION_PARAMS.presence_penalty;
  } else if (isAnthropicModel(modelId ?? "") || (modelId ?? "").toLowerCase().includes("claude")) {
    base.temperature = resolveClaudeTemperatureForTarget(targetResponseChars);
    base.frequency_penalty = CLAUDE_OPUS_GENERATION_PARAMS.frequency_penalty;
    base.presence_penalty = CLAUDE_OPUS_GENERATION_PARAMS.presence_penalty;
    base.repetition_penalty = CLAUDE_OPUS_GENERATION_PARAMS.repetition_penalty;
  }

  if (overrides?.temperature != null) {
    base.temperature = coerceFloat(overrides.temperature, base.temperature as number);
  }
  if (overrides?.top_p != null) base.top_p = overrides.top_p;
  if (overrides?.frequency_penalty != null) base.frequency_penalty = overrides.frequency_penalty;
  if (overrides?.presence_penalty != null) base.presence_penalty = overrides.presence_penalty;
  if (overrides?.repetition_penalty != null) base.repetition_penalty = overrides.repetition_penalty;

  return base as {
    temperature: number;
    max_tokens: number;
    stream_options: { include_usage: true };
    top_p?: number;
    frequency_penalty?: number;
    presence_penalty?: number;
    repetition_penalty?: number;
  };
}

/** 재생성 — 동일 프롬프트에서 다른 전개를 유도 */
export function resolveRegenerateGenerationOverrides(
  modelId: string,
  targetResponseChars?: number | null
): OpenRouterGenerationOverrides {
  const base = normalizeOpenRouterGenerationParams(
    resolveOpenRouterMaxTokens(targetResponseChars, undefined, modelId),
    modelId,
    undefined,
    targetResponseChars
  );
  const overrides: OpenRouterGenerationOverrides = {
    temperature: Math.min(1.2, base.temperature + 0.15),
  };
  if (base.top_p != null) overrides.top_p = Math.min(0.98, base.top_p + 0.05);
  if (base.frequency_penalty != null) {
    overrides.frequency_penalty = Math.min(0.45, base.frequency_penalty + 0.12);
  }
  if (base.presence_penalty != null) {
    overrides.presence_penalty = Math.min(0.35, base.presence_penalty + 0.1);
  }
  if (base.repetition_penalty != null) {
    overrides.repetition_penalty = Math.min(1.15, base.repetition_penalty + 0.08);
  }
  return overrides;
}

export function buildOpenRouterRequestBody(
  modelId: string,
  messages: OpenRouterChatMessage[],
  stream: boolean,
  targetResponseChars?: number | null,
  sessionId?: string | null,
  maxTokensOverride?: number,
  generationOverrides?: OpenRouterGenerationOverrides
) {
  const maxTokens = resolveOpenRouterMaxTokens(
    targetResponseChars,
    maxTokensOverride,
    modelId
  );

  const gen = normalizeOpenRouterGenerationParams(
    maxTokens,
    modelId,
    generationOverrides,
    targetResponseChars
  );

  const body: Record<string, unknown> = {
    model: normalizeOpenRouterModelId(modelId),
    messages,
    stream: Boolean(stream),
    ...gen,
  };

  const sid = sessionId?.trim();
  if (sid) {
    body.session_id = sid.slice(0, 256);
  }

  for (const key of OPENROUTER_FORBIDDEN_KEYS) {
    if (key === "top_p" && isDeepSeekOpenRouterModel(modelId)) continue;
    delete body[key];
  }

  if (
    isOpenRouterRpReasoningMandatoryModel(modelId) ||
    isOpenRouterRpReasoningDisabledModel(modelId) ||
    isGeminiFlashOpenRouterModel(modelId)
  ) {
    applyOpenRouterRpReasoningPolicy(body, modelId);
  }

  assertPureOpenRouterPayload(body, modelId);
  assertNumericGenerationParams(body);
  return body;
}

function assertNumericGenerationParams(body: Record<string, unknown>): void {
  for (const key of [
    "temperature",
    "max_tokens",
    "top_p",
    "frequency_penalty",
    "presence_penalty",
    "repetition_penalty",
  ] as const) {
    const v = body[key];
    if (v === undefined) continue;
    if (typeof v !== "number" || !Number.isFinite(v)) {
      throw new Error(`[OpenRouter] ${key} must be finite number, got ${typeof v}: ${String(v)}`);
    }
  }
}

export function assertPureOpenRouterPayload(body: Record<string, unknown>, modelId?: string): void {
  for (const key of Object.keys(body)) {
    if (!GEMINI_FORBIDDEN_KEYS.has(key)) continue;
    if (key === "top_p" && modelId && isDeepSeekOpenRouterModel(modelId)) continue;
    throw new Error(`[OpenRouter] payload contamination: forbidden "${key}"`);
  }
}

export function openRouterGenerationParams(
  targetResponseChars?: number | null,
  modelId?: string
) {
  const maxTokens = resolveOpenRouterMaxTokens(targetResponseChars, undefined, modelId);
  return normalizeOpenRouterGenerationParams(maxTokens, modelId, undefined, targetResponseChars);
}

/** 디버그 로그용 — 메시지 본문 제외 */
export function summarizeOpenRouterPayload(body: Record<string, unknown>) {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const systemMsg = messages[0] as { role?: string; content?: unknown } | undefined;
  const typedMessages = messages as OpenRouterChatMessage[];
  let cachedSystemBlocks = 0;
  if (systemMsg?.role === "system" && Array.isArray(systemMsg.content)) {
    cachedSystemBlocks = (systemMsg.content as OpenRouterContentBlock[]).filter(
      (b) => b.cache_control?.type === "ephemeral"
    ).length;
  }
  const cachedBlocksTotal = countCachedContentBlocks(typedMessages);
  const historyBreakpointIdx = typedMessages.findIndex(
    (m, i) =>
      i > 0 &&
      m.role !== "system" &&
      Array.isArray(m.content) &&
      m.content.some((b) => b.cache_control?.type === "ephemeral")
  );
  return {
    model: body.model,
    stream: body.stream,
    session_id: body.session_id,
    messageCount: messages.length,
    temperature: body.temperature,
    max_tokens: body.max_tokens,
    top_p: body.top_p,
    frequency_penalty: body.frequency_penalty,
    presence_penalty: body.presence_penalty,
    repetition_penalty: body.repetition_penalty,
    cachedSystemBlocks,
    cachedBlocksTotal,
    historyCacheMessageIndex: historyBreakpointIdx >= 0 ? historyBreakpointIdx : null,
    hasStop: "stop" in body,
    hasStopSequences: "stop_sequences" in body,
    hasPenaltyParams:
      "repetition_penalty" in body ||
      "frequency_penalty" in body ||
      "presence_penalty" in body,
    paramTypes: {
      temperature: typeof body.temperature,
      max_tokens: typeof body.max_tokens,
    },
  };
}

/** message content → 단일 문자열 (캐시 블록 배열 포함) */
export function flattenOpenRouterMessageContent(
  content: string | OpenRouterContentBlock[]
): string {
  if (typeof content === "string") return content;
  return content.map((b) => b.text).join("\n\n");
}

/** @deprecated flattenOpenRouterMessageContent 사용 */
export function flattenOpenRouterSystemContent(
  content: string | OpenRouterContentBlock[]
): string {
  return flattenOpenRouterMessageContent(content);
}

export function countCachedContentBlocks(messages: OpenRouterChatMessage[]): number {
  let n = 0;
  for (const m of messages) {
    if (Array.isArray(m.content)) {
      n += m.content.filter((b) => b.cache_control?.type === "ephemeral").length;
    }
  }
  return n;
}

/** OpenRouter fetch 직전 — role:system 본문 덤프 */
export function logOpenRouterSystemPromptBeforeFetch(body: Record<string, unknown>): void {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const systemMsg = messages.find(
    (m) => (m as OpenRouterChatMessage).role === "system"
  ) as OpenRouterChatMessage | undefined;

  if (!systemMsg) {
    console.log("=== [DEBUG] SYSTEM PROMPT LOADED (length: 0, missing) ===");
    return;
  }

  const raw = systemMsg.content;
  const systemPromptContent = flattenOpenRouterMessageContent(raw);

  console.log(
    `=== [DEBUG] SYSTEM PROMPT LOADED (length: ${systemPromptContent.length}) ===`
  );

  if (Array.isArray(raw) && process.env.NODE_ENV !== "production") {
    raw.forEach((block, i) => {
      console.log(
        `=== [DEBUG] SYSTEM BLOCK ${i + 1}/${raw.length} === len=${block.text.length} cached=${block.cache_control?.type === "ephemeral"}`
      );
    });
  }

  let lastUserIdx = -1;
  for (let i = messages.length - 1; i >= 1; i--) {
    if ((messages[i] as OpenRouterChatMessage).role === "user") {
      lastUserIdx = i;
      break;
    }
  }
  if (lastUserIdx >= 2) {
    const histMsg = messages[lastUserIdx - 1] as OpenRouterChatMessage | undefined;
    const histContent = histMsg?.content;
    const histCached =
      Array.isArray(histContent) &&
      histContent.some((b) => b.cache_control?.type === "ephemeral");
    console.log("=== [DEBUG] HISTORY CACHE BREAKPOINT ===", {
      index: lastUserIdx - 1,
      role: histMsg?.role,
      cached: histCached,
      contentIsArray: Array.isArray(histContent),
    });
  }
}
