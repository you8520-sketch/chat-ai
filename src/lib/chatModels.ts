/** 채팅방 AI 선택 (selectedAI) — OpenRouter 전용 · 사용자 전역 선택 */
/** 유저가 보내는 메시지 최대 글자 수 */
export const CHAT_MESSAGE_MAX = 1000;

export {
  ASSISTANT_MESSAGE_EDIT_MAX_CHARS as ASSISTANT_MESSAGE_MAX,
  DEFAULT_TARGET_RESPONSE_CHARS,
  MIN_TARGET_RESPONSE_CHARS,
} from "./responseLengthConstants";

/** @deprecated UI 선택용 Flash — 백그라운드 작업은 OPENROUTER_DEEPSEEK_V3_MODEL */
export const GEMINI_CHAT_FLASH_25 = "gemini-2.5-flash";
/** @deprecated LEGACY — gemini-3-flash-preview */
export const GEMINI_CHAT_FLASH = "gemini-3-flash-preview";

/** OpenRouter Claude Opus — 현재 라우팅 가능한 slug (claude-3-opus는 OpenRouter에서 endpoint 없음) */
export const OPENROUTER_CLAUDE_DEFAULT = "anthropic/claude-opus-4.5";

/** @deprecated OPENROUTER_CLAUDE_DEFAULT 사용 — DB·UI 호환용 */
export const CLAUDE_OPUS_MODEL_LEGACY = "anthropic/claude-3-opus";

/** selectedAI·OpenRouter model param 기본값 */
export const CLAUDE_OPUS_MODEL = OPENROUTER_CLAUDE_DEFAULT;

/** OpenRouter — DeepSeek V4 Pro */
export const OPENROUTER_DEEPSEEK_V4_PRO_MODEL = "deepseek/deepseek-v4-pro";

/** OpenRouter — Tencent Hy3 (295B MoE, 21B active, reasoning) */
export const OPENROUTER_TENCENT_HY3_MODEL = "tencent/hy3";

/** OpenRouter — DeepSeek V3 (백그라운드 기억·상태창·번역 등) */
export const OPENROUTER_DEEPSEEK_V3_MODEL = "deepseek/deepseek-chat-v3-0324";

/** @deprecated UI 선택 제거 — legacy slug·과금 경로 호환용 */
export const OPENROUTER_QWEN_37_MAX_MODEL = "qwen/qwen3.7-max";

/** @deprecated UI 선택 제거 — legacy slug·과금 경로 호환용 */
export const OPENROUTER_GLM_52_MODEL = "z-ai/glm-5.2";

/** @deprecated UI 선택 제거 — legacy slug·과금·영수증 호환용 (재활성화 가능) */
export const OPENROUTER_KIMI_K3_MODEL = "moonshotai/kimi-k3";

/** OpenRouter — Meta Muse Spark 1.1 */
export const OPENROUTER_MUSE_SPARK_11_MODEL = "meta/muse-spark-1.1";

export const OPENROUTER_SOLAR_PRO_3_MODEL = "upstage/solar-pro-3";

/** OpenRouter — Google Gemini 2.5 Pro */
export const OPENROUTER_GEMINI_25_PRO_MODEL = "google/gemini-2.5-pro";

/** @deprecated UI 선택 제거 — legacy slug·과금 경로 호환용 */
export const OPENROUTER_GEMINI_31_PRO_MODEL = "google/gemini-3.1-pro-preview";

/** OpenRouter — Gemini 2.0 Flash (백그라운드 비전: 이미지 검열·에셋 태그) */
export const OPENROUTER_GEMINI_20_FLASH_MODEL = "google/gemini-2.0-flash-001";

/** OpenRouter — Gemini 2.5 Flash (HTML·백그라운드 등 직접 호출용) */
export const OPENROUTER_GEMINI_25_FLASH_MODEL = "google/gemini-2.5-flash";

/** OpenRouter — Gemini 2.5 Flash Lite (background failure-only fallback) */
export const OPENROUTER_GEMINI_25_FLASH_LITE_MODEL = "google/gemini-2.5-flash-lite";

/** OpenRouter — Gemini 3.1 Flash Lite (백그라운드·비-RP 직접 호출용) */
export const OPENROUTER_GEMINI_31_FLASH_MODEL = "google/gemini-3.1-flash-lite";

/** 유저-facing 표시명 (채팅 선택·영수증) */
export const DEEPSEEK_DISPLAY_NAME = "DeepSeek V4 Pro";

