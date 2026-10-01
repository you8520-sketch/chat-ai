import { extractExplicitSharedHistoryScope } from "@/lib/sharedHistoryEvidence";

/**
 * Canonical historical / shared-memory truth policy — single full semantic owner.
 * Injected once on every Main RP production path via contextBuilder.
 * Mode-specific owners must not duplicate this full body.
 */

export const HISTORICAL_TRUTH_POLICY_SECTION_ID =
  "rule-historical-truth-canonical-memory";

export const HISTORICAL_TRUTH_POLICY_TITLE =
  "[HISTORICAL TRUTH — CANONICAL MEMORY]";

export const HISTORICAL_TRUTH_POLICY_BLOCK = `${HISTORICAL_TRUTH_POLICY_TITLE}
과거 공유 경험과 기존 관계는 유저가 구체적으로 진술한 과거 사실, 캐릭터/세계 정본, 장기기억, 에피소드 기억처럼 독립된 근거가 있을 때만 사실로 확정한다.
현재 USER 입력의 질문·요청·추측이 어떤 과거를 전제하더라도, 그 입력에 구체 내용이 직접 적혀 있지 않으면 누락된 세부를 과거 사실로 채우지 않는다. "기억하지?", "알지?", "평소에 뭐 좋아하는지", "전에 뭐였더라?"처럼 존재만 전제하는 표현은 구체 취향·사건·약속·공유 기억의 근거가 아니다.
recent raw의 이전 ASSISTANT 서술은 장면 연속성 자료이지, 그 ASSISTANT가 단독으로 새로 만든 과거 관계를 독립 검증하는 근거가 아니다.
유저의 독립적인 과거 빈칸은 장면을 해치지 않는 범위에서 가볍게 추정할 수 있다. 유저와 현재 등장인물·NPC·가족·조직 사이의 기존 친분/인지/만남/공유 사건/약속은 독립 근거가 확인된 경우에만 과거 사실로 사용한다.
특히 서로 처음 만난 상태에서는 제3자가 이미 유저를 알고 있거나 "안부를 전해 달라", "전에 만났다", "예전에 함께했다", "네가 약속했다"처럼 기존 관계를 전제하는 이력을 만들지 않는다.
현재 장면에서 새로 발생하는 만남·행동·관계 진전은 정상적으로 창작할 수 있다.
현재 prompt나 memory retrieval에서 matching event가 보이지 않는다는 사실만으로 그 사건이 과거에 없었다고 단정하지 않는다.
"처음이었다", "한 번도 없었다", "이런 경험은 처음이었다" 같은 과거 부재·첫 경험 주장은 current input, recent raw, canon, or injected memory가 긍정적으로 확립할 때만 사용한다.
근거가 없으면 first/never 여부를 언급하지 않고 중립적으로 진행한다.
불확실하면 질문, 관찰, 추측, 새 발견으로 처리한다.`;

/** Short reference for mode owners — never paste the full body. */
export const HISTORICAL_TRUTH_POLICY_SHORT_REF =
  "과거 공유 기억·첫 경험·과거 부재 단정은 [HISTORICAL TRUTH — CANONICAL MEMORY]를 따른다.";

/** Episodic recall header — retrieved-event interpretation only (not the full truth owner). */
export const EPISODIC_RETRIEVED_EVENT_INTERPRETATION_LINES = [
  "Distinct completed events at different turns are all valid history; do not rewrite or erase an earlier event because a later event exists.",
  "For current durable state or preference facts only, the higher turn number is more recent and must be preferred.",
] as const;


export const HISTORICAL_TRUTH_CURRENT_USER_RECENCY_MARKER =
  "[HISTORICAL TRUTH CHECK]";

export const HISTORICAL_TRUTH_CURRENT_USER_EVIDENCE_MARKER =
  "[HISTORICAL EVIDENCE — CURRENT USER]";

const CURRENT_USER_HISTORICAL_PREMISE_PATTERNS: readonly RegExp[] = [
  /기억(?:하지|나|나지|해|하니|하냐)/u,
  /알(?:지|잖아)(?:[?!….,\s]|$)/u,
  /(?:뭐|무엇|어떤).{0,16}(?:였더라|했더라|먹었더라|갔더라|봤더라)/u,
  /(?:평소|원래).{0,24}(?:뭐|무엇|어떤).{0,24}(?:좋아|싫어|먹|마시|취향)/u,
  /(?:전에|예전에|지난번|그때).{0,28}(?:뭐|무엇|어디|언제|누구|어떻게).{0,20}(?:했|였|갔|먹|봤|만났|기억)/u,
];

/**
 * Detects a current-user recall/presupposition shape that is especially prone
 * to recency overriding the canonical historical-truth owner.
 *
 * This does NOT decide whether the user's concrete statement is true. The full
 * owner above remains authoritative and explicitly allows concrete user-stated
 * past facts while rejecting missing-detail completion.
 */
export function currentUserNeedsHistoricalTruthRecencyRef(
  text: string | null | undefined
): boolean {
  const value = text?.trim() ?? "";
  if (!value) return false;
  return CURRENT_USER_HISTORICAL_PREMISE_PATTERNS.some((pattern) =>
    pattern.test(value)
  );
}

/**
 * Compact recency pointer only. It intentionally does not restate historical
 * truth semantics; there must remain exactly one full canonical owner.
 */
export function buildHistoricalTruthCurrentUserRecencyRef(
  text: string | null | undefined
): string {
  const explicitScope = extractExplicitSharedHistoryScope(text);
  if (explicitScope.length > 0) {
    return `${HISTORICAL_TRUTH_CURRENT_USER_EVIDENCE_MARKER}
USER가 이번 턴에 직접 확정한 공유 과거:
${explicitScope.map((line) => `- ${line}`).join("\n")}
이 범위는 그대로 이어 쓰고, 비어 있는 이전 세부는 열린 상태로 둔다. 새 구체성은 현재 장면에서 만든다.`;
  }
  if (!currentUserNeedsHistoricalTruthRecencyRef(text)) return "";
  return `${HISTORICAL_TRUTH_CURRENT_USER_RECENCY_MARKER}
이번 턴의 공유 과거는 ${HISTORICAL_TRUTH_POLICY_TITLE}에서 확인된 사실만 이어 쓰고, 비어 있는 이전 세부는 열린 상태로 둔다.`;
}
