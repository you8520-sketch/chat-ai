import {
  resolveMaxOutputTokensForTarget,
  resolveTierMaxOutputTokensEstimate,
} from "@/lib/responseLength";
import type { ChatMsg } from "@/lib/ai";
import { assertPayloadWithinTokenLimit } from "@/lib/turnApiBudget";

/** Gemini generationConfig에 허용되는 키만 (Llama/OpenRouter 파라미터 금지) */
const GEMINI_ALLOWED_GENERATION_KEYS = new Set([
  "temperature",
  "topK",
  "topP",
  "maxOutputTokens",
  "thinkingConfig",
]);

const GEMINI_FORBIDDEN_TOP_LEVEL = new Set([
  "repetition_penalty",
  "frequency_penalty",
  "presence_penalty",
  "top_p",
  "max_tokens",
  "model",
  "messages",
  "stream",
  "stream_options",
]);

function isSecondaryGeminiRequest(requestKind?: string): boolean {
  return /continuation|truncation-recovery|background-memory/i.test(requestKind ?? "");
}

/** explicit cache 미사용 — continuation·truncation-recovery·background-memory */
function requestKindSkipsExplicitCache(requestKind?: string): boolean {
  return /continuation|truncation-recovery|background-memory|background-lorebook-compact/i.test(
    requestKind ?? ""
  );
}

export { isSecondaryGeminiRequest, requestKindSkipsExplicitCache };

function isBackgroundGeminiRequest(requestKind?: string): boolean {
  return /background-memory|background-lorebook-compact/i.test(requestKind ?? "");
}

function isLorebookCompactRequest(requestKind?: string): boolean {
  return requestKind === "background-lorebook-compact";
}

export type GeminiThinkingDiagnostics = {
  thinkingEnabled: boolean;
  thinkingBudget?: number;
  thinkingLevel?: string;
};

export function describeGeminiThinkingConfig(
  thinking?: Record<string, unknown>
): GeminiThinkingDiagnostics {
  if (!thinking || Object.keys(thinking).length === 0) {
    return { thinkingEnabled: true, thinkingBudget: -1 };
  }
  if (typeof thinking.thinkingLevel === "string") {
    return {
      thinkingEnabled: true,
      thinkingLevel: thinking.thinkingLevel,
    };
  }
  const budget = thinking.thinkingBudget;
  if (budget === 0) {
    return { thinkingEnabled: false, thinkingBudget: 0 };
  }
  if (budget === -1 || budget === undefined) {
    return { thinkingEnabled: true, thinkingBudget: -1 };
  }
  if (typeof budget === "number" && budget > 0) {
    return { thinkingEnabled: true, thinkingBudget: budget };
  }
  return { thinkingEnabled: true };
}

/** flash-lite 등 thinking API 미지원 모델 */
function geminiModelSupportsThinking(modelId: string): boolean {
  return !/flash-lite/i.test(modelId.toLowerCase());
}

/** Gemini 2.5 Pro — thinking 상한 (동적 -1 금지, 출력 토큰 잠식 방지) */
export const GEMINI_25_PRO_THINKING_BUDGET = 1024;

/** Gemini 2.5 Pro — thinking 필수, budget 0 불가 */
export function geminiModelRequiresThinkingMode(modelId: string): boolean {
  return /2\.5-pro/i.test(modelId.toLowerCase());
}

/** Gemini 3.x — thinkingLevel API (2.5 thinkingBudget와 별도) */
function isGemini3SeriesModel(modelId: string): boolean {
  const id = modelId.toLowerCase();
  return /gemini-3|3\.1-pro|3-flash|3\.0-flash|3\.5-flash/i.test(id);
}

/**
 * 모델별 thinkingConfig.
 * - 2.5 Pro: thinkingBudget 1024 고정 (-1·0 금지)
 * - 2.5 Flash 등: thinkingBudget 0 (비용·지연 절감)
 * - 3.x: thinkingLevel (budget 0 미지원)
 */
export function buildGeminiThinkingConfig(
  modelId: string,
  _requestKind?: string
): Record<string, unknown> | undefined {
  if (!geminiModelSupportsThinking(modelId)) return undefined;

  const id = modelId.toLowerCase();

  if (geminiModelRequiresThinkingMode(modelId)) {
    const raw = process.env.GEMINI_25_PRO_THINKING_BUDGET?.trim();
    if (raw) {
      const n = Number(raw);
      if (Number.isFinite(n) && n >= 128) {
        return { thinkingBudget: Math.min(32_768, Math.floor(n)) };
      }
    }
    return { thinkingBudget: GEMINI_25_PRO_THINKING_BUDGET };
  }

  if (isGemini3SeriesModel(modelId)) {
    if (/pro/i.test(id)) return { thinkingLevel: "low" };
    return { thinkingLevel: "minimal" };
  }

  return { thinkingBudget: 0 };
}