export const QWEN_DISPLAY_NAME = "Qwen 3.7 Max";

export const GLM_52_DISPLAY_NAME = "GLM 5.2";

export const KIMI_K3_DISPLAY_NAME = "Kimi K3";

export const MUSE_SPARK_11_DISPLAY_NAME = "Muse Spark 1.1";

export const SOLAR_PRO_3_DISPLAY_NAME = "Solar Pro 3";

export const TENCENT_HY3_DISPLAY_NAME = "Tencent Hy3";

export const GEMINI_25_PRO_DISPLAY_NAME = "Gemini 2.5 Pro";

export const GEMINI_31_PRO_DISPLAY_NAME = "Gemini 3.1 Pro";

/** 채팅 UI에 Claude Opus 노출 — `OPENROUTER_OPUS_USER_SELECTABLE=1`로 재활성화 */
export function isOpusUserSelectable(): boolean {
  return process.env.OPENROUTER_OPUS_USER_SELECTABLE?.trim() === "1";
}

export type SelectedAIOptionMeta = {
  id: string;
  label: string;
  tier: "pro";
  hint: string;
  /** 기본 추천 배지 */
  badge?: string;
  recommended?: boolean;
};

export const SELECTED_AI_OPTIONS = [
  {
    id: OPENROUTER_MUSE_SPARK_11_MODEL,
    label: MUSE_SPARK_11_DISPLAY_NAME,
    tier: "pro" as const,
    hint: "Meta",
    badge: "기본 추천",
    recommended: true,
  },
  {
    id: OPENROUTER_GEMINI_25_PRO_MODEL,
    label: GEMINI_25_PRO_DISPLAY_NAME,
    tier: "pro" as const,
    hint: "Google",
  },
  {
    id: OPENROUTER_DEEPSEEK_V4_PRO_MODEL,
    label: DEEPSEEK_DISPLAY_NAME,
    tier: "pro" as const,
    hint: "Reasoning",
  },
  {
    id: OPENROUTER_TENCENT_HY3_MODEL,
    label: TENCENT_HY3_DISPLAY_NAME,
    tier: "pro" as const,
    hint: "Reasoning",
  },
  {
    id: CLAUDE_OPUS_MODEL,
    label: "Claude Opus 4P",
    tier: "pro" as const,
    hint: "Premium",
  },
] as const satisfies readonly SelectedAIOptionMeta[];

/** Anthropic(Claude) 계열 모델 여부 — OpenRouter 경로 + prompt caching + prefill 적용 기준 */
export function isAnthropicModel(modelId: string): boolean {
  return modelId.toLowerCase().startsWith("anthropic/");
}

/** Anthropic(Claude) 전용 — prefill·캐시 breakpoint 적용 기준 */
export function isClaudeSelectedAI(selected: string): boolean {
  return isAnthropicModel(selected);
}

export type SelectedAI = (typeof SELECTED_AI_OPTIONS)[number]["id"];
export type SelectedAITier = (typeof SELECTED_AI_OPTIONS)[number]["tier"];

/** 신규·미선택 사용자 기본값 — Muse Spark 1.1 */
export const DEFAULT_SELECTED_AI: SelectedAI = OPENROUTER_MUSE_SPARK_11_MODEL;

/** 채팅 모델 선택 UI에만 노출 (Opus는 기본 숨김) */
export const USER_SELECTABLE_AI_OPTIONS = SELECTED_AI_OPTIONS.filter(
  (o) => isOpusUserSelectable() || !isClaudeSelectedAI(o.id)
);

export function coerceUserSelectableAI(id: SelectedAI): SelectedAI {
  if (!isOpusUserSelectable() && isClaudeSelectedAI(id)) {
    return DEFAULT_SELECTED_AI;
  }
  return id;
}

/** selectedAI가 OpenRouter 라우팅 대상인지 (유저 채팅은 전부 OpenRouter) */
export function isOpenRouterSelectedAI(selected: string): boolean {
  return isValidSelectedAI(selected);
}

/** OpenRouter DeepSeek V4 Pro — generation·prompt·style tuning 대상 */
export function isDeepSeekV4ProModel(modelId: string): boolean {
  return modelId.trim() === OPENROUTER_DEEPSEEK_V4_PRO_MODEL;
}

