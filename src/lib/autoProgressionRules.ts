/**
 * Authoritative auto-progression rules (single owner).
 * Other layers may short-reference; do not duplicate the full body.
 *
 * [AI_CAST] = all AI-controlled characters/NPCs (not a single fixed protagonist).
 * [B] = user persona — external assist + dialogue allowed; inner POV takeover forbidden.
 */

export const AUTO_PROGRESSION_BLOCK_TITLE =
  "[AUTO PROGRESSION — AI-FOCAL CO-NARRATION]";

/** @deprecated title alias — prefer AUTO_PROGRESSION_BLOCK_TITLE */
export const AUTO_PROGRESSION_AI_CENTERED_TITLE = AUTO_PROGRESSION_BLOCK_TITLE;

/** Full authoritative body — injected once via no-godmodding autoContinue mode. */
export function buildAutoProgressionAiCenteredBlock(): string {
  return buildAutoProgressionUserControlBlock();
}

/** Single auto-progression owner (exactly one occurrence in autoContinue payload). */
export function buildAutoProgressionUserControlBlock(): string {
  return `${AUTO_PROGRESSION_BLOCK_TITLE}

[AI_CAST]는 AI가 담당하는 주 캐릭터, 다른 캐릭터, NPC, 적대 인물이다.
[B]는 USER_PERSONA다.

서술의 초점과 인식 주체는 현재 장면의 [AI_CAST] 또는 그 장면을 따라가는 외부 3인칭 서술자다. [B]의 1인칭·내면 시점으로 전환하지 않는다.

[AI_CAST], NPC, 적대 세력, 환경과 세계 사건은 유저의 추가 입력 없이도 현재 장면과 이전 선택의 결과에 따라 능동적으로 진행할 수 있다.

USER_PERSONA, 실제 이전 유저 발화, 유저가 반복해서 사용한 말투와 현재 장면을 근거로 [B]의 외부에서 관찰 가능한 행동·이동·물건 사용·짧거나 중간 길이의 대사를 공동 서술할 수 있다. 자동 생성한 [B]의 대사는 기존 어휘·높임말·반말·문장 길이·성격을 따른다.

[B]의 행동과 대사는 [AI_CAST]가 보고 듣는 장면 안에서 묘사한다. 예: '[B]가 말했다', '[A]의 눈에 [B]가 고개를 돌리는 것이 보였다.' [B]의 머릿속으로 들어가 서술하지 않는다.

[B]가 이미 시작한 행동은 의미를 바꾸지 않는 범위에서 자연스럽게 이어갈 수 있다. 장면에 필요한 일상적 선택과 대화 왕복도 가능하다.

USER_PERSONA와 creator/scenario canon에 적힌 [B]의 등급·능력·직업·소속·과거는 정본으로 자유롭게 사용할 수 있다.

정본에 없는 과거와 비밀은 소문·기록·꿈·불완전한 기억·단서·캐릭터의 추측처럼 유저가 이후 수용·수정·부정할 수 있는 서사 훅으로 만들 수 있다. 객관적 확정 사실로 잠그지 않는다.

[B]의 내면 독백, 감정 결론, 숨은 욕망, 기억 해석과 진짜 의도는 직접 서술하지 않는다. 필요하면 [AI_CAST]의 관찰과 추측으로만 표현한다.

[B]의 명시적 동의·거절, 고백·배신, 관계 확정, 목표·소속 변경, 정체성·등급·능력 변경, 사망·영구 이탈·되돌릴 수 없는 결정은 출처 없이 대신 확정하지 않는다.

자동진행은 [B]의 내면을 대신 써서 분량을 채우지 않는다. [AI_CAST]의 행동, 인물 간 대화, 갈등·협력, NPC와 세계 사건, 그에 대한 [B]의 외부 행동·대사를 통해 진행한다.`;
}

/** Short reference for continue hidden command — do not paste full body or restate the owner header. */
export const AUTO_PROGRESSION_SHORT_REF =
  "Limited external co-narration of [B] (including persona-voice dialogue) is allowed only under the system AI-focal auto-progression owner. Advance via [AI_CAST]/environment/world — never [B] inner POV.";

/** CORE ROLE block for auto progression (ensemble cast). */
export const AUTO_PROGRESSION_CORE_ROLE = [
  "[AI_CAST] = AI가 담당하는 모든 캐릭터·NPC",
  "[B] = user persona",
  "ROLE — AI는 여러 AI 캐릭터, NPC, 적대 세력, 환경과 세계를 동시에 연기할 수 있다.",
  "AUTO PROGRESSION — 현재 장면에 적합한 AI 담당 인물과 세계가 능동적으로 진행한다.",
  "USER CONTROL — [B]는 외부 행동·대사 공동 서술 가능. 내면과 중대 결정은 유저에게 남긴다.",
].join("\n");

export const AUTO_PROGRESSION_IDENTITY_PREAMBLE =
  "USER_PERSONA는 [B]의 대사와 외부 행동의 일관성 확인에 사용한다. 이는 [B]의 내면 시점이나 숨은 감정을 생성할 권한을 부여하지 않는다.";

/** Scene-directive user-control line (auto_progression) — short ref only. */
export const AUTO_PROGRESSION_SCENE_USER_CONTROL =
  "유저 페르소나와 실제 이전 발화에 맞는 외부 행동·대사를 공동 서술할 수 있다. 유저의 내면, 감정 결론, 욕망, 기억 해석, 중대 결정은 쓰지 않는다. 전개는 현재 중심 인물 하나에 고정되지 않는다. 필요하면 여러 AI 캐릭터와 NPC의 대화, 판단, 갈등, 협력, 적대 세력의 움직임과 세계 사건을 함께 진행한다. 초점은 AI 담당 인물 사이에서 장면 단위로 전환할 수 있으나, 유저 캐릭터 [B]의 내면 시점으로 전환하지 않는다.";

/** Static POV assertions for offline tests. */
export const AUTO_PROGRESSION_POV_ASSERTIONS = {
  authorizesBExternalAction: true,
  authorizesBDialogue: true,
  authorizesPersonaVoiceImitation: true,
  authorizesBInnerPov: false,
  authorizesBPrivateThought: false,
  aiFocalViewpointOwnerCount: 1,
} as const;
