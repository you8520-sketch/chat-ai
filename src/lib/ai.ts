import { ROLLING_SUMMARY_INTERVAL } from "@/lib/hybridMemory";
import {
  clampSummary,
  demoTurnSummary,
} from "@/lib/chatMemory";
import { estimateTokens } from "@/lib/tokenEstimate";
import { callOpenRouterCompletion } from "@/lib/openRouterCompletion";
import type { ProviderCostLedgerContext } from "@/lib/providerCostLedger";
import {
  CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_LEGACY_MODEL,
  CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_MODEL,
  CHEAPER_INFERENCE_GPT_56_LUNA_MODEL,
  OPENROUTER_DEEPSEEK_V3_MODEL,
  OPENROUTER_DEEPSEEK_V4_FLASH_0731_BACKUP_MODEL,
  OPENROUTER_DEEPSEEK_V4_FLASH_MODEL,
  OPENROUTER_GEMINI_31_FLASH_MODEL,
  isCheaperInferenceModel,
  normalizeDeepSeekV4FlashModelId,
} from "@/lib/chatModels";
import { resolveAssetVisionPrimaryModel } from "@/lib/assetVisionModels";
import {
  GeminiTrafficOverloadError,
  GEMINI_TRAFFIC_OVERLOAD_MESSAGE,
} from "@/lib/geminiTrafficError";
export {
  GeminiTrafficOverloadError,
  GEMINI_TRAFFIC_OVERLOAD_MESSAGE,
  isTrafficOverloadSystemMessage,
  sendTrafficOverloadGracefulStream,
} from "@/lib/geminiTrafficError";
import { formatClientApiError } from "@/lib/apiErrors";
import {
  HTML_FLASH_MAX_OUTPUT_TOKENS,
  HTML_ONLY_TURN_MAX_INPUT_TOKENS,
} from "@/lib/htmlVisualCardRecovery";

export type ChatMsg = { role: "user" | "assistant"; content: string };
export type Route = "safe" | "nsfw";
export type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
  estimated: boolean;
  finishReason?: string;
  thoughtsTokens?: number;
  cachedContentTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  standardInputTokens?: number;
  upstreamCostUsd?: number;
  cheaperInferenceBilledCostUsd?: number;
  cacheDiscountUsd?: number;
  cachePaddingTokens?: number;
  billableInputTokens?: number;
  apiReportedInputTokens?: number;
  /** OpenRouter completion_tokens_details.reasoning_tokens */
  reasoningOutputTokens?: number;
  /** Provider reporting-presence evidence (parallel to numeric buckets). */
  usageReportingEvidence?: import("@/lib/usageReportingEvidence").UsageReportingEvidence;
  /** Dev-only — raw OpenRouter usage payload for diagnostics */
  debugRawUsage?: unknown;
  /** Provider-reported model id from stream/completion payload (when present) */
  responseModelId?: string;
  /** Provider request id from response headers (when present) */
  providerRequestId?: string;
  /** Merged status-widget extract — physical calls with CI billed USD. Admin receipt only. */
  syncExtractCiBilledCallCount?: number;
  /** Merged status-widget extract — total physical calls represented (nested-safe). */
  syncExtractPhysicalCallCount?: number;
};

/** 백그라운드 기억·요약·상태창·번역 등 — Cheaper Inference GPT-5.6 Luna */
export const BACKGROUND_MAX_INPUT_TOKENS = 12_000;
/** 5턴 요약 원문 + 기억 추출 system 전체 (12k는 ~13k 대화에서 system 지시 잘림) — env로 상향 가능 */
export const BACKGROUND_MEMORY_EXTRACT_MAX_INPUT_TOKENS_DEFAULT = 48_000;

export function resolveBackgroundMemoryExtractMaxInputTokens(): number {
  const raw = process.env.BACKGROUND_MEMORY_EXTRACT_MAX_INPUT_TOKENS?.trim();
  if (!raw) return BACKGROUND_MEMORY_EXTRACT_MAX_INPUT_TOKENS_DEFAULT;
  const n = Number(raw);
  if (Number.isFinite(n) && n >= 16_000) return Math.floor(n);
  return BACKGROUND_MEMORY_EXTRACT_MAX_INPUT_TOKENS_DEFAULT;
}

const HISTORICAL_BACKGROUND_PRIMARY_DEEPSEEK_ALIASES = new Set([
  CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_MODEL.toLowerCase(),
  CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_LEGACY_MODEL.toLowerCase(),
  OPENROUTER_DEEPSEEK_V4_FLASH_MODEL.toLowerCase(),
  OPENROUTER_DEEPSEEK_V4_FLASH_0731_BACKUP_MODEL.toLowerCase(),
  OPENROUTER_DEEPSEEK_V3_MODEL.toLowerCase(),
]);