/** Any OpenRouter DeepSeek family model, including current chat V4 Pro and background V3. */
export function isDeepSeekModel(modelId: string): boolean {
  const id = modelId.trim().toLowerCase();
  return id === OPENROUTER_DEEPSEEK_V4_PRO_MODEL || id === OPENROUTER_DEEPSEEK_V3_MODEL || id.startsWith("deepseek/") || id.includes("/deepseek-");
}

/** OpenRouter Google Gemini 2.5 Pro */
export function isGemini25ProModel(modelId: string): boolean {
  const id = modelId.trim().toLowerCase();
  return id === OPENROUTER_GEMINI_25_PRO_MODEL || id.includes("gemini-2.5-pro");
}

/** OpenRouter Gemini 3.1 Pro Preview */
export function isGemini31ProModel(modelId: string): boolean {
  const id = modelId.trim().toLowerCase();
  return id === OPENROUTER_GEMINI_31_PRO_MODEL || id.includes("gemini-3.1-pro");
}

/** Gemini 3.x Pro on OpenRouter — native thinkingLevel (2.5 Pro thinkingBudget cap과 별도) */
export function isGemini3ProOpenRouterModel(modelId: string): boolean {
  return isGeminiProOpenRouterModel(modelId) && !isGemini25ProModel(modelId);
}

/** OpenRouter Gemini Flash (RP 라우팅·배경 작업) */
export function isGeminiFlashOpenRouterModel(modelId: string): boolean {
  const id = modelId.trim().toLowerCase();
  if (!id.includes("gemini") || !id.includes("flash")) return false;
  return (
    id === OPENROUTER_GEMINI_25_FLASH_MODEL ||
    id === OPENROUTER_GEMINI_31_FLASH_MODEL ||
    id === GEMINI_CHAT_FLASH_25 ||
    id.includes("gemini-2.5-flash") ||
    id.includes("gemini-3.1-flash") ||
    id.includes("gemini-3-flash")
  );
}

/** OpenRouter Gemini Pro — 2.5 Pro · 3.1 Pro (유저 선택·과금·reasoning 정책 공통) */
export function isGeminiProOpenRouterModel(modelId: string): boolean {
  return isGemini25ProModel(modelId) || isGemini31ProModel(modelId);
}

/** OpenRouter Tencent Hy3 계열 (tencent/hy3 등) */
export function isTencentHy3Model(modelId: string): boolean {
  const id = modelId.trim().toLowerCase();
  return id === OPENROUTER_TENCENT_HY3_MODEL || id.includes("/hy3") || /(^|\/)hy3\b/i.test(id);
}

/** OpenRouter Qwen 계열 (Qwen3.7 Max 등) */
export function isQwenModel(modelId: string): boolean {
  return modelId.trim().toLowerCase().includes("qwen");
}

/** OpenRouter Z.ai GLM 계열 (GLM 5.2 등) */
export function isGlmModel(modelId: string): boolean {
  const id = modelId.trim().toLowerCase();
  return id === OPENROUTER_GLM_52_MODEL || id.startsWith("z-ai/glm") || id.includes("/glm-");
}

/** OpenRouter MoonshotAI Kimi 계열 (Kimi K3 등) — UI 제거, 영수증·legacy 보존 */
export function isKimiModel(modelId: string): boolean {
  const id = modelId.trim().toLowerCase();
  return (
    id === OPENROUTER_KIMI_K3_MODEL ||
    id.startsWith("moonshotai/kimi") ||
    id.includes("/kimi-k3") ||
    /(^|\/)kimi[-.]?k3\b/i.test(id)
  );
}

/** OpenRouter Meta Muse Spark 계열 (Muse Spark 1.1 등) */
export function isMuseModel(modelId: string): boolean {
  const id = modelId.trim().toLowerCase();
  return (
    id === OPENROUTER_MUSE_SPARK_11_MODEL ||
    id.includes("muse-spark") ||
    /(^|\/)muse[-.]?spark\b/i.test(id)
  );
}

/** @deprecated provider === "openrouter" — 모든 OpenRouter 모델에 통합 prose 적용 */
export function isOpenRouterSharedProseModel(modelId: string): boolean {
  const id = modelId.trim();
  return (
    id.length > 0 &&
    (isAnthropicModel(id) ||
      isQwenModel(id) ||
      isGlmModel(id) ||
      isKimiModel(id) ||
      isMuseModel(id) ||
      isDeepSeekV4ProModel(id) ||
      isGemini25ProModel(id) ||
      isGemini31ProModel(id) ||
      id.includes("/"))
  );
}

