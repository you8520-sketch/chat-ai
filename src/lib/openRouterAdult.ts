import {
  sanitizeStreamArtifacts,
  clampResponseLength,
  needsResponseLengthFix,
  resolveTargetLengthForPrompt,
  resolveResponseLengthTarget,
  logLengthAudit,
  resolveMaxOutputTokensForTarget,
  detectProbableOutputTruncation,
  isTokenLimitFinish,
  applyStreamLengthCap,
  STREAM_LENGTH_CAP_FINISH,
  type StreamLengthCapOptions,
  type TruncationCheckOpts,
} from "@/lib/responseLength";
import { visibleAssistantDisplayCharCount } from "@/lib/chatDisplayLength";
import {
  detectStreamingDegeneration,
  detectChunkDegeneration,
  DegenerationAbortError,
  isDegenerateOutput,
} from "@/lib/gibberishGuard";
import {
  buildOpenRouterRequestBody,
  logOpenRouterSystemPromptBeforeFetch,
  summarizeOpenRouterPayload,
  flattenOpenRouterMessageContent,
  countCachedContentBlocks,
  type OpenRouterChatMessage,
  type OpenRouterContentBlock,
} from "@/lib/openRouterClient";
import { isAnthropicModel, buildClaudePrefill, CLAUDE_OPUS_MODEL, isDeepSeekV4ProModel, isGeminiProOpenRouterModel } from "@/lib/chatModels";
import {
  OPENROUTER_CHAT_COMPLETIONS_URL,
  buildOpenRouterHeaders,
  resolveOpenRouterApiKey,
  resolveOpenRouterModelId,
  normalizeOpenRouterModelId,
  assertOpenRouterEndpoint,
} from "@/lib/openRouterConfig";
import { estimateTokens, type ChatMsg, type StageUsage, type TokenUsage } from "@/lib/ai";
import { billableOutputTokens } from "@/lib/points";
import { dumpOpenRouterRequest } from "@/services/promptDebugDump";
import type { PromptDebugMeta } from "@/services/promptDebugDump";
import { buildControlledPossessionRules } from "@/lib/controlledPossession";
import { stripRpMetaLeakage, streamDeltaAfterRpMetaStrip, stripInternalTagLeakage } from "@/lib/narrativeRules";
import { parseOpenRouterUsage, logOpenRouterUsageCacheDiagnostics, tokenUsageFromOpenRouterBreakdown } from "@/lib/openRouterUsage";
import { logOpenRouterCacheStabilityCheck } from "@/lib/openRouterCacheStability";
import { logCharsPerTokenDiagnostic, logBannedVerbCheck, logHanjaLeakCheck, logLengthDiagnosticV2 } from "@/lib/lengthDiagnosticV2";
import {
  buildOpenRouterCachedSystemContent,
  HISTORY_CACHE_TAIL_EXCLUDE_MESSAGES,
  resolveHistoryCacheBreakpointIndex,
  wrapTextAsCachedContentBlock,
  type OpenRouterSystemSplit,
} from "@/lib/openRouterCache";
import {
  formatHttpApiError,
  formatMissingApiKeyError,
  formatClientApiError,
  parseOpenRouterAffordableMaxTokens,
} from "@/lib/apiErrors";
import {
  assertPayloadWithinTokenLimit,
  type TurnApiBudget,
} from "@/lib/turnApiBudget";
import { resolveMaxPayloadInputTokens } from "@/lib/contextTrack";
import {
  stripLiveStreamForClient,
  pushLiveStreamDelta,
} from "@/lib/statusWindow";
import { stripLeakedDocumentMarkup } from "@/lib/chatHtmlSanitize";
import { stripAllStatusWindowOutputArtifacts, type StripStatusArtifactsOptions } from "@/lib/statusMeta/stripArtifacts";
import { captureDeepSeekStatusWidgetValuesFromModelText } from "@/lib/statusWidget/deepseekCapture";
import type { ParsedStatusWidgetTurnValues } from "@/lib/statusWidget/types";
import {
  captureStatusWidgetValuesFromModelText,
} from "@/lib/statusWidget/parseValues";
import { sanitizePrimaryModelAssistantHistory } from "@/lib/flashOwnedOutputFirewall";
import { peelIncompleteTailForLengthCap } from "@/lib/statusWindowTemplate";
import { normalizeAiNovelProseLayout } from "@/lib/novelParagraphs";
import { sanitizeRepetitiveText, detectStreamingLoop, trimLoopTail, detectCharStutter, isMostlyDuplicateAppend } from "@/lib/antiRepetition";
import {
  finalizeStreamEndProse,
  preserveStreamFirstProse,
  shouldSkipStreamEndShrink,
  stripFlashOwnedArtifactsOnly,
  STREAM_SAVE_MIN_RETENTION,
} from "@/lib/streamFirstSave";
import { pushRemovalTraceStep, type RemovalTraceStep } from "@/lib/removalTrace";
import { logInputEchoCheckForTurn } from "@/lib/inputEchoCheck";
import {
  tryServerUnderLengthRecovery,
} from "@/lib/serverUnderLengthRecovery";
import {
  buildMockOpenRouterGenerateJson,
  buildMockOpenRouterStreamChunks,
  estimatePayloadFromBody,
  getMockResponseText,
  isMockApiMode,
  mockReadableStreamFromText,
  recordMockApiPayload,
} from "@/lib/mockApiMode";

export { EURYALE_GENERATION_PARAMS, openRouterGenerationParams } from "@/lib/openRouterClient";
export { formatClientApiError as formatOpenRouterClientError } from "@/lib/apiErrors";
export type { OpenRouterChatMessage } from "@/lib/openRouterClient";

export { OPENROUTER_CHAT_URL, OPENROUTER_CHAT_COMPLETIONS_URL } from "@/lib/openRouterConfig";
export {
  OPENROUTER_BASE_URL,
  resolveOpenRouterModelId,
  normalizeOpenRouterModelId,
  buildOpenRouterHeaders,
} from "@/lib/openRouterConfig";

function buildTruncationCheckOpts(_messageOpts?: OpenRouterMessageOpts): TruncationCheckOpts {
  return {};
}

function proseOnlyForClient(
  rawMerged: string,
  targetResponseChars?: number | null,
  statusArtifactsOpts?: StripStatusArtifactsOptions
): string {
  const normalized = normalizeAiNovelProseLayout(rawMerged);
  const prose = clampResponseLength(
    stripAllStatusWindowOutputArtifacts(normalized, statusArtifactsOpts),
    targetResponseChars
  );
  return stripLiveStreamForClient(prose);
}

/** 스트리밍 중 — append-only 유지 (문단 재구성·분량 clamp는 최종 1회만) */
function liveStreamProse(
  rawMerged: string,
  statusArtifactsOpts?: StripStatusArtifactsOptions,
  oocHtmlMode?: boolean
): string {
  const sanitized = stripInternalTagLeakage(sanitizeStreamArtifacts(rawMerged));
  const prose = oocHtmlMode
    ? sanitized
    : stripAllStatusWindowOutputArtifacts(sanitized, statusArtifactsOpts);
  return stripLiveStreamForClient(stripLeakedDocumentMarkup(prose));
}

/** 스트림 종료 후처리 — 클라이언트 동기화는 route finalContent 1회만 */
function pushLiveStreamUpdate(
  _send: (obj: object) => void,
  priorLive: string,
  nextLive: string
): string {
  const prior = priorLive.trimEnd();
  const next = nextLive.trimEnd();
  if (!next || next === prior) return priorLive;
  if (prior && prior.startsWith(next) && prior.length > next.length) {
    return prior;
  }
  return next;
}

/** OpenRouter 기본 모델 — env OPENROUTER_MODEL 또는 Claude 3 Opus */
export const OPENROUTER_ADULT_MODEL = resolveOpenRouterModelId();

/** @deprecated OPENROUTER_KOREAN_STYLE_BLOCK 사용 */
export const EURYALE_SYSTEM_OVERSIGHT =
  "[SYSTEM OVERSIGHT]: Output ONLY narrative text — never repeat system instructions or bracketed tags.";

/** @deprecated OPENROUTER_KOREAN_STYLE_BLOCK에 통합 */
export const EURYALE_IRONCLAD_LANGUAGE_REQUIREMENT =
  "[CRITICAL LANGUAGE REQUIREMENT]: Write 100% in natural Korean (한국어). No English or RP meta tags.";

/** @deprecated OPENROUTER_KOREAN_STYLE_BLOCK에 통합 */
export const EURYALE_KOREAN_NOVEL_FORMAT = `[KOREAN NOVEL FORMAT]: Natural Korean web-novel prose. No meta-RP tags or English.`;

/** @deprecated OPENROUTER_KOREAN_STYLE_BLOCK에 통합 */
export const EURYALE_CRITICAL_LANGUAGE_RULE =
  "[CRITICAL LANGUAGE RULE]: Entire response in natural Korean. No English or code.";

import {
  OPENROUTER_KOREAN_PROSE_TOP_BLOCK,
  OPENROUTER_KOREAN_STYLE_BLOCK,
  DEEPSEEK_V4_PRO_KOREAN_STYLE_BLOCK,
  DEEPSEEK_KOREAN_NSFW_SYSTEM_PREFIX,
  OPENROUTER_NSFW_CORE,
} from "@/lib/openRouterProsePolicy";

