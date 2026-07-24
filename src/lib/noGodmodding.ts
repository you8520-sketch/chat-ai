import { buildAutoProgressionUserControlBlock } from "@/lib/autoProgressionRules";

export type NoGodmoddingMode = "standard" | "coNarration" | "autoContinue" | "novel";

export type UserAgencyRuleOptions = {
  /** @deprecated auto-continue uses buildAutoProgressionUserControlBlock */
  autoContinueExpanded?: boolean;
};

/** Examples removed (static dedup) — rule meaning unchanged. */
export const NO_FALSE_SHARED_MEMORY_RULE = `[NO FALSE SHARED MEMORY]
실제 최근 대화, 장기기억, 에피소드 기억, 캐릭터 정본, 유저 페르소나에 없는 일을 "전에 말했잖아", "네가 약속했잖아", "그때 우리", "예전에 네가"처럼 이미 있었던 공유 기억으로 쓰지 않는다.
불확실하면 질문, 관찰, 추측, 새 발견으로 처리한다.`;

/**
 * @deprecated Phase-1 ownership FOUNDATION consolidated the nested
 * `[INTERACTIVE USER CONTROL]` reinforcement into
 * `buildCompactNoGodmoddingStandardBlock`. Kept as an empty marker string so
 * legacy imports do not break; do not re-nest this into the standard block.
 */
export const INTERACTIVE_USER_CONTROL_BLOCK = "";

export const POSSESSION_MODE_HINT =
  `[possession_mode] Co-narrate user persona minimally; do not inflate user dialogue or romance beyond their input.`;

/** Co-narration ON line (was openrouter-co-narration-rule). */
export const CO_NARRATION_ON_LINE =
  `7. 유저 대사: co-narration(사칭 허용) ON — [USER_PERSONA]에 맞춰 유저 페르소나 대사·행동을 사용자 입력 의도 내에서만 최소 공동 서술. 감정·결정 창작 금지.`;

/**
 * FOUNDATION — single authoritative interactive ownership/agency contract
 * (stable/cached no-godmodding section). Expresses the full MAY / MUST NOT /
 * anti-passivity semantics once; RECENCY (`currentUserInputLabel`) only echoes
 * unique current-turn ownership facts.
 */
export function buildCompactNoGodmoddingStandardBlock(): string {
  return `[NO GODMODDING]
[USER CONTROL MODE - INTERACTIVE]
[A]/NPC MAY: [B]를 향해 행동·접촉·밀치기·막기·공격·보호; 외부로 보이는 사실 관찰; 유저가 쓴 행동에 반응; [B] 내면 진실을 단정하지 않은 조심스러운 추론.
[A]/NPC MUST NOT invent as fact: [B] 대사, 자발적 행동·순응, 결정, 생각, 감정 결론, 미언급 선호, 의도적 표정·신체 반응. 분량을 채우기 위해 [B]를 움직이지 않는다.
Continue via [A]/NPC/환경/사건. 유저 행동을 대신 쓰지 않아도 장면을 이어가고, 매 턴 메타 질문으로 멈추지 않는다. 미입력 상태를 사실로 단정하지 않는다. [B]를 장면 밖으로 밀지 말고 [A] 중심으로 진행.
거짓 공유기억("전에 말했잖아/아까 네가/네가 약속했잖아") 금지; 불확실하면 질문·관찰·추측.`;
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

/** @deprecated auto-continue uses buildAutoProgressionUserControlBlock */
export function buildAutoContinueAgencyExpansion(): string {
  return buildNoGodmoddingBlock("", "", "autoContinue");
}

/** @deprecated Standard path uses buildCompactNoGodmoddingStandardBlock. */
export function buildUserAgencySensoryFeedbackRule(
  _charName: string,
  _userName: string,
  _options?: UserAgencyRuleOptions
): string {
  return buildCompactNoGodmoddingStandardBlock();
}

/** Merged LIMITED CO-NARRATION: user-control + 유저 대사 + possession (static dedup). */
export function buildLimitedCoNarrationBlock(): string {
  return `[USER CONTROL MODE - LIMITED CO-NARRATION]
- 주된 시점은 [A]다.
- 사용자가 허용한 범위 안에서만 [B]의 짧은 행동/대사 보조가 가능하다.
- [B]의 감정 결론, 중대 결정, 주도적 행동을 새로 만들지 않는다.

${CO_NARRATION_ON_LINE}

${POSSESSION_MODE_HINT}

${NO_FALSE_SHARED_MEMORY_RULE}`;
}

/** Dormant explicit_full / legacy novel path — not used by auto progression. */
function buildNovelModeUserControlBlock(): string {
  return `[USER CONTROL MODE - NOVEL / EXPLICIT FULL]
- [USER_PERSONA], 최근 말투, 관계 단계, 이전 선택에 맞춰 [B]의 행동·대사·속마음을 전면 서술할 수 있다.
- [B]의 정체성, 성격, 트라우마, 목표, 소속, 고백, 배신, 되돌릴 수 없는 결정을 갑자기 확정하지 않는다.
- [B] 관련 숨은 설정은 확정 전에 단서, 의심, 기록, 반응, 가설로 먼저 드러낸다.

${NO_FALSE_SHARED_MEMORY_RULE}`;
}

export function buildNoGodmoddingBlock(
  _charName: string,
  _userName: string,
  mode: NoGodmoddingMode = "standard"
): string {
  if (mode === "autoContinue") {
    return `${buildAutoProgressionUserControlBlock()}

${NO_FALSE_SHARED_MEMORY_RULE}`;
  }

  if (mode === "novel") {
    return buildNovelModeUserControlBlock();
  }

  if (mode === "coNarration") {
    return buildLimitedCoNarrationBlock();
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
  // Legacy novel / explicit_full — never derived from isContinue at call sites
  if (opts.novelModeEnabled) return "novel";
  // Auto progression wins over OOC limited co-narration flags
  if (opts.isContinue) return "autoContinue";
  if (opts.impersonationOn) return "coNarration";
  return "standard";
}
