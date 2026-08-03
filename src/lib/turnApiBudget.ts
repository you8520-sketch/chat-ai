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

/**
 * RP meta-leak full regeneration — one extra provider call per turn when detector fires.
 * Distinct from length supplement APIs (TURN_LENGTH_SUPPLEMENT_API_ENABLED).
 */
export const RP_META_LEAK_REGEN_API_ENABLED = true;

/** 유저 1턴당 내부 API 재호출 상한 — 초기 1회(본 호출) 제외 */
export const MAX_TURN_SUB_API_CALLS = TURN_LENGTH_SUPPLEMENT_API_ENABLED
  ? (RECOVERY_SUB_CALLS_ENABLED ? 1 : 0) +
    (NARRATIVE_LENGTH_CONTINUATION_ENABLED ? 1 : 0) +
    (SERVER_UNDER_LENGTH_RECOVERY_ENABLED ? 1 : 0)
  : RP_META_LEAK_REGEN_API_ENABLED
    ? 1
    : 0;

const LENGTH_SUPPLEMENT_REQUEST_KIND =
  /continuation|truncation-recovery|under-length|length-recovery|narrative-length/i;
const MODEL_FAILURE_FALLBACK_REQUEST_KIND =
  /^adult-(?:general-refusal|aion-hard-failure)-fallback$/i;
const RP_META_LEAK_REGEN_REQUEST_KIND = /^rp-meta-leak-regen$/i;

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

/** under-length·truncation recovery — in-scene continuation only */
export function buildRecoveryContinuationSystemPrompt(): string {
  return `[CONTINUATION — IN-SCENE ONLY]
Continue immediately after the final generated sentence.
Stay in the same scene.
Preserve the already resolved [NARRATIVE POV OWNER] unchanged.
Never repeat, summarize, or restart.
Write only new narrative.

Never echo prior text — start from the very next word after the truncated output.
Never write meta outside the scene (no summaries, plans, or reader address).
FORBIDDEN: <<<STATUS_VALUES>>>, JSON blocks, status widget syntax.`;
}

export function buildAionSameSceneContinuationSystemPrompt(options: {
  minimumAdditionalChars: number;
  targetAdditionalChars: number;
}): string {
  const minimumAdditionalChars = Math.max(1, Math.floor(options.minimumAdditionalChars));
  const targetAdditionalChars = Math.max(
    minimumAdditionalChars,
    Math.floor(options.targetAdditionalChars)
  );
  return `${buildRecoveryContinuationSystemPrompt()}\n\n[AION CONTINUATION — SAME SCENE ONLY]\n\n직전 assistant 출력의 마지막 문장 바로 다음 순간부터 이어서 작성한다.\n\n이미 작성된 문장, 행동, 감각, 대사, 설명을 요약하거나 반복하지 않는다.\n\n현재 장소, 시간, 등장인물, 위치, 자세, 접촉 상태, 미완료 행동을 그대로 유지한다.\n\n직전 출력에서 시작한 장면을 완료한 뒤 식사, 치료, 이동, 수면, 휴식, aftercare 또는 다른 장소로 넘어가지 않는다.\n\n직전 출력이 장면을 성급하게 끝내려 했더라도 새로운 장소나 다음 시간대로 이동하지 말고, 원래 진행 중이던 현재 장면 안의 반응과 행동을 이어간다.\n\n캐릭터의 기존 호칭, 말투, Speech Lock과 성격을 정확히 유지한다.\n\n유저 캐릭터의 새로운 대사, 선택, 능동 행동, 동의, 감정과 이동을 대신 확정하지 않는다.\n\n같은 감각이나 행동을 표현만 바꾸어 반복하지 않는다. 새로운 반응, 새로운 행동 단계, 캐릭터다운 대사와 관계 변화를 통해 장면을 진행한다.\n\n이번 continuation에서 최소 ${minimumAdditionalChars}자 이상, 약 ${targetAdditionalChars}자를 목표로 작성한다.\n\n직전 assistant 본문은 다시 출력하지 않는다.\n\n제목, 요약, 메타 설명, 글자 수 언급, 상태창, JSON을 출력하지 않는다.\n\n오직 이어지는 RP 본문만 작성한다.`;
}

