/**
 * SceneDirective V2 — Event Restraint + Two-Turn Reconvergence pacing governor.
 * Does not modify legacy sceneDirective.ts. Injection gated by SCENE_DIRECTIVE_V2_MODE.
 */

import type { ChatMsg } from "@/lib/ai";
import { AUTO_PROGRESSION_SCENE_USER_CONTROL } from "@/lib/autoProgressionRules";
import { NO_FALSE_SHARED_MEMORY_RULE } from "@/lib/noGodmodding";
import type {
  SceneDirectiveMode,
  SceneProgressionType,
  SceneUserControl,
} from "@/lib/sceneDirective";
import {
  advanceReconvergenceState,
  defaultReconvergenceState,
  markReconvergenceOffered,
  pickReconvergenceMethod,
  type ReconvergenceDirective,
  type ReconvergenceState,
} from "@/lib/reconvergenceState";

function emptyReconv(chatId = 0, characterId = 0): ReconvergenceState {
  return defaultReconvergenceState(chatId, characterId);
}

export type ScenePacingDecision =
  | "hold_current_beat"
  | "advance_existing_beat"
  | "reconverge"
  | "resolve_trigger";

export type SceneGroundingSource =
  | "current_scene_fact"
  | "user_action"
  | "existing_unresolved_hook"
  | "authoritative_trigger"
  | "confirmed_schedule"
  | "none";

export type SceneCastPolicy =
  | "existing_cast_only"
  | "known_cast_allowed"
  | "new_cast_forbidden";

export type SceneEventBudget = 0 | 1;

export type SceneDialoguePressure = "none" | "natural";

/** V2 intensity is a single integer 0–4 (no reserved 5, no ranges). */
export type SceneDirectiveV2Intensity = 0 | 1 | 2 | 3 | 4;

export type SceneDirectiveV2 = {
  mode: SceneDirectiveMode;
  recentStagnation: boolean;
  recommendedIntensity: SceneDirectiveV2Intensity;
  progressionTypes: SceneProgressionType[];
  avoid: string[];
  nextBeatHint?: string;
  userControl: SceneUserControl;
  pacingDecision: ScenePacingDecision;
  eventBudget: SceneEventBudget;
  groundingSources: SceneGroundingSource[];
  castPolicy: SceneCastPolicy;
  allowNewNpc: boolean;
  allowNewExternalMessage: boolean;
  allowNewOrderOrSchedule: boolean;
  reconvergence?: ReconvergenceDirective | null;
  reasonCodes: string[];
  dialoguePressure: SceneDialoguePressure;
  /** Internal lifecycle snapshot for telemetry/tests — not rendered. */
  reconvergenceState: ReconvergenceLifecycleSnapshot;
};

export type ReconvergenceLifecycleSnapshot = {
  state: ReconvergenceState["state"];
  dueInTurns: number | null;
  hookType: string | null;
};

export type SceneDirectiveV2Input = {
  mode: SceneDirectiveMode;
  recentMessages?: ChatMsg[];
  currentUserMessage?: string | null;
  /** Used only for hook validation after candidate selection — never for scene classification. */
  memoryText?: string | null;
  relationshipMemoryText?: string | null;
  lorebookText?: string | null;
  triggeredEventText?: string | null;
  /** Authoritative current scene facts (server-confirmed). */
  currentSceneFacts?: string | null;
  /** Existing NPCs/cast names already present in the scene. */
  existingCastNames?: string[] | null;
  /** Optional injected reconvergence state (tests / route). */
  reconvergenceState?: ReconvergenceState | null;
  currentTurn?: number;
  /** Known contact channel already established. */
  hasEstablishedContactChannel?: boolean;
  /** Regenerate must not advance separation/due clocks. */
  isRegenerate?: boolean;
};

export type SceneStagnationAxes = {
  assistantMeaningRepetition: number;
  userStaticRepetition: number;
  stateChangeAbsence: boolean;
  recentStagnation: boolean;
};

const PROGRESSION_LABELS: Record<SceneProgressionType, string> = {
  relationship: "관계 변화",
  daily_life: "생활 변수",
  lore_clue: "단서",
  npc_action: "NPC 행동",
  world_reaction: "세계 반응",
  tactical_planning: "작전/조사",
  consequence: "이전 선택의 결과",
  comedy: "개그/오해",
  environment: "환경 변화",
};