/** Known stale Railway / env aliases that used to mean "background text primary". */
export function isHistoricalBackgroundPrimaryDeepSeekAlias(
  modelId?: string | null
): boolean {
  const trimmed = modelId?.trim();
  if (!trimmed) return false;
  return HISTORICAL_BACKGROUND_PRIMARY_DEEPSEEK_ALIASES.has(trimmed.toLowerCase());
}

/**
 * Explicit model id only. Does not migrate historical Flash primary aliases to Luna.
 * Empty → Luna. Legacy V3 slug → CI DeepSeek V4 Flash (existing explicit compatibility).
 */
export function resolveBackgroundTextModelId(modelId?: string | null): string {
  const trimmed = modelId?.trim();
  if (!trimmed) return CHEAPER_INFERENCE_GPT_56_LUNA_MODEL;
  if (trimmed.toLowerCase() === OPENROUTER_DEEPSEEK_V3_MODEL.toLowerCase()) {
    return CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_MODEL;
  }
  return normalizeDeepSeekV4FlashModelId(trimmed);
}

/**
 * Background TEXT primary only. Migrates unset / legacy V3 / historical Flash
 * primary env values to GPT-5.6 Luna so Railway stale BACKGROUND_MEMORY_MODEL
 * cannot pin DeepSeek as primary after deploy.
 */
export function resolveBackgroundPrimaryModelId(
  modelId?: string | null
): string {
  const trimmed = modelId?.trim();
  if (!trimmed || isHistoricalBackgroundPrimaryDeepSeekAlias(trimmed)) {
    return CHEAPER_INFERENCE_GPT_56_LUNA_MODEL;
  }
  return resolveBackgroundTextModelId(trimmed);
}

export const BACKGROUND_OPENROUTER_MODEL = resolveBackgroundPrimaryModelId(
  process.env.BACKGROUND_MEMORY_MODEL
);

/**
 * Creative OOC HTML primary — task-specific owner (default Luna).
 * Does not inherit BACKGROUND_MEMORY_MODEL when unset.
 */
export function resolveBackgroundCreativeHtmlPrimaryModelId(
  env: NodeJS.ProcessEnv = process.env
): string {
  const raw = env.BACKGROUND_CREATIVE_HTML_MODEL?.trim();
  if (!raw) return CHEAPER_INFERENCE_GPT_56_LUNA_MODEL;
  return resolveBackgroundTextModelId(raw);
}

export const BACKGROUND_CREATIVE_HTML_MODEL = resolveBackgroundCreativeHtmlPrimaryModelId();

const HISTORICAL_BACKGROUND_FALLBACK_DEEPSEEK_ALIASES = new Set([
  OPENROUTER_DEEPSEEK_V3_MODEL.toLowerCase(),
  OPENROUTER_DEEPSEEK_V4_FLASH_MODEL.toLowerCase(),
  OPENROUTER_DEEPSEEK_V4_FLASH_0731_BACKUP_MODEL.toLowerCase(),
  CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_MODEL.toLowerCase(),
  CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_LEGACY_MODEL.toLowerCase(),
]);

function isHistoricalBackgroundFallbackDeepSeekAlias(modelId?: string | null): boolean {
  const trimmed = modelId?.trim();
  if (!trimmed) return false;
  return HISTORICAL_BACKGROUND_FALLBACK_DEEPSEEK_ALIASES.has(trimmed.toLowerCase());
}

function resolveBackgroundMemoryFallbackCandidate(
  env: NodeJS.ProcessEnv
): string {
  const raw = env.BACKGROUND_MEMORY_FALLBACK_MODEL;
  if (raw == null) return OPENROUTER_GEMINI_31_FLASH_MODEL;
  const rawTrimmed = String(raw).trim();
  if (!rawTrimmed) return OPENROUTER_GEMINI_31_FLASH_MODEL;
  if (isHistoricalBackgroundFallbackDeepSeekAlias(rawTrimmed)) {
    return OPENROUTER_GEMINI_31_FLASH_MODEL;
  }
  return resolveBackgroundTextModelId(rawTrimmed);
}

/**
 * Optional cross-model fallback after primary background calls fail.
 * No live production callers — kept for env/docs/tests compatibility.
 * Explicit fallback ids keep their vendor. Stale DeepSeek aliases migrate to
 * OpenRouter Gemini 3.1 Flash-Lite. Never returns the same resolved model as
 * primary; when the canonical candidate would collide, returns null.
 */
