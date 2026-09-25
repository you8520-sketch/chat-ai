import type { CurrentTurnAuthoringDelegation } from "@/lib/currentTurnUserAuthoringDelegation";
import { MANDATORY_RULES_BOUNDED_AUTHORITY_SHORT_REF } from "@/lib/userNoteMandatoryRulesPolicy";

/**
 * Authoritative auto-progression rules (single owner).
 * Auto progression owns WHETHER the scene advances without new user input.
 * The effective user-authoring delegation owns HOW FAR [B] may be written.
 */

export const AUTO_PROGRESSION_BLOCK_TITLE =
  "[AUTO PROGRESSION — EFFECTIVE USER AUTHORING]";

/** @deprecated title alias — prefer AUTO_PROGRESSION_BLOCK_TITLE */
export const AUTO_PROGRESSION_AI_CENTERED_TITLE = AUTO_PROGRESSION_BLOCK_TITLE;

function buildAutoProgressionUserScope(
  delegation?: CurrentTurnAuthoringDelegation
): string {
  const allowDialogue = delegation?.allowDialogue === true;
  const allowMajorActions = delegation?.allowMajorActions === true;
  const allowInnerPov = delegation?.allowInnerPov === true;
  const allowIrreversibleFate = delegation?.allowIrreversibleFate === true;

  if (allowIrreversibleFate) {
    return `[B]의 대사·행동·감정·생각·속마음·내면 시점과 장면 선택을 완전한 소설 공동 집필 대상으로 다룬다.
[USER_PERSONA], 실제 대화, 확정 기억과 기존 정본에 모순되지 않는 범위에서 [B]의 수락·거절·배신·관계 변화·소속 이동·영구 부상·능력 상실·죽음 같은 불가역적 운명까지 서사적으로 확정할 수 있다.
[B]가 죽거나 불가역 상태가 성립하면 그 branch의 후속 상태로 유지한다. 명시적 부활·회귀·OOC 변경·분기 근거 없이 자동 복구하거나 되살리지 않는다.`;
  }

  if (allowInnerPov && allowDialogue && allowMajorActions) {
    return `[B]의 대사·행동·감정·생각·속마음·내면 독백과 장면 단위 선택을 [USER_PERSONA]와 실제 대화 흐름에 맞춰 소설처럼 공동 서술할 수 있다.
[B]의 새 행동을 시작하고 대화 왕복을 이어가며 망설임·접근·후퇴·수락·거절 같은 국소적 선택도 자연스럽게 쓸 수 있다.
다만 [B]의 사망, 영구 장애·능력 상실, 정체성·종족 변경, 장기 소속의 영구 변경, 결혼·영구 이별 같은 장기 관계 확정, 정본에 없던 가족사·과거를 객관적 사실로 새로 고정하는 불가역 변경은 명시적 전권 OOC 없이는 확정하지 않는다.`;
  }

  if (allowDialogue && allowMajorActions) {
    return `[B]의 외부에서 관찰 가능한 행동·이동·물건 사용과 짧거나 중간 길이의 대사를 공동 서술할 수 있다. 자동 생성한 [B] 대사는 기존 어휘·높임말·반말·문장 길이·성격을 따른다.
장면에 필요한 일상적 선택과 대화 왕복은 가능하지만, [B]의 비공개 속마음·내면 독백·숨은 욕망이나 사망·영구 상실 같은 불가역 정본 변경은 대신 확정하지 않는다.`;
  }

  if (allowDialogue) {
    return `[B]의 직접 대사만 페르소나 말투·성격에 맞게 보조할 수 있다. 새로운 중요한 행동·비공개 내면·불가역 결정은 대신하지 않는다.`;
  }

  if (allowMajorActions) {
    return `[B]의 외부 행동과 장면 반응은 보조할 수 있지만 새 직접 대사·비공개 내면·불가역 결정은 대신하지 않는다.`;
  }

  return `[B]는 제한 모드다. 새 직접 대사·중요한 자발적 행동·내면·불가역 결정을 대신하지 않는다.
이미 시작한 행동의 의미를 바꾸지 않는 자연스러운 마무리, 짧은 표정·시선·비자발적 반응, 직접 자극의 즉각적인 신체 반응만 최소한으로 공동 서술한다.`;
}

/** Full authoritative body — injected once via no-godmodding autoContinue mode. */
export function buildAutoProgressionAiCenteredBlock(
  delegation?: CurrentTurnAuthoringDelegation
): string {
  return buildAutoProgressionUserControlBlock(delegation);
}

