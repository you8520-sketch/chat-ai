import type { ChatMsg } from "@/lib/ai";
import { isAnthropicModel } from "@/lib/chatModels";
import { isGeminiIsolationMode } from "@/lib/geminiIsolationMode";
import { estimateTokens } from "@/lib/tokenEstimate";

/**
 * 분량 보강·under-length 복구 등 서버 추가 API — 전 모델 OFF.
 * 유저 1턴 = OpenRouter/Gemini 본 호출 1회만 (HTML Flash 등 별도 경로는 유지).
 */
export const TURN_LENGTH_SUPPLEMENT_API_ENABLED = false;

/** Recovery sub-calls (under-length, truncation, status-window) */
export const RECOVERY_SUB_CALLS_ENABLED = TURN_LENGTH_SUPPLEMENT_API_ENABLED;

/** 분량 이어쓰기 sub-call */
export const NARRATIVE_LENGTH_CONTINUATION_ENABLED = TURN_LENGTH_SUPPLEMENT_API_ENABLED;

/** 85% 미달 clean stop 시 서버 1회 이어쓰기 */
export const SERVER_UNDER_LENGTH_RECOVERY_ENABLED = TURN_LENGTH_SUPPLEMENT_API_ENABLED;

export const HTML_RECOVERY_SUB_CALLS_ENABLED = TURN_LENGTH_SUPPLEMENT_API_ENABLED;

/** 유저 1턴당 내부 API 재호출 상한 — 초기 1회(본 호출) 제외 */
export const MAX_TURN_SUB_API_CALLS = TURN_LENGTH_SUPPLEMENT_API_ENABLED
  ? (RECOVERY_SUB_CALLS_ENABLED ? 1 : 0) +
    (NARRATIVE_LENGTH_CONTINUATION_ENABLED ? 1 : 0) +
    (SERVER_UNDER_LENGTH_RECOVERY_ENABLED ? 1 : 0)
  : 0;

const LENGTH_SUPPLEMENT_REQUEST_KIND =
  /continuation|truncation-recovery|under-length|length-recovery|narrative-length/i;

/** 분량 보강·복구 sub-call requestKind — TURN_LENGTH_SUPPLEMENT_API_ENABLED=false면 금지 */
export function isLengthSupplementRequestKind(requestKind?: string | null): boolean {
  return LENGTH_SUPPLEMENT_REQUEST_KIND.test(requestKind ?? "");
}

export function assertLengthSupplementApiAllowed(requestKind?: string | null): void {
  if (!TURN_LENGTH_SUPPLEMENT_API_ENABLED && isLengthSupplementRequestKind(requestKind)) {
    throw new Error(
      `[turn-api-budget] Length supplement API disabled for all models (${requestKind ?? "unknown"})`
    );
  }
}

/** 루프 버그로 payload가 비정상 팽창할 때 API 호출 전 차단 */
export const MAX_PAYLOAD_INPUT_TOKENS = 150_000;

export const CONTEXT_LIMIT_EXCEEDED_ERROR = "Context Limit Exceeded by Loop Bug";

export const CONTINUATION_SYSTEM_PROMPT =
  "이어쓰기 모드. 직전 assistant 출력 바로 다음부터 한국어 장면 내부 3인칭 RP 본문만. 작가·해설자·독자에게 말하는 문단 금지.";

/** under-length·truncation recovery — 장면 밖 해설 차단 (NSFW·세계관 표현은 유지) */
export function buildRecoveryContinuationSystemPrompt(charName?: string): string {
  const who = charName?.trim() || "the AI character";
  return `[이어쓰기 — 장면 내부만]
직전 assistant 출력 **바로 다음 문장**부터 한국어 3인칭 RP 본문만 작성.

절대 금지:
- 장면 밖 해설·요약·계획·예고 (이야기를 소개하거나 다음 전개를 예고하는 메타 문단)
- 독자·유저에게 말하기, 시스템 지시 에코, 영어
- FORBIDDEN: <<<STATUS_VALUES>>>, JSON blocks, or any status widget syntax in this continuation. Write ONLY RP prose continuing the scene.

규칙:
- "${who}" 장면 안에서만 서술·대사 (in-scene third person)
- 성적·감각 묘사는 톤·관계에 맞게 계속 허용
- 이미 쓴 문장·비트·문단 **절대 반복 금지** — paraphrase·요약 재서술도 금지
- 직전 assistant 본문을 다시 출력하면 실패 — **새 행동·대사·감각만**`;
}

const RECOVERY_ANTI_ECHO_HINT =
  "\n\n절대 이전 텍스트를 반복(Echo)하지 마라. 쓰다 만 단어/글자의 **바로 다음**부터 즉시 시작하라.";

export function appendRecoveryAntiEchoHint(userMsg: string): string {
  if (userMsg.includes("반복(Echo)")) return userMsg;
  return `${userMsg}${RECOVERY_ANTI_ECHO_HINT}`;
}