const USER_CONTROL_LABELS: Record<SceneUserControl, string> = {
  no_user_control: "유저의 의도적 행동/대사/감정 결론은 쓰지 않는다.",
  limited_reactions: "유저의 의도는 쓰지 않고, 자연스러운 짧은 비자발 반응만 가능하다.",
  persona_based_dialogue_allowed: AUTO_PROGRESSION_SCENE_USER_CONTROL,
};

const PRIVATE_SCENE_PACING_RULE = [
  "[PRIVATE SCENE PACING RULE]",
  "새 사건은 장면이 실제로 정체됐거나, 현재 행동의 결과가 도착했거나, 확정된 trigger·일정·미완료 hook이 있을 때만 만든다.",
  "장면이 이미 자연스럽게 진행 중이면 새로운 사건·NPC·메시지·단서·관계 단계를 추가하지 않는다.",
  "현재 감각, 행동, 접촉, 대화, 업무 또는 정서를 충분히 진행하고 그 비트에서 머물거나 종료할 수 있다.",
  "한 응답에서 새 외부 사건은 최대 하나다.",
].join("\n");

const ACTION_CHANGE_TERMS = [
  "문",
  "칼",
  "밀친",
  "전화",
  "나가",
  "들어",
  "열",
  "닫",
  "잡",
  "놓",
  "일어",
  "앉",
  "걷",
  "뛰",
  "던",
  "쓰",
  "뽑",
];

const STATIC_REST_TERMS = [
  "계속 잔다",
  "다시 잔다",
  "다시 눈을 감",
  "그대로 누워",
  "아무것도 하지",
  "계속 누워",
  "잠만",
  "눈을 감은 채",
];

const CONTACT_CHANGE_TERMS = ["닿", "안", "입술", "손", "어깨", "허리", "무릎", "체중", "압력", "키스"];
const LOCATION_CHANGE_TERMS = ["이동", "나가", "들어", "복도", "밖", "방", "거실", "침대", "소파"];
const NEW_INFO_TERMS = ["발견", "알", "들었", "보였", "도착", "울렸"];
const DECISION_TERMS = ["결정", "선택", "하겠", "하자", "갈게", "남을게"];

const OPERATION_SCENE_TERMS = ["작전", "임무", "침투", "추적", "협상", "함정", "구출", "전투"];
const INVESTIGATION_SCENE_TERMS = ["조사", "단서", "기록", "소문", "흔적", "보고서"];
const REST_SCENE_TERMS = ["휴식", "식사", "잠", "치료", "회복", "데이트", "키스", "소파", "침대"];
const CLIMAX_SCENE_TERMS = ["결전", "최종", "붕괴", "배신", "대형 위기", "보스"];
const UNRESOLVED_RESULT_TERMS = ["아직", "미완료", "남겨", "돌아오", "결과", "후속"];
const EXISTING_REQUEST_TERMS = ["요청", "지시", "명령", "마감", "제한시간", "카운트다운", "디데이"];
const SCHEDULE_TERMS = ["일정", "약속", "내일", "모레", "회의", "출동"];

function includesAny(text: string, terms: string[]): boolean {
  return terms.some((term) => text.includes(term));
}

function compactRecent(messages: ChatMsg[] | undefined): string {
  return (messages ?? [])
    .slice(-8)
    .map((m) => m.content.trim())
    .filter(Boolean)
    .join("\n");
}

