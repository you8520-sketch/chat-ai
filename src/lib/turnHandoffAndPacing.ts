/** Scene continuation + turn-end policy — handoff only after length floor at response tail. */

export const SCENE_CONTINUATION_PRIORITY_BLOCK = `[SCENE CONTINUATION PRIORITY]
Never stop at the first satisfying ending.
감정의 여운·몸짓·분위기 변화·새 상호작용까지 이어간다.
Expand through progression, never repetition.`;

export function buildTurnHandoffAndPacingBlock(): string {
  return `<TURN_HANDOFF_AND_PACING>
[조기 종료 금지]
- MINIMUM_FLOOR 미달 전 조기 종료·관찰자 붕괴 결말 금지

[TURN HANDOFF]
Never end immediately after a seemingly complete moment.
Continue through:
- emotional aftermath
- body language
- atmosphere change
- new interaction
Return the scene naturally to the user.
</TURN_HANDOFF_AND_PACING>`;
}