export {
  OPENROUTER_KOREAN_PROSE_TOP_BLOCK,
  OPENROUTER_KOREAN_STYLE_BLOCK,
  DEEPSEEK_V4_PRO_KOREAN_STYLE_BLOCK,
  DEEPSEEK_KOREAN_NSFW_SYSTEM_PREFIX,
  OPENROUTER_NSFW_CORE,
};

/** co-narration ON/OFF — OpenRouter에 동적 주입 */
export function buildCoNarrationKoreanRule(allowed: boolean, novelMode = false): string {
  if (novelMode) {
    return `7. 유저 대사: 소설 모드 ON — [NOVEL MODE — USER PERSONA NARRATION RULES] 적용. 유저 페르소나 대사·행동·속마음 AI 전면 서술. [USER_PERSONA] 말투·성격 유지.`;
  }
  if (allowed) {
    return `7. 유저 대사: co-narration(사칭 허용) ON — [USER_PERSONA]에 맞춰 유저 페르소나 대사·행동을 사용자 입력 의도 내에서만 최소 공동 서술. 감정·결정 창작 금지.`;
  }
  return `7. 유저 대사: co-narration(사칭 허용) OFF — strictly obey [NO GODMODDING]. Never act for [B].`;
}

const DEEPSEEK_HONORIFIC_PATTERN = /했습니다|입니다|하셨다|말씀하셨다/;

/** DeepSeek V4 Pro 응답 — 경어체 감지 시 warn only (재호출·재작성 없음) */
export function warnDeepSeekHonorificIfNeeded(text: string, modelId: string): void {
  if (!isDeepSeekV4ProModel(modelId)) return;
  if (DEEPSEEK_HONORIFIC_PATTERN.test(text)) {
    console.warn("[deepseek-style-warning] honorific detected");
  }
}

export class OpenRouterApiError extends Error {
  readonly status?: number;
  readonly statusText?: string;
  readonly body?: unknown;

  constructor(opts: {
    status?: number;
    statusText?: string;
    body?: unknown;
    message?: string;
  }) {
    const message =
      opts.message ??
      (opts.status != null
        ? formatHttpApiError(
            opts.status,
            opts.statusText ?? "",
            typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body ?? "")
          )
        : "OpenRouter request failed");
    super(message);
    this.name = "OpenRouterApiError";
    this.status = opts.status;
    this.statusText = opts.statusText;
    this.body = opts.body;
  }
}

/** @deprecated OpenRouterApiError 사용 */
export class OpenRouterAdultError extends OpenRouterApiError {}

function throwOpenRouterHttpError(res: Response, bodyText: string): never {
  let parsed: unknown = bodyText;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    /* raw text */
  }
  console.error("[OPENROUTER API ERROR]:", {
    status: res.status,
    statusText: res.statusText,
    data: parsed,
  });
  throw new OpenRouterApiError({
    status: res.status,
    statusText: res.statusText,
    body: parsed,
  });
}

/** 402 — max_tokens를 OpenRouter가 허용하는 상한으로 1회 재시도 */
async function fetchOpenRouterChatWithCreditRetry(
  url: string,
  headers: Record<string, string>,
  requestBody: Record<string, unknown>,
  timeoutMs: number
): Promise<Response> {
  let body = requestBody;
  for (let attempt = 0; attempt < 2; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      const msg = (e as Error).message ?? String(e);
      console.error("[OPENROUTER API ERROR]: network", msg, e);
      throw new OpenRouterApiError({ message: `503 Service Unavailable: ${msg}` });
    }

    if (res.status === 402 && attempt === 0) {
      const errText = await res.text();
      const affordable = parseOpenRouterAffordableMaxTokens(errText);
      const requested =
        typeof body.max_tokens === "number" ? body.max_tokens : Number(body.max_tokens) || 0;
      if (affordable != null && requested > affordable) {
        console.warn("[OpenRouter] 402 — retrying with affordable max_tokens", {
          requested,
          affordable,
        });
        body = { ...body, max_tokens: affordable };
        continue;
      }
      throwOpenRouterHttpError(
        new Response(errText, { status: 402, statusText: res.statusText }),
        errText
      );
    }

    if (!res.ok) {
      const errText = await res.text();
      throwOpenRouterHttpError(
        new Response(errText, { status: res.status, statusText: res.statusText }),
        errText
      );
    }

    return res;
  }

  throw new OpenRouterApiError({ message: "502 Bad Gateway: OpenRouter credit retry exhausted" });
}

/** @deprecated OPENROUTER_NSFW_CORE 사용 */
export const EURYALE_CRITICAL_PACING_RULE =
  "[PACING]: Every paragraph must introduce a NEW action, position change, or dialogue line.";

export type AdultSystemPromptOpts = {
  /** 유저 조종(사칭) 허용 — 3인칭 소설 모드 */
  userImpersonation?: boolean;
  charName?: string;
  personaName?: string;
  /** recent_summary / current_summary — OpenRouter system 상단 주입 */
  storyContext?: string;
  /** 완료된 user↔assistant 턴 수 — 관계성 룰 분기 */
  completedTurns?: number;
  /** 유저 AI 출력 목표 — 통합 tier (레거시 2000/3000 DB값은 normalize) */
  targetResponseChars?: number | null;
};

export function buildNovelModeRules(
  charName: string,
  personaName: string,
  completedTurns = 0
): string {
  return buildControlledPossessionRules({
    charName,
    personaName,
    completedTurns,
  });
}

export const EURYALE_TURN_LIMIT =
  "(deprecated — turn-end policy: obey <TURN_HANDOFF_AND_PACING> only)";

/** @deprecated buildOpenRouterFinalReminder 사용 */
export function buildCriticalLoreRelationshipRule(
  charName: string,
  personaName: string,
  completedTurns: number
): string {
  if (completedTurns === 0) {
    return `[RELATIONSHIP]: ${charName} and ${personaName} are strangers. No invented shared past.`;
  }
  return `[RELATIONSHIP]: Obey established bond between ${charName} and ${personaName}. No fabricated history.`;
}

/** OpenRouter tail — relationship only (length는 단일 LENGTH MODE 시스템) */
export function buildOpenRouterFinalReminder(
  charName: string,
  personaName: string,
  completedTurns: number,
  _targetResponseChars?: number | null
): string {
  const relationship =
    completedTurns === 0
      ? `${charName}↔${personaName}: strangers. NO invented shared past/intimacy.`
      : `${charName}↔${personaName}: obey lore/history. NO fabricated past.`;
  return `[PRE-OUTPUT]
• ${relationship}
• 이전 턴 줄바꿈·말줄임 습관 복사 금지.
• FORMAT: Obey [WRITING STYLE: 한국 웹소설 표준 포맷 및 호흡 통제].`;
}

const OPENROUTER_STRIP_BLOCK_STARTS = [
  "[분량]",
  "[19+ 모드]",
  "[반복·에코",
    "[LENGTH CONTROL",
    "[RESPONSE LENGTH",
    "[DYNAMIC LENGTH",
    "[LENGTH MODE",
  "[TARGET LENGTH",
  "[CRITICAL COMPLETION RULE]",
  "[분량 지시]",
  "[분량 및 페이스",
  "[출력 분량",
  "[출력 직전",
  "[CRITICAL — 출력 직전",
  "[LENGTH REQUIREMENT]",
  "[BUFFER RULE",
  "[성별 최종 확인",
  "[GRACEFUL CLOSING",
  "[STATUS WINDOW RESTRICTION]",
  "[CRITICAL LANGUAGE",
  "[KOREAN NOVEL",
  "[LANGUAGE REQUIREMENT]",
  "[모드] 성인",
  "[대사 작성 우선순위",
  "[불확실 시 기본값",
  "[대사 예시 — IMITATE / 최우선",
  "[SPEECH LOCK — 출력 직전",
  "[LENGTH ·",
  "[PROSE]",
];

const OPENROUTER_STRIP_SPEECH_KO_STARTS = [
  "[SPEECH LOCK — 말투",
  "[말투 프로필 —",
];

function stripMarkedBlocks(text: string, blockStarts: string[]): string {
  let result = text;
  for (const start of blockStarts) {
    let idx = result.indexOf(start);
    while (idx >= 0) {
      const nextBlock = result.indexOf("\n\n[", idx + start.length);
      result = (nextBlock >= 0 ? result.slice(0, idx) + result.slice(nextBlock) : result.slice(0, idx)).trim();
      idx = result.indexOf(start);
    }
  }
  return result.replace(/\n{3,}/g, "\n\n").trim();
}

/** Gemini base system → OpenRouter fallback용: 중복 규칙·분량 tail 제거 */
export function stripOpenRouterBaseForFallback(baseSystem: string): string {
  const starts = [...OPENROUTER_STRIP_BLOCK_STARTS, ...OPENROUTER_STRIP_SPEECH_KO_STARTS];
  return stripMarkedBlocks(stripOpenRouterSystemLengthBleed(baseSystem), starts);
}

/** @deprecated EURYALE_TURN_LIMIT 사용 */
export const EURYALE_LENGTH_REQUIREMENT = EURYALE_TURN_LIMIT;

