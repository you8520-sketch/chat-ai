import { ROLLING_SUMMARY_INTERVAL } from "@/lib/hybridMemory";
import {
  clampSummary,
  demoTurnSummary,
  normalizeMemoryMeta,
  restrictRelationshipMetaDeltaToDurableAutoFacts,
} from "@/lib/chatMemory";
import { estimateTokens } from "@/lib/tokenEstimate";
import { callOpenRouterCompletion } from "@/lib/openRouterCompletion";
import {
  OPENROUTER_DEEPSEEK_V3_MODEL,
  OPENROUTER_GEMINI_20_FLASH_MODEL,
} from "@/lib/chatModels";
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
  cacheDiscountUsd?: number;
  cachePaddingTokens?: number;
  billableInputTokens?: number;
  apiReportedInputTokens?: number;
  /** OpenRouter completion_tokens_details.reasoning_tokens */
  reasoningOutputTokens?: number;
  /** Dev-only — raw OpenRouter usage payload for diagnostics */
  debugRawUsage?: unknown;
};

/** 백그라운드 기억·요약·상태창·번역 등 — OpenRouter DeepSeek V3 */
export const BACKGROUND_MAX_INPUT_TOKENS = 12_000;
/** 6턴 RP raw + 기억 요약 system 전체 (12k는 ~13k 대화에서 system 지시 잘림) — env로 상향 가능 */
export const BACKGROUND_MEMORY_EXTRACT_MAX_INPUT_TOKENS_DEFAULT = 48_000;

export function resolveBackgroundMemoryExtractMaxInputTokens(): number {
  const raw = process.env.BACKGROUND_MEMORY_EXTRACT_MAX_INPUT_TOKENS?.trim();
  if (!raw) return BACKGROUND_MEMORY_EXTRACT_MAX_INPUT_TOKENS_DEFAULT;
  const n = Number(raw);
  if (Number.isFinite(n) && n >= 16_000) return Math.floor(n);
  return BACKGROUND_MEMORY_EXTRACT_MAX_INPUT_TOKENS_DEFAULT;
}
export const BACKGROUND_OPENROUTER_MODEL =
  process.env.BACKGROUND_MEMORY_MODEL?.trim() || OPENROUTER_DEEPSEEK_V3_MODEL;
/** 백그라운드 비전 — 이미지 검열·에셋 태그 (DeepSeek V3는 vision 미지원) */
export const BACKGROUND_VISION_OPENROUTER_MODEL =
  process.env.BACKGROUND_VISION_MODEL?.trim() ||
  process.env.ASSET_VISION_MODEL?.trim() ||
  OPENROUTER_GEMINI_20_FLASH_MODEL;
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

function resolveBackgroundMaxInputTokens(requestKind: string): number {
  if (/background-html-visual-card/i.test(requestKind)) {
    return HTML_ONLY_TURN_MAX_INPUT_TOKENS;
  }
  if (/background-memory-extract/i.test(requestKind)) {
    return resolveBackgroundMemoryExtractMaxInputTokens();
  }
  return BACKGROUND_MAX_INPUT_TOKENS;
}

