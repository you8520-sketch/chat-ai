/** 사칭 OFF — 일반 턴·자동진행 공통 (상세 금지/허용은 [NO GODMODDING] 단일 출처) */

/**
 * 일반 턴 system tail — [USER PERSONA NARRATION RULES]
 * Pacing/role only — FORBIDDEN/ALLOWED lists live in [NO GODMODDING].
 */
export function buildSmartUserPersonaNarrationRules(
  _charName: string,
  _personaName: string
): string {
  return `[USER PERSONA NARRATION] [NO GODMODDING] 그대로 적용. [B]는 awareness용 — 조종 권한 아님.`;
}

/**
 * 자동진행 턴 — AI 주도권 강조 overlay
 */
export function buildAutoContinueUserPersonaRules(
  _charName: string,
  _personaName: string
): string {
  return `[AUTO-CONTINUE — USER PERSONA NARRATION RULES]
(Supplements [NO GODMODDING] — auto-continue turn, no new user input)

Lead the scene through [A] dialogue and action only.
[B] stays reaction-only per [NO GODMODDING] (auto-continue expanded); do NOT treat [B] as a silent prop.
Auto-continue handoff: obey <TURN_HANDOFF_AND_PACING>.`;
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
[A] = AI character · [B] = user's persona character

1. AI는 [A]뿐만 아니라 [B]의 대사, 행동, 속마음까지 모두 주도적으로 서술할 권한을 가진다.
2. [B]를 묘사할 때는 [USER_PERSONA]와 채팅에서 유저가 직접 입력한 대사를 기준으로, 캐릭터 붕괴 없이 성격과 말투를 유지하며 서사를 전개할 것.
3. 마치 두 명의 캐릭터가 등장하는 한 편의 완성된 웹소설을 쓰듯이, 티키타카(대화)와 행동의 합을 자연스럽게 묘사하여 이야기를 이끌어 나갈 것.`;
}