export function resolveBackgroundMemoryFallbackModel(
  env: NodeJS.ProcessEnv = process.env,
  primaryModelId: string = BACKGROUND_OPENROUTER_MODEL
): string | null {
  const primaryNorm = primaryModelId.trim().toLowerCase();
  const raw = env.BACKGROUND_MEMORY_FALLBACK_MODEL;
  const rawTrimmed = raw == null ? "" : String(raw).trim();
  const isExplicitEnv =
    rawTrimmed.length > 0 && !isHistoricalBackgroundFallbackDeepSeekAlias(rawTrimmed);

  if (isExplicitEnv) {
    const explicit = resolveBackgroundTextModelId(rawTrimmed);
    if (explicit.trim().toLowerCase() === primaryNorm) {
      const canonical = OPENROUTER_GEMINI_31_FLASH_MODEL;
      return canonical.trim().toLowerCase() === primaryNorm ? null : canonical;
    }
    return explicit;
  }

  const candidate = resolveBackgroundMemoryFallbackCandidate(env);
  if (candidate.trim().toLowerCase() === primaryNorm) return null;
  return candidate;
}

/** 백그라운드 비전 1차 — 이미지 검열·에셋 태그 (실패 시 Qwen3-VL-8B Instruct) */
export const BACKGROUND_VISION_OPENROUTER_MODEL = resolveAssetVisionPrimaryModel();
/** @deprecated BACKGROUND_OPENROUTER_MODEL 사용 */
export const DRAFT_FLASH_MODEL = BACKGROUND_OPENROUTER_MODEL;
/** @deprecated BACKGROUND_OPENROUTER_MODEL 사용 */
export const GEMINI_MODEL = BACKGROUND_OPENROUTER_MODEL;

function trimBackgroundPayload(
  system: string,
  history: ChatMsg[],
  maxInputTokens: number,
  opts?: { freezeSystem?: boolean }
): { system: string; history: ChatMsg[] } {
  let sys = system.trim();
  let hist = history.filter((m) => m.content?.trim());

  const totalTokens = () =>
    estimateTokens(sys) + hist.reduce((sum, m) => sum + estimateTokens(m.content), 0);

  if (opts?.freezeSystem && hist.length >= 1) {
    const userIdx = hist.length - 1;
    let content = hist[userIdx]!.content;
    if (estimateTokens(sys) + estimateTokens(content) > maxInputTokens) {
      const userTokens = estimateTokens(content);
      const sysBudget = Math.max(
        512,
        maxInputTokens - Math.min(userTokens, maxInputTokens - 640) - 32
      );
      while (estimateTokens(sys) > sysBudget && sys.length > 200) {
        sys = sys.slice(0, Math.floor(sys.length * 0.92));
      }
    }
    const userBudget = Math.max(1024, maxInputTokens - estimateTokens(sys) - 32);
    while (estimateTokens(content) > userBudget && content.length > 400) {
      content = content.slice(0, Math.floor(content.length * 0.92));
    }
    if (!content.trim()) {
      content = hist[userIdx]!.content.trim().slice(0, 2000) || "[context truncated]";
    }
    return { system: sys, history: [{ ...hist[userIdx]!, content }] };
  }

  // Drop oldest turns first — never remove the sole remaining message (OpenRouter needs user last).
  while (hist.length > 1 && totalTokens() > maxInputTokens) {
    hist.shift();
  }

  if (totalTokens() > maxInputTokens && sys.length > 0) {
    const histTokens = hist.reduce((sum, m) => sum + estimateTokens(m.content), 0);
    const sysBudget = Math.max(512, maxInputTokens - histTokens);
    while (estimateTokens(sys) > sysBudget && sys.length > 200) {
      sys = sys.slice(0, Math.floor(sys.length * 0.92));
    }
  }

  if (totalTokens() > maxInputTokens && hist.length > 0) {
    const lastIdx = hist.length - 1;
    const fixedTokens =
      estimateTokens(sys) +
      hist.slice(0, lastIdx).reduce((sum, m) => sum + estimateTokens(m.content), 0);
    const lastBudget = Math.max(512, maxInputTokens - fixedTokens);
    let lastContent = hist[lastIdx]!.content;
    while (estimateTokens(lastContent) > lastBudget && lastContent.length > 200) {
      lastContent = lastContent.slice(0, Math.floor(lastContent.length * 0.92));
    }
    hist = [...hist.slice(0, lastIdx), { ...hist[lastIdx]!, content: lastContent }];
  }

  if (hist.length === 0 && history.some((m) => m.content?.trim())) {
    const fallback = [...history].reverse().find((m) => m.content?.trim());
    if (fallback) {
      hist = [{ role: fallback.role, content: fallback.content.trim().slice(0, 4000) }];
    }
  }
  if (hist.length > 0 && !hist[hist.length - 1]!.content.trim()) {
    const lastIdx = hist.length - 1;
    hist = [
      ...hist.slice(0, lastIdx),
      { ...hist[lastIdx]!, content: "[context truncated]" },
    ];
  }

  return { system: sys, history: hist };
}