function normalizeForRepeat(text: string): string {
  return text
    .replace(/[^\p{Letter}\p{Number}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

function classifyUserTurn(text: string): {
  locationChange: boolean;
  objectStateChange: boolean;
  contactStateChange: boolean;
  newDecision: boolean;
  newInformation: boolean;
  dialogueOnly: boolean;
  restStatic: boolean;
} {
  const t = text.trim();
  const restStatic = includesAny(t, STATIC_REST_TERMS) || /^(계속\s*)?(잔다|누워|눈을 감)/.test(t);
  const locationChange = includesAny(t, LOCATION_CHANGE_TERMS);
  const objectStateChange = includesAny(t, ACTION_CHANGE_TERMS) && !restStatic;
  const contactStateChange = includesAny(t, CONTACT_CHANGE_TERMS);
  const newDecision = includesAny(t, DECISION_TERMS);
  const newInformation = includesAny(t, NEW_INFO_TERMS);
  const dialogueOnly =
    !locationChange &&
    !objectStateChange &&
    !contactStateChange &&
    !newDecision &&
    !newInformation &&
    !restStatic &&
    t.length > 0 &&
    t.length <= 40;
  return {
    locationChange,
    objectStateChange,
    contactStateChange,
    newDecision,
    newInformation,
    dialogueOnly,
    restStatic,
  };
}

export function analyzeSceneStagnation(recentMessages: ChatMsg[] | undefined): SceneStagnationAxes {
  const recent = (recentMessages ?? []).slice(-8);
  if (recent.length < 4) {
    return {
      assistantMeaningRepetition: 0,
      userStaticRepetition: 0,
      stateChangeAbsence: false,
      recentStagnation: false,
    };
  }

  const assistantTurns = recent.filter((m) => m.role === "assistant");
  const userTurns = recent.filter((m) => m.role === "user");

  const reassuranceTerms = ["괜찮", "미안", "걱정", "말하지 않아도", "침묵"];
  const normalizedAssistant = assistantTurns.map((m) => normalizeForRepeat(m.content));
  let assistantMeaningRepetition = 0;
  if (normalizedAssistant.length >= 2) {
    const set = new Set(normalizedAssistant.filter(Boolean));
    if (set.size <= Math.max(1, normalizedAssistant.length - 2)) {
      assistantMeaningRepetition = normalizedAssistant.length - set.size + 1;
    }
  }
  const reassuranceCount = assistantTurns.filter((m) => includesAny(m.content, reassuranceTerms)).length;
  if (reassuranceCount >= 2) {
    assistantMeaningRepetition = Math.max(assistantMeaningRepetition, reassuranceCount);
  }

  let userStaticRepetition = 0;
  let anyStateChange = false;
  for (const turn of userTurns.slice(-4)) {
    const c = classifyUserTurn(turn.content);
    if (
      c.locationChange ||
      c.objectStateChange ||
      c.contactStateChange ||
      c.newDecision ||
      c.newInformation
    ) {
      anyStateChange = true;
    }
    if (c.restStatic || (c.dialogueOnly && turn.content.trim().length <= 8)) {
      userStaticRepetition += 1;
    }
  }

  // Distinct short actions are not stagnation.
  const distinctActions = new Set(
    userTurns
      .slice(-3)
      .map((m) => normalizeForRepeat(m.content))
      .filter(Boolean)
  );
  if (distinctActions.size >= 3 && userTurns.slice(-3).every((m) => m.content.trim().length <= 20)) {
    const allActionLike = userTurns.slice(-3).every((m) => {
      const c = classifyUserTurn(m.content);
      return c.objectStateChange || c.locationChange || c.newDecision || c.contactStateChange;
    });
    if (allActionLike) {
      userStaticRepetition = 0;
      anyStateChange = true;
    }
  }

  const stateChangeAbsence = !anyStateChange;
  const recentStagnation =
    assistantMeaningRepetition >= 2 ||
    (userStaticRepetition >= 2 && stateChangeAbsence);

  return {
    assistantMeaningRepetition,
    userStaticRepetition,
    stateChangeAbsence,
    recentStagnation,
  };
}

function currentSceneText(input: {
  recentMessages?: ChatMsg[];
  currentUserMessage?: string | null;
  currentSceneFacts?: string | null;
  triggeredEventText?: string | null;
}): string {
  return [
    compactRecent(input.recentMessages),
    input.currentUserMessage ?? "",
    input.currentSceneFacts ?? "",
    input.triggeredEventText ?? "",
  ]
    .filter(Boolean)
    .join("\n");
}

function resolveSceneKind(
  text: string
): "rest" | "investigation" | "operation" | "climax" | "intimate" | "neutral" {
  if (includesAny(text, CLIMAX_SCENE_TERMS)) return "climax";
  if (includesAny(text, OPERATION_SCENE_TERMS)) return "operation";
  if (includesAny(text, INVESTIGATION_SCENE_TERMS)) return "investigation";
  if (includesAny(text, ["연인", "키스", "안기", "소파", "접촉", "체온"])) return "intimate";
  if (includesAny(text, REST_SCENE_TERMS)) return "rest";
  return "neutral";
}

export function selectSceneIntensityV2(input: {
  recentMessages?: ChatMsg[];
  currentUserMessage?: string | null;
  currentSceneFacts?: string | null;
  triggeredEventText?: string | null;
  recentStagnation?: boolean;
}): SceneDirectiveV2Intensity {
  const text = currentSceneText(input);
  const kind = resolveSceneKind(text);
  const recentHighIntensity =
    (text.match(/공격|폭발|붕괴|배신|납치|전투|함정|추락/g) || []).length >= 2;

  if (input.triggeredEventText?.trim()) return 3;
  if (recentHighIntensity) return input.recentStagnation ? 1 : 0;
  if (kind === "rest" || kind === "intimate") return input.recentStagnation ? 1 : 0;
  if (kind === "investigation") return input.recentStagnation ? 2 : 2;
  if (kind === "operation") return input.recentStagnation ? 3 : 3;
  if (kind === "climax") {
    // Intensity 4 only with trigger or already-high climax cues — stagnation alone never creates 4.
    return recentHighIntensity || Boolean(input.triggeredEventText?.trim()) ? 4 : 3;
  }
  return input.recentStagnation ? 2 : 0;
}

function hasExistingNpcGrounding(input: SceneDirectiveV2Input, sceneText: string): boolean {
  const cast = (input.existingCastNames ?? []).filter(Boolean);
  if (cast.some((name) => sceneText.includes(name))) return true;
  if (includesAny(sceneText, ["이미 있던", "기존 NPC", "옆에 있던", "동료가", "상관이"])) {
    // Weak lexical — only with explicit existing-cast cue in current facts/dialogue.
    const facts = input.currentSceneFacts?.trim() ?? "";
    return Boolean(facts) && includesAny(facts, ["NPC", "동료", "상관", "담당"]);
  }
  return false;
}

function validateHookAgainstCanon(
  candidate: SceneProgressionType,
  sceneText: string,
  canonText: string
): boolean {
  if (!canonText.trim()) return true;
  // Forbid inventing operation from canon alone when scene is rest/intimate.
  const kind = resolveSceneKind(sceneText);
  if ((kind === "rest" || kind === "intimate") && (candidate === "npc_action" || candidate === "tactical_planning")) {
    return false;
  }
  if (candidate === "relationship" && kind !== "intimate" && kind !== "rest") {
    // relationship ok if scene itself has relationship cues
    if (!includesAny(sceneText, ["연인", "고백", "질투", "미안", "친구", "관계"])) return false;
  }
  return true;
}

export function selectProgressionTypesV2(input: {
  sceneText: string;
  intensity: number;
  stagnant: boolean;
  allowNpcAction: boolean;
  unresolvedConsequence: boolean;
  canonText: string;
}): SceneProgressionType[] {
  const selected: SceneProgressionType[] = [];
  const add = (type: SceneProgressionType) => {
    if (selected.includes(type) || selected.length >= 3) return;
    if (!validateHookAgainstCanon(type, input.sceneText, input.canonText)) return;
    selected.push(type);
  };

  if (includesAny(input.sceneText, OPERATION_SCENE_TERMS)) {
    add("tactical_planning");
    if (input.allowNpcAction) add("npc_action");
    if (input.unresolvedConsequence) add("consequence");
  }
  if (includesAny(input.sceneText, INVESTIGATION_SCENE_TERMS) && input.unresolvedConsequence) {
    add("lore_clue");
  }
  if (includesAny(input.sceneText, ["연인", "고백", "질투", "미안", "괜찮", "걱정", "친구"])) {
    add("relationship");
  }
  if (includesAny(input.sceneText, ["식사", "잠", "집", "휴식", "회복", "정비"])) {
    add("daily_life");
  }
  if (input.unresolvedConsequence) add("consequence");
  if (input.stagnant && selected.length === 0) {
    add("daily_life");
  }
  // No environment+relationship fallback when empty — empty is valid.
  return selected;
}

function buildAvoidListV2(
  mode: SceneDirectiveMode,
  intensity: number,
  pacing: ScenePacingDecision
): string[] {
  const avoid = [
    "괜찮냐는 반복",
    "이미 지난 설명 반복",
    "트리거 조건 노출",
    "유저 인지·응답·이동 대필",
    "새 NPC 중개",
    "근거 없는 새 위기",
  ];
  if (intensity <= 2) avoid.unshift("갑작스러운 납치", "대형 전투", "위기 남발");
  else avoid.unshift("즉시 정체 확정", "강제 고백");
  if (pacing === "hold_current_beat") {
    avoid.unshift("새 외부 사건", "새 메시지", "새 일정", "새 단서 생성");
  }
  if (pacing === "reconverge") {
    avoid.unshift("새 상부 명령", "새 긴급 임무", "새 사고", "운명적 우연 반복");
  }
  if (mode === "interactive") avoid.push("유저 의도 작성");
  if (mode === "auto_progression") {
    avoid.push("[B] 내면·감정 결론으로 분량 채우기");
    avoid.push("존재하지 않는 cast 확장");
  }
  return avoid.slice(0, 8);
}

function buildNextBeatHintV2(opts: {
  pacing: ScenePacingDecision;
  types: SceneProgressionType[];
  intensity: number;
  sceneText: string;
  reconvergence?: ReconvergenceDirective | null;
}): string {
  if (opts.pacing === "resolve_trigger") {
    return "이미 발생한 정식 사건의 여파만 이어가며 별도 새 사건은 추가하지 않는다.";
  }
  if (opts.pacing === "hold_current_beat") {
    return "현재 감각·행동·접촉·대화·업무를 자연스럽게 이어가거나 이 비트에서 닫는다.";
  }
  if (opts.pacing === "reconverge" && opts.reconvergence) {
    return `분리된 기존 캐릭터와 재접점 하나만 외부 상태로 제시한다. 근거: ${opts.reconvergence.hook?.summary ?? "기존 관계"}. 유저 인지·응답·이동은 쓰지 않는다.`;
  }

  const hasExistingRequest = includesAny(opts.sceneText, EXISTING_REQUEST_TERMS);
  const hasSchedule = includesAny(opts.sceneText, SCHEDULE_TERMS);
  const hasUnresolved = includesAny(opts.sceneText, UNRESOLVED_RESULT_TERMS);

  if (opts.types.includes("tactical_planning")) {
    if (hasExistingRequest || hasSchedule) {
      return "이미 있는 요청·일정에 묶인 작은 진행만 이어간다.";
    }
    return "현재 확인된 작전 논의의 다음 실무 한 걸음만 이어간다. 새 외부 요청이나 시간 압박은 만들지 않는다.";
  }
  if (opts.types.includes("lore_clue")) {
    if (hasUnresolved) {
      return "이미 존재했던 기록·물건·흔적을 다시 관찰한다. 새 단서는 만들지 않는다.";
    }
    return "새 단서를 만들지 말고 현재 장면의 확인된 사실만 이어간다.";
  }
  if (opts.types.includes("daily_life")) {
    return "현재 장소·물건·신체 상태·기존 일정에서 나오는 생활 동선만 이어간다.";
  }
  if (opts.types.includes("relationship")) {
    return "반복 확인 대신 이미 진행 중인 관계 행동을 한 단계만 미세하게 이어간다.";
  }
  if (opts.types.includes("consequence") && hasUnresolved) {
    return "이미 열린 선택의 작은 결과 하나만 도착시킨다.";
  }
  if (opts.intensity <= 0) {
    return "새 외부 사건 없이 현재 비트를 유지하거나 자연스럽게 종료한다.";
  }
  return "현재 확인된 인과만으로 작은 진행을 이어간다.";
}

function triggerImpliesReunion(triggeredEventText: string): boolean {
  return includesAny(triggeredEventText, ["재회", "만남", "찾아왔", "도착", "노크", "전화가", "메시지가"]);
}

export function buildSceneDirectiveV2(input: SceneDirectiveV2Input): SceneDirectiveV2 {
  const axes = analyzeSceneStagnation(input.recentMessages);
  const sceneText = currentSceneText(input);
  const triggerPresent = Boolean(input.triggeredEventText?.trim());
  const currentTurn = input.currentTurn ?? 0;
  const baseReconv = input.reconvergenceState ?? emptyReconv();

  const advanced = advanceReconvergenceState({
    previous: baseReconv,
    currentTurn,
    currentUserMessage: input.currentUserMessage,
    recentMessages: input.recentMessages,
    triggerPresent,
    triggerImpliesReunion: triggerPresent && triggerImpliesReunion(input.triggeredEventText || ""),
    isRegenerate: input.isRegenerate,
  });

  const reasonCodes = [...advanced.reasonCodes];
  if (advanced.blockedNoGroundedPath) {
    reasonCodes.push("RECONVERGENCE_BLOCKED_NO_GROUNDED_PATH");
  }
  const groundingSources: SceneGroundingSource[] = [];
  if (triggerPresent) groundingSources.push("authoritative_trigger");
  if (input.currentUserMessage?.trim()) groundingSources.push("user_action");
  if (input.currentSceneFacts?.trim()) groundingSources.push("current_scene_fact");
  if (advanced.state.unresolvedHooks.length > 0) groundingSources.push("existing_unresolved_hook");
  if (includesAny(sceneText, SCHEDULE_TERMS)) groundingSources.push("confirmed_schedule");
  if (groundingSources.length === 0) groundingSources.push("none");

  const userActingMeaningfully = (() => {
    const c = classifyUserTurn(input.currentUserMessage ?? "");
    return (
      c.locationChange ||
      c.objectStateChange ||
      c.contactStateChange ||
      c.newDecision ||
      c.newInformation ||
      Boolean(input.currentUserMessage && input.currentUserMessage.trim().length >= 8 && !c.restStatic)
    );
  })();

  const unresolvedConsequence = includesAny(sceneText, UNRESOLVED_RESULT_TERMS);
  const npcGrounded =
    hasExistingNpcGrounding(input, sceneText) ||
    (triggerPresent && includesAny(input.triggeredEventText || "", ["NPC", "동료", "상관"]));

  let pacingDecision: ScenePacingDecision = "hold_current_beat";
  let eventBudget: SceneEventBudget = 0;
  let reconvergence: ReconvergenceDirective | null = null;
  let reconvergenceState = advanced.state;
  const sceneKind = resolveSceneKind(sceneText);
  const quietScene = sceneKind === "rest" || sceneKind === "intimate" || sceneKind === "neutral";

  if (triggerPresent) {
    pacingDecision = "resolve_trigger";
    eventBudget = 0;
    reasonCodes.push("RESOLVE_TRIGGER");
  } else if (advanced.reconvergenceDue) {
    const picked = pickReconvergenceMethod(advanced.state, advanced.state.unresolvedHooks);
    if (picked.blocked || advanced.blockedNoGroundedPath) {
      pacingDecision = "hold_current_beat";
      eventBudget = 0;
      reconvergence = {
        method: "relationship_initiative",
        hook: null,
        ownershipSafe: true,
        allowUserCognition: false,
        blockedNoGroundedPath: true,
      };
      reasonCodes.push("RECONVERGENCE_BLOCKED_NO_GROUNDED_PATH");
    } else {
      pacingDecision = "reconverge";
      eventBudget = 1;
      reconvergence = {
        method: picked.method,
        hook: picked.hook,
        ownershipSafe: true,
        allowUserCognition: false,
        blockedNoGroundedPath: false,
      };
      reconvergenceState = markReconvergenceOffered(advanced.state, currentTurn, picked.method);
      reasonCodes.push("RECONVERGE_SELECTED");
    }
  } else if (unresolvedConsequence && !quietScene) {
    pacingDecision = "advance_existing_beat";
    eventBudget = 1;
    reasonCodes.push("ADVANCE_UNRESOLVED");
  } else if (
    axes.recentStagnation &&
    !quietScene &&
    (sceneKind === "operation" || sceneKind === "investigation" || sceneKind === "climax")
  ) {
    pacingDecision = "advance_existing_beat";
    eventBudget = 1;
    reasonCodes.push("ADVANCE_STAGNATION");
  } else if (
    !axes.recentStagnation &&
    !unresolvedConsequence &&
    userActingMeaningfully
  ) {
    pacingDecision = "hold_current_beat";
    eventBudget = 0;
    reasonCodes.push("HOLD_ACTIVE_BEAT");
  } else {
    // Rest/intimate/neutral: holding the beat is the normal path — including quiet rest loops.
    pacingDecision = "hold_current_beat";
    eventBudget = 0;
    reasonCodes.push(quietScene ? "HOLD_QUIET_SCENE" : "HOLD_DEFAULT");
  }

  // Separated T0/T1: no forced reconvergence before due.
  if (
    !triggerPresent &&
    (reconvergenceState.state === "separated" || reconvergenceState.state === "separation_pending") &&
    pacingDecision !== "reconverge"
  ) {
    const due = reconvergenceState.reconvergenceDueTurn;
    if (due != null && currentTurn < due) {
      pacingDecision = "hold_current_beat";
      eventBudget = 0;
      reasonCodes.push(currentTurn === reconvergenceState.separationTurn ? "T0_RESPECT_PARTING" : "T1_INDEPENDENT_BEAT");
    }
  }

  if (
    (reconvergenceState.state === "hard_no_contact" ||
      reconvergenceState.state === "temporary_quiet") &&
    pacingDecision === "reconverge"
  ) {
    pacingDecision = "hold_current_beat";
    eventBudget = 0;
    reconvergence = null;
    reasonCodes.push("LOCK_BLOCKS_RECONVERGE");
  }

  const recommendedIntensity =
    pacingDecision === "hold_current_beat"
      ? (0 as const)
      : pacingDecision === "reconverge"
        ? (1 as const)
        : selectSceneIntensityV2({
            recentMessages: input.recentMessages,
            currentUserMessage: input.currentUserMessage,
            currentSceneFacts: input.currentSceneFacts,
            triggeredEventText: input.triggeredEventText,
            recentStagnation: axes.recentStagnation,
          });

  const canonText = [input.memoryText ?? "", input.relationshipMemoryText ?? "", input.lorebookText ?? ""].join(
    "\n"
  );

  let progressionTypes: SceneProgressionType[] = [];
  if (pacingDecision === "resolve_trigger") {
    progressionTypes = [];
  } else if (pacingDecision === "reconverge") {
    progressionTypes = ["relationship"];
  } else if (pacingDecision === "advance_existing_beat") {
    progressionTypes = selectProgressionTypesV2({
      sceneText,
      intensity: recommendedIntensity,
      stagnant: axes.recentStagnation,
      allowNpcAction: npcGrounded,
      unresolvedConsequence,
      canonText,
    });
  } else {
    progressionTypes = [];
  }

  // Intensity 0 / hold: strip event-driving types.
  if (recommendedIntensity === 0 || eventBudget === 0) {
    progressionTypes = progressionTypes.filter((t) => t === "relationship" && pacingDecision === "reconverge");
    if (pacingDecision !== "reconverge") progressionTypes = [];
  }

  const allowNewNpc = false;
  const castPolicy: SceneCastPolicy = npcGrounded ? "existing_cast_only" : "new_cast_forbidden";
  const allowNewExternalMessage =
    pacingDecision === "reconverge" && reconvergence?.method === "message";
  const allowNewOrderOrSchedule = false;

  const userControl: SceneUserControl =
    input.mode === "auto_progression" ? "persona_based_dialogue_allowed" : "no_user_control";

  const dueInTurns =
    reconvergenceState.reconvergenceDueTurn != null
      ? Math.max(0, reconvergenceState.reconvergenceDueTurn - currentTurn)
      : null;

  return {
    mode: input.mode,
    recentStagnation: axes.recentStagnation,
    recommendedIntensity,
    progressionTypes,
    avoid: buildAvoidListV2(input.mode, recommendedIntensity, pacingDecision),
    nextBeatHint: buildNextBeatHintV2({
      pacing: pacingDecision,
      types: progressionTypes,
      intensity: recommendedIntensity,
      sceneText,
      reconvergence,
    }),
    userControl,
    pacingDecision,
    eventBudget,
    groundingSources,
    castPolicy,
    allowNewNpc,
    allowNewExternalMessage,
    allowNewOrderOrSchedule,
    reconvergence,
    reasonCodes: [...new Set(reasonCodes)],
    dialoguePressure: "none",
    reconvergenceState: {
      state: reconvergenceState.state,
      dueInTurns,
      hookType: reconvergence?.hook?.type ?? null,
    },
  };
}

/** Expose updated lifecycle for persistence after build. */
export function getUpdatedReconvergenceStateFromBuild(
  input: SceneDirectiveV2Input,
  directive: SceneDirectiveV2
): ReconvergenceState {
  const base = input.reconvergenceState ?? emptyReconv();

  const advanced = advanceReconvergenceState({
    previous: base,
    currentTurn: input.currentTurn ?? 0,
    currentUserMessage: input.currentUserMessage,
    recentMessages: input.recentMessages,
    triggerPresent: Boolean(input.triggeredEventText?.trim()),
    triggerImpliesReunion:
      Boolean(input.triggeredEventText?.trim()) &&
      triggerImpliesReunion(input.triggeredEventText || ""),
    isRegenerate: input.isRegenerate,
  });

  if (
    directive.pacingDecision === "reconverge" &&
    directive.reconvergence &&
    !directive.reconvergence.blockedNoGroundedPath
  ) {
    return markReconvergenceOffered(
      advanced.state,
      input.currentTurn ?? 0,
      directive.reconvergence.method
    );
  }
  return advanced.state;
}

export function renderSceneDirectiveV2ForPrompt(directive: SceneDirectiveV2): string {
  const modeLabel = directive.mode === "auto_progression" ? "자동진행" : "일반 RP";
  const castLine =
    directive.castPolicy === "existing_cast_only"
      ? "등장인물: 현재 장면 인물만"
      : "등장인물: 새 인물 생성 금지";

  let body: string[];
  if (directive.pacingDecision === "hold_current_beat") {
    body = [
      "[이번 턴 장면 조절 - 비공개]",
      "새 외부 사건: 만들지 않음",
      "진행: 현재 행동·접촉·대화·업무를 자연스럽게 이어가거나 닫는다.",
      castLine,
      "새 정보·NPC·메시지·일정: 금지",
      "유저 행동·감정·대사: 대신 쓰지 않음",
    ];
  } else if (directive.pacingDecision === "resolve_trigger") {
    body = [
      "[이번 턴 장면 조절 - 비공개]",
      "목적: 정식 trigger 사건만 처리한다.",
      "새 외부 사건: trigger 외 추가 금지",
      castLine,
      "금지: 별도 환경 변화, 새 NPC, 별도 관계 사건, 별도 재접점 사건",
      "유저 행동·감정·대사: 대신 쓰지 않음",
    ];
  } else if (directive.pacingDecision === "reconverge") {
    body = [
      "[이번 턴 장면 조절 - 비공개]",
      "목적: 분리된 기존 캐릭터와 다시 상호작용할 기회를 만든다.",
      `근거: ${directive.reconvergence?.hook?.summary ?? "기존 관계"}`,
      "강도: 1",
      "새 외부 사건: 재접점 하나만",
      "등장인물: 재회 대상 기존 캐릭터만",
      "금지: 새 NPC, 새 위기, 새 명령, 새 일정, 유저의 인지·응답·이동 작성",
    ];
  } else {
    const progression = directive.progressionTypes.map((t) => PROGRESSION_LABELS[t]).join(" + ") || "없음";
    body = [
      "[이번 턴 장면 조절 - 비공개]",
      `모드: ${modeLabel}`,
      `강도: ${directive.recommendedIntensity}`,
      `전개: ${progression}`,
      "새 외부 사건: 최대 하나",
      castLine,
      directive.nextBeatHint ? `진행 힌트: ${directive.nextBeatHint}` : "",
      `피할 것: ${directive.avoid.slice(0, 5).join(", ")}`,
      "유저 행동·감정·대사: 대신 쓰지 않음",
    ].filter(Boolean);
  }

  const lines = [
    PRIVATE_SCENE_PACING_RULE,
    "",
    ...body,
    `유저 조종: ${USER_CONTROL_LABELS[directive.userControl]}`,
  ];

  if (directive.mode === "auto_progression") {
    const multiCastOk =
      (inputExistingCastCountHint(directive) || 0) >= 2 &&
      directive.pacingDecision === "advance_existing_beat";
    if (multiCastOk) {
      lines.push(
        "다인물: 현재 cast에 이미 2명 이상 있고 갈등·협상·작전이 진행 중일 때만 여러 AI 인물 대화를 쓴다."
      );
    } else {
      lines.push("다인물: 존재하지 않는 NPC를 추가해 대화량을 채우지 않는다.");
    }
    lines.push(NO_FALSE_SHARED_MEMORY_RULE);
  }

  if (directive.dialoguePressure === "none") {
    lines.push("대사 비중: 늘리지 않는다. 재접점도 대사 의무가 아니다.");
  }

  return lines.filter(Boolean).join("\n");
}

function inputExistingCastCountHint(_directive: SceneDirectiveV2): number {
  // Prompt must not expose cast counts from DB; keep rule qualitative.
  return 0;
}

export function buildSceneDirectiveV2PromptBlock(input: SceneDirectiveV2Input): string {
  return renderSceneDirectiveV2ForPrompt(buildSceneDirectiveV2(input));
}

export type SceneDirectiveV2Telemetry = {
  version: "v2";
  pacingDecision: ScenePacingDecision;
  recentStagnation: boolean;
  recommendedIntensity: SceneDirectiveV2Intensity;
  eventBudget: SceneEventBudget;
  progressionTypes: SceneProgressionType[];
  allowNewNpc: boolean;
  triggerPresent: boolean;
  reconvergenceState: ReconvergenceState["state"];
  reconvergenceDueInTurns: number | null;
  hookType: string | null;
  reasonCodes: string[];
};

export function buildSceneDirectiveV2Telemetry(
  directive: SceneDirectiveV2,
  triggerPresent: boolean
): SceneDirectiveV2Telemetry {
  return {
    version: "v2",
    pacingDecision: directive.pacingDecision,
    recentStagnation: directive.recentStagnation,
    recommendedIntensity: directive.recommendedIntensity,
    eventBudget: directive.eventBudget,
    progressionTypes: [...directive.progressionTypes],
    allowNewNpc: directive.allowNewNpc,
    triggerPresent,
    reconvergenceState: directive.reconvergenceState.state,
    reconvergenceDueInTurns: directive.reconvergenceState.dueInTurns,
    hookType: directive.reconvergenceState.hookType,
    reasonCodes: [...directive.reasonCodes],
  };
}

export function logSceneDirectiveV2Telemetry(payload: SceneDirectiveV2Telemetry): void {
  console.info("[scene-directive-v2]", JSON.stringify(payload));
}