const VALID = new Set<string>(SELECTED_AI_OPTIONS.map((o) => o.id));

const LEGACY_TO_SELECTED: Record<string, SelectedAI> = {
  "gemini-2.5-pro": OPENROUTER_GEMINI_25_PRO_MODEL,
  "gemini-2.5-flash": DEFAULT_SELECTED_AI,
  "gemini-2.5": DEFAULT_SELECTED_AI,
  "gemini-3.0": DEFAULT_SELECTED_AI,
  "gemini-3-flash-preview": DEFAULT_SELECTED_AI,
  "gemini-3.5-flash": DEFAULT_SELECTED_AI,
  /** Gemini 3.1 Pro 제거 — 기존 채팅·legacy slug는 Muse로 이전 */
  "gemini-3.1": DEFAULT_SELECTED_AI,
  "gemini-3.1-pro-preview": DEFAULT_SELECTED_AI,
  "google/gemini-2.5-pro": OPENROUTER_GEMINI_25_PRO_MODEL,
  "google/gemini-2.5-pro-preview": OPENROUTER_GEMINI_25_PRO_MODEL,
  "google/gemini-3.1-pro-preview": DEFAULT_SELECTED_AI,
  masterpiece: DEFAULT_SELECTED_AI,
  [CLAUDE_OPUS_MODEL_LEGACY]: CLAUDE_OPUS_MODEL,
  "claude-opus": CLAUDE_OPUS_MODEL,
  "anthropic/claude-opus-latest": CLAUDE_OPUS_MODEL,
  deepseek: OPENROUTER_DEEPSEEK_V4_PRO_MODEL,
  "deepseek-v4-pro": OPENROUTER_DEEPSEEK_V4_PRO_MODEL,
  "deepseek-4-pro": OPENROUTER_DEEPSEEK_V4_PRO_MODEL,
  "deepseek/deepseek-v4-pro": OPENROUTER_DEEPSEEK_V4_PRO_MODEL,
  /** Qwen 3.7 Max 제거 — Muse로 이전 */
  qwen: DEFAULT_SELECTED_AI,
  "qwen3.7-max": DEFAULT_SELECTED_AI,
  "qwen/qwen3.7-max": DEFAULT_SELECTED_AI,
  /** GLM 5.2 제거 — Muse로 이전 */
  glm: DEFAULT_SELECTED_AI,
  "glm-5.2": DEFAULT_SELECTED_AI,
  "glm5.2": DEFAULT_SELECTED_AI,
  "z-ai/glm-5.2": DEFAULT_SELECTED_AI,
  "z-ai/glm-5.1": DEFAULT_SELECTED_AI,
  "z-ai/glm-5": DEFAULT_SELECTED_AI,
  /** Kimi K3 제거 — Muse로 이전 (재활성화 시 상수·detector 유지) */
  kimi: DEFAULT_SELECTED_AI,
  "kimi-k3": DEFAULT_SELECTED_AI,
  kimik3: DEFAULT_SELECTED_AI,
  "moonshotai/kimi-k3": DEFAULT_SELECTED_AI,
  "moonshotai/kimi-latest": DEFAULT_SELECTED_AI,
  muse: OPENROUTER_MUSE_SPARK_11_MODEL,
  "muse-spark": OPENROUTER_MUSE_SPARK_11_MODEL,
  "muse-spark-1.1": OPENROUTER_MUSE_SPARK_11_MODEL,
  musespark: OPENROUTER_MUSE_SPARK_11_MODEL,
  "meta/muse-spark-1.1": OPENROUTER_MUSE_SPARK_11_MODEL,
  /** Solar Pro 3 retired after runaway-generation incident — migrate stored prefs to default. */
  solar: DEFAULT_SELECTED_AI,
  "solar-pro": DEFAULT_SELECTED_AI,
  "solar-pro-3": DEFAULT_SELECTED_AI,
  "upstage/solar-pro-3": DEFAULT_SELECTED_AI,
  /** Retired Sonnet → Gemini 2.5 Pro (3.1 Pro selection removed) */
  "anthropic/claude-3.5-sonnet": OPENROUTER_GEMINI_25_PRO_MODEL,
  "claude-3.5-sonnet": OPENROUTER_GEMINI_25_PRO_MODEL,
  "anthropic/claude-sonnet-4": OPENROUTER_GEMINI_25_PRO_MODEL,
};