/** Translation-only caps. Never used for RP main max_tokens. */
export const PROMPT_TRANSLATION_REQUEST_KIND = "background-prompt-translation";
export const TRANSLATION_MAX_INPUT_TOKENS = 20_000;
export const TRANSLATION_MAX_OUTPUT_TOKENS = 15_000;

export function resolveBackgroundMaxInputTokens(requestKind: string): number {
  if (/background-html-visual-card/i.test(requestKind)) {
    return HTML_ONLY_TURN_MAX_INPUT_TOKENS;
  }
  if (/background-memory-extract/i.test(requestKind)) {
    return resolveBackgroundMemoryExtractMaxInputTokens();
  }
  // Scene briefs must read the full selected turn, which can exceed 5k chars.
  if (/background-chat-image-scene-brief/i.test(requestKind)) return 48_000;
  if (/background-prompt-translation/i.test(requestKind)) {
    return TRANSLATION_MAX_INPUT_TOKENS;
  }
  return BACKGROUND_MAX_INPUT_TOKENS;
}

export function resolveBackgroundMaxOutputTokens(requestKind: string): number {
  if (/background-lorebook-compact/i.test(requestKind)) return 3500;
  // V4 Flash reports internal reasoning inside completion_tokens, so leave
  // enough room for the requested structured result after thinking.
  if (/background-status-meta-extract/i.test(requestKind)) return 1536;
  if (/background-post-turn-shared-initial/i.test(requestKind)) return 4096;
  if (/background-suggested-replies-extract/i.test(requestKind)) return 1024;
  if (/background-status-widget-extract/i.test(requestKind)) return 3072;
  if (/background-html-visual-card/i.test(requestKind)) return HTML_FLASH_MAX_OUTPUT_TOKENS;
  if (/background-prompt-translation/i.test(requestKind)) return TRANSLATION_MAX_OUTPUT_TOKENS;
  return 3072;
}

export type StageUsage = {
  stage: string;
  model: string;
  input: number;
  output: number;
  estimated: boolean;
  finishReason?: string;
  truncated?: boolean;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  standardInputTokens?: number;
  upstreamCostUsd?: number;
  cheaperInferenceBilledCostUsd?: number;
  cacheDiscountUsd?: number;
  apiReportedInputTokens?: number;
  cachePaddingTokens?: number;
  cachedContentTokens?: number;
  thoughtsTokens?: number;
  apiOutputTokens?: number;
  /** OpenRouter reasoning_tokens 합산 (표시 RP 제외) */
  apiReasoningOutputTokens?: number;
  /** Provider reporting-presence evidence (parallel to numeric buckets). */
  usageReportingEvidence?: import("@/lib/usageReportingEvidence").UsageReportingEvidence;
  lengthRecoveryPasses?: number;
  savedOutputChars?: number;
  loopAborted?: boolean;
  degenerationAborted?: boolean;
  /** Provider request id captured from response headers/body (when present). */
  providerRequestId?: string;
  /** Provider-reported model id from the response payload (when present). */
  responseModelId?: string;
};

export { estimateTokens } from "@/lib/tokenEstimate";

export class SafetyBlockError extends Error {}

/** 검열·안전 필터 감지 */
export function isGeminiSafetyBlockError(e: unknown): boolean {
  if (e instanceof SafetyBlockError) return true;
  const msg = (e as Error).message ?? String(e);
  if (
    /SAFETY|SAFETY_BLOCK|blockReason|PROHIBITED_CONTENT|RECITATION|CONTENT_FILTER|BLOCKLIST|blocked due to/i.test(
      msg
    )
  ) {
    return true;
  }
  if (/400|INVALID_ARGUMENT/i.test(msg) && /safety|blocked|filter|harm|prohibited/i.test(msg)) {
    return true;
  }
  if (/응답이 비어.*finishReason=SAFETY/i.test(msg)) return true;
  return false;
}