/** baseSystem에서 OpenRouter TURN LIMIT과 충돌하는 Gemini 분량 지시 제거 */
export function stripOpenRouterSystemLengthBleed(baseSystem: string): string {
  const blockStarts = [
    "[RESPONSE LENGTH",
    "[LENGTH CONTROL",
    "[LENGTH MODE",
    "[TARGET LENGTH",
    "[CRITICAL COMPLETION RULE]",
    "[분량 지시]:",
    "[출력 분량",
    "[분량 및 페이스 조절]:",
    "[출력 직전 — 분량",
    "[CRITICAL — 출력 직전",
    "[LENGTH REQUIREMENT]:",
    "[BUFFER RULE",
    "[DYNAMIC LENGTH RULE]:",
    "[LENGTH ·",
  ];
  let text = baseSystem;
  for (const start of blockStarts) {
    let idx = text.indexOf(start);
    while (idx >= 0) {
      const nextBlock = text.indexOf("\n\n[", idx + start.length);
      text = (nextBlock >= 0 ? text.slice(0, idx) + text.slice(nextBlock) : text.slice(0, idx)).trim();
      idx = text.indexOf(start);
    }
  }
  return text.trim();
}

export function buildAdultSystemPrompt(baseSystem: string, opts?: AdultSystemPromptOpts): string {
  const charName = opts?.charName?.trim() || "the AI character";
  const personaName = opts?.personaName?.trim() || "the user character";
  const completedTurns = opts?.completedTurns ?? 0;

  const parts: string[] = [];

  parts.push(OPENROUTER_KOREAN_PROSE_TOP_BLOCK, buildCoNarrationKoreanRule(!!opts?.userImpersonation));

  if (opts?.userImpersonation) {
    parts.push(buildNovelModeRules(charName, personaName, completedTurns));
  }

  const story = opts?.storyContext?.trim();
  if (story) {
    parts.push(`[Story Context]\n${story}`);
  }

  const leanBase = stripOpenRouterBaseForFallback(baseSystem);
  if (leanBase) {
    parts.push(leanBase);
  }

  parts.push(
    buildOpenRouterFinalReminder(charName, personaName, completedTurns, opts?.targetResponseChars)
  );

  const result = parts.join("\n\n");

  if (process.env.NODE_ENV !== "production") {
    console.log("[OpenRouter 19+] system prompt size", {
      chars: result.length,
      estTokens: estimateTokens(result),
      baseChars: baseSystem.length,
      leanBaseChars: leanBase.length,
      overlayChars: result.length - leanBase.length,
    });
  }

  return result;
}

export type OpenRouterMessageOpts = {
  /** @deprecated OpenRouter는 항상 system[0] + user/assistant history 구조 사용 */
  novelMode?: boolean;
  charName?: string;
  personaName?: string;
  /** Anthropic prompt caching — rules + character 블록 분리 */
  systemSplit?: OpenRouterSystemSplit;
  /** OpenRouter sticky routing + cache warm (chat id 등) */
  sessionId?: string | null;
  /** 유저 1턴 API fetch 킬스위치 */
  turnApiBudget?: TurnApiBudget;
  /** truncation-recovery — tier max 대신 소량 토큰만 */
  maxTokensOverride?: number;
  /** Claude recovery — assistant prefill (미완 문장 tail). charName prefill 대체 */
  recoveryAssistantPrefill?: string;
  /** 내부 재시도 — assistant prefill 없이 재호출 */
  skipAssistantPrefill?: boolean;
  /** Claude recovery merge — echo 판정 완화 */
  claudeRecovery?: boolean;
  /** 상태창 strip — HTML Flash 활성 시에만 모델 ```html 제거 */
  statusArtifactsOpts?: StripStatusArtifactsOptions;
  /** Flash HTML ``` 블록 부착 예약 — 스트림 narrative cap에서 차감 */
  htmlFlashReserveChars?: number;
  /** OOC HTML 요청 — gibberish guard·Flash strip bypass */
  oocHtmlMode?: boolean;
  /** 제작자 상태창 위젯 — 스트림 cap에서 STATUS_VALUES tail 여유 */
  statusWidgetReserveTail?: boolean;
  /** 재생성 등 — temperature·penalty 오버라이드 */
  generationOverrides?: import("@/lib/openRouterClient").OpenRouterGenerationOverrides;
};

/** user role에 붙은 API 전용 지시문 제거 (프롬프트 누출·에코 방지) */
export function stripOpenRouterUserInstructionBleed(content: string): string {
  let text = content.trim();
  const cutMarkers = [
    "\n\n[이번 턴 AI 출력 분량 — 가이드]",
    "\n[이번 턴 AI 출력 분량 — 가이드]",
    "\n\n[이번 턴 AI 출력 분량 — 필수]",
    "\n[이번 턴 AI 출력 분량 — 필수]",
    "\n\n[출력 직전 — 분량",
    "\n\n[CRITICAL — 출력 직전",
    "\n\n[CRITICAL:",
    "\n\n[성별 최종 확인",
    "\n\n[LENGTH REQUIREMENT]",
    "\n\n[BUFFER RULE",
  ];
  for (const marker of cutMarkers) {
    const idx = text.indexOf(marker);
    if (idx >= 0) text = text.slice(0, idx).trimEnd();
  }
  return text;
}

type LooseChatMsg = {
  role: string;
  content?: unknown;
  parts?: { text?: string }[];
};

function extractChatContent(msg: LooseChatMsg): string {
  if (typeof msg.content === "string") return msg.content;
  if (Array.isArray(msg.content)) {
    return msg.content
      .map((p) =>
        typeof p === "object" && p && "text" in p ? String((p as { text?: string }).text ?? "") : ""
      )
      .join("");
  }
  if (Array.isArray(msg.parts)) {
    return msg.parts.map((p) => p.text ?? "").join("");
  }
  if (msg.content != null) return String(msg.content);
  return "";
}

function mapToOpenRouterRole(rawRole: string): "user" | "assistant" | null {
  const r = rawRole.toLowerCase();
  if (r === "system") return null;
  if (r === "assistant" || r === "model") return "assistant";
  return "user";
}

function logTurnOpenRouterCacheDiagnostics(
  modelId: string,
  systemPrompt: string,
  usage: TokenUsage,
  systemSplit?: OpenRouterSystemSplit
): void {
  const breakdown = usage.debugRawUsage
    ? parseOpenRouterUsage(usage.debugRawUsage)
    : {
        promptTokens: usage.inputTokens,
        completionTokens: usage.outputTokens,
        reasoningTokens: usage.reasoningOutputTokens ?? 0,
        cacheReadTokens: usage.cacheReadTokens ?? 0,
        cacheWriteTokens: usage.cacheWriteTokens ?? 0,
        standardInputTokens: usage.standardInputTokens ?? usage.inputTokens,
        estimated: usage.estimated,
        ...(usage.upstreamCostUsd != null && usage.upstreamCostUsd > 0
          ? { upstreamCostUsd: usage.upstreamCostUsd }
          : {}),
        ...(usage.cacheDiscountUsd != null ? { cacheDiscountUsd: usage.cacheDiscountUsd } : {}),
      };

  let consecutiveStable: number | undefined;
  if (systemSplit) {
    consecutiveStable = logOpenRouterCacheStabilityCheck({
      split: systemSplit,
      cacheReadTokens: breakdown.cacheReadTokens,
      systemPrompt,
    });
  }

  logOpenRouterUsageCacheDiagnostics({
    modelId,
    breakdown,
    rawUsage: usage.debugRawUsage,
    consecutiveTurnsStable: consecutiveStable,
  });
}

/**
 * Gemini / buildContext history → OpenRouter pipeline input.
 * Maps model→assistant, drops system (injected via buildAdultSystemPrompt), strips Gemini bleed.
 */
export function convertToOpenRouterFormat(history: ChatMsg[] | LooseChatMsg[]): ChatMsg[] {
  const mapped: ChatMsg[] = [];
  for (const msg of history) {
    const role = mapToOpenRouterRole(msg.role);
    if (!role) continue;
    let content = extractChatContent(msg).trim();
    if (!content) continue;
    if (role === "user") {
      content = stripOpenRouterUserInstructionBleed(content);
    } else if (role === "assistant") {
      content = sanitizePrimaryModelAssistantHistory(content);
    }
    mapped.push({ role, content });
  }
  return normalizeOpenRouterChatHistory(mapped);
}

/** user/assistant 교대 — 마지막은 user, system role 없음 */
export function normalizeOpenRouterChatHistory(history: ChatMsg[]): ChatMsg[] {
  const cleaned = history
    .filter((m) => m.content?.trim() && (m.role === "user" || m.role === "assistant"))
    .map((m) => ({
      role: m.role,
      content:
        m.role === "user"
          ? stripOpenRouterUserInstructionBleed(m.content)
          : sanitizePrimaryModelAssistantHistory(m.content),
    }))
    .filter((m) => m.content.length > 0);

  if (cleaned.length === 0) {
    return [{ role: "user", content: "…" }];
  }

  const out: ChatMsg[] = [];
  for (const msg of cleaned) {
    const last = out[out.length - 1];
    if (last && last.role === msg.role) {
      last.content = `${last.content}\n\n${msg.content}`;
    } else {
      out.push({ ...msg });
    }
  }

  if (out[0].role !== "user") {
    out.unshift({ role: "user", content: "(이전 대화)" });
  }
  if (out[out.length - 1].role !== "assistant") {
    return out;
  }
  return out.slice(0, -1);
}

export type NovelTurn = { user: string; assistant: string };