/** Claude recovery — assistant prefill용 tail (50~100자) */
export function extractRecoveryPrefillTail(
  priorText: string,
  minLen = 50,
  maxLen = 100
): string {
  const trimmed = priorText.trimEnd();
  if (!trimmed) return "";
  if (trimmed.length <= minLen) return trimmed;

  let start = trimmed.length - Math.min(maxLen, trimmed.length);
  const tailWindow = trimmed.slice(start);

  const nl = tailWindow.indexOf("\n");
  if (nl >= 0 && tailWindow.length - nl - 1 >= Math.floor(minLen * 0.6)) {
    start = trimmed.length - tailWindow.length + nl + 1;
  } else {
    const spaceIdx = tailWindow.slice(0, 40).lastIndexOf(" ");
    if (spaceIdx >= 0 && tailWindow.length - spaceIdx - 1 >= Math.floor(minLen * 0.5)) {
      start = trimmed.length - tailWindow.length + spaceIdx + 1;
    }
  }

  let prefill = trimmed.slice(start);
  if (prefill.length < minLen) {
    prefill = trimmed.slice(-Math.min(minLen, trimmed.length));
  }
  return prefill;
}

/** Claude(Anthropic) truncation/under-length recovery — tail prefill + prefix history */
export function buildClaudeRecoveryContinuation(
  priorText: string,
  userMsg: string
): { history: ChatMsg[]; prefill: string } {
  const trimmed = priorText.trimEnd();
  const prefill = extractRecoveryPrefillTail(trimmed);
  const userContent = appendRecoveryAntiEchoHint(userMsg);
  const prefix = prefill.length > 0 ? trimmed.slice(0, trimmed.length - prefill.length) : trimmed;

  if (!prefix.trim()) {
    return {
      history: [{ role: "user", content: userContent }],
      prefill,
    };
  }

  return {
    history: [
      { role: "assistant", content: prefix },
      { role: "user", content: userContent },
    ],
    prefill,
  };
}

export type RecoveryContinuationRequest = {
  history: ChatMsg[];
  recoveryAssistantPrefill?: string;
  claudeRecovery: boolean;
};

/** 모델별 recovery history — Claude는 tail assistant prefill */
export function buildRecoveryContinuationRequest(
  priorText: string,
  userMsg: string,
  modelId: string
): RecoveryContinuationRequest {
  const hintedUserMsg = appendRecoveryAntiEchoHint(userMsg);
  if (isAnthropicModel(modelId)) {
    const { history, prefill } = buildClaudeRecoveryContinuation(priorText, userMsg);
    return {
      history,
      recoveryAssistantPrefill: prefill,
      claudeRecovery: true,
    };
  }
  return {
    history: buildMinimalContinuationHistory(priorText, hintedUserMsg),
    claudeRecovery: false,
  };
}

/** 이어쓰기·말투교정 — history에 전체 대화·시스템 중복 주입 금지 */
export function buildMinimalContinuationHistory(
  priorText: string,
  userMsg: string
): ChatMsg[] {
  return [
    { role: "assistant", content: priorText },
    { role: "user", content: userMsg },
  ];
}

export function estimatePayloadInputTokens(
  system: string,
  history: ChatMsg[],
  cachedContentTokens = 0
): number {
  const historyText = history.map((m) => m.content).join("\n");
  return estimateTokens(system) + estimateTokens(historyText) + Math.max(0, cachedContentTokens);
}

export function assertPayloadWithinTokenLimit(
  system: string,
  history: ChatMsg[],
  cachedContentTokens = 0,
  maxTokens = MAX_PAYLOAD_INPUT_TOKENS
): void {
  const tokens = estimatePayloadInputTokens(system, history, cachedContentTokens);
  if (tokens > maxTokens) {
    console.error("[turn-api-budget] payload token limit exceeded", {
      tokens,
      limit: maxTokens,
      historyMessages: history.length,
      cachedContentTokens,
    });
    throw new Error(CONTEXT_LIMIT_EXCEEDED_ERROR);
  }
}

/** 유저 1턴 — API fetch 하드 킬스위치 (본 1회 + 서브 최대 1회) */
export class TurnApiBudget {
  private fetchCount = 0;

  beforeFetch(context: string): void {
    if (isGeminiIsolationMode() && this.fetchCount >= 1) {
      console.error("[turn-api-budget] ISOLATION HARD STOP — max 1 Gemini request per turn", {
        context,
        fetchCount: this.fetchCount,
      });
      throw new Error(
        `[turn-api-budget] Isolation mode — max 1 Gemini request per turn (${context})`
      );
    }
    if (this.fetchCount > 0 && this.fetchCount > MAX_TURN_SUB_API_CALLS) {
      console.error("[turn-api-budget] HARD STOP — max sub-calls exceeded", {
        context,
        fetchCount: this.fetchCount,
        maxSubCalls: MAX_TURN_SUB_API_CALLS,
      });
      throw new Error(
        `[turn-api-budget] Max internal API calls exceeded (${context})`
      );
    }
    if (this.fetchCount > 0) {
      console.warn("[turn-api-budget] sub-call", {
        context,
        retryIndex: this.fetchCount,
        maxSubCalls: MAX_TURN_SUB_API_CALLS,
      });
    }
    this.fetchCount++;
  }

  canSubCall(): boolean {
    if (!TURN_LENGTH_SUPPLEMENT_API_ENABLED) return false;
    if (isGeminiIsolationMode()) return this.fetchCount < 1;
    return this.fetchCount <= MAX_TURN_SUB_API_CALLS;
  }

  get fetchCountSnapshot(): number {
    return this.fetchCount;
  }
}
