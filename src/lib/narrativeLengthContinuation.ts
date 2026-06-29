import type { ChatMsg, StageUsage } from "@/lib/ai";
import { preserveStreamFirstContinuationMerge } from "@/lib/streamFirstSave";
import { extractProseWithoutHtml } from "@/lib/htmlVisualCardRecovery";
import { callOpenRouterAdult } from "@/lib/openRouterAdult";
import {
  capRecoveryContinuation,
  finalizeRecoveryMerge,
  meetsTierLengthRequirements,
  resolveResponseLengthTarget,
  resolveTierMinimumKoreanWords,
  resolveTierMinimumRequired,
} from "@/lib/responseLength";
import {
  buildRecoveryContinuationRequest,
  buildRecoveryContinuationSystemPrompt,
  NARRATIVE_LENGTH_CONTINUATION_ENABLED,
  type TurnApiBudget,
} from "@/lib/turnApiBudget";

/** tier minimum(글자) 미달일 때만 이어쓰기 — target 미달·단어 부족만으로는 금지 */
export function needsVisibleLengthContinuation(
  prose: string,
  targetInput?: number | null
): boolean {
  const trimmed = prose.trim();
  if (!trimmed) return false;
  const check = meetsTierLengthRequirements(trimmed, targetInput);
  return check.charCount < check.minChars;
}

export function buildVisibleLengthContinuationUserMessage(
  currentVisibleLen: number,
  targetInput?: number | null,
  currentWordCount?: number
): string {
  const tier = resolveResponseLengthTarget(targetInput).target;
  const minimum = resolveTierMinimumRequired(tier);
  const minWords = resolveTierMinimumKoreanWords(tier);
  const words = currentWordCount ?? 0;
  const needChars = Math.max(200, minimum - currentVisibleLen);
  const wordLine =
    minWords > 0
      ? ` · 한글 단어 ${words.toLocaleString()}개 — 통과 최소 ${minimum.toLocaleString()}자 · ${minWords.toLocaleString()}단어 미만`
      : ` — 통과 최소 ${minimum.toLocaleString()}자 미만`;
  const needWordsLine =
    minWords > 0
      ? ` · 한글 단어 ${Math.max(50, minWords - words).toLocaleString()}개 이상`
      : "";
  return `[이어쓰기 — RP 분량 보강 (이번 턴 API 이어쓰기 1회 — 글자 minimum 미달 보정)]
현재 표시 RP 글자수 ${currentVisibleLen.toLocaleString()}자${wordLine}.

직전 assistant 본문 **마지막 글자 바로 다음**부터, **이전 턴·이번 턴 서사를 자연스럽게 이어** 약 ${needChars.toLocaleString()}자 이상${needWordsLine} RP 본문·대사를 추가한다.

절대 금지: 이전 문장·문단 반복(Echo) · HTML·\`\`\`html · 상태창 · 장면 밖 해설 · 새 시간/장면 도약
한국어 3인칭 RP 본문만. 지금 장면 안에서만 이어간다.`;
}

export type ContinueNarrativeIfUnderMinimumOpts = {
  prose: string;
  system: string;
  modelId: string;
  targetResponseChars?: number | null;
  charName: string;
  turnApiBudget: TurnApiBudget;
  sessionId?: string;
};

export type ContinueNarrativeResult = {
  prose: string;
  continued: boolean;
  stage?: StageUsage;
};

/** 표시 글자·한글 단어 중 하나라도 tier 최소 미달 — 이어쓰기 **1회** (본문 1회 + sub-call 최대 1회) */
export async function continueNarrativeIfUnderMinimum(
  opts: ContinueNarrativeIfUnderMinimumOpts
): Promise<ContinueNarrativeResult> {
  const prior = opts.prose.trim();
  if (!NARRATIVE_LENGTH_CONTINUATION_ENABLED) {
    return { prose: prior, continued: false };
  }
  if (!needsVisibleLengthContinuation(prior, opts.targetResponseChars)) {
    return { prose: prior, continued: false };
  }
  if (!opts.turnApiBudget.canSubCall()) {
    console.warn("[narrative-continuation] sub-call budget exhausted");
    return { prose: prior, continued: false };
  }

  const lengthCheck = meetsTierLengthRequirements(prior, opts.targetResponseChars);
  const userMsg = buildVisibleLengthContinuationUserMessage(
    lengthCheck.charCount,
    opts.targetResponseChars,
    lengthCheck.wordCount
  );
  const contSystem = `${opts.system}\n\n${buildRecoveryContinuationSystemPrompt()}`;
  const { history, recoveryAssistantPrefill, claudeRecovery } = buildRecoveryContinuationRequest(
    prior,
    userMsg,
    opts.modelId
  );

  opts.turnApiBudget.beforeFetch("narrative-length-continuation");

  console.log("[narrative-continuation] below tier minimum — main model continue", {
    visibleChars: lengthCheck.charCount,
    koreanWords: lengthCheck.wordCount,
    minimumChars: lengthCheck.minChars,
    minimumWords: lengthCheck.minWords,
  });

  const result = await callOpenRouterAdult(
    contSystem,
    history,
    opts.modelId,
    opts.targetResponseChars,
    {
      charName: opts.charName,
      recoveryAssistantPrefill,
      skipAssistantPrefill: !recoveryAssistantPrefill?.trim(),
      claudeRecovery,
      sessionId: opts.sessionId,
    },
    {
      requestKind: "narrative-length-continuation",
      turnApiBudget: opts.turnApiBudget,
      /** 상단 beforeFetch 이미 차감 — callOpenRouterAdult 내부 중복 차감 방지 */
      chargeTurnBudget: false,
    }
  );

  const tail = capRecoveryContinuation(prior, result.text, opts.targetResponseChars, {
    claudeRecovery,
  });
  const merged = finalizeRecoveryMerge(prior, prior + tail, { claudeRecovery });
  const clean = extractProseWithoutHtml(merged) || merged.trim();
  const prose = preserveStreamFirstContinuationMerge(
    prior,
    clean,
    opts.targetResponseChars
  );

  return {
    prose,
    continued: prose.length > prior.length,
    stage: {
      stage: "narrative-length-continuation",
      model: opts.modelId,
      input: result.usage.inputTokens,
      output: result.usage.outputTokens,
      apiOutputTokens: result.usage.outputTokens,
      estimated: result.usage.estimated,
      finishReason: result.usage.finishReason,
      ...(result.usage.reasoningOutputTokens != null && result.usage.reasoningOutputTokens > 0
        ? { apiReasoningOutputTokens: result.usage.reasoningOutputTokens }
        : {}),
    },
  };
}

/** @internal tests */
export function buildContinuationHistoryForTest(
  prose: string,
  userMsg: string,
  modelId: string
): ChatMsg[] {
  return buildRecoveryContinuationRequest(prose, userMsg, modelId).history;
}