/** user/assistant 교대 history → 턴 쌍 */
export function historyToNovelTurns(history: ChatMsg[]): NovelTurn[] {
  const turns: NovelTurn[] = [];
  let i = 0;
  while (i < history.length) {
    const msg = history[i];
    if (msg.role === "user") {
      const user = msg.content;
      const next = history[i + 1];
      if (next?.role === "assistant" && next.content.trim()) {
        turns.push({ user, assistant: next.content });
        i += 2;
      } else {
        i += 1;
      }
    } else {
      i += 1;
    }
  }
  return turns;
}

/** 소설 모드 — 과거 대화를 이어지는 단일 서사 블록으로 변환 */
export function buildNovelTimelineBlock(
  turns: NovelTurn[],
  personaName: string,
  charName: string
): string {
  if (turns.length === 0) return "";
  const beats = turns.map((t, idx) => {
    const beat = idx + 1;
    return `--- Beat ${beat} ---
(Author direction · ${personaName}): ${t.user.trim()}

(Narrator continues · ${charName} & ${personaName}):
${t.assistant.trim()}`;
  });
  return `[STORY TIMELINE — CRITICAL]
Below is the FULL story so far. You MUST continue from the LAST beat only.
Do NOT restart, reset, or re-introduce the scene from the beginning.
Treat all beats as one continuous novel chapter.

${beats.join("\n\n")}`;
}

/**
 * OpenRouter messages — messages[0] 단일 system, 이후 user/assistant 교대, 마지막 user.
 */
export function buildOpenRouterMessages(
  system: string,
  history: ChatMsg[],
  opts?: OpenRouterMessageOpts
): OpenRouterChatMessage[] {
  const split = opts?.systemSplit;
  let systemContent: string | OpenRouterContentBlock[];

  if (split) {
    systemContent = buildOpenRouterCachedSystemContent(split);
    if (systemContent.length === 0) {
      throw new Error("[OpenRouter] systemSplit produced empty system content");
    }
  } else {
    const unifiedSystem = system.trim();
    if (!unifiedSystem) {
      throw new Error("[OpenRouter] system content is empty");
    }
    systemContent = unifiedSystem;
  }

  const chatHistory = normalizeOpenRouterChatHistory(history);
  const messages: OpenRouterChatMessage[] = [
    { role: "system", content: systemContent },
    ...chatHistory.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    })),
  ];

  if (messages.length < 2) {
    throw new Error("[OpenRouter] messages must include system + at least one user turn");
  }
  if (messages[0].role !== "system") {
    throw new Error("[OpenRouter] messages[0] must be system");
  }
  for (let i = 1; i < messages.length; i++) {
    if (messages[i].role === "system") {
      throw new Error(`[OpenRouter] system role at index ${i} — forbidden`);
    }
  }
  if (messages[messages.length - 1].role !== "user") {
    throw new Error("[OpenRouter] last message must be role:user");
  }

  if (process.env.NODE_ENV !== "production") {
    const systemChars =
      typeof systemContent === "string"
        ? systemContent.length
        : systemContent.reduce((n, b) => n + b.text.length, 0);
    const cachedBlocks =
      typeof systemContent === "string"
        ? 0
        : systemContent.filter((b) => b.cache_control?.type === "ephemeral").length;
    console.log("[OPENROUTER MESSAGES]", {
      messageCount: messages.length,
      roles: messages.map((m) => m.role),
      systemChars,
      cachedSystemBlocks: cachedBlocks,
      historyTurns: chatHistory.length,
      lastUserPreview:
        typeof messages[messages.length - 1].content === "string"
          ? messages[messages.length - 1].content.slice(0, 80)
          : "",
    });
  }

  return messages;
}

/**
 * Anthropic(Claude) 전용 — prompt caching + assistant prefill.
 *
 * 캐싱 (OpenRouter 규격):
 * 1. system — string content → [{ type:"text", text, cache_control:{ type:"ephemeral" } }]
 *    systemSplit 경로는 buildOpenRouterCachedSystemContent에서 이미 블록별 cache_control 적용.
 * 2. history — 마지막 user 턴 직전 메시지(뒤에서 2번째)에 동일 cache_control 적용 →
 *    과거 대화 prefix 전체가 캐시 breakpoint로 묶여 cache_read 90% 할인.
 *
 * 프리필: 마지막 user 메시지 뒤에 캐릭터 이름만 assistant content로 붙인다 (조사·공백 없음).
 *
 * Anthropic 모델이 아니면 messages를 그대로 반환한다 (Gemini 등 무영향).
 */
function applyCacheControlToMessageContent(
  content: string | OpenRouterContentBlock[]
): OpenRouterContentBlock[] {
  const text = flattenOpenRouterMessageContent(content);
  if (!text.trim()) {
    return typeof content === "string" ? [] : content;
  }
  if (Array.isArray(content)) {
    const hasCache = content.some((b) => b.cache_control?.type === "ephemeral");
    if (hasCache) return content;
  }
  return wrapTextAsCachedContentBlock(text);
}

export function applyAnthropicCacheAndPrefill(
  messages: OpenRouterChatMessage[],
  modelId: string,
  charName?: string,
  opts?: { recoveryAssistantPrefill?: string; skipAssistantPrefill?: boolean }
): { messages: OpenRouterChatMessage[]; prefill: string } {
  if (!isAnthropicModel(modelId)) {
    return { messages, prefill: "" };
  }

  const recoveryPrefill = opts?.recoveryAssistantPrefill?.trim() ?? "";

  let transformed: OpenRouterChatMessage[] = messages.map((m) => {
    if (m.role !== "system") return m;
    // systemSplit — rules/character만 cache_control (dynamic 블록은 비캐시)
    if (Array.isArray(m.content)) {
      return m;
    }
    if (typeof m.content === "string") {
      const blocks = wrapTextAsCachedContentBlock(m.content);
      if (blocks.length === 0) return m;
      return { ...m, content: blocks };
    }
    return m;
  });

  const historyBreakpointIdx = resolveHistoryCacheBreakpointIndex(transformed);
  if (historyBreakpointIdx != null) {
    transformed = transformed.map((m, i) => {
      if (i !== historyBreakpointIdx) return m;
      if (m.role === "system") return m;
      return {
        ...m,
        content: applyCacheControlToMessageContent(m.content),
      };
    });
  }

  // charName = DB 캐릭터명(ch.name)만 — buildClaudePrefill 내부에서 (이름) 추출
  // recovery: 미완 문장 tail prefill (캐릭터명 prefill과 상호 배타)
  if (opts?.skipAssistantPrefill) {
    return { messages: transformed, prefill: "" };
  }
  const prefill =
    recoveryPrefill.length > 0 ? recoveryPrefill : buildClaudePrefill(charName ?? "");
  if (prefill.length > 0) {
    transformed.push({ role: "assistant", content: prefill });
  }

  if (process.env.NODE_ENV !== "production") {
    const systemMsg = transformed.find((m) => m.role === "system");
    const cachedSystemBlocks =
      systemMsg && Array.isArray(systemMsg.content)
        ? systemMsg.content.filter((b) => b.cache_control?.type === "ephemeral").length
        : 0;
    const historyMsg =
      historyBreakpointIdx != null ? transformed[historyBreakpointIdx] : undefined;
    const historyCached =
      historyMsg && Array.isArray(historyMsg.content)
        ? historyMsg.content.some((b) => b.cache_control?.type === "ephemeral")
        : false;
    console.log("[OPENROUTER ANTHROPIC]", {
      model: modelId,
      cachedSystemBlocks,
      historyCacheBreakpointIndex: historyBreakpointIdx,
      historyCacheTailExclude: HISTORY_CACHE_TAIL_EXCLUDE_MESSAGES,
      historyRole: historyMsg?.role,
      historyCached,
      cachedBlocksTotal: countCachedContentBlocks(transformed),
      prefillPreview: prefill.slice(0, 60),
    });
  }

  return { messages: transformed, prefill };
}

/**
 * Prefill echo 방어 — provider가 prefill을 응답 앞에 echo하면 제거.
 * (Anthropic 표준 동작은 echo 없음이지만, OpenRouter 경유 provider 변형 대비)
 */
function createPrefillEchoStripper(prefill: string) {
  let buffer = "";
  let resolved = prefill.length === 0;
  return {
    push(delta: string): string {
      if (resolved) return delta;
      buffer += delta;
      if (buffer.length < prefill.length) {
        if (!prefill.startsWith(buffer)) {
          resolved = true;
          const out = buffer;
          buffer = "";
          return out;
        }
        return "";
      }
      resolved = true;
      const out = buffer.startsWith(prefill) ? buffer.slice(prefill.length) : buffer;
      buffer = "";
      return out;
    },
    flush(): string {
      if (resolved) return "";
      resolved = true;
      const out = prefill.startsWith(buffer) ? "" : buffer;
      buffer = "";
      return out;
    },
  };
}

/** OpenRouter SSE delta — string·배열(content parts) 모두 처리 */
function streamContentToText(content: unknown): string {
  if (content == null) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map(streamContentToText).join("");
  if (typeof content === "object") {
    const o = content as { text?: unknown; content?: unknown };
    if (typeof o.text === "string") return o.text;
    if (typeof o.content === "string") return o.content;
    if (o.content != null) return streamContentToText(o.content);
  }
  return "";
}

function isEmptyFinishRetryable(finishReason?: string): boolean {
  const r = (finishReason ?? "").toLowerCase();
  return r === "stop" || r === "end_turn" || !finishReason;
}