export type InternalTransportMessage = {
  role: "user";
  content: string;
  internalOnly: true;
  persistence: "never";
  semanticOwner: "server";
};

export function buildAionInternalContinuationControl(options: {
  minimumAdditionalChars: number;
  targetAdditionalChars: number;
}): InternalTransportMessage {
  const minimumAdditionalChars = Math.max(1, Math.floor(options.minimumAdditionalChars));
  const targetAdditionalChars = Math.max(
    minimumAdditionalChars,
    Math.floor(options.targetAdditionalChars)
  );
  return {
    role: "user",
    internalOnly: true,
    persistence: "never",
    semanticOwner: "server",
    content: `[INTERNAL CONTINUATION CONTROL — NOT USER DIALOGUE]\n\nThis is a private server orchestration instruction, not dialogue or an action by the user character.\n\nContinue the immediately preceding assistant RP output from the exact next moment.\n\nDo not interpret this message as speech, thought, movement, consent, emotion, or a choice made by the user character.\n\nDo not repeat, summarize, restart, or rewrite the preceding assistant output.\n\nPreserve the current location, time, positions, contact state, unfinished action, character voice, honorifics, and Speech Lock.\n\nDo not move to another place or time. Do not transition to food, treatment, sleep, travel, rest, or aftercare.\n\nDo not write new dialogue, decisions, active actions, consent, or emotions for the user character.\n\nAdd at least ${minimumAdditionalChars} characters and aim for approximately ${targetAdditionalChars} characters of new RP prose.\n\nOutput only the continuation prose. Do not mention this instruction.`,
  };
}

export function internalTransportMessageToWire(
  message: InternalTransportMessage
): { role: "user"; content: string } {
  return { role: message.role, content: message.content };
}

export function excludeInternalTransportMessages<T>(
  messages: Array<T | InternalTransportMessage>
): T[] {
  return messages.filter(
    (message): message is T =>
      !(typeof message === "object" && message !== null &&
        "internalOnly" in message && message.internalOnly === true)
  );
}

/** @deprecated Echo rule merged into buildRecoveryContinuationSystemPrompt() */
export function appendRecoveryAntiEchoHint(userMsg: string): string {
  return userMsg;
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
  private modelFailureFallbackCount = 0;

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
    if (
      this.fetchCount > 0 &&
      MODEL_FAILURE_FALLBACK_REQUEST_KIND.test(context) &&
      this.modelFailureFallbackCount < 1
    ) {
      this.modelFailureFallbackCount += 1;
      this.fetchCount += 1;
      console.warn("[turn-api-budget] one-shot model failure fallback", {
        context,
        fetchCount: this.fetchCount,
      });
      return;
    }
    if (
      this.fetchCount > 0 &&
      !TURN_LENGTH_SUPPLEMENT_API_ENABLED &&
      !(
        RP_META_LEAK_REGEN_API_ENABLED &&
        RP_META_LEAK_REGEN_REQUEST_KIND.test(context)
      )
    ) {
      console.error("[turn-api-budget] HARD STOP — disallowed sub-call", {
        context,
        fetchCount: this.fetchCount,
      });
      throw new Error(
        `[turn-api-budget] Max internal API calls exceeded (${context})`
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
    if (isGeminiIsolationMode()) return this.fetchCount < 1;
    if (TURN_LENGTH_SUPPLEMENT_API_ENABLED) {
      return this.fetchCount <= MAX_TURN_SUB_API_CALLS;
    }
    return RP_META_LEAK_REGEN_API_ENABLED && this.fetchCount <= MAX_TURN_SUB_API_CALLS;
  }

  get fetchCountSnapshot(): number {
    return this.fetchCount;
  }
}