async function callGeminiOnce(
  system: string,
  history: ChatMsg[],
  modelId: string,
  opts?: {
    requestKind?: string;
    maxTokens?: number;
    temperature?: number;
    ledgerContext?: ProviderCostLedgerContext;
    jobId?: string | null;
  }
): Promise<{ text: string; usage: TokenUsage }> {
  if (
    isCheaperInferenceModel(modelId)
      ? !process.env.CHEAPER_INFERENCE_API_KEY?.trim()
      : !process.env.OPENROUTER_API_KEY?.trim()
  ) {
    throw new Error(
      isCheaperInferenceModel(modelId)
        ? "NO_CHEAPER_INFERENCE_KEY"
        : "NO_OPENROUTER_KEY"
    );
  }
  const requestKind = opts?.requestKind ?? "generateContent";
  const unboundedNoReasoningRequest =
    /background-memory|background-lorebook-compact|background-status-meta-extract|background-suggested-replies-extract|background-status-widget-extract/i.test(
      requestKind
    );
  let effectiveSystem = system;
  let effectiveHistory = history;
  if (
    !unboundedNoReasoningRequest &&
    (modelId === BACKGROUND_OPENROUTER_MODEL || /^background-/i.test(requestKind))
  ) {
    const trimmed = trimBackgroundPayload(
      system,
      history,
      resolveBackgroundMaxInputTokens(requestKind),
      {
        freezeSystem:
          /background-memory-extract|background-html-visual-card/i.test(requestKind),
      }
    );
    effectiveSystem = trimmed.system;
    effectiveHistory = trimmed.history;
  }
  if (process.env.NODE_ENV !== "production" && /background-memory|background-lorebook-compact|background-status-meta-extract|background-suggested-replies-extract|background-status-widget-extract/i.test(requestKind)) {
    console.log("[background-memory] compatible API request", {
      model: modelId,
      provider: isCheaperInferenceModel(modelId)
        ? "cheaperinference"
        : "openrouter",
      requestKind,
      messages: effectiveHistory.length + 1,
      inputTokensEst:
        estimateTokens(effectiveSystem) +
        effectiveHistory.reduce((s, m) => s + estimateTokens(m.content), 0),
    });
  }
  return callOpenRouterCompletion({
    system: effectiveSystem,
    history: effectiveHistory,
    model: modelId,
    temperature: opts?.temperature ?? 0.3,
    maxTokens: unboundedNoReasoningRequest
      ? null
      : opts?.maxTokens ?? resolveBackgroundMaxOutputTokens(requestKind),
    disableReasoning: unboundedNoReasoningRequest,
    requestKind,
    timeoutMs: /background-html-visual-card/i.test(requestKind) ? 240_000 : undefined,
    ledgerContext: opts?.ledgerContext,
    jobId: opts?.jobId ?? null,
  });
}

export async function callGemini(
  system: string,
  history: ChatMsg[],
  modelId = BACKGROUND_OPENROUTER_MODEL
): Promise<{ text: string; usage: TokenUsage }> {
  return callGeminiOnce(system, history, modelId, { requestKind: "generateContent" });
}

/** KO→EN character-layer translation — bounded output, not RP max_tokens. */
export async function callPromptTranslation(
  system: string,
  history: ChatMsg[],
  modelId: string,
  opts?: { jobId?: string | null }
): Promise<{ text: string; usage: TokenUsage }> {
  return callGeminiOnce(system, history, modelId, {
    requestKind: PROMPT_TRANSLATION_REQUEST_KIND,
    maxTokens: TRANSLATION_MAX_OUTPUT_TOKENS,
    jobId: opts?.jobId ?? null,
  });
}

/** 긴 텍스트를 타이핑 효과용으로 잘라 스트리밍 */
export function* chunkText(text: string, size = 24): Generator<string> {
  for (let i = 0; i < text.length; i += size) {
    yield text.slice(i, i + size);
  }
}