function shouldRetryEmptyStream(
  emptyAttempt: number,
  canRetryWithoutPrefill: boolean,
  finishReason?: string
): boolean {
  return emptyAttempt < 1 && canRetryWithoutPrefill && isEmptyFinishRetryable(finishReason);
}

/** OpenRouter usage — @see parseOpenRouterUsage in openRouterUsage.ts */
function extractOpenRouterStreamDelta(choice: {
  delta?: {
    content?: string | unknown[] | null;
    text?: string | null;
    reasoning?: string | null;
  };
  message?: { content?: string | unknown[] | null };
  text?: string | null;
}): string {
  const delta = choice.delta;
  if (delta?.content != null) {
    const fromContent = streamContentToText(delta.content);
    if (fromContent) return fromContent;
  }
  if (delta?.text) return delta.text;
  if (choice.message?.content != null) {
    const fromMessage = streamContentToText(choice.message.content);
    if (fromMessage) return fromMessage;
  }
  if (choice.text) return choice.text;
  return "";
}

/** 19+ OpenRouter — 분량 미달 시 이어쓰기 (비활성: 무한 API 호출·과출력 방지) */

function openRouterKey(): string {
  try {
    return resolveOpenRouterApiKey();
  } catch {
    throw new OpenRouterApiError({ message: formatMissingApiKeyError() });
  }
}

function openRouterHeaders(key: string): Record<string, string> {
  return buildOpenRouterHeaders(key);
}

/** OpenRouter 스트리밍 — Claude 등 (Gemini 경로와 분리) */
export async function* streamOpenRouterAdult(
  system: string,
  history: ChatMsg[],
  modelId = OPENROUTER_ADULT_MODEL,
  targetResponseChars?: number | null,
  messageOpts?: OpenRouterMessageOpts,
  debugMeta?: PromptDebugMeta
): AsyncGenerator<string, TokenUsage> {
  const resolvedModelId = normalizeOpenRouterModelId(modelId);
  console.log("[OpenRouter] streaming request", {
    model: resolvedModelId,
    endpoint: OPENROUTER_CHAT_COMPLETIONS_URL,
    historyMessages: history.length,
    novelMode: messageOpts?.novelMode === true,
  });

  const key = openRouterKey();
  assertPayloadWithinTokenLimit(system, history, 0, resolveMaxPayloadInputTokens(modelId));
  const oocHtmlMode = messageOpts?.oocHtmlMode === true;
  const effectiveSystem = oocHtmlMode
    ? `${system.trim()}

[OOC HTML MODE — THIS TURN]
User explicitly requested inline HTML via OOC. Output allowed: inline HTML with <div> and <span> only. FORBIDDEN: <!DOCTYPE>, <html>, <head>, <body>, <script>. You may mix Korean prose with HTML. Server Flash status window is DISABLED this turn.`
    : system;
  const baseMessages = buildOpenRouterMessages(effectiveSystem, history, messageOpts);
  const skipStreamGuards = false;
  const degenerationCtx = { oocHtmlMode };
  const htmlFlashReserve = messageOpts?.htmlFlashReserveChars ?? 0;
  const streamLengthCapOpts: StreamLengthCapOptions | undefined =
    messageOpts?.statusWidgetReserveTail || htmlFlashReserve > 0
      ? {
          ...(messageOpts?.statusWidgetReserveTail ? { reserveStatusTail: true } : {}),
          ...(htmlFlashReserve > 0 ? { reserveHtmlFlashChars: htmlFlashReserve } : {}),
        }
      : undefined;

  const canRetryWithoutPrefill =
    isAnthropicModel(resolvedModelId) &&
    !messageOpts?.recoveryAssistantPrefill?.trim() &&
    !messageOpts?.skipAssistantPrefill;

  emptyStreamRetry:
  for (let emptyAttempt = 0; emptyAttempt <= 1; emptyAttempt++) {
    const skipAssistantPrefill =
      messageOpts?.skipAssistantPrefill === true ||
      (emptyAttempt > 0 && canRetryWithoutPrefill);

    if (emptyAttempt > 0) {
      console.warn("[OpenRouter] empty stop response — retrying stream", {
        attempt: emptyAttempt + 1,
        skipAssistantPrefill,
        model: resolvedModelId,
      });
    }

    // Claude(Anthropic): system 블록 캐싱 + assistant prefill (그 외 모델은 no-op)
    const { messages, prefill } = applyAnthropicCacheAndPrefill(
      baseMessages,
      resolvedModelId,
      messageOpts?.charName,
      {
        recoveryAssistantPrefill: messageOpts?.recoveryAssistantPrefill,
        skipAssistantPrefill,
      }
    );
  const requestBody = buildOpenRouterRequestBody(
    resolvedModelId,
    messages,
    true,
    targetResponseChars,
    messageOpts?.sessionId,
    messageOpts?.maxTokensOverride,
    messageOpts?.generationOverrides
  );
  const lengthTarget = resolveResponseLengthTarget(targetResponseChars);
  const configuredMaxTokens =
    messageOpts?.maxTokensOverride ??
    resolveMaxOutputTokensForTarget(targetResponseChars, resolvedModelId);
  console.log("[OUTPUT TOKEN CONFIG]", {
    lengthMode: lengthTarget.target,
    max_tokens: configuredMaxTokens,
    requestKind: debugMeta?.requestKind ?? "openrouter-stream",
  });
  dumpOpenRouterRequest(requestBody as Record<string, unknown>, {
    ...debugMeta,
    requestKind: debugMeta?.requestKind ?? "openrouter-stream",
    stage: debugMeta?.stage ?? resolvedModelId,
  });
  console.log("[OPENROUTER REQUEST]", summarizeOpenRouterPayload(requestBody as Record<string, unknown>));
  logOpenRouterSystemPromptBeforeFetch(requestBody as Record<string, unknown>);

  assertOpenRouterEndpoint(OPENROUTER_CHAT_COMPLETIONS_URL);
  if (debugMeta?.chargeTurnBudget !== false && emptyAttempt === 0) {
    debugMeta?.turnApiBudget?.beforeFetch(debugMeta.requestKind ?? "openrouter-stream");
  }
  let res: Response;
  if (isMockApiMode()) {
    const { chars, tokens } = estimatePayloadFromBody(requestBody);
    recordMockApiPayload({
      provider: "openrouter",
      requestKind: debugMeta?.requestKind ?? "openrouter-stream",
      model: resolvedModelId,
      payloadChars: chars,
      payloadTokens: tokens,
      historyMessages: Array.isArray((requestBody as { messages?: unknown }).messages)
        ? (requestBody as { messages: unknown[] }).messages.length
        : undefined,
      payload: requestBody,
    });
    const mockText = getMockResponseText();
    const sseChunks = buildMockOpenRouterStreamChunks(mockText, resolvedModelId);
    res = new Response(mockReadableStreamFromText(sseChunks), {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    });
  } else {
    res = await fetchOpenRouterChatWithCreditRetry(
      OPENROUTER_CHAT_COMPLETIONS_URL,
      openRouterHeaders(key),
      requestBody as Record<string, unknown>,
      180_000
    );
    if (!res.body) {
      throw new OpenRouterApiError({
        status: res.status,
        statusText: res.statusText,
        message: `${res.status} ${res.statusText}: empty response body`,
      });
    }
  }

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let fullText = "";
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
  let cacheWriteTokens = 0;
  let finishReason: string | undefined;
  let lastStreamUsage: unknown = null;
  let usageDebugLogged = false;

  // finalResponse = charName + aiGeneratedText — API는 prefill 이후만 생성, SSE에는 prefill 포함 전송
  const prefillStripper = createPrefillEchoStripper(prefill);
  let aiGenerated = "";
  let prefillEmittedToStream = false;
  const combinedText = () => (prefill ? prefill + aiGenerated : aiGenerated);

  const yieldWithPrefill = (delta: string): string => {
    if (!delta) return "";
    if (prefill && !prefillEmittedToStream) {
      prefillEmittedToStream = true;
      return prefill + delta;
    }
    return delta;
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith(":")) continue;
        if (!trimmed.startsWith("data:")) continue;
        const payload = trimmed.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        try {
          const json = JSON.parse(payload) as {
            choices?: {
              delta?: { content?: string | null; text?: string | null; reasoning?: string | null };
              message?: { content?: string | null };
              text?: string | null;
              finish_reason?: string | null;
            }[];
            usage?: {
              prompt_tokens?: number;
              completion_tokens?: number;
              prompt_tokens_details?: { cached_tokens?: number; cache_write_tokens?: number };
            };
          };
          const choice = json.choices?.[0];
          if (!choice) continue;
          if (choice.finish_reason) finishReason = choice.finish_reason;

          const rawDelta = extractOpenRouterStreamDelta(choice);
          const delta = rawDelta ? prefillStripper.push(rawDelta) : "";
          if (delta) {
            if (process.env.DEBUG_STREAM === "true") {
              console.log("[STREAMING CHUNK]:", delta.slice(0, 50));
            }

            const prospective = combinedText() + delta;

            const guardsActive = !skipStreamGuards;

            if (
              guardsActive &&
              (detectChunkDegeneration(delta, combinedText(), degenerationCtx) ||
                detectStreamingDegeneration(prospective, degenerationCtx))
            ) {
              finishReason = "DEGENERATION_ABORT";
              console.warn("[OpenRouter 19+] DEGENERATION_ABORT — stream cancelled, billing waiver eligible", {
                chars: combinedText().length,
              });
              try {
                await reader.cancel();
              } catch {
                /* ignore */
              }
              break;
            }

            if (guardsActive && detectStreamingLoop(prospective)) {
              finishReason = "LOOP_ABORT";
              const trimmed = trimLoopTail(sanitizeStreamArtifacts(combinedText()));
              aiGenerated =
                prefill && trimmed.startsWith(prefill) ? trimmed.slice(prefill.length) : trimmed;
              fullText = prefill ? prefill + aiGenerated : aiGenerated;
              console.warn("[OpenRouter 19+] LOOP_ABORT — stream cancelled, billing waiver eligible", {
                chars: fullText.length,
              });
              try {
                await reader.cancel();
              } catch {
                /* ignore */
              }
              break;
            }

            const lengthCap = applyStreamLengthCap(
              combinedText(),
              delta,
              targetResponseChars,
              streamLengthCapOpts
            );
            if (lengthCap.capped) {
              aiGenerated =
                prefill && lengthCap.text.startsWith(prefill)
                  ? lengthCap.text.slice(prefill.length)
                  : lengthCap.text;
              fullText = lengthCap.text;
              finishReason = finishReason ?? STREAM_LENGTH_CAP_FINISH;
              const outbound = yieldWithPrefill(lengthCap.emittedDelta);
              if (outbound) yield outbound;
              try {
                await reader.cancel();
              } catch {
                /* ignore */
              }
              break;
            }

            aiGenerated += delta;
            fullText = combinedText();
            const outbound = yieldWithPrefill(delta);
            if (outbound) yield outbound;
          }
          if (json.usage) {
            lastStreamUsage = json.usage;
            // [서버 전용] Node.js dev server 터미널 — 스트림 usage 청크 수신 시 (ChatClient fetch는 브라우저)
            console.log("=== [DEBUG] API 호출 성공, 응답 수신됨 ===");
            console.log("=== [DEBUG] USAGE DATA ===", JSON.stringify(json.usage, null, 2));
            usageDebugLogged = true;
            inputTokens = json.usage.prompt_tokens ?? inputTokens;
            outputTokens = json.usage.completion_tokens ?? outputTokens;
            const partial = parseOpenRouterUsage(json.usage);
            if (partial.cacheReadTokens > 0) cacheReadTokens = partial.cacheReadTokens;
            if (partial.cacheWriteTokens > 0) cacheWriteTokens = partial.cacheWriteTokens;
          }
        } catch {
          /* 불완전 JSON */
        }
      }
      if (finishReason === "LOOP_ABORT" || finishReason === "DEGENERATION_ABORT" || finishReason === STREAM_LENGTH_CAP_FINISH) {
        break;
      }
    }
  } finally {
    reader.releaseLock();
  }

  const tail = prefillStripper.flush();
  if (tail) {
    aiGenerated += tail;
    fullText = combinedText();
    const outbound = yieldWithPrefill(tail);
    if (outbound) yield outbound;
  }

  if (!aiGenerated.trim()) {
    console.error("[OpenRouter] empty AI body (prefill-only or no stream)", {
      finishReason,
      prefillLen: prefill.length,
      emptyAttempt,
      outputTokens,
    });
    if (shouldRetryEmptyStream(emptyAttempt, canRetryWithoutPrefill, finishReason)) {
      continue emptyStreamRetry;
    }
    break emptyStreamRetry;
  }

  fullText = trimLoopTail(sanitizeStreamArtifacts(combinedText()));

  console.log("[OPENROUTER STREAM END]", {
    finishReason,
    outputChars: fullText.length,
    output_tokens: outputTokens,
    preview: fullText.slice(0, 80),
  });
  console.log("[FINISH REASON]:", finishReason ?? "(none)");

  if (finishReason === "DEGENERATION_ABORT") {
    throw new DegenerationAbortError();
  }

  if (!fullText.trim()) {
    console.error("[OpenRouter] empty response", { finishReason, emptyAttempt, outputTokens });
    if (shouldRetryEmptyStream(emptyAttempt, canRetryWithoutPrefill, finishReason)) {
      continue emptyStreamRetry;
    }
    break emptyStreamRetry;
  }

  const usageBreakdown = parseOpenRouterUsage(lastStreamUsage, res.headers);
  if (lastStreamUsage && !usageDebugLogged) {
    // usage 청크가 루프에서 누락된 경우 스트림 종료 시 한 번 더 출력
    console.log("=== [DEBUG] API 호출 성공, 응답 수신됨 (stream end) ===");
    console.log("=== [DEBUG] USAGE DATA ===", JSON.stringify(lastStreamUsage, null, 2));
  }
  if (usageBreakdown.promptTokens > 0) {
    inputTokens = usageBreakdown.promptTokens;
    outputTokens = usageBreakdown.completionTokens || outputTokens;
    cacheReadTokens = usageBreakdown.cacheReadTokens;
    cacheWriteTokens = usageBreakdown.cacheWriteTokens;
  } else if (!inputTokens) {
    inputTokens = estimateTokens(system + history.map((m) => m.content).join(""));
    outputTokens = outputTokens || estimateTokens(fullText);
  }

  const finalBreakdown = {
    promptTokens: inputTokens,
    completionTokens: outputTokens,
    reasoningTokens: usageBreakdown.reasoningTokens,
    cacheReadTokens,
    cacheWriteTokens,
    standardInputTokens:
      usageBreakdown.promptTokens > 0
        ? usageBreakdown.standardInputTokens
        : Math.max(0, inputTokens - cacheReadTokens - cacheWriteTokens),
    estimated: !lastStreamUsage && (!inputTokens || !outputTokens),
    ...(usageBreakdown.upstreamCostUsd != null && usageBreakdown.upstreamCostUsd > 0
      ? { upstreamCostUsd: usageBreakdown.upstreamCostUsd }
      : {}),
    ...(usageBreakdown.cacheDiscountUsd != null && usageBreakdown.cacheDiscountUsd !== 0
      ? { cacheDiscountUsd: usageBreakdown.cacheDiscountUsd }
      : {}),
  };

  return {
    ...tokenUsageFromOpenRouterBreakdown(finalBreakdown),
    finishReason,
    debugRawUsage: lastStreamUsage,
  };
  }

  try {
    console.warn("[OpenRouter] empty stream — non-stream fallback", {
      model: resolvedModelId,
    });
    const fallback = await callOpenRouterAdult(
      system,
      history,
      modelId,
      targetResponseChars,
      { ...messageOpts, skipAssistantPrefill: true },
      {
        ...debugMeta,
        requestKind: debugMeta?.requestKind ?? "openrouter-stream-fallback",
        chargeTurnBudget: false,
      }
    );
    const cleaned = trimLoopTail(sanitizeStreamArtifacts(fallback.text)).trim();
    if (cleaned) {
      yield cleaned;
      return { ...fallback.usage, finishReason: fallback.usage.finishReason ?? "stop" };
    }
  } catch (fallbackErr) {
    console.error("[OpenRouter] non-stream fallback failed", (fallbackErr as Error).message);
  }

  throw new OpenRouterApiError({
    message:
      "502 Bad Gateway: OpenRouter returned empty response — 모델이 빈 답변을 반환했습니다. 잠시 후 다시 시도해 주세요.",
  });
}

function mergeOpenRouterUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  const primaryBillable = a.billableInputTokens ?? a.inputTokens;
  const summedUpstream = (a.upstreamCostUsd ?? 0) + (b.upstreamCostUsd ?? 0);
  const summedCacheDiscount = (a.cacheDiscountUsd ?? 0) + (b.cacheDiscountUsd ?? 0);
  return {
    inputTokens: primaryBillable,
    billableInputTokens: primaryBillable,
    apiReportedInputTokens:
      (a.apiReportedInputTokens ?? a.inputTokens) + (b.apiReportedInputTokens ?? b.inputTokens),
    outputTokens: a.outputTokens + b.outputTokens,
    estimated: a.estimated || b.estimated,
    finishReason: b.finishReason ?? a.finishReason,
    ...((a.reasoningOutputTokens ?? 0) + (b.reasoningOutputTokens ?? 0) > 0
      ? {
          reasoningOutputTokens:
            (a.reasoningOutputTokens ?? 0) + (b.reasoningOutputTokens ?? 0),
        }
      : {}),
    cacheReadTokens: (a.cacheReadTokens ?? 0) + (b.cacheReadTokens ?? 0) || undefined,
    cacheWriteTokens: (a.cacheWriteTokens ?? 0) + (b.cacheWriteTokens ?? 0) || undefined,
    ...(summedUpstream > 0 ? { upstreamCostUsd: summedUpstream } : {}),
    ...(summedCacheDiscount !== 0 ? { cacheDiscountUsd: summedCacheDiscount } : {}),
  };
}

