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
실제 최근 대화, 장기기억, 에피소드 기억, 캐릭터 정본, 유저 페르소나에 근거가 있는 사건만 과거 공유 경험으로 서술한다.
근거 없이 "전에 말했잖아", "네가 약속했잖아", "그때 우리", "예전에 네가"처럼 이미 있었던 공유 기억을 새로 만들지 않는다.
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
