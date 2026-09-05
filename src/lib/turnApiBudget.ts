import type { ChatMsg } from "@/lib/ai";
import { isAnthropicModel } from "@/lib/chatModels";
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
 * Retired for the single-primary RP invariant. The legacy request-kind and
 * budget branches remain for compatibility, but no automatic regeneration is
 * permitted on a user turn.
 */
export const RP_META_LEAK_REGEN_API_ENABLED = false;

/** Strict Main RP invariant: one provider fetch is the complete user turn. */
export const MAX_MAIN_RP_PROVIDER_CALLS_PER_TURN = 1;

/** @deprecated compatibility export; Main RP has no sub-call slot. */
export const MAX_TURN_SUB_API_CALLS = 0;

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

export type InternalTransportMessage = {
  role: "user";
  content: string;
  internalOnly: true;
  persistence: "never";
  semanticOwner: "server";
};

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

/**
 * 유저 1턴 — Main RP provider fetch hard stop (exactly one).
 *
 * Two distinct counters must not be conflated:
 * - LOGICAL_MAIN_GENERATION_COUNT: this budget's fetchCount — one logical
 *   Main RP generation per user turn (manual regeneration starts a NEW turn
 *   with a fresh budget instance, so it is always allowed).
 * - MAIN_RP_EXTERNAL_PROVIDER_ATTEMPT_COUNT: physical external HTTP provider
 *   requests inside one generation — enforced to <= 1 separately in
 *   deepseekProviderFailover (MAX_MAIN_RP_EXTERNAL_PROVIDER_ATTEMPTS) and by
 *   the single-attempt transport in openRouterAdult. fetchCount=1 alone does
 *   NOT prove one external request.
 * Auxiliary provider calls (status widget, summaries, memories, suggested
 * replies, …) never consult this budget and are attributed separately.
 */
export class TurnApiBudget {
  private fetchCount = 0;

  beforeFetch(context: string): void {
    if (this.fetchCount >= MAX_MAIN_RP_PROVIDER_CALLS_PER_TURN) {
      console.error("[turn-api-budget] HARD STOP — one Main RP provider call per turn", {
        context,
        fetchCount: this.fetchCount,
        maxCalls: MAX_MAIN_RP_PROVIDER_CALLS_PER_TURN,
      });
      throw new Error(
        `[turn-api-budget] Main RP provider call budget exceeded (${context})`
      );
    }
    this.fetchCount++;
  }

  canSubCall(): boolean {
    return this.fetchCount < MAX_MAIN_RP_PROVIDER_CALLS_PER_TURN;
  }

  get fetchCountSnapshot(): number {
    return this.fetchCount;
  }
}
