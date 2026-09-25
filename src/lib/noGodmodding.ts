import { buildAutoProgressionUserControlBlock } from "@/lib/autoProgressionRules";
import { HISTORICAL_TRUTH_POLICY_SHORT_REF } from "@/lib/historicalTruthPolicy";
import {
  MANDATORY_RULES_BOUNDED_AUTHORITY_SHORT_REF,
  MANDATORY_RULES_BOUNDED_ROLE_DIRECTION_PRECEDENCE,
} from "@/lib/userNoteMandatoryRulesPolicy";
import type {
  CurrentTurnAuthoringDelegation,
  UserCoauthorDuration,
} from "@/lib/currentTurnUserAuthoringDelegation";

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

/** @deprecated Full semantics moved to HISTORICAL_TRUTH_POLICY_BLOCK — short ref only. */
export const NO_FALSE_SHARED_MEMORY_RULE = `[NO FALSE SHARED MEMORY]
${HISTORICAL_TRUTH_POLICY_SHORT_REF}`;

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

현재 턴의 런타임 모드(interactive / auto progression / OOC 위임)만 이번 응답의 [B] 집필 권한 기준이다. 이전 자동진행 턴에서 어시스턴트가 작성한 [B] 대사·행동, 예시 대화, 과거 위임·공동 서술은 장면 사실·연속성·말투 참고로만 쓰고, 현재 interactive 턴에서 새 [B] 직접 대사·중요 선택·동의/거절·감정 결론을 작성할 권한으로 삼지 않는다.

현재 입력에서 확정된 행동의 주체·대상·방향은 이번 응답의 기준으로 유지한다. [B]가 시작하거나 완료한 행동은 [B]의 행동으로 두고, [A]는 그 상황에 대한 반응·대응·대사·직접 결과를 이어간다.

다음 [B]의 새로운 의도적 선택이 필요한 순간에는 [A] 측에서 진행 가능한 반응까지 전개하고 [B]가 이어갈 반응점으로 둔다. ${MANDATORY_RULES_BOUNDED_ROLE_DIRECTION_PRECEDENCE}

USER_PERSONA, creator/scenario canon, 실제 대화와 확정 기억에 적힌 [B]의 외형·등급·능력·직업·소속·성격·과거는 현재 입력에 다시 나오지 않아도 정본으로 사용할 수 있다.

[B]의 새로운 직접 대사, 중요한 선택·동의·거절, 관계·목표·소속·정체성을 바꾸는 결정은 대신 확정하지 않는다.

현재 입력과 정본에 모순되지 않는 짧은 표정·시선·비자발적 반응, 이미 시작한 행동의 자연스러운 마무리, 사소한 이동·접촉·물건 수취·일상 행동은 공동 서술할 수 있다. 직접 자극에 따른 즉각적·가역적 신체 반응과 NPC/환경/기계의 직접 결과(버튼 불, 문 열림 등)는 허용한다. 새 목적·대상·연쇄 이동·탑승·층 선택·닫힘 버튼·중요한 intent는 현재 입력이 확정한 범위 밖에서 대신하지 않는다.

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

${MANDATORY_RULES_BOUNDED_AUTHORITY_SHORT_REF}

${POSSESSION_MODE_HINT}`;
}

export const USER_COAUTHOR_OWNER_TITLE =
  "[USER AUTHORING — EFFECTIVE COAUTHOR POLICY]";

/** @deprecated Legacy name retained for tests/importers; same canonical owner. */
export const CURRENT_TURN_OOC_DELEGATION_OWNER_TITLE = USER_COAUTHOR_OWNER_TITLE;

export const CURRENT_INPUT_OVERRIDES_PRIOR_ASSISTANT_LINE =
  "현재 사용자 입력이 이전에 어시스턴트가 쓴 [B] 대사·행동보다 우선한다. 방금 입력과 모순되는 페르소나 진행은 쓰지 않는다.";

export type NoGodmoddingBlockOptions = {
  currentTurnDelegation?: CurrentTurnAuthoringDelegation;
};

function resolveCoauthorDuration(
  delegation?: CurrentTurnAuthoringDelegation
): UserCoauthorDuration {
  return delegation?.duration === "persistent" ? "persistent" : "turn";
}

function coauthorDurationLine(duration: UserCoauthorDuration): string {
  if (duration === "persistent") {
    return "사용자가 유저 페르소나 공동 서술을 켜 두었다. 철회하기 전까지 이후 일반 입력 턴에도 같은 범위가 유지된다.";
  }
  return "현재 사용자가 OOC로 이번 턴에 한해 유저 페르소나 서술을 위임했다. 이후 일반 입력 턴의 권한이 아니다.";
}

function delegatedScopeLines(
  delegation?: CurrentTurnAuthoringDelegation,
  duration: UserCoauthorDuration = "turn"
): string {
  const allowDialogue = delegation?.allowDialogue === true;
  const allowMajorActions = delegation?.allowMajorActions === true;
  const allowInnerPov = delegation?.allowInnerPov === true;
  const allowIrreversibleFate = delegation?.allowIrreversibleFate === true;
  const turnLimited = duration === "turn";

  if (allowIrreversibleFate) {
    return `[B]의 대사·행동·감정·생각·속마음·내면 시점과 장면 선택을 완전한 소설 공동 집필 대상으로 다룬다.
