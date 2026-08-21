import { buildAutoProgressionUserControlBlock } from "@/lib/autoProgressionRules";
import type { CurrentTurnAuthoringDelegation } from "@/lib/currentTurnUserAuthoringDelegation";

/** Production modes only — legacy `novel` removed; normalize to autoContinue at request boundary. */
export type NoGodmoddingMode =
  | "standard"
  | "coNarration"
  | "autoContinue"
  | "currentTurnDelegated";

export type UserAgencyRuleOptions = {
  /** @deprecated auto-continue uses buildAutoProgressionUserControlBlock */
  autoContinueExpanded?: boolean;
};

/** Examples removed (static dedup) — rule meaning unchanged. */
export const NO_FALSE_SHARED_MEMORY_RULE = `[NO FALSE SHARED MEMORY]
실제 최근 대화, 장기기억, 에피소드 기억, 캐릭터 정본, 유저 페르소나에 없는 일을 "전에 말했잖아", "네가 약속했잖아", "그때 우리", "예전에 네가"처럼 이미 있었던 공유 기억으로 쓰지 않는다.
불확실하면 질문, 관찰, 추측, 새 발견으로 처리한다.`;

/**
 * @deprecated Nested interactive reinforcement — superseded by
 * `[USER CONTROL — COLLABORATIVE INTERACTIVE]` (single standard owner).
 */
export const LUNA_MINIMAL_CORE_V1_AGENCY_A1_SENTENCE =
  "현재까지 확정되지 않은 유저의 이동·대사·동의·선택·주도 행동을 새로 일어난 사실처럼 쓰지 않는다.";

/**
 * @deprecated Nested interactive owner — superseded by collaborative interactive block.
 * Kept for test/fixture references only; not injected on the production standard path.
 */
export const INTERACTIVE_USER_CONTROL_BLOCK = `[INTERACTIVE USER CONTROL]
일반 입력 턴에서는 유저의 대사, 의도적 행동, 생각, 결정, 동의/거절, 감정 결론, 신체 반응, 표정, 기억, 약속을 쓰지 않는다.
${LUNA_MINIMAL_CORE_V1_AGENCY_A1_SENTENCE}
분량을 채우기 위해 유저를 움직이지 않는다.
유저의 새 대사·선택·동의·주도 행동은 대신 확정하지 않는다.
현재 행동에서 직접 발생한 즉각적이고 가역적인 신체 반응만 제한적으로 묘사한다.
실제 대화·기억·페르소나에 없는 일을 “전에 말했잖아/아까 네가/네가 약속했잖아”로 꾸며 쓰지 말고, 불확실하면 질문·관찰·추측으로 한다.`;

export const COLLABORATIVE_INTERACTIVE_OWNER_TITLE =
  "[USER CONTROL — COLLABORATIVE INTERACTIVE]";

/** Single standard user-control owner (exactly one occurrence in interactive payload). */
export const COLLABORATIVE_INTERACTIVE_OWNER_BLOCK = `${COLLABORATIVE_INTERACTIVE_OWNER_TITLE}

USER_PERSONA, creator/scenario canon, 실제 대화와 확정 기억에 적힌 [B]의 외형·등급·능력·직업·소속·성격·과거는 현재 입력에 다시 나오지 않아도 정본으로 사용할 수 있다.

[B]의 새로운 직접 대사, 중요한 선택·동의·거절, 관계·목표·소속·정체성을 바꾸는 결정은 대신 확정하지 않는다.

현재 입력과 정본에 모순되지 않는 짧은 표정·시선·비자발적 반응, 이미 시작한 행동의 자연스러운 마무리, 사소한 이동·접촉·물건 수취·일상 행동은 공동 서술할 수 있다.

확정되지 않은 정보는 [A]의 관찰·추측·오해·소문·가설로 표현할 수 있다. 캐릭터의 추측은 객관적 사실과 구분한다.

[A]는 수동적으로 기다리기만 하지 않고 자신의 성격과 현재 상황에 맞는 대사·행동·접촉·제안을 능동적으로 수행한다.`;

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