export function isValidSelectedAI(v: unknown): v is SelectedAI {
  return typeof v === "string" && VALID.has(v);
}

export function resolveSelectedAI(value: unknown, fallback?: string): SelectedAI {
  let resolved: SelectedAI;
  if (isValidSelectedAI(value)) resolved = value;
  else if (typeof value === "string" && LEGACY_TO_SELECTED[value]) resolved = LEGACY_TO_SELECTED[value];
  else if (typeof value === "string" && isKimiModel(value)) resolved = DEFAULT_SELECTED_AI;
  else if (fallback && isValidSelectedAI(fallback)) resolved = fallback;
  else if (typeof fallback === "string" && LEGACY_TO_SELECTED[fallback]) resolved = LEGACY_TO_SELECTED[fallback];
  else if (typeof fallback === "string" && isKimiModel(fallback)) resolved = DEFAULT_SELECTED_AI;
  else resolved = DEFAULT_SELECTED_AI;
  return coerceUserSelectableAI(resolved);
}

/** UI·영수증 표시용 */
export function selectedAILabel(id: string): string {
  const opt = SELECTED_AI_OPTIONS.find((o) => o.id === id);
  if (opt) return opt.label;
  if (id === OPENROUTER_KIMI_K3_MODEL || isKimiModel(id)) {
    return KIMI_K3_DISPLAY_NAME;
  }
  if (id === OPENROUTER_SOLAR_PRO_3_MODEL || id.toLowerCase().includes("/solar-pro-3")) {
    return SOLAR_PRO_3_DISPLAY_NAME;
  }
  if (id === OPENROUTER_QWEN_37_MAX_MODEL || id.toLowerCase().includes("qwen3.7-max")) {
    return QWEN_DISPLAY_NAME;
  }
  if (id === OPENROUTER_GEMINI_31_PRO_MODEL || id.toLowerCase().includes("gemini-3.1-pro")) {
    return GEMINI_31_PRO_DISPLAY_NAME;
  }
  if (id === OPENROUTER_GLM_52_MODEL || isGlmModel(id)) {
    return GLM_52_DISPLAY_NAME;
  }
  if (id === GEMINI_CHAT_FLASH_25 || id === GEMINI_CHAT_FLASH) return id;
  return id;
}

export function selectedAIOptionMeta(id: string): (typeof SELECTED_AI_OPTIONS)[number] | undefined {
  return SELECTED_AI_OPTIONS.find((o) => o.id === id);
}

/** OpenRouter model slug — selectedAI와 동일 */
export function billingModelId(selected: SelectedAI): string {
  return selected;
}

/** Claude prefill에 쓸 호칭 최대 글자 수 — 괄호 추출 후에도 초과 시 prefill 생략 */
export const CLAUDE_PREFILL_NAME_MAX = 8;

/**
 * DB 캐릭터명에서 prefill용 호칭 추출.
 * `작품명(캐릭터)` / `작품명[캐릭터]` 형식이면 괄호·대괄호 안 텍스트만 사용.
 * (Assistant 전용 — 유저 이름과 혼동하지 말 것)
 */
export function extractCharacterCallName(rawName: string): string {
  const trimmed = rawName.trim();
  if (!trimmed) return "";
  const match = trimmed.match(/[\(\[]([^)\]]+)[\)\]]/);
  if (match?.[1]?.trim()) return match[1].trim();
  return trimmed;
}

/**
 * Claude assistant prefill용 호칭 해석.
 * - 빈 값 → "그"
 * - 괄호 안 이름 우선 추출 후 CLAUDE_PREFILL_NAME_MAX 초과 → null (prefill 생략)
 * - 그 외 → 추출·trim된 이름
 */
export function resolveClaudePrefillName(charName: string): string | null {
  const actualName = extractCharacterCallName(charName);
  if (!actualName) return "그";
  if (actualName.length > CLAUDE_PREFILL_NAME_MAX) return null;
  return actualName;
}

/**
 * Open-ended Claude assistant prefill — 캐릭터 이름만 주입 (조사·공백 없음).
 * AI가 받침에 맞는 조사(은/는/이/가 등)부터 자연스럽게 이어 쓰도록 유도한다.
 */
export function buildClaudePrefill(charName: string): string {
  const resolved = resolveClaudePrefillName(charName);
  if (resolved === null) return "";
  return resolved;
}