/** 백그라운드 기억·요약·압축 — primary BACKGROUND_MEMORY_MODEL (default GPT-5.6 Luna) */
export async function callBackgroundMemory(
  system: string,
  history: ChatMsg[],
  _turnTrace?: import("@/lib/geminiRequestTrace").GeminiTurnTrace,
  requestKind = "background-memory-extract",
  opts?: {
    maxTokens?: number;
    temperature?: number;
    modelId?: string;
    ledgerContext?: ProviderCostLedgerContext;
    jobId?: string | null;
  }
): Promise<{ text: string; usage: TokenUsage }> {
  const explicitModelId = opts?.modelId?.trim();
  const modelId = explicitModelId
    ? resolveBackgroundTextModelId(explicitModelId)
    : BACKGROUND_OPENROUTER_MODEL;
  const call = (targetModelId: string) =>
    callGeminiOnce(system, history, targetModelId, {
      requestKind,
      maxTokens: opts?.maxTokens ?? resolveBackgroundMaxOutputTokens(requestKind),
      temperature: opts?.temperature,
      jobId: opts?.jobId ?? null,
      ledgerContext: opts?.ledgerContext
        ? {
            ...opts.ledgerContext,
            requestedModel: opts.ledgerContext.requestedModel || targetModelId,
          }
        : undefined,
    });
  return call(modelId);
}

export async function generateReply(opts: {
  system: string;
  history: ChatMsg[];
  route: Route;
  geminiModel?: string;
}): Promise<{ text: string; model: string; route: Route; usage: TokenUsage }> {
  const { system, history, route, geminiModel } = opts;
  const modelId = geminiModel ?? BACKGROUND_OPENROUTER_MODEL;
  try {
    const { text, usage } = await callGemini(system, history, modelId);
    return { text, model: modelId, route, usage };
  } catch (e) {
    if ((e as Error).message === "NO_OPENROUTER_KEY") {
      const text =
        "(데모 응답 · OpenRouter API 키가 설정되지 않았습니다)\n\n.env.local에 OPENROUTER_API_KEY를 설정해 주세요.";
      return {
        text,
        model: "demo",
        route,
        usage: {
          inputTokens: estimateTokens(system + history.map((m) => m.content).join("")),
          outputTokens: estimateTokens(text),
          estimated: true,
        },
      };
    }
    throw e;
  }
}

export function friendlyPipelineError(e: unknown, step: string): string {
  const msg = (e as Error).message ?? String(e);
  if (/^\d{3}\s+\S/.test(msg)) return msg;
  if (msg === "NO_OPENROUTER_KEY" || msg === "NO_KEY") {
    return formatClientApiError(e, "OpenRouter API key missing");
  }
  if (/prepayment credits are depleted|RESOURCE_EXHAUSTED|insufficient.*credit/i.test(msg)) {
    return "OpenRouter 크레딧이 부족합니다. OpenRouter 대시보드에서 크레딧을 충전한 뒤 다시 시도해 주세요.";
  }
  if (e instanceof GeminiTrafficOverloadError) {
    return e.userMessage;
  }
  if (/503|UNAVAILABLE|high demand|experiencing high demand/i.test(msg)) {
    return GEMINI_TRAFFIC_OVERLOAD_MESSAGE;
  }
  if (/429|rate.?limit|quota/i.test(msg)) {
    return GEMINI_TRAFFIC_OVERLOAD_MESSAGE;
  }
  if (/401|403|API key not valid|PERMISSION_DENIED|invalid.*key/i.test(msg)) {
    return "OpenRouter API 키가 유효하지 않습니다. .env.local의 OPENROUTER_API_KEY를 확인해 주세요.";
  }
  if (/404|NOT_FOUND|model.*not found|is not supported|No endpoints found/i.test(msg)) {
    return "요청한 AI 모델을 사용할 수 없습니다. 다른 모델을 선택하거나 잠시 후 다시 시도해 주세요.";
  }
  if (/Context Limit Exceeded by Loop Bug/i.test(msg)) {
    return "컨텍스트가 비정상적으로 커져 요청이 차단되었습니다. 새 채팅을 시작하거나 잠시 후 다시 시도해 주세요.";
  }
  if (/\[turn-api-budget\]/i.test(msg)) {
    return "응답 생성 재시도 한도에 도달했습니다. 이번 턴은 부분 응답으로 저장됩니다.";
  }
  if (/응답이 비어|empty completion|MAX_TOKENS|thoughtsToken/i.test(msg)) {
    return "AI가 빈 응답을 반환했습니다. 다른 모델을 선택한 뒤 다시 시도해 주세요.";
  }
  if (/DEADLINE|deadline exceeded|AbortError|aborted due to timeout/i.test(msg)) {
    return "AI 응답 시간이 초과되었습니다. 잠시 후 다시 시도해 주세요.";
  }
  if (/502|504|timeout|ECONNRESET|fetch failed/i.test(msg)) {
    return "AI 서버가 일시적으로 응답하지 않습니다. 잠시 후 다시 시도해 주세요.";
  }
  console.error(`[AI] ${step} 실패:`, msg);
  return `${step} 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.`;
}