[USER_PERSONA], 실제 대화, 확정 기억과 기존 정본에 모순되지 않는 범위에서 [B]의 수락·거절·배신·관계 변화·소속 이동·영구 부상·능력 상실·죽음 같은 불가역적 운명까지 서사적으로 확정할 수 있다.${turnLimited ? " 이번 턴에만 적용된다." : ""}
[B]가 죽거나 다른 불가역 상태가 성립하면 그 branch의 후속 상태로 유지한다. 명시적 부활·회귀·OOC 변경·분기 근거 없이 다음 턴에 자동 복구하거나 되살리지 않는다.
기존 [USER_PERSONA]/creator canon을 무시해서 설정을 바꾸는 권한은 아니다. 빈칸은 장면과 기존 성격에 일관되게 채울 수 있다.`;
  }

  if (allowInnerPov && allowDialogue && allowMajorActions) {
    return `[B]의 대사·행동·감정·생각·속마음·내면 독백과 장면 단위 선택을 [USER_PERSONA]와 실제 대화 흐름에 맞춰 소설처럼 공동 서술할 수 있다.${turnLimited ? " 이번 턴에만 적용된다." : ""}
[B]의 새 행동을 시작하고 대화 왕복을 이어가며, 망설임·접근·후퇴·수락·거절 같은 국소적 선택도 자연스럽게 쓸 수 있다.
다만 [B]의 사망, 영구 장애·능력 상실, 정체성·종족 변경, 장기 소속의 영구 변경, 결혼·영구 이별 같은 장기 관계 확정, 정본에 없던 가족사·과거를 객관적 사실로 새로 고정하는 불가역 변경은 현재 사용자 입력이나 명시적 전권 OOC 없이는 대신 확정하지 않는다.`;
  }

  if (allowDialogue && allowMajorActions) {
    return `[B]의 직접 대사와 외부에서 관찰 가능한 중요한 행동을 페르소나에 맞게 공동 서술할 수 있다.
장면에 필요한 일상적 선택, 대화 왕복, 접근·후퇴·망설임·수락·거절 같은 국소적 반응을 자연스럽게 이어갈 수 있다.${turnLimited ? " 이번 턴에만 적용된다." : ""}
[B]의 비공개 속마음·내면 독백·숨은 욕망을 객관적 사실로 쓰지 않는다. [B]의 사망·영구 상실·정체성·장기 관계·소속 같은 불가역 정본 변경도 대신 확정하지 않는다.`;
  }

  if (allowDialogue) {
    return `[B]의 직접 대사를 페르소나 말투·성격에 맞게 작성할 수 있다.
새로운 중요한 자발적 행동·내면·불가역 관계/정체성 결정은 현재 입력이 이미 확정한 범위 밖에서는 대신하지 않는다.`;
  }

  if (allowMajorActions) {
    return `[B]의 중요한 외부 행동과 페르소나에 맞는 장면 진행을 작성할 수 있다.
요청된 장면을 자연스럽게 완성하기 위한 국소적 동작·반응·선택(접근·후퇴·망설임·수락·거절)은 허용한다.
현재 입력에 없는 새 [B] 대사·비공개 내면·불가역 정본 변경은 만들지 않는다.`;
  }

  return `현재 [B] 집필 권한은 제한 상태다. 새 직접 대사·중요 행동·내면·불가역 결정을 대신하지 않고, 짧은 표정·시선·비자발적 반응과 이미 시작된 행동의 자연스러운 마무리만 공동 서술한다.`;
}
function aiCastIrreversibleExpansionLine(
  delegation?: CurrentTurnAuthoringDelegation
): string {
  if (delegation?.allowAiCastIrreversibleExpansion !== true) return "";
  return `AI가 담당하는 캐릭터·NPC·세계는 명시 정본과 충돌하지 않는 빈 과거·비밀을 창작해 해당 branch의 사실로 발전시킬 수 있고, 결혼·영구 이별·배신·조직 탈퇴·사망·능력 상실 같은 불가역 변화도 서사적으로 일으킬 수 있다.`;
}

/** Parameterized coauthor owner — turn-only or persistent. Not LIMITED CO-NARRATION. */
export function buildUserCoauthorOwnerBlock(
  delegation?: CurrentTurnAuthoringDelegation
): string {
  const duration = resolveCoauthorDuration(delegation);
  return `${USER_COAUTHOR_OWNER_TITLE}

${coauthorDurationLine(duration)}

[USER_PERSONA], 확정된 관계, 현재 장면, 실제 대화·기억을 정본으로 따른다. 새 성격을 만들지 않는다.

${delegatedScopeLines(delegation, duration)}

${aiCastIrreversibleExpansionLine(delegation)}

${CURRENT_INPUT_OVERRIDES_PRIOR_ASSISTANT_LINE}

${MANDATORY_RULES_BOUNDED_AUTHORITY_SHORT_REF}

짧은 표정·시선·호흡·습관·이미 시작된 상태의 자연스러운 마무리는 기존과 같이 공동 서술할 수 있다.`;
}

/** @deprecated Use buildUserCoauthorOwnerBlock. */
export function buildCurrentTurnDelegatedOwnerBlock(
  delegation?: CurrentTurnAuthoringDelegation
): string {
  return buildUserCoauthorOwnerBlock(delegation);
}

export function buildNoGodmoddingBlock(
  _charName: string,
  _userName: string,
  mode: NoGodmoddingMode = "standard",
  options?: NoGodmoddingBlockOptions
): string {
  switch (mode) {
    case "autoContinue":
      return buildAutoProgressionUserControlBlock(options?.currentTurnDelegation);
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
