/** Scene continuation — handoff wrapper removed Step 7 (SCENE CONTINUATION lives in LENGTH). */

/**
 * Production length + scene-completion owner (common RP layer).
 * Replaces the prior early-stop floor line; do not duplicate elsewhere.
 */
export const LONGFORM_RP_SCENE_CONTRACT =
  "한국어 장편 소설형 RP로, 한 턴을 보통 3,200~4,200자의 하나의 밀도 있는 장면으로 전개한다. 요약하거나 다음 전개를 예고하며 끝내지 말고, 이번 턴에 시작된 주요 행동은 필요한 단계와 최초로 확인 가능한 결과까지 완성한다.";

export const SCENE_CONTINUATION_PRIORITY_BLOCK = `[SCENE CONTINUATION PRIORITY]
Never stop at the first satisfying ending.
분위기·세계 움직임으로 이어가되, 억지 질문·훅으로 유저를 붙잡지 않는다. (pause·여운은 [WEBNOVEL BREATH])
${LONGFORM_RP_SCENE_CONTRACT}`;

/** @deprecated Step 7 — empty shell removed from assembly */
export function buildTurnHandoffAndPacingBlock(): string {
  return "";
}
