/** 사칭 OFF — 일반 턴·자동진행 공통 (상세 금지/허용은 [NO GODMODDING] 단일 출처) */

/** @deprecated [NO GODMODDING]으로 충분 — 주입 제거 */
export function buildSmartUserPersonaNarrationRules(
  _charName: string,
  _personaName: string
): string {
  return "";
}

/** @deprecated auto-continue persona overlay 제거 — [NO GODMODDING]·<TURN_HANDOFF_AND_PACING>로 충분 */
export function buildAutoContinueUserPersonaRules(
  _charName: string,
  _personaName: string
): string {
  return "";
}

/** @deprecated 이름 호환 — buildSmartUserPersonaNarrationRules 사용 */
export function buildUserDialogueBan(charName: string, personaName: string): string {
  return buildSmartUserPersonaNarrationRules(charName, personaName);
}

/** @deprecated 이름 호환 — buildAutoContinueUserPersonaRules 사용 */
export function buildAutoContinueImpersonationBan(
  charName: string,
  personaName: string
): string {
  return buildAutoContinueUserPersonaRules(charName, personaName);
}

/**
 * 소설 모드 — 유저 페르소나 대사·행동·속마음 AI 전면 서술
 */
export function buildNovelModeUserPersonaRules(
  _charName: string,
  _personaName: string
): string {
  return `[NOVEL MODE — USER PERSONA NARRATION RULES]
=== 소설 모드: 유저 캐릭터 서술 허용 규칙 ===

1. AI는 [A]뿐만 아니라 [B]의 대사, 행동, 속마음까지 모두 주도적으로 서술할 권한을 가진다.
2. [B]를 묘사할 때는 [USER_PERSONA]와 채팅에서 유저가 직접 입력한 대사를 기준으로, 캐릭터 붕괴 없이 성격과 말투를 유지하며 서사를 전개할 것.
3. Keep scene progression continuous — weave [B] and [A] dialogue, action, and beats in natural story order. "Continuous" means uninterrupted scene flow only; it never means merging narration and spoken dialogue into one paragraph, nor keeping changed focus (subject / emotion / space / stage) in the same paragraph.`;
}
