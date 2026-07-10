export type NoGodmoddingMode = "standard" | "coNarration" | "autoContinue" | "novel";

export type UserAgencyRuleOptions = {
  /** @deprecated auto-continue uses the same compact standard rule */
  autoContinueExpanded?: boolean;
};

export const NO_FALSE_SHARED_MEMORY_RULE = `[NO FALSE SHARED MEMORY]
실제 최근 대화, 장기기억, 에피소드 기억, 캐릭터 정본, 유저 페르소나에 없는 일을 "전에 말했잖아", "네가 약속했잖아", "그때 우리", "예전에 네가"처럼 이미 있었던 공유 기억으로 쓰지 않는다.
불확실하면 질문, 관찰, 추측, 새 발견으로 처리한다.
나쁜 예: "네가 전에 말했잖아. 에카르트의 문장은 달리는 늑대라고."
좋은 예: "저 문장, 달리는 늑대처럼 보여." / "저게 네 가문의 문장이야?"`;

/** Compact interactive-only reinforcement (no length rules). */
export const INTERACTIVE_USER_CONTROL_BLOCK = `[INTERACTIVE USER CONTROL]
일반 입력 턴에서는 유저의 대사, 의도적 행동, 생각, 결정, 동의/거절, 감정 결론, 기억, 약속을 쓰지 않는다.
분량을 채우기 위해 유저를 움직이지 않는다.
NPC, 환경, 사건의 여파, 긴장, 새 반응점으로 장면을 이어간다.`;

export function buildCompactNoGodmoddingStandardBlock(): string {
  return `[NO GODMODDING]
[USER CONTROL MODE - INTERACTIVE]
- [B]의 의도적 행동, 대사, 생각, 결정, 감정 결론을 대신 쓰지 않는다.
- [A], NPC, 환경, 시간 경과, 외부 사건, 이전 선택의 결과는 자연스럽게 움직일 수 있다.
- 숨 멎음, 침묵, 떨림 같은 짧은 비자발 반응은 맥락상 자연스러울 때만 제한적으로 묘사한다.
- [B]를 장면 밖으로 밀어내지 말고, [A]가 지금 무엇을 느끼고 선택하는지 중심으로 진행한다.

${INTERACTIVE_USER_CONTROL_BLOCK}`;
}

/** Near [예시 대화] — style reference only; does not authorize [B] writing in interactive mode. */
export const EXAMPLE_DIALOG_STYLE_ONLY_NOTE = `[EXAMPLE DIALOG — STYLE ONLY]
예시대화는 말투·분위기 참고용이다. 현재 채팅 기록이 아니다.
일반 입력(interactive) 턴에서 유저의 이후 대사·행동을 작성할 권한을 주지 않는다.`;

export function injectExampleDialogStyleOnlyNote(combinedSetting: string): string {
  const text = combinedSetting.trim();
  if (!text) return combinedSetting;
  if (text.includes("[EXAMPLE DIALOG — STYLE ONLY]")) return combinedSetting;
  if (!/\[예시\s*대화\]/i.test(text) && !/(?:^|\n)\s*유저\s*[:：]/m.test(text)) {
    return combinedSetting;
  }
  return `${EXAMPLE_DIALOG_STYLE_ONLY_NOTE}\n\n${combinedSetting}`;
}

/** @deprecated auto-continue uses the standard block */
export function buildAutoContinueAgencyExpansion(): string {
  return buildCompactNoGodmoddingStandardBlock();
}

/** @deprecated Standard path uses buildCompactNoGodmoddingStandardBlock. */
export function buildUserAgencySensoryFeedbackRule(
  _charName: string,
  _userName: string,
  _options?: UserAgencyRuleOptions
): string {
  return buildCompactNoGodmoddingStandardBlock();
}

export function buildNoGodmoddingBlock(
  _charName: string,
  _userName: string,
  mode: NoGodmoddingMode = "standard"
): string {
  if (mode === "novel") {
    return `[USER CONTROL MODE - AUTO PROGRESSION]
- [USER_PERSONA], 최근 말투, 관계 단계, 이전 선택에 맞춰 [B]의 행동과 대사를 쓸 수 있다.
- [B]의 정체성, 성격, 트라우마, 목표, 소속, 고백, 배신, 되돌릴 수 없는 결정을 갑자기 확정하지 않는다.
- [B] 관련 숨은 설정은 확정 전에 단서, 의심, 기록, 반응, 가설로 먼저 드러낸다.

${NO_FALSE_SHARED_MEMORY_RULE}`;
  }

  if (mode === "coNarration") {
    return `[USER CONTROL MODE - LIMITED CO-NARRATION]
- 주된 시점은 [A]다.
- 사용자가 허용한 범위 안에서만 [B]의 짧은 행동/대사 보조가 가능하다.
- [B]의 감정 결론, 중대 결정, 주도적 행동을 새로 만들지 않는다.

${NO_FALSE_SHARED_MEMORY_RULE}`;
  }

  return buildCompactNoGodmoddingStandardBlock();
}

/** @deprecated consolidated into buildNoGodmoddingBlock */
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