export function buildGeminiGenerationConfig(
  modelId: string,
  targetResponseChars?: number | null,
  requestKind?: string,
  maxOutputTokensOverride?: number
): Record<string, unknown> {
  const thinking = buildGeminiThinkingConfig(modelId, requestKind);
  const isBackground = isBackgroundGeminiRequest(requestKind);

  let resolvedMaxOutputTokens: number | undefined;
  if (maxOutputTokensOverride != null) {
    resolvedMaxOutputTokens = maxOutputTokensOverride;
  } else if (isBackground) {
    const estimate = resolveTierMaxOutputTokensEstimate(targetResponseChars);
    resolvedMaxOutputTokens = Math.min(
      estimate,
      isLorebookCompactRequest(requestKind) ? 3500 : 2048
    );
  } else {
    resolvedMaxOutputTokens = resolveMaxOutputTokensForTarget(targetResponseChars, modelId);
  }

  const config: Record<string, unknown> = {
    temperature: isBackground ? 0.3 : 0.9,
    topK: 40,
    topP: 0.95,
  };
  if (resolvedMaxOutputTokens != null) {
    config.maxOutputTokens = resolvedMaxOutputTokens;
  }

  if (thinking) {
    config.thinkingConfig = thinking;
  }

  if (process.env.NODE_ENV !== "production") {
    const thinkingDiagnostics = describeGeminiThinkingConfig(
      config.thinkingConfig as Record<string, unknown> | undefined
    );
    console.log("[gemini-generation-config]", {
      model: modelId,
      requestKind: requestKind ?? "primary-stream",
      ...thinkingDiagnostics,
      maxOutputTokens: config.maxOutputTokens,
    });
  }

  return config;
}

/** cachedContent 사용 시 generateContent에 system_instruction 불가 — dynamic tail만 contents 선두에 주입 */
export function injectDynamicContextIntoContents(
  dynamicSystemTail: string,
  history: ChatMsg[],
  promptTail?: string
): ChatMsg[] {
  const trimmed = dynamicSystemTail.trim();
  const tail = promptTail?.trim();
  if (!trimmed && !tail) return history;

  const preface: ChatMsg[] = trimmed
    ? [
        {
          role: "user",
          content: `[OPERATIONAL INSTRUCTIONS — follow strictly; do not quote or roleplay this block in output]\n${trimmed}`,
        },
        {
          role: "assistant",
          content: "Acknowledged. I will follow the operational instructions for this conversation.",
        },
      ]
    : [];

  let result: ChatMsg[] = [...preface, ...history];
  if (tail) {
    const tailMsg: ChatMsg = {
      role: "user",
      content: `[CRITICAL TAIL — non-cached appearance anchor; follow strictly]\n${tail}`,
    };
    if (result.length > 0 && result[result.length - 1]?.role === "user") {
      result = [...result.slice(0, -1), tailMsg, result[result.length - 1]!];
    } else {
      result.push(tailMsg);
    }
  }
  return result;
}

/** @deprecated injectDynamicContextIntoContents — explicit cache 시 dynamic tail만 주입 */
export function injectSystemPromptIntoContents(
  system: string,
  history: ChatMsg[],
  promptTail?: string
): ChatMsg[] {
  return injectDynamicContextIntoContents(system, history, promptTail);
}

export function buildGeminiRequestBody(
  system: string,
  history: ChatMsg[],
  modelId: string,
  targetResponseChars?: number | null,
  requestKind?: string,
  cachedContentName?: string,
  promptTail?: string,
  cachedContentTokens = 0,
  maxOutputTokensOverride?: number
) {
  const useExplicitCache = Boolean(cachedContentName?.trim());
  const secondary = isSecondaryGeminiRequest(requestKind);
  const injectDynamicTail = useExplicitCache && !secondary;
  const effectiveHistory = injectDynamicTail
    ? injectDynamicContextIntoContents(system, history, promptTail)
    : history;

  assertPayloadWithinTokenLimit(
    system,
    effectiveHistory,
    injectDynamicTail ? cachedContentTokens : 0
  );

  const body: Record<string, unknown> = {
    contents: effectiveHistory.map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    })),
    safetySettings: [
      { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
      { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
      { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
      { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
    ],
    generationConfig: buildGeminiGenerationConfig(
      modelId,
      targetResponseChars,
      requestKind,
      maxOutputTokensOverride
    ),
  };
  if (!useExplicitCache) {
    body.system_instruction = { parts: [{ text: system }] };
  }
  if (cachedContentName) {
    body.cachedContent = cachedContentName;
  }
  assertPureGeminiPayload(body);
  return body;
}

/** Gemini 요청에 Llama/OpenRouter 파라미터 혼입 방지 */
export function assertPureGeminiPayload(body: Record<string, unknown>): void {
  for (const key of Object.keys(body)) {
    if (GEMINI_FORBIDDEN_TOP_LEVEL.has(key)) {
      throw new Error(`[Gemini] payload contamination: forbidden top-level "${key}"`);
    }
  }
  const gen = body.generationConfig as Record<string, unknown> | undefined;
  if (gen) {
    for (const key of Object.keys(gen)) {
      if (!GEMINI_ALLOWED_GENERATION_KEYS.has(key)) {
        throw new Error(`[Gemini] generationConfig contamination: forbidden "${key}"`);
      }
    }
  }
}
