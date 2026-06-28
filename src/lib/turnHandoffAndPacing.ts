/** Scene continuation + turn-end policy — handoff only after length floor at response tail. */

export const SCENE_CONTINUATION_PRIORITY_BLOCK = `[SCENE CONTINUATION PRIORITY]
장면은 하나의 감정 반응,
하나의 대사,
하나의 행동만으로 종료하지 않는다.

반응 → 후속 행동 → 분위기 변화 → 심리 변화 → 추가 상호작용을 거쳐 장면을 이어간다.

반복으로 분량을 채우지 말고, 새로운 반응과 상황 변화로 장면을 자연스럽게 이어간다.`;

export function buildTurnHandoffAndPacingBlock(): string {
  return `<TURN_HANDOFF_AND_PACING>
[조기 종료 금지]
- 관찰자 붕괴 결말(기다리며 / 기다렸다 / 바라보았다 / 확인했다 / 지켜보았다) — 최소 분량(MINIMUM_FLOOR) 미달 전 금지
</TURN_HANDOFF_AND_PACING>`;
}
