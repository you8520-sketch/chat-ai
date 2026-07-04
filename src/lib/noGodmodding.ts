export type NoGodmoddingMode = "standard" | "coNarration" | "autoContinue" | "novel";

export type UserAgencyRuleOptions = {
  /** @deprecated auto-continue 확장 예시 제거 — standard와 동일 */
  autoContinueExpanded?: boolean;
};

/** Standard / auto-continue 공통 본문 */
export function buildCompactNoGodmoddingStandardBlock(): string {
  return `[NO GODMODDING]
[B]의 의도적 대사·행동·감정·판단은 작성하지 않는다.
허용: 생리적·반사적 반응만.
매 턴 [A](및 AI 담당 NPC)의 반응·행동·처지가 중심이다 — [A]와 [B]가 같은 장소에 있지 않거나, 유저 입력이 [B]의 행동·상황만 서술해도, 응답 **절반(50%) 이상**은 [A]가 지금 어디서 무엇을 하고 있는지·그 처지에서 무엇을 느끼는지를 **직접 서술**한다. [B] 장면만 길게 이어가며 [A]를 생략하지 마라. [B] 장면을 대신 창작하지는 않되, [A]의 병행 장면(오프스크린·원거리)은 [Memory]·직전 턴·이번 턴 사건을 근거로 추정해서 반드시 쓴다.`;
}

/** @deprecated auto-continue 확장 예시 제거 — standard 블록과 동일 */
export function buildAutoContinueAgencyExpansion(): string {
  return buildCompactNoGodmoddingStandardBlock();
}

/**
 * @deprecated Standard path uses buildCompactNoGodmoddingStandardBlock.
 */
export function buildUserAgencySensoryFeedbackRule(
  _charName: string,
  _userName: string,
  _options?: UserAgencyRuleOptions
): string {
  return buildCompactNoGodmoddingStandardBlock();
}

/** Single consolidated user-agency block — replaces scattered prohibitions across identity/core/speech/narration. */
export function buildNoGodmoddingBlock(
  _charName: string,
  _userName: string,
  mode: NoGodmoddingMode = "standard"
): string {
  if (mode === "novel") {
    return `[NO GODMODDING — NOVEL MODE]
소설 모드 ON — [NOVEL MODE — USER PERSONA NARRATION RULES]에 따라 [A]+[B] 공동 서술.
[B]는 [USER_PERSONA]를 따른다.`;
  }

  if (mode === "coNarration") {
    return `[NO GODMODDING]
주로 [A]로 연기.
공동 서술 ON — 유저가 입력한 의도 범위 내에서만 [B] 대사·행동 보조.
[B]의 감정·결정·주도적 행동은 새로 만들지 않는다.`;
  }

  if (mode === "autoContinue") {
    return buildCompactNoGodmoddingStandardBlock();
  }

  return buildCompactNoGodmoddingStandardBlock();
}

/** @deprecated auto-continue godmodding supplement 제거 — buildNoGodmoddingBlock(autoContinue)로 통합 */
export function buildAutoContinueGodmoddingSupplement(
  _charName: string,
  _userName: string
): string {
  return "";
}

export function resolveNoGodmoddingMode(opts: {
  novelModeEnabled?: boolean;
  impersonationOn?: boolean;
  isContinue?: boolean;
}): NoGodmoddingMode {
  if (opts.novelModeEnabled) return "novel";
  if (opts.impersonationOn) return "coNarration";
  if (opts.isContinue) return "autoContinue";
  return "standard";
}
