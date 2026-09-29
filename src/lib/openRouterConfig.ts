import mainRpOpenRouterRoutesJson from "@/lib/mainRpOpenRouterRoutes.json";
import { SITE_DISPLAY_NAME } from "@/lib/siteBrand";
import {
  CLAUDE_OPUS_MODEL_LEGACY,
  OPENROUTER_CLAUDE_DEFAULT,
  OPENROUTER_GEMINI_36_FLASH_MODEL,
  OPENROUTER_GEMINI_31_PRO_MODEL,
  OPENROUTER_GEMINI_37_FLASH_MODEL,
  OPENROUTER_GEMINI_38_FLASH_MODEL,
  GEMINI_38_FLASH_MODEL,
  OPENROUTER_MUSE_SPARK_11_MODEL,
  MAIN_RP_USER_SELECTABLE_OPTIONS,
  coerceUserSelectableAI,
  isOpenRouterSelectedAI,
  type SelectedAI,
} from "@/lib/chatModels";

/** OpenRouter에서 endpoint가 제거된 구 slug → 현재 사용 가능한 slug */
const DEPRECATED_OPENROUTER_MODELS: Record<string, string> = {
  [CLAUDE_OPUS_MODEL_LEGACY]: OPENROUTER_CLAUDE_DEFAULT,
  "gemini-2.5-pro": OPENROUTER_GEMINI_36_FLASH_MODEL,
  "google/gemini-2.5-pro": OPENROUTER_GEMINI_36_FLASH_MODEL,
  "google/gemini-2.5-pro-preview": OPENROUTER_GEMINI_36_FLASH_MODEL,
  "gemini-2.5-flash": OPENROUTER_GEMINI_36_FLASH_MODEL,
  "google/gemini-2.5-flash": OPENROUTER_GEMINI_36_FLASH_MODEL,
  "gemini-3.1": OPENROUTER_GEMINI_31_PRO_MODEL,
  "gemini-3.1-pro-preview": OPENROUTER_GEMINI_31_PRO_MODEL,
  "google/gemini-3.1-pro-preview": OPENROUTER_GEMINI_31_PRO_MODEL,
  "gemini-3.7-flash": OPENROUTER_GEMINI_37_FLASH_MODEL,
  "google/gemini-3.7-flash": OPENROUTER_GEMINI_37_FLASH_MODEL,
  [GEMINI_38_FLASH_MODEL]: OPENROUTER_GEMINI_38_FLASH_MODEL,
  [OPENROUTER_GEMINI_38_FLASH_MODEL]: OPENROUTER_GEMINI_38_FLASH_MODEL,
  [OPENROUTER_MUSE_SPARK_11_MODEL]: OPENROUTER_GEMINI_36_FLASH_MODEL,
};

/** OpenRouter 전용 무지정 예비 모델 — 전역 기본 모델의 provider와 분리한다. */
export const DEFAULT_OPENROUTER_MODEL = OPENROUTER_GEMINI_36_FLASH_MODEL;

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
 * selectedAI(openrouter 계열) → OPENROUTER_MODEL env → OpenRouter 전용 기본값
 */
export function resolveOpenRouterModelId(selectedAI?: string | null): string {
  const trimmed = selectedAI ? stripEnvQuotes(selectedAI) : null;
  const fromSelection =
    trimmed && DEPRECATED_OPENROUTER_MODELS[trimmed]
      ? DEPRECATED_OPENROUTER_MODELS[trimmed]
      : trimmed && isOpenRouterSelectedAI(trimmed)
        ? coerceUserSelectableAI(trimmed as SelectedAI)
        : null;
  const fromEnv = process.env.OPENROUTER_MODEL
    ? stripEnvQuotes(process.env.OPENROUTER_MODEL)
    : null;
  const raw = fromSelection ?? fromEnv ?? DEFAULT_OPENROUTER_MODEL;
  const normalized = normalizeOpenRouterModelId(raw);
  const mapped = DEPRECATED_OPENROUTER_MODELS[normalized] ?? normalized;
  if (mapped !== normalized) {
    console.warn("[OpenRouter] deprecated model slug remapped", { from: normalized, to: mapped });
  }
  return mapped;
}

/** RP OpenRouter HTTP model slug — UI·과금과 동일 Pro slug (Flash 우회 없음) */
export function resolveRpOpenRouterModelId(modelId: string): string {
  const normalized = normalizeOpenRouterModelId(modelId);
  return DEPRECATED_OPENROUTER_MODELS[normalized] ?? normalized;
}

type MainRpOpenRouterRouteRegistryEntry = {
  providerSlug: string;
  providerLabel: string;
  serviceTier: "flex" | null;
};

const MAIN_RP_OPENROUTER_ROUTE_REGISTRY =
  mainRpOpenRouterRoutesJson as Record<string, MainRpOpenRouterRouteRegistryEntry>;

export type MainRpOpenRouterRoutePolicy = {
  provider: {
    only: [string];
    allow_fallbacks: false;
    require_parameters: true;
  };
  serviceTier?: "flex";
};

function resolveMainRpRouteRegistryKey(modelId: string): string | null {
  const normalized = normalizeOpenRouterModelId(modelId).toLowerCase();
  if (MAIN_RP_OPENROUTER_ROUTE_REGISTRY[normalized]) return normalized;

  const resolved = resolveRpOpenRouterModelId(modelId);
  const selected = MAIN_RP_USER_SELECTABLE_OPTIONS.find(
    (option) =>
      option.provider === "openrouter" &&
      resolveRpOpenRouterModelId(option.id) === resolved
  );
  return selected?.id ?? null;
}

/**
 * Canonical Main-RP OpenRouter sub-provider route owner.
 * Provider pin + optional service tier live in mainRpOpenRouterRoutes.json so
 * evidence-backed automation can propose one small, reviewable route diff.
 * Privacy/data-retention policy is intentionally not duplicated here; account
 * privacy settings remain the canonical owner for those constraints.
 */
export function resolveMainRpOpenRouterRoutePolicy(
  modelId: string
): MainRpOpenRouterRoutePolicy | null {
  const key = resolveMainRpRouteRegistryKey(modelId);
  if (!key) return null;
  const route = MAIN_RP_OPENROUTER_ROUTE_REGISTRY[key];
  if (!route?.providerSlug) return null;

  return {
    provider: {
      only: [route.providerSlug],
      allow_fallbacks: false,
      require_parameters: true,
    },
    ...(route.serviceTier === "flex" ? { serviceTier: "flex" as const } : {}),
  };
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
      "[OpenRouter] OPENROUTER_HTTP_REFERER is unset — set your production site URL (e.g. https://hav.chat)"
    );
  }
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${key}`,
    "HTTP-Referer": referer || "http://localhost:3000",
    "X-Title": process.env.OPENROUTER_APP_TITLE?.trim() || SITE_DISPLAY_NAME,
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