// ---------- 기억력 강화 (장기 기억 요약) ----------
export async function summarizeMemory(
  prevMemory: string,
  oldMessages: ChatMsg[],
  route: Route,
  maxChars = 2000
): Promise<string> {
  const system = `너는 롤플레잉 대화의 장기 기억 관리자다. 기존 기억과 새 대화를 통합해 핵심 사실(중요 대사, 감정 변화, 사건, 관계, 약속)을 한국어 불릿(-) 목록으로 요약하라. 반드시 ${maxChars}자 이내.`;
  const history: ChatMsg[] = [
    {
      role: "user",
      content: `[기존 기억]\n${prevMemory || "(없음)"}\n\n[새 대화]\n${oldMessages
        .map((m) => `${m.role === "user" ? "유저" : "캐릭터"}: ${m.content}`)
        .join("\n")}\n\n위 내용을 통합 요약해줘.`,
    },
  ];
  try {
    const { text } = await callBackgroundMemory(system, history);
    return text.slice(0, maxChars);
  } catch {
    return prevMemory.slice(0, maxChars);
  }
}

/** 턴 1회 — 200자 요약 + durable relationship facts */
export async function analyzeTurnMemory(
  userMessage: string,
  assistantMessage: string,
  charName: string,
  route: Route
): Promise<{ turnSummary: string; meta: import("@/lib/chatMemory").RelationshipMetaDelta }> {
  const system = `너는 롤플레잉 대화 기록관이다. 이번 턴에서 중요 대사·감정 변화·사건만 추출하라.
turnSummary 형식: 서술형 문장 금지. 음슴체(-음/-ㅁ) 키워드 나열, · 구분, 200자 이내 완결 형태.
예: 유저 질문함 · 캐릭터 경계심→호기심 · "..." 대사 언급 · ○○ 사건 발생
순수 JSON만 출력:
{"turnSummary":"200자 이내 음슴체 키워드 요약","items":["\${userName}: 반지, 펜던트"],"promisesAdd":[{"text":"약속 내용","deadline":"기한"}],"promisesRemove":[]}
자동 추출 금지: 호칭/별명, NPC 생각, inner_thoughts, 감정 온도, 관계 단계, 애착/소유욕/복종 추정, 말투, 성별, 현재 장소.
없는 항목은 빈 배열. turnSummary는 반드시 200자 이내 완결 형태.`;
  const history: ChatMsg[] = [
    {
      role: "user",
      content: `캐릭터: ${charName}\n유저: ${userMessage}\n캐릭터: ${assistantMessage}`,
    },
  ];
  try {
    const { text } = await callBackgroundMemory(system, history);
    const trimmed = text.trim();
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
    const raw = fenced ? fenced[1].trim() : trimmed;
    const j = JSON.parse(raw) as {
      turnSummary?: string;
      items?: string[];
      thoughts?: string[];
      promisesAdd?: { text?: string; deadline?: string }[];
      promisesRemove?: string[];
    };
    return {
      turnSummary: clampSummary(j.turnSummary ?? ""),
      meta: {
        items: Array.isArray(j.items) ? j.items.filter(Boolean) : [],
        thoughts: [],
        promisesAdd: Array.isArray(j.promisesAdd)
          ? j.promisesAdd
              .map((p) => ({
                text: typeof p?.text === "string" ? p.text.trim() : "",
                deadline: typeof p?.deadline === "string" ? p.deadline.trim() : undefined,
              }))
              .filter((p) => p.text)
          : [],
        promisesRemove: Array.isArray(j.promisesRemove) ? j.promisesRemove.filter(Boolean) : [],
      },
    };
  } catch {
    return {
      turnSummary: demoTurnSummary(userMessage, assistantMessage, charName),
      meta: {},
    };
  }
}

/** 턴 1회 — 호칭·물건·속마음·약속 추출 (관계 메모 탭용) */
export type RelationshipMetaExtractResult = {
  delta: import("@/lib/chatMemory").RelationshipMetaDelta;
  parseOk: boolean;
};