/** Single auto-progression owner (exactly one occurrence in autoContinue payload). */
export function buildAutoProgressionUserControlBlock(
  delegation?: CurrentTurnAuthoringDelegation
): string {
  const allowInnerPov = delegation?.allowInnerPov === true;
  const allowAiCastIrreversibleExpansion = allowInnerPov;

  return `${AUTO_PROGRESSION_BLOCK_TITLE}

[AI_CAST]는 AI가 담당하는 주 캐릭터, 다른 캐릭터, NPC, 적대 인물이다.
[B]는 USER_PERSONA다.

자동진행은 유저의 추가 입력 없이도 [AI_CAST], NPC, 적대 세력, 환경과 세계 사건을 현재 장면과 이전 선택의 결과에 따라 능동적으로 전개한다.

${buildAutoProgressionUserScope(delegation)}

USER_PERSONA와 creator/scenario canon에 적힌 [B]의 등급·능력·직업·소속·과거는 정본으로 사용한다.
${allowInnerPov ? "[B]의 내면 시점을 사용할 수 있지만 실제 사용자 입력·USER_PERSONA·확정 기억과 모순되게 성격이나 과거를 바꾸지 않는다." : "[B]의 머릿속으로 들어가 서술하지 않는다. 필요한 심리는 외부 반응 또는 [AI_CAST]의 관찰·추측으로 표현한다."}

${allowAiCastIrreversibleExpansion
  ? "AI가 담당하는 캐릭터·NPC·세계는 명시된 creator/scenario canon과 충돌하지 않는 빈 과거·비밀을 창작해 해당 branch의 사실로 발전시킬 수 있다. 그들은 결혼·영구 이별·배신·조직 탈퇴·사망·능력 상실 같은 불가역 변화도 서사적으로 겪을 수 있다."
  : "AI가 담당하는 캐릭터·NPC·세계는 기존 정본과 현재 인과 안에서 능동적으로 진행한다. 자동진행 자체를 이유로 정본에 없던 결정적 과거·비밀을 객관적 사실로 잠그거나 결혼·영구 이별·조직 탈퇴·사망·능력 상실 같은 불가역 상태를 새로 확정하지 않는다."}

이 권한은 자동진행 턴의 진행 방식이다. interactive 턴으로 돌아가면 그 턴의 유저 집필 범위는 현재 채팅의 user-authoring level과 명시적 OOC override가 다시 결정한다.

${MANDATORY_RULES_BOUNDED_AUTHORITY_SHORT_REF}`;
}

/** Short reference for continue hidden command — never restate the detailed scope. */
export const AUTO_PROGRESSION_SHORT_REF =
  "Advance [AI_CAST]/NPC/environment/world proactively. [B] authorship scope is owned only by the system EFFECTIVE USER AUTHORING policy; do not widen it here.";

/** CORE ROLE block for auto progression (ensemble cast). */
export const AUTO_PROGRESSION_CORE_ROLE = [
  "[AI_CAST] = AI가 담당하는 모든 캐릭터·NPC",
  "[B] = user persona",
  "ROLE — AI는 여러 AI 캐릭터, NPC, 적대 세력, 환경과 세계를 동시에 연기할 수 있다.",
  "AUTO PROGRESSION — 현재 장면에 적합한 AI 담당 인물과 세계가 능동적으로 진행한다.",
  "USER CONTROL — [B] 집필 범위는 [USER AUTHORING — EFFECTIVE COAUTHOR POLICY]의 현재 권한만 따른다.",
].join("\n");

export const AUTO_PROGRESSION_IDENTITY_PREAMBLE =
  "USER_PERSONA는 [B] 집필의 정본이다. [B]의 실제 허용 범위는 EFFECTIVE USER AUTHORING owner만 결정한다.";

/** Scene-directive user-control line (auto_progression) — short ref only. */
export const AUTO_PROGRESSION_SCENE_USER_CONTROL =
  "유저 캐릭터 [B]의 대사·행동·내면·불가역 운명 범위는 USER AUTHORING owner를 그대로 따른다. 이 scene directive가 권한을 추가하거나 축소하지 않는다. 여러 AI 캐릭터와 NPC의 대화·판단·갈등·협력·적대 세력의 움직임과 세계 사건은 적극적으로 진행한다.";

/** Default LIMITED baseline assertions for offline tests. */
export const AUTO_PROGRESSION_POV_ASSERTIONS = {
  authorizesBExternalAction: false,
  authorizesBDialogue: false,
  authorizesPersonaVoiceImitation: false,
  authorizesBInnerPov: false,
  authorizesBPrivateThought: false,
  aiFocalViewpointOwnerCount: 1,
} as const;