function resolveBackgroundMaxOutputTokens(requestKind: string): number {
  if (/background-lorebook-compact/i.test(requestKind)) return 3500;
  if (/background-status-meta-extract/i.test(requestKind)) return 1024;
  if (/background-status-widget-extract/i.test(requestKind)) return 512;
  if (/background-html-visual-card/i.test(requestKind)) return HTML_FLASH_MAX_OUTPUT_TOKENS;
  return 2048;
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
  cacheDiscountUsd?: number;
  apiReportedInputTokens?: number;
  cachePaddingTokens?: number;
  cachedContentTokens?: number;
  thoughtsTokens?: number;
  apiOutputTokens?: number;
  /** OpenRouter reasoning_tokens 합산 (표시 RP 제외) */
  apiReasoningOutputTokens?: number;
  lengthRecoveryPasses?: number;
  savedOutputChars?: number;
  loopAborted?: boolean;
  degenerationAborted?: boolean;
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
  opts?: { requestKind?: string; maxTokens?: number; temperature?: number }
): Promise<{ text: string; usage: TokenUsage }> {
  if (!process.env.OPENROUTER_API_KEY?.trim()) {
    throw new Error("NO_OPENROUTER_KEY");
  }
  const requestKind = opts?.requestKind ?? "generateContent";
  let effectiveSystem = system;
  let effectiveHistory = history;
  if (
    modelId === BACKGROUND_OPENROUTER_MODEL ||
    /^background-/i.test(requestKind)
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
  if (process.env.NODE_ENV !== "production" && /background-memory|background-lorebook-compact|background-status-meta-extract|background-status-widget-extract/i.test(requestKind)) {
    console.log("[background-memory] OpenRouter request", {
      model: modelId,
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
    maxTokens: opts?.maxTokens ?? resolveBackgroundMaxOutputTokens(requestKind),
    requestKind,
    timeoutMs: /background-html-visual-card/i.test(requestKind) ? 240_000 : undefined,
  });
}

export async function callGemini(
  system: string,
  history: ChatMsg[],
  modelId = BACKGROUND_OPENROUTER_MODEL
): Promise<{ text: string; usage: TokenUsage }> {
  return callGeminiOnce(system, history, modelId, { requestKind: "generateContent" });
}

/** 긴 텍스트를 타이핑 효과용으로 잘라 스트리밍 */
export function* chunkText(text: string, size = 24): Generator<string> {
  for (let i = 0; i < text.length; i += size) {
    yield text.slice(i, i + size);
  }
}

/** 백그라운드 기억·요약·압축 — OpenRouter DeepSeek V3 */
export async function callBackgroundMemory(
  system: string,
  history: ChatMsg[],
  _turnTrace?: import("@/lib/geminiRequestTrace").GeminiTurnTrace,
  requestKind = "background-memory-extract",
  opts?: { maxTokens?: number; temperature?: number }
): Promise<{ text: string; usage: TokenUsage }> {
  return callGeminiOnce(system, history, BACKGROUND_OPENROUTER_MODEL, {
    requestKind,
    maxTokens: opts?.maxTokens ?? resolveBackgroundMaxOutputTokens(requestKind),
    temperature: opts?.temperature,
  });
}

/** @deprecated callBackgroundMemory */
export async function callGeminiBackground(
  system: string,
  history: ChatMsg[],
  turnTrace?: import("@/lib/geminiRequestTrace").GeminiTurnTrace,
  requestKind = "background-memory-extract"
): Promise<{ text: string; usage: TokenUsage }> {
  return callBackgroundMemory(system, history, turnTrace, requestKind);
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
    const { text } = await callGeminiBackground(system, history);
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
      content: `캐릭터: ${charName}\n유저: ${userMessage.slice(0, 2000)}\n캐릭터: ${assistantMessage.slice(0, 3000)}`,
    },
  ];
  try {
    const { text } = await callGeminiBackground(system, history);
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
export async function extractRelationshipMetaFromTurn(
  userMessage: string,
  assistantMessage: string,
  charName: string,
  userName: string,
  route: Route,
  prevMeta?: import("@/lib/chatMemory").MemoryMeta,
  turnTrace?: import("@/lib/geminiRequestTrace").GeminiTurnTrace
): Promise<import("@/lib/chatMemory").RelationshipMetaDelta> {
  const existing = prevMeta ?? { honorifics: [], items: [], thoughts: [], promises: [] };
  const dialogue = `${userMessage}\n${assistantMessage}`;
  const names = { charName, userName };
  const activePromises = existing.promises.length
    ? existing.promises
        .map((p) => `- ${p.text}${p.deadline ? ` (기한: ${p.deadline})` : ""}`)
        .join("\n")
    : "(없음)";
  const currentItems = existing.items.length ? existing.items.join("\n") : "(없음)";

  const system = `너는 롤플레잉 관계 메모 추출기다. 이번 턴 본문(유저·캐릭터 대사·서술)에서 **새로 등장·변경**된 항목만 JSON으로 출력하라.

items: **유저(${userName})와의 관계에 관련된 물건만** — ① ${userName} 본인의 소지품, ② ${userName}↔상대가 주고받은·나눠 가진·맡긴 물건. **한 사람당 한 줄** — 형식 "이름: 물건1, 물건2, 물건3" (쉼표로 나열). 선물·전달·건넴·양도는 "보낸이→받는이: 물건" 또는 받는 쪽 "이름: 물건"으로. "캐릭터", "유저" 라벨 금지. **절대 금지**: 캐릭터가 원래 갖고 있던 개인 물건, 장면 배경에 놓인 물건, 가구·설비·실내 비품(침대, 의자, 책상, 세면대, 거울 등), 의류(옷·드레스·정장·신발 등 — 장신구는 허용), 평소 착용 중인 제복·기본 복장. 사람 이름 없이 물건명만 단독 출력 금지 — 반드시 "이름: 물건" 형식. 유저와 무관한 물건은 아무리 자세히 묘사돼도 넣지 마라.
itemsRemove: [현재 소지품] 줄 중 **더 이상 사실이 아닌** 항목 — 이번 턴에 다른 사람에게 건넸·잃었·없어진 물건. **현재 목록 문자열과 정확히 일치**하게 출력. 전달 시 보낸 사람 줄 전체 또는 갱신 전 줄을 넣어라.
promisesAdd: 이번 턴에 **새로 맺은** 약속 [{ "text": "약속 내용", "deadline": "기한(있으면)" }]
promisesRemove: 아래 [기존 활성 약속] 중 **이번 턴에 지켜졌거나, 기한이 지나 더 이상 유효하지 않은** 약속의 text와 **정확히 일치**하는 문자열

[현재 소지품]
${currentItems}

[기존 활성 약속]
${activePromises}

소지품을 건넸으면 보낸 쪽 itemsRemove에 해당 줄을 포함하고, 받는 쪽은 items에 추가하라.
자동 추출 금지: 호칭/별명, NPC 생각, inner_thoughts, 감정 온도, 관계 단계, 애착/소유욕/복종 추정, 말투, 성별, 현재 장소.
없는 항목은 빈 배열. 순수 JSON만:
{"items":[],"itemsRemove":[],"promisesAdd":[],"promisesRemove":[]}`;
  const history: ChatMsg[] = [
    {
      role: "user",
      content: `유저(${userName}): ${userMessage.slice(0, 2000)}\n캐릭터(${charName}): ${assistantMessage.slice(0, 3000)}`,
    },
  ];
  try {
    const { text } = await callGeminiBackground(
      `${system}

[RELATIONSHIP MEMORY AUTO EXTRACTION RESTRICTION]
Do not extract or update honorifics/nicknames, NPC thoughts, inner_thoughts, emotion temperature, relationship stage, inferred attachment/possessiveness/obedience, current speech style, gender, or current location.
Only durable relationship facts may be non-empty: items, itemsRemove, promisesAdd, promisesRemove.
Return honorifics: [], thoughts: [], thoughtsRemove: [], currentLocation: "" even if the schema contains those keys.`,
      history,
      turnTrace
    );
    const trimmed = text.trim();
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
    const raw = fenced ? fenced[1].trim() : trimmed;
    const j = JSON.parse(raw) as {
      honorifics?: string[];
      items?: string[];
      thoughts?: string[];
      itemsRemove?: string[];
      thoughtsRemove?: string[];
      promisesAdd?: { text?: string; deadline?: string }[];
      promisesRemove?: string[];
      currentLocation?: string;
    };
    const delta: import("@/lib/chatMemory").RelationshipMetaDelta = {
      honorifics: Array.isArray(j.honorifics) ? j.honorifics.filter(Boolean) : [],
      currentLocation: typeof j.currentLocation === "string" ? j.currentLocation : undefined,
      items: Array.isArray(j.items) ? j.items.filter(Boolean) : [],
      thoughts: [],
      itemsRemove: Array.isArray(j.itemsRemove) ? j.itemsRemove.filter(Boolean) : [],
      thoughtsRemove: [],
      promisesAdd: Array.isArray(j.promisesAdd)
        ? j.promisesAdd
            .map((p) => ({
              text: typeof p?.text === "string" ? p.text.trim() : "",
              deadline: typeof p?.deadline === "string" ? p.deadline.trim() : undefined,
            }))
            .filter((p) => p.text)
        : [],
      promisesRemove: Array.isArray(j.promisesRemove) ? j.promisesRemove.filter(Boolean) : [],
    };
    const normalized = normalizeMemoryMeta(
      {
        honorifics: delta.honorifics ?? [],
        items: delta.items ?? [],
        thoughts: [],
        promises: [],
        currentLocation: delta.currentLocation,
      },
      names
    );
    return restrictRelationshipMetaDeltaToDurableAutoFacts({
      ...delta,
      honorifics: normalized.honorifics,
      items: normalized.items,
      currentLocation: normalized.currentLocation,
    });
  } catch {
    return {};
  }
}

/** 재생성 — 거부된 assistant와 새 assistant 비교, 소지품·속마음 제거·갱신 */
export async function extractRelationshipMetaAfterRegenerate(
  userMessage: string,
  newAssistantMessage: string,
  previousAssistantMessage: string,
  charName: string,
  userName: string,
  route: Route,
  prevMeta?: import("@/lib/chatMemory").MemoryMeta,
  turnTrace?: import("@/lib/geminiRequestTrace").GeminiTurnTrace
): Promise<import("@/lib/chatMemory").RelationshipMetaDelta> {
  const existing = prevMeta ?? { honorifics: [], items: [], thoughts: [], promises: [] };
  const names = { charName, userName };
  const activePromises = existing.promises.length
    ? existing.promises
        .map((p) => `- ${p.text}${p.deadline ? ` (기한: ${p.deadline})` : ""}`)
        .join("\n")
    : "(없음)";

  const system = `너는 롤플레잉 관계 메모 **재생성 보정** 추출기다. 같은 유저 턴에 assistant 답변이 교체되었다.
[거부된 assistant — 폐기]와 [새 assistant — 정본]을 비교하고, [현재 관계 메모]를 정본에 맞게 수정하라.

itemsRemove: [현재 소지품] 줄 중 **더 이상 사실이 아닌** 항목 — 새 본문에서 다른 사람에게 건넸·잃었·없어진 물건, 또는 거부본에만 있고 새 본문에 없는 전달. **현재 목록 문자열과 정확히 일치**하게 출력.
items / promisesAdd / promisesRemove: **새 assistant 정본**에서 새로 생긴·변경된 durable 항목만.
소지품 전달·양도가 새 본문에 있으면 보낸 쪽 itemsRemove에 해당 줄 포함.

[현재 소지품]
${existing.items.length ? existing.items.join("\n") : "(없음)"}

[기존 활성 약속]
${activePromises}

items 규칙은 평소와 동일. "캐릭터","유저" 라벨 금지. items는 **유저(${userName})와의 관계에 관련된 물건만** — ${userName} 본인의 소지품, ${userName}↔상대가 주고받은·나눠 가진·맡긴 물건. 캐릭터가 원래 갖고 있던 개인 물건·배경 물건·가구·설비·의류(옷·드레스·신발 등, 장신구 제외)·착용 중인 제복은 절대 금지. 사람 이름 없이 물건명만 단독 출력 금지 — 반드시 "이름: 물건" 형식.
자동 추출 금지: 호칭/별명, NPC 생각, inner_thoughts, 감정 온도, 관계 단계, 애착/소유욕/복종 추정, 말투, 성별, 현재 장소.

순수 JSON만:
{"items":[],"itemsRemove":[],"promisesAdd":[],"promisesRemove":[]}`;

  const history: ChatMsg[] = [
    {
      role: "user",
      content: `유저(${userName}): ${userMessage.slice(0, 2000)}

[거부된 assistant — 폐기]
${previousAssistantMessage.slice(0, 3500)}

[새 assistant — 정본]
${newAssistantMessage.slice(0, 3500)}`,
    },
  ];

  try {
    const { text } = await callGeminiBackground(
      `${system}

[RELATIONSHIP MEMORY AUTO EXTRACTION RESTRICTION]
Do not extract or update honorifics/nicknames, NPC thoughts, inner_thoughts, emotion temperature, relationship stage, inferred attachment/possessiveness/obedience, current speech style, gender, or current location.
Only durable relationship facts may be non-empty: items, itemsRemove, promisesAdd, promisesRemove.
Return honorifics: [], thoughts: [], thoughtsRemove: [], currentLocation: "" even if the schema contains those keys.`,
      history,
      turnTrace
    );
    const trimmed = text.trim();
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
    const raw = fenced ? fenced[1].trim() : trimmed;
    const j = JSON.parse(raw) as {
      honorifics?: string[];
      items?: string[];
      thoughts?: string[];
      itemsRemove?: string[];
      thoughtsRemove?: string[];
      promisesAdd?: { text?: string; deadline?: string }[];
      promisesRemove?: string[];
      currentLocation?: string;
    };
    const delta: import("@/lib/chatMemory").RelationshipMetaDelta = {
      honorifics: Array.isArray(j.honorifics) ? j.honorifics.filter(Boolean) : [],
      currentLocation: typeof j.currentLocation === "string" ? j.currentLocation : undefined,
      items: Array.isArray(j.items) ? j.items.filter(Boolean) : [],
      thoughts: [],
      itemsRemove: Array.isArray(j.itemsRemove) ? j.itemsRemove.filter(Boolean) : [],
      thoughtsRemove: [],
      promisesAdd: Array.isArray(j.promisesAdd)
        ? j.promisesAdd
            .map((p) => ({
              text: typeof p?.text === "string" ? p.text.trim() : "",
              deadline: typeof p?.deadline === "string" ? p.deadline.trim() : undefined,
            }))
            .filter((p) => p.text)
        : [],
      promisesRemove: Array.isArray(j.promisesRemove) ? j.promisesRemove.filter(Boolean) : [],
    };
    const normalized = normalizeMemoryMeta(
      { honorifics: delta.honorifics ?? [], items: delta.items ?? [], thoughts: [], promises: [], currentLocation: delta.currentLocation },
      names
    );
    return restrictRelationshipMetaDeltaToDurableAutoFacts({
      ...delta,
      honorifics: normalized.honorifics,
      items: normalized.items,
      currentLocation: normalized.currentLocation,
    });
  } catch {
    return {};
  }
}

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
    const { text } = await callGeminiBackground(system, history);
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
    const { text } = await callGeminiBackground(system, history);
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
    const { text } = await callGeminiBackground(system, [{ role: "user", content: memory }]);
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

  const { text } = await callGemini(
    system,
    [{ role: "user", content: userContent }],
    BACKGROUND_OPENROUTER_MODEL
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
        `[${fromTurn + i}턴]\n유저: ${t.user.slice(0, 2500)}\n${charName}: ${t.assistant.slice(0, 3500)}`
    )
    .join("\n\n");
  const system = `너는 롤플레잉 대화 기록관이다. 아래 ${turns.length}턴(${fromTurn}~${toTurn}턴) 대화에서 핵심 사건·감정 변화·관계·약속만 300자 이내 한국어로 요약하라. 불릿(-) 또는 짧은 문단.`;
  try {
    const { text } = await callGemini(system, [{ role: "user", content: dialogue }], DRAFT_FLASH_MODEL);
    return text.replace(/\s+/g, " ").trim().slice(0, 300);
  } catch {
    const fallback = turns
      .map((t) => `유저:${t.user.slice(0, 40)} → ${charName}:${t.assistant.slice(0, 60)}`)
      .join(" / ");
    return fallback.slice(0, 300);
  }
}
