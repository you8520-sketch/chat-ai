import {
  CLAUDE_OPUS_MODEL_LEGACY,
  DEFAULT_SELECTED_AI,
  OPENROUTER_CLAUDE_DEFAULT,
  OPENROUTER_GEMINI_25_FLASH_MODEL,
  OPENROUTER_GEMINI_25_PRO_MODEL,
  OPENROUTER_GEMINI_31_FLASH_MODEL,
  OPENROUTER_GEMINI_31_PRO_MODEL,
  isGemini25ProModel,
  isGemini31ProModel,
  coerceUserSelectableAI,
  isOpenRouterSelectedAI,
  type SelectedAI,
} from "@/lib/chatModels";

/** OpenRouter에서 endpoint가 제거된 구 slug → 현재 사용 가능한 slug */
const DEPRECATED_OPENROUTER_MODELS: Record<string, string> = {
  [CLAUDE_OPUS_MODEL_LEGACY]: OPENROUTER_CLAUDE_DEFAULT,
  "gemini-3.1": OPENROUTER_GEMINI_31_PRO_MODEL,
  "gemini-3.1-pro-preview": OPENROUTER_GEMINI_31_PRO_MODEL,
  "google/gemini-3.1-pro-preview": OPENROUTER_GEMINI_31_PRO_MODEL,
};

/** OpenRouter OpenAI-compatible API root — SDK baseURL과 동일 */
export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

/** chat/completions 전체 URL (경로 누락 방지) */
export const OPENROUTER_CHAT_COMPLETIONS_URL = `${OPENROUTER_BASE_URL}/chat/completions`;

/** @deprecated OPENROUTER_CHAT_COMPLETIONS_URL 사용 */
export const OPENROUTER_CHAT_URL = OPENROUTER_CHAT_COMPLETIONS_URL;

function stripEnvQuotes(value: string): string {
  const v = value.trim();
  if (
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'"))
  ) {
    return v.slice(1, -1).trim();
  }
  return v;
}

/** model 파라미터 — trim·따옴표 제거·빈 값 거부 */
export function normalizeOpenRouterModelId(modelId: string): string {
  const normalized = stripEnvQuotes(modelId);
  if (!normalized) {
    throw new Error("[OpenRouter] model id is empty after trim");
  }
  if (normalized !== modelId.trim()) {
    console.warn("[OpenRouter] model id normalized", {
      before: JSON.stringify(modelId),
      after: normalized,
    });
  }
  return normalized;
}

/**
 * OpenRouter 호출용 model slug.
 * selectedAI(openrouter 계열) → OPENROUTER_MODEL env → DEFAULT_SELECTED_AI 기본값
 */
export function resolveOpenRouterModelId(selectedAI?: string | null): string {
  const trimmed = selectedAI ? stripEnvQuotes(selectedAI) : null;
  const fromSelection =
    trimmed && isOpenRouterSelectedAI(trimmed)
      ? coerceUserSelectableAI(trimmed as SelectedAI)
      : null;
  const fromEnv = process.env.OPENROUTER_MODEL
    ? stripEnvQuotes(process.env.OPENROUTER_MODEL)
    : null;
  const raw = fromSelection ?? fromEnv ?? DEFAULT_SELECTED_AI;
  const normalized = normalizeOpenRouterModelId(raw);
  const mapped = DEPRECATED_OPENROUTER_MODELS[normalized] ?? normalized;
  if (mapped !== normalized) {
    console.warn("[OpenRouter] deprecated model slug remapped", { from: normalized, to: mapped });
  }
  return mapped;
}

/**
 * RP 채팅 OpenRouter 실제 HTTP 호출용 — Gemini Pro UI·env slug는 Flash로 라우팅 (thinking 원가 회피).
 * 과금·영수증·DB selectedAI는 billing slug(Pro) 유지 — resolveOpenRouterModelId().
 */
export function resolveRpOpenRouterModelId(modelId: string): string {
  const normalized = normalizeOpenRouterModelId(modelId);
  if (process.env.OPENROUTER_RP_ROUTE_GEMINI_PRO_TO_FLASH === "0") {
    console.warn(
      "[openrouter-rp-routing] OPENROUTER_RP_ROUTE_GEMINI_PRO_TO_FLASH=0 ignored — Gemini Pro always routes to Flash for RP API"
    );
  }
  if (isGemini25ProModel(normalized)) {
    return OPENROUTER_GEMINI_25_FLASH_MODEL;
  }
  if (isGemini31ProModel(normalized)) {
    return OPENROUTER_GEMINI_31_FLASH_MODEL;
  }
  return normalized;
}

export function resolveOpenRouterApiKey(): string {
  const key = process.env.OPENROUTER_API_KEY?.trim();
  if (!key) {
    throw new Error("NO_OPENROUTER_KEY");
  }
  return key;
}

/** OpenRouter 권장 헤더 포함 */
export function buildOpenRouterHeaders(apiKey?: string): Record<string, string> {
  const key = apiKey?.trim() || resolveOpenRouterApiKey();
  const referer = process.env.OPENROUTER_HTTP_REFERER?.trim();
  if (!referer && process.env.NODE_ENV === "production") {
    console.warn(
      "[OpenRouter] OPENROUTER_HTTP_REFERER is unset — set your production URL (e.g. https://your-app.up.railway.app)"
    );
  }
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${key}`,
    "HTTP-Referer": referer || "http://localhost:3000",
    "X-Title": process.env.OPENROUTER_APP_TITLE?.trim() || "PlayAI",
  };
}

export function assertOpenRouterEndpoint(url: string): void {
  const expected = OPENROUTER_CHAT_COMPLETIONS_URL;
  if (url !== expected) {
    throw new Error(
      `[OpenRouter] invalid endpoint URL: ${JSON.stringify(url)} (expected ${expected})`
    );
  }
}
