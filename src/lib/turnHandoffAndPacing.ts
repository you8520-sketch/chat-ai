/** Scene continuation — handoff wrapper removed Step 7 (SCENE CONTINUATION lives in LENGTH). */

/** Core continuation (no numeric length ownership). */
export const SCENE_CONTINUATION_PRIORITY_BLOCK_CORE = `[SCENE CONTINUATION PRIORITY]
Never stop at the first satisfying ending.
분위기·세계 움직임으로 이어가되, 억지 질문·훅으로 유저를 붙잡지 않는다. (pause·여운은 [WEBNOVEL BREATH])`;

/** Production early-stop floor line — omitted on Terra terminal-owner diagnosis path. */
export const SCENE_CONTINUATION_EARLY_STOP_LINE =
  "MINIMUM_FLOOR 미달 전 조기 종료·관찰자 붕괴 결말 금지.";

export const SCENE_CONTINUATION_PRIORITY_BLOCK = `${SCENE_CONTINUATION_PRIORITY_BLOCK_CORE}
${SCENE_CONTINUATION_EARLY_STOP_LINE}`;

/**
 * @deprecated Experiment-1 common longform contract — removed; Terra terminal-owner
 * diagnosis owns length at user-turn end instead. Kept only so old scripts can import.
 */
export const LONGFORM_RP_SCENE_CONTRACT =
  "한국어 장편 소설형 RP로, 한 턴을 보통 3,200자 이상 하나의 충분히 전개된 장면으로 작성한다. 장면에 필요한 내용이 있으면 더 길게 이어간다. 요약하거나 다음 전개를 예고하며 끝내지 말고, 이번 턴에 시작된 주요 행동은 필요한 단계와 최초로 확인 가능한 결과까지 완성한다.";

/** @deprecated Step 7 — empty shell removed from assembly */
export function buildTurnHandoffAndPacingBlock(): string {
  return "";
}
