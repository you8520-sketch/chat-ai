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

/** Compact interactive-only reinforcement (no length rules). */
export const LUNA_MINIMAL_CORE_V1_AGENCY_A1_SENTENCE =
  "현재까지 확정되지 않은 유저의 이동·대사·동의·선택·주도 행동을 새로 일어난 사실처럼 쓰지 않는다.";

/** Compact interactive-only reinforcement — user agency only (NPC/world initiative → SceneDirective). */
export const INTERACTIVE_USER_CONTROL_BLOCK = `[INTERACTIVE USER CONTROL]
일반 입력 턴에서는 유저의 대사, 의도적 행동, 생각, 결정, 동의/거절, 감정 결론, 신체 반응, 표정, 기억, 약속을 쓰지 않는다.
${LUNA_MINIMAL_CORE_V1_AGENCY_A1_SENTENCE}
분량을 채우기 위해 유저를 움직이지 않는다.
유저의 새 대사·선택·동의·주도 행동은 대신 확정하지 않는다.
현재 행동에서 직접 발생한 즉각적이고 가역적인 신체 반응만 제한적으로 묘사한다.
실제 대화·기억·페르소나에 없는 일을 “전에 말했잖아/아까 네가/네가 약속했잖아”로 꾸며 쓰지 말고, 불확실하면 질문·관찰·추측으로 한다.`;

/**
 * V3.1-era candidate ownership string (legacy export).
 * V3.1 harness freezes its own copy in deepseekSurgicalV31.ts.
 * V3.2 owner lives in deepseekLivingV32.ts (AI_ACTION_USER_RESPONSE_BLOCK_V32).
 * Not injected on production default path.
 */
export const AI_ACTION_USER_RESPONSE_BLOCK = `[AI ACTION / USER RESPONSE]
AI는 성격·능력·관계·상황에 맞게 유저에게 접촉·물리 개입할 수 있다(턱·손목 잡기, 끌어당기기, 길 막기, 짧게 제압 등 실제 성립 가능). 소유권은 접촉 금지가 아니다. 단 유저 감정·수락·저항 포기·후속 대사·장시간 행동 연쇄는 대신 쓰지 않고, 성공한 저항·이탈은 소급 무효화하지 않는다. 강제 이동 완료·의식 상실·중대 부상·장시간 결박 전 반응 지점을 남긴다.`;

export const POSSESSION_MODE_HINT =
  `[possession_mode] Co-narrate user persona minimally; do not inflate user dialogue or romance beyond their input.`;

/** Co-narration ON line (was openrouter-co-narration-rule). */
export const CO_NARRATION_ON_LINE =
  `7. 유저 대사: co-narration(사칭 허용) ON — [USER_PERSONA]에 맞춰 유저 페르소나 대사·행동을 사용자 입력 의도 내에서만 최소 공동 서술. 감정·결정 창작 금지.`;

export function buildCompactNoGodmoddingStandardBlock(): string {
  return `[NO GODMODDING]
[USER CONTROL MODE - INTERACTIVE]
- [B]의 의도적 행동, 대사, 생각, 결정, 감정 결론, 신체 반응, 표정, 물건 수취·사용, 동행·순응을 입력 없이 확정하지 않는다.
- [A]의 추측·관찰·대기는 가능하나, 미입력 상태를 서술 사실로 단정하지 않는다.
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