/** Standard interactive — single collaborative owner. */
export function buildCompactNoGodmoddingStandardBlock(): string {
  return COLLABORATIVE_INTERACTIVE_OWNER_BLOCK;
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

export const CURRENT_TURN_OOC_DELEGATION_OWNER_TITLE =
  "[USER AUTHORING — CURRENT-TURN OOC DELEGATION]";

export type NoGodmoddingBlockOptions = {
  currentTurnDelegation?: CurrentTurnAuthoringDelegation;
};

function delegatedScopeLines(delegation?: CurrentTurnAuthoringDelegation): string {
  const allowDialogue = delegation?.allowDialogue === true;
  const allowMajorActions = delegation?.allowMajorActions === true;
  if (allowDialogue && allowMajorActions) {
    return `이번 턴에 [B]의 대사와 중요한 행동을 페르소나에 맞게 작성할 수 있다.
위임된 허구 턴을 이어가는 데 필요한 페르소나 일관 선택(수락·거절·망설임·접근·물러남)과 장면 국소적 후속 동작·반응·접근/후퇴는 허용한다. 이는 허구 페르소나 서술이며 현실 동의가 아니고, 이번 턴에만 적용된다.
현재 OOC·[USER_PERSONA]·확정 관계·장면·기억/정본 범위 밖의 정체성·소속·장기 관계·영구적 약속 같은 정본 변경은 대신하지 않는다.`;
  }
  if (allowDialogue) {
    return `이번 턴에 [B]의 직접 대사를 페르소나 말투·성격에 맞게 작성할 수 있다.
새로운 중요한 자발적 행동·동의/거절·관계·정체성 결정은 현재 입력이 이미 확정한 범위 밖에서는 대신하지 않는다.`;
  }
  if (allowMajorActions) {
    return `이번 턴에 [B]의 중요한 행동과 페르소나에 맞는 장면 진행을 작성할 수 있다.
요청된 장면을 자연스럽게 완성하기 위한 국소적 동작·반응·선택(접근·후퇴·망설임·수락·거절)은 허용한다. 현재 OOC·[USER_PERSONA]·확정 관계·장면·기억/정본 범위 밖의 정체성·소속·장기 관계·영구적 약속 같은 정본 변경은 대신하지 않는다.
현재 입력에 없는 새 [B] 대사는 만들지 않는다.`;
  }
  return `이번 턴의 위임 범위가 없으면 [USER CONTROL — COLLABORATIVE INTERACTIVE]와 같이 새 대사·중요 행동을 대신하지 않는다.`;
}

/** Current-turn OOC delegation owner — not LIMITED CO-NARRATION, not autoContinue. */
export function buildCurrentTurnDelegatedOwnerBlock(
  delegation?: CurrentTurnAuthoringDelegation
): string {
  return `${CURRENT_TURN_OOC_DELEGATION_OWNER_TITLE}

현재 사용자가 OOC로 이번 턴에 한해 유저 페르소나 서술을 위임했다. 이후 일반 입력 턴의 권한이 아니다.

[USER_PERSONA], 확정된 관계, 현재 장면, 실제 대화·기억을 정본으로 따른다. 새 성격을 만들지 않는다.

${delegatedScopeLines(delegation)}

짧은 표정·시선·호흡·습관·이미 시작된 상태의 자연스러운 마무리는 기존과 같이 공동 서술할 수 있다.`;
}

export function buildNoGodmoddingBlock(
  _charName: string,
  _userName: string,
  mode: NoGodmoddingMode = "standard",
  options?: NoGodmoddingBlockOptions
): string {
  switch (mode) {
    case "autoContinue":
      return buildAutoProgressionUserControlBlock();
    case "coNarration":
      return buildLimitedCoNarrationBlock();
    case "currentTurnDelegated":
      return buildCurrentTurnDelegatedOwnerBlock(options?.currentTurnDelegation);
    case "standard":
      return buildCompactNoGodmoddingStandardBlock();
    default: {
      const _exhaustive: never = mode;
      return _exhaustive;
    }
  }
}

/** @deprecated consolidated into buildNoGodmoddingBlock */
export function buildAutoContinueGodmoddingSupplement(
  _charName: string,
  _userName: string
): string {
  return "";
}

export function resolveNoGodmoddingMode(opts: {
  /** @deprecated Prefer legacyNovelModeEnabled — both normalize to autoContinue */
  novelModeEnabled?: boolean;
  legacyNovelModeEnabled?: boolean;
  impersonationOn?: boolean;
  isContinue?: boolean;
  /** Manual current-turn OOC only. Ignored when autoContinue already wins. */
  currentTurnDelegation?: CurrentTurnAuthoringDelegation | null;
}): NoGodmoddingMode {
  const legacyNovel =
    opts.legacyNovelModeEnabled === true || opts.novelModeEnabled === true;
  // Continue and legacy novel both → AI-focal auto progression (never novel POV)
  if (opts.isContinue || legacyNovel) return "autoContinue";
  if (opts.impersonationOn) return "coNarration";
  if (opts.currentTurnDelegation?.active) return "currentTurnDelegated";
  return "standard";
}