/** 5턴 요약 → 장기 기억 병합 */
export async function mergeTurnSummariesToLongTerm(
  prevMemory: string,
  turnSummaries: string[],
  maxChars: number,
  route: Route
): Promise<string> {
  if (!turnSummaries.length) return prevMemory.slice(0, maxChars);
  const system = `너는 롤플레잉 장기 기억 편집자다. 기존 장기 기억과 새 턴 요약(${ROLLING_SUMMARY_INTERVAL}턴 분)을 통합해 중요 대사·감정·사건만 불릿(-) 목록으로 정리하라. 반드시 ${maxChars}자 이내.`;
  const history: ChatMsg[] = [
    {
      role: "user",
      content: `[기존 장기 기억]\n${prevMemory || "(없음)"}\n\n[새 턴 요약 ${turnSummaries.length}개]\n${turnSummaries.map((t, i) => `${i + 1}. ${t}`).join("\n")}\n\n통합 요약:`,
    },
  ];
  try {
    const { text } = await callBackgroundMemory(system, history);
    return text.slice(0, maxChars);
  } catch {
    const merged = [prevMemory, ...turnSummaries.map((t) => `- ${t}`)].filter(Boolean).join("\n");
    return merged.slice(0, maxChars);
  }
}

/** 한도 초과 시 압축 */
export async function compressLongTermMemory(
  memory: string,
  maxChars: number,
  route: Route
): Promise<string> {
  if (memory.length <= maxChars) return memory;
  const system = `너는 롤플레잉 장기 기억 압축기다. 아래 기억을 중요 대사·감정·사건·관계·호칭 위주로 재압축하라. 반드시 ${maxChars}자 이내 불릿 목록.`;
  const history: ChatMsg[] = [{ role: "user", content: memory }];
  try {
    const { text } = await callBackgroundMemory(system, history);
    return text.slice(0, maxChars);
  } catch {
    return memory.slice(0, maxChars);
  }
}

/** 장기 기억 강제 압축 (하이브리드 메모리) */
export async function compressLongTermWithFlash(memory: string, maxChars: number): Promise<string> {
  if (memory.length <= maxChars) return memory;
  const system = `너는 롤플레잉 장기 기억 압축기다. 아래 기억을 핵심 사건·감정·관계·호칭 위주로 재압축하라. 반드시 ${maxChars}자 이내 한국어 불릿(-) 목록.`;
  try {
    const { text } = await callBackgroundMemory(system, [{ role: "user", content: memory }]);
    return text.trim().slice(0, maxChars) || memory.slice(0, maxChars);
  } catch {
    return memory.slice(0, maxChars);
  }
}

/** 5턴 롤링 요약 */
export async function generateRollingSummary(opts: {
  existingSummary: string;
  recentDialogue: string;
  charName: string;
}): Promise<string> {
  const { ROLLING_SUMMARY_SYSTEM_PROMPT } = await import("@/lib/memory/memory-rolling-summary");
  const system = ROLLING_SUMMARY_SYSTEM_PROMPT;
  const userContent = `[기존 요약]
${opts.existingSummary.trim() || "(없음)"}

[최근 ${ROLLING_SUMMARY_INTERVAL}턴 대화]
${opts.recentDialogue}

캐릭터 이름: ${opts.charName}

위 ${ROLLING_SUMMARY_INTERVAL}턴을 150자 내외 3인칭 관찰자 요약 1문단으로 출력하세요. 기존 요약과 중복되지 않는 새 사건만 서술하세요.`;

  const { text } = await callBackgroundMemory(
    system,
    [{ role: "user", content: userContent }],
    undefined,
    "background-memory-rolling-summary"
  );
  return text.replace(/\s+/g, " ").trim();
}

/** @deprecated 롤링 요약(generateRollingSummary) 사용 */
export async function summarizeTurnBatch(
  turns: { user: string; assistant: string }[],
  charName: string,
  fromTurn: number,
  toTurn: number
): Promise<string> {
  const dialogue = turns
    .map(
      (t, i) =>
        `[${fromTurn + i}턴]\n유저: ${t.user}\n${charName}: ${t.assistant}`
    )
    .join("\n\n");
  const system = `너는 롤플레잉 대화 기록관이다. 아래 ${turns.length}턴(${fromTurn}~${toTurn}턴) 대화에서 핵심 사건·감정 변화·관계·약속만 300자 이내 한국어로 요약하라. 불릿(-) 또는 짧은 문단.`;
  try {
    const { text } = await callBackgroundMemory(
      system,
      [{ role: "user", content: dialogue }],
      undefined,
      "background-memory-rolling-summary"
    );
    return text.replace(/\s+/g, " ").trim().slice(0, 300);
  } catch {
    const fallback = turns
      .map((t) => `유저:${t.user.slice(0, 40)} → ${charName}:${t.assistant.slice(0, 60)}`)
      .join(" / ");
    return fallback.slice(0, 300);
  }
}
