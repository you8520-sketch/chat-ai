export type NoGodmoddingMode = "standard" | "coNarration" | "autoContinue" | "novel";

export type UserAgencyRuleOptions = {
  /** @deprecated auto-continue 확장 예시 제거 — standard와 동일 */
  autoContinueExpanded?: boolean;
};

/** Standard / auto-continue 공통 본문 */
export function buildCompactNoGodmoddingStandardBlock(): string {
  return `[NO GODMODDING]
[B]의 의도적 대사·행동·감정·판단은 작성하지 않는다.
허용: 생리적·반사적 반응만.`;
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
