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
과거 공유 경험과 기존 관계는 유저 발화, 캐릭터/세계 정본, 장기기억, 에피소드 기억처럼 독립된 근거가 있을 때만 사실로 확정한다.
근거는 그 출처가 직접 확정한 사실의 범위까지만 이어간다. 유저가 "몇 차례 임무를 함께했다"고 확정하면 여러 임무 경험까지만, "내가 평소에 뭐 좋아하는지 기억하지?"라고 하면 정본에 이미 있는 취향을 기억한다는 범위까지만 근거로 삼는다. 구체적인 임무 장소·행동·대사나 과거 식사·구매·시장 방문 같은 에피소드는 별도 근거가 있을 때만 과거 사실로 사용한다.
recent raw의 이전 ASSISTANT 서술은 장면 연속성 자료이지, 그 ASSISTANT가 단독으로 새로 만든 과거 관계를 독립 검증하는 근거가 아니다.
유저의 독립적인 과거 빈칸은 장면을 해치지 않는 범위에서 가볍게 추정할 수 있다. 유저와 현재 등장인물·NPC·가족·조직 사이의 기존 친분/인지/만남/공유 사건/약속은 위 근거 범위 안에서 과거 사실로 사용한다.
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