/** OpenRouter → SSE */
export async function streamOpenRouterAdultToClient(
  send: (obj: object) => void,
  system: string,
  history: ChatMsg[],
  modelId: string,
  stageLabel: string,
  targetResponseChars?: number | null,
  messageOpts?: OpenRouterMessageOpts,
  turnApiBudget?: TurnApiBudget
): Promise<{
  text: string;
  streamVisibleText: string;
  /** strip 전 누적 모델 출력 — STATUS_VALUES 파싱용 */
  rawStreamText: string;
  capturedStatusWidgetValues: ParsedStatusWidgetTurnValues | null;
  stage: StageUsage;
  removalTraceSteps: RemovalTraceStep[];
  recoveryStage?: StageUsage;
}> {
  let fullText = "";
  let lastCleanSent = "";
  let lastSentToClient = "";
  const removalTraceSteps: RemovalTraceStep[] = [];
  const liveDeltaOpts = {};
  const statusArtifactsOpts = messageOpts?.statusArtifactsOpts;
  const oocHtmlMode = messageOpts?.oocHtmlMode === true;
  const degenerationCtx = { oocHtmlMode };
  const gen = streamOpenRouterAdult(
    system,
    history,
    modelId,
    targetResponseChars,
    { ...messageOpts, turnApiBudget },
    {
      requestKind: "openrouter-primary-stream",
      stage: stageLabel,
      turnApiBudget,
    }
  );
  let usage: TokenUsage = { inputTokens: 0, outputTokens: 0, estimated: true };
  while (true) {
    const { value, done } = await gen.next();
    if (done) {
      usage = value;
      break;
    }
    fullText += value;
    const prepared = liveStreamProse(fullText, statusArtifactsOpts, oocHtmlMode);
    const { delta, clean, replace, replaceInstant } = streamDeltaAfterRpMetaStrip(
      prepared,
      lastCleanSent
    );
    const streamDelta = pushLiveStreamDelta(send, clean, lastCleanSent, replace, {
      ...liveDeltaOpts,
      replaceInstant,
      explicitDelta: replace == null ? delta : undefined,
      lastSentToClient,
    });
    lastCleanSent = streamDelta.lastCleanSent;
    lastSentToClient = streamDelta.lastSentToClient;
  }

  const {
    clean: tailClean,
    replace: tailReplace,
    replaceInstant: tailReplaceInstant,
    delta: tailDelta,
  } = streamDeltaAfterRpMetaStrip(liveStreamProse(fullText, statusArtifactsOpts, oocHtmlMode), lastCleanSent);
  const tailStreamDelta = pushLiveStreamDelta(send, tailClean, lastCleanSent, tailReplace, {
    ...liveDeltaOpts,
    replaceInstant: tailReplaceInstant,
    explicitDelta: tailReplace == null ? tailDelta : undefined,
    lastSentToClient,
  });
  lastCleanSent = tailStreamDelta.lastCleanSent;
  lastSentToClient = tailStreamDelta.lastSentToClient;

  /** stream-first — dedupe/loop tail 금지, 유저가 본 텍스트 기준 */
  const streamVisibleText = lastSentToClient.trimEnd();
  const streamAccumulated = fullText;
  const capturedStatusWidgetValues =
    isDeepSeekV4ProModel(modelId) || isGeminiProOpenRouterModel(modelId)
      ? captureDeepSeekStatusWidgetValuesFromModelText(streamAccumulated)
      : captureStatusWidgetValuesFromModelText(streamAccumulated);
  let mergedText = pushRemovalTraceStep(
    removalTraceSteps,
    "openRouter_sanitizeStreamArtifacts",
    streamAccumulated,
    sanitizeStreamArtifacts(streamAccumulated),
    "sanitizeStreamArtifacts — incomplete [태그:…] and trailing < HTML fragments (stream end)"
  );
  mergedText = pushRemovalTraceStep(
    removalTraceSteps,
    "openRouter_stripRpMetaLeakage",
    mergedText,
    stripRpMetaLeakage(mergedText),
    "stripRpMetaLeakage — RP meta preamble leakage"
  );
  const afterStripFlash = pushRemovalTraceStep(
    removalTraceSteps,
    "openRouter_stripFlashOwnedArtifactsOnly",
    mergedText,
    oocHtmlMode
      ? stripInternalTagLeakage(sanitizeStreamArtifacts(stripRpMetaLeakage(mergedText)))
      : stripFlashOwnedArtifactsOnly(mergedText, statusArtifactsOpts),
    oocHtmlMode
      ? "oocHtmlMode — skip Flash-owned strip; internal tag + stream sanitize only"
      : "stripFlashOwnedArtifactsOnly — status/json/html artifacts (finalizeStreamEndProse inner)"
  );
  const afterClamp = pushRemovalTraceStep(
    removalTraceSteps,
    "openRouter_clampResponseLength",
    afterStripFlash,
    clampResponseLength(afterStripFlash, targetResponseChars),
    "clampResponseLength — hard max tier cap (finalizeStreamEndProse inner)"
  );
  mergedText = pushRemovalTraceStep(
    removalTraceSteps,
    "openRouter_finalizeStreamEndProse",
    afterClamp,
    preserveStreamFirstProse(streamVisibleText, afterClamp, targetResponseChars),
    "preserveStreamFirstProse — reject >5% loss vs stream-visible baseline (finalizeStreamEndProse)"
  );

  let loopAborted = usage.finishReason === "LOOP_ABORT";
  const degenerationAborted = usage.finishReason === "DEGENERATION_ABORT";
  if (degenerationAborted) {
    throw new DegenerationAbortError();
  }
  if (loopAborted && isDegenerateOutput(mergedText, degenerationCtx)) {
    throw new DegenerationAbortError();
  }
  if (loopAborted) {
    if (mergedText.trim()) {
      const loopProse = finalizeStreamEndProse({
        streamVisible: streamVisibleText,
        rawMerged: mergedText,
        targetResponseChars,
        statusArtifactsOpts,
        oocHtmlMode,
      });
      if (!shouldSkipStreamEndShrink(streamVisibleText, loopProse)) {
        lastCleanSent = pushLiveStreamUpdate(send, lastCleanSent, loopProse);
      }
    }
    if (detectCharStutter(mergedText) || isDegenerateOutput(mergedText, degenerationCtx)) {
      throw new DegenerationAbortError();
    }
  }

  const lengthTarget = resolveResponseLengthTarget(targetResponseChars);
  const truncationCheckOpts = buildTruncationCheckOpts(messageOpts);

  mergedText = finalizeStreamEndProse({
    streamVisible: streamVisibleText,
    rawMerged: mergedText,
    targetResponseChars,
    statusArtifactsOpts,
    oocHtmlMode,
  });
  const finalForClient = stripLiveStreamForClient(mergedText);

  if (finalForClient.trim() && finalForClient.trimEnd() !== lastCleanSent.trimEnd()) {
    if (shouldSkipStreamEndShrink(streamVisibleText, finalForClient)) {
      console.warn("[stream-first-save] skip stream-end shrink replace", {
        streamVisibleChars: streamVisibleText.length,
        finalChars: finalForClient.length,
        minRetention: STREAM_SAVE_MIN_RETENTION,
      });
      mergedText = clampResponseLength(streamVisibleText, targetResponseChars);
    } else {
      lastCleanSent = pushLiveStreamUpdate(send, lastCleanSent, finalForClient);
    }
  } else if (finalForClient.trim()) {
    lastCleanSent = finalForClient.trimEnd();
  }

  let recoveryStage: StageUsage | undefined;
  let lengthRecoveryPasses = 0;
  const recoveryResult = await tryServerUnderLengthRecovery({
    prose: mergedText,
    finishReason: usage.finishReason,
    system,
    modelId,
    targetResponseChars,
    charName: messageOpts?.charName ?? "",
    turnApiBudget,
    sessionId: messageOpts?.sessionId ?? undefined,
  });
  if (recoveryResult.stage) {
    recoveryStage = recoveryResult.stage;
  }
  if (recoveryResult.prose.length > mergedText.trim().length) {
    mergedText = recoveryResult.prose;
    lengthRecoveryPasses = 1;
    const recoveredForClient = stripLiveStreamForClient(mergedText);
    if (
      recoveredForClient.trim() &&
      recoveredForClient.trimEnd() !== lastCleanSent.trimEnd() &&
      !shouldSkipStreamEndShrink(streamVisibleText, recoveredForClient)
    ) {
      lastCleanSent = pushLiveStreamUpdate(send, lastCleanSent, recoveredForClient);
    }
  }

  logInputEchoCheckForTurn(history, mergedText);

  const configuredMaxTokens = resolveMaxOutputTokensForTarget(
    targetResponseChars,
    modelId
  );
  const recoveryOutputTokens = recoveryStage?.apiOutputTokens ?? recoveryStage?.output ?? 0;
  const totalApiOutputTokens = usage.outputTokens + recoveryOutputTokens;

  console.log("[OUTPUT GENERATION RESULT]", {
    lengthMode: resolveResponseLengthTarget(targetResponseChars).target,
    max_tokens: configuredMaxTokens,
    api_output_tokens: totalApiOutputTokens,
    primary_output_tokens: usage.outputTokens,
    ...(recoveryOutputTokens > 0 ? { recovery_output_tokens: recoveryOutputTokens } : {}),
    billable_output_tokens: billableOutputTokens(
      totalApiOutputTokens,
      mergedText.trim(),
      targetResponseChars
    ),
    finish_reason: usage.finishReason,
    output_chars: visibleAssistantDisplayCharCount(mergedText),
    hard_max: lengthTarget.hardMax,
    probable_truncation: detectProbableOutputTruncation(
      mergedText,
      usage.finishReason,
      targetResponseChars,
      truncationCheckOpts
    ),
  });

  logCharsPerTokenDiagnostic({
    outputTokens: totalApiOutputTokens,
    primaryOutputTokens: usage.outputTokens,
    recoveryOutputTokens,
    rawModelText: streamAccumulated,
    primaryRawModelChars: streamAccumulated.length,
    finalSavedText: mergedText,
    recoveryMergeRejected: Boolean(recoveryStage) && lengthRecoveryPasses === 0,
    usageData: usage.debugRawUsage,
    reasoningOutputTokens: usage.reasoningOutputTokens,
    systemPrompt: system,
  });

  logBannedVerbCheck(mergedText, system);
  logHanjaLeakCheck(modelId, mergedText);

  const totalOutputTokens = totalApiOutputTokens;

  logLengthDiagnosticV2({
    finishReason: usage.finishReason,
    outputText: mergedText,
    outputTokens: totalOutputTokens,
    primaryOutputTokens: usage.outputTokens,
    recoveryOutputTokens,
    usageData: usage.debugRawUsage,
    reasoningOutputTokens: usage.reasoningOutputTokens,
    targetResponseChars,
    maxTokens: configuredMaxTokens,
    systemPrompt: system,
    apiPromptTokens: usage.apiReportedInputTokens ?? usage.inputTokens,
  });

  if (messageOpts?.systemSplit) {
    logTurnOpenRouterCacheDiagnostics(
      modelId,
      system,
      usage,
      messageOpts.systemSplit
    );
  } else {
    logTurnOpenRouterCacheDiagnostics(modelId, system, usage);
  }

  const truncated = needsResponseLengthFix(mergedText, usage.finishReason, targetResponseChars);

  logLengthAudit({
    targetInput: targetResponseChars,
    actualChars: visibleAssistantDisplayCharCount(mergedText),
    maxOutputTokens: configuredMaxTokens,
    promptLengthRuleCount: 1,
    underLengthRecoveryTriggered: lengthRecoveryPasses > 0,
    lengthRecoveryPasses,
  });

  warnDeepSeekHonorificIfNeeded(mergedText, modelId);

  return {
    text: mergedText,
    streamVisibleText: streamVisibleText || lastCleanSent.trimEnd(),
    rawStreamText: streamAccumulated,
    capturedStatusWidgetValues,
    removalTraceSteps,
    stage: {
      stage: stageLabel,
      model: modelId,
      input: usage.inputTokens,
      output: usage.outputTokens,
      apiReportedInputTokens: usage.apiReportedInputTokens ?? usage.inputTokens,
      apiOutputTokens: usage.outputTokens,
      lengthRecoveryPasses,
      savedOutputChars: visibleAssistantDisplayCharCount(mergedText.trim()),
      estimated: usage.estimated,
      finishReason: usage.finishReason,
      truncated,
      loopAborted,
      degenerationAborted,
      ...(usage.reasoningOutputTokens != null && usage.reasoningOutputTokens > 0
        ? { apiReasoningOutputTokens: usage.reasoningOutputTokens }
        : {}),
      ...(usage.cacheReadTokens != null && usage.cacheReadTokens > 0
        ? { cacheReadTokens: usage.cacheReadTokens }
        : {}),
      ...(usage.cacheWriteTokens != null && usage.cacheWriteTokens > 0
        ? { cacheWriteTokens: usage.cacheWriteTokens }
        : {}),
      standardInputTokens: Math.max(
        0,
        usage.inputTokens - (usage.cacheReadTokens ?? 0) - (usage.cacheWriteTokens ?? 0)
      ),
      ...(usage.upstreamCostUsd != null && usage.upstreamCostUsd > 0
        ? { upstreamCostUsd: usage.upstreamCostUsd }
        : {}),
      ...(usage.cacheDiscountUsd != null && usage.cacheDiscountUsd !== 0
        ? { cacheDiscountUsd: usage.cacheDiscountUsd }
        : {}),
    },
    recoveryStage,
  };
}

function mergePrefillCompletion(prefill: string, completion: string): string {
  if (!prefill) return completion;
  if (completion.startsWith(prefill)) return completion;
  return prefill + completion;
}

function aiBodyAfterPrefill(fullText: string, prefill: string): string {
  if (!prefill) return fullText;
  return fullText.startsWith(prefill) ? fullText.slice(prefill.length) : fullText;
}

/** OpenRouter 비스트리밍 (내부 유틸) */
export async function callOpenRouterAdult(
  system: string,
  history: ChatMsg[],
  modelId = OPENROUTER_ADULT_MODEL,
  targetResponseChars?: number | null,
  messageOpts?: OpenRouterMessageOpts,
  debugMeta?: PromptDebugMeta
): Promise<{ text: string; usage: TokenUsage }> {
  const resolvedModelId = normalizeOpenRouterModelId(modelId);
  console.log("[OpenRouter] generate request", {
    model: resolvedModelId,
    stream: false,
  });

  const key = openRouterKey();
  const baseMessages = buildOpenRouterMessages(system, history, messageOpts);
  const canRetryWithoutPrefill =
    isAnthropicModel(resolvedModelId) &&
    !messageOpts?.recoveryAssistantPrefill?.trim() &&
    !messageOpts?.skipAssistantPrefill;

  for (let attempt = 0; attempt <= (canRetryWithoutPrefill ? 1 : 0); attempt++) {
    const skipAssistantPrefill =
      messageOpts?.skipAssistantPrefill === true || (attempt > 0 && canRetryWithoutPrefill);
    if (attempt > 0) {
      console.warn("[OpenRouter] empty generate — retry without prefill", {
        attempt: attempt + 1,
        model: resolvedModelId,
      });
    }

    const { messages, prefill } = applyAnthropicCacheAndPrefill(
      baseMessages,
      resolvedModelId,
      messageOpts?.charName,
      {
        recoveryAssistantPrefill: messageOpts?.recoveryAssistantPrefill,
        skipAssistantPrefill,
      }
    );
    const requestBody = buildOpenRouterRequestBody(
      resolvedModelId,
      messages,
      false,
      targetResponseChars,
      messageOpts?.sessionId,
      messageOpts?.maxTokensOverride,
      messageOpts?.generationOverrides
    );
    dumpOpenRouterRequest(requestBody as Record<string, unknown>, {
      ...debugMeta,
      requestKind: debugMeta?.requestKind ?? "openrouter-generate",
      stage: debugMeta?.stage ?? resolvedModelId,
    });
    logOpenRouterSystemPromptBeforeFetch(requestBody as Record<string, unknown>);

    assertOpenRouterEndpoint(OPENROUTER_CHAT_COMPLETIONS_URL);
    let res: Response;
    if (isMockApiMode()) {
    const { chars, tokens } = estimatePayloadFromBody(requestBody);
    recordMockApiPayload({
      provider: "openrouter",
      requestKind: debugMeta?.requestKind ?? "openrouter-generate",
      model: resolvedModelId,
      payloadChars: chars,
      payloadTokens: tokens,
      historyMessages: Array.isArray((requestBody as { messages?: unknown }).messages)
        ? (requestBody as { messages: unknown[] }).messages.length
        : undefined,
      payload: requestBody,
    });
    const mockText = getMockResponseText();
    res = new Response(JSON.stringify(buildMockOpenRouterGenerateJson(mockText, resolvedModelId)), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
    } else {
      if (debugMeta?.chargeTurnBudget !== false && attempt === 0) {
        debugMeta?.turnApiBudget?.beforeFetch(debugMeta.requestKind ?? "openrouter-generate");
      }
      res = await fetchOpenRouterChatWithCreditRetry(
        OPENROUTER_CHAT_COMPLETIONS_URL,
        openRouterHeaders(key),
        requestBody as Record<string, unknown>,
        120_000
      );
    }

    const data = await res.json();
    console.log("=== [DEBUG] API 호출 성공, 응답 수신됨 ===");
    console.log("=== [DEBUG] USAGE DATA ===", JSON.stringify(data?.usage, null, 2));
  const finishReason = data.choices?.[0]?.finish_reason as string | undefined;
  console.log("[FINISH REASON]:", finishReason ?? "(none)");
  const completion = streamContentToText(data.choices?.[0]?.message?.content);
  const text = mergePrefillCompletion(prefill, completion);
  const aiBody = aiBodyAfterPrefill(text, prefill).trim();

  if (!aiBody) {
    if (shouldRetryEmptyStream(attempt, canRetryWithoutPrefill, finishReason)) {
      continue;
    }
    throw new OpenRouterApiError({
      message: `502 Bad Gateway: OpenRouter returned empty completion (finishReason=${finishReason ?? "unknown"})`,
    });
  }

  const usageBreakdown = parseOpenRouterUsage(data.usage, res.headers);
  const usage: TokenUsage = data.usage
    ? {
        ...tokenUsageFromOpenRouterBreakdown({
          ...usageBreakdown,
          promptTokens:
            usageBreakdown.promptTokens ||
            estimateTokens(system + history.map((m) => m.content).join("")),
          completionTokens: usageBreakdown.completionTokens || estimateTokens(text),
          estimated: usageBreakdown.estimated,
        }),
        finishReason,
        debugRawUsage: data.usage,
      }
    : {
        inputTokens: estimateTokens(system + history.map((m) => m.content).join("")),
        outputTokens: estimateTokens(text),
        estimated: true,
        finishReason,
      };

  if (messageOpts?.systemSplit) {
    logTurnOpenRouterCacheDiagnostics(
      resolvedModelId,
      system,
      usage,
      messageOpts.systemSplit
    );
  } else {
    logTurnOpenRouterCacheDiagnostics(resolvedModelId, system, usage);
  }

  return { text, usage };
  }

  throw new OpenRouterApiError({
    message: "502 Bad Gateway: OpenRouter returned empty completion after retries",
  });
}
