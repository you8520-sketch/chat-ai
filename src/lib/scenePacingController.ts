/**
 * Phase G10-SD* / G10-D1 / G10-D2 / G10-D3 — Scene Pacing + Dialogue Budget.
 *
 * Experiment / harness-first. Does NOT wire into chat route by default.
 * Production standard interactive SceneDirective injection remains OFF (ARM D).
 *
 * G10-SD1/SD2 controller decision path is FROZEN (BYTE_IDENTICAL).
 * G10-D2 Arm U: fixed terminal max-4 (PASS sealed — do not rejudge).
 * G10-D3 Arm V sole architecture: SERVER-RESOLVED DIALOGUE CEILING
 * (same terminal location; number dynamic; no prompt mapping table).
 */

import type { ChatMsg } from "@/lib/ai";
import type { ContentKind } from "@/lib/simulationMode";
import type { SceneProgressionHistoryEntry } from "@/lib/sceneProgressionState";
import {
  buildGroundingText,
  buildSceneSignalText,
  detectSceneStagnation,
  resolveSceneCastFocus,
  resolveSceneKind,
  type SceneCastMode,
  type SceneKind,
  type SceneProgressionType,
} from "@/lib/sceneDirective";
import { SCENE_FLOW_BLOCK } from "@/lib/generationProcessBeatFlow";

export type ScenePacingArm = "A" | "P" | "Q" | "R" | "T" | "U" | "V";

/** G10-D3 — server-resolved direct-speech ceiling (null = no global cap). */
export type DialogueBudget = 4 | 5 | 6 | null;

export type CommunicationDemand = "LOW" | "NORMAL" | "HIGH";

export type DialogueBudgetReason =
  | "quiet_dyad"
  | "intimate_dyad"
  | "exploration"
  | "operation"
  | "communication_heavy"
  | "ensemble_uncapped";

export type TerminalDialogueBudgetResolution = {
  maxBlocks: DialogueBudget;
  reason: DialogueBudgetReason;
  communicationDemand: CommunicationDemand;
};

export type ScenePacingMode =
  | "DYAD"
  | "EXPLORATION"
  | "OPERATION"
  | "ENSEMBLE";

export type SceneMotionLevel = "HOLD" | "AMBIENT" | "LOCAL" | "EXTERNAL";

export type SceneTransitionDomain =
  | "relationship"
  | "ai_interior"
  | "ai_action"
  | "sensory"
  | "ambient_environment"
  | "existing_consequence"
  | "local_information"
  | "external_actor";

export type ExternalContinuity =
  | "PRESERVE"
  | "AMBIENT_ONLY"
  | "LOCAL_CHANGE"
  | "EXTERNAL_CHANGE";

export type SceneStateAuthority = {
  stateAuthority: "RECENT_SCENE_CURRENT_USER_TRIGGER";
  canonRole: "POSSIBILITY_AND_CONSTRAINT";
  externalContinuity: ExternalContinuity;
  transitionDomains: SceneTransitionDomain[];
};

export type ScenePacingDecision = {
  pacingMode: ScenePacingMode;
  motionLevel: SceneMotionLevel;
  sceneKind: SceneKind;
  castMode: SceneCastMode;
  intimateDyad: boolean;
  recentStagnation: boolean;
  externalCooldownActive: boolean;
  triggerActive: boolean;
  /** At most 1 for single_primary; may be 2–3 for ensemble/simulation. */
  meaningfulBeatBudget: number;
  /** Soft carriers inside the same beat — not independent events. */
  carrierHints: SceneProgressionType[];
  /** Primary progression type for history commit; empty for pure HOLD. */
  primaryProgression: SceneProgressionType | null;
  npcActionEligible: boolean;
  externalEligible: boolean;
  reasonCodes: string[];
};

export type ScenePacingControllerInput = {
  recentMessages?: ChatMsg[];
  currentUserMessage?: string | null;
  memoryText?: string | null;
  relationshipMemoryText?: string | null;
  lorebookText?: string | null;
  triggeredEventText?: string | null;
  contentKind?: ContentKind | null;
  party?: boolean | null;
  primaryCharacterName?: string | null;
  establishedActiveCastNames?: string[] | null;
  knownSupportingCastNames?: string[] | null;
  chatId?: number | string | null;
  currentTurn?: number | null;
  progressionHistory?: SceneProgressionHistoryEntry[] | null;
  /** Explicit adult content enabled — NOT sufficient alone for intimate dyad. */
  adultModeEnabled?: boolean | null;
};

const DYAD_TERMS = [
  "휴식",
  "식사",
  "잠",
  "치료",
  "회복",
  "데이트",
  "연인",
  "키스",
  "집",
  "소파",
  "곁",
  "이대로",
  "조용",
  "대화",
  "이야기",
  "걱정",
  "괜찮",
  "미안",
  "친구",
  "관계",
  "커피",
  "차 ",
  "밥",
  "담요",
  "컵",
  "식탁",
  "저녁",
  "수프",
  "소파",
];

const INTIMATE_SCENE_TERMS = [
  "키스",
  "포옹",
  "안고",
  "침대",
  "속옷",
  "벗",
  "애무",
  "삽입",
  "섹스",
  "정사",
  "몸을 맡",
  "밀착",
  "속삭이",
  "입술",
  "피부",
];

const EXPLORATION_TERMS = [
  "조사",
  "단서",
  "기록",
  "소문",
  "흔적",
  "골목",
  "탐색",
  "탐사",
  "이쪽",
  "길",
  "지도",
  "안개",
  "농도",
];

const OPERATION_TERMS = [
  "작전",
  "임무",
  "침투",
  "추적",
  "협상",
  "함정",
  "구출",
  "제한시간",
  "전투",
  "공격",
  "습격",
  "경보",
  "도주",
  "사격",
];

const DANGER_NOW_TERMS = [
  "공격",
  "폭발",
  "습격",
  "경보",
  "전투",
  "추격",
  "변이체",
  "괴물",
  "피격",
  "위험",
];

const NPC_GROUND_TERMS = [
  "NPC",
  "동료",
  "상관",
  "담당",
  "방문객",
  "손님",
  "병사",
  "경비",
  "의사",
  "점원",
  "사람",
  "누군가",
];

const EXTERNAL_HISTORY_TYPES: SceneProgressionType[] = [
  "npc_action",
  "world_reaction",
];

function includesAny(text: string, terms: string[]): boolean {
  return terms.some((term) => text.includes(term));
}

/** EXTERNAL blocked for 3 completed turns after an EXTERNAL selection. */
export function isExternalCooldownActive(
  progressionHistory: SceneProgressionHistoryEntry[] | null | undefined,
  currentTurn: number | null | undefined
): boolean {
  const turn = Number(currentTurn ?? 0);
  if (!turn || !progressionHistory?.length) return false;
  return progressionHistory.some((entry) => {
    if (entry.turn >= turn) return false;
    if (entry.turn < turn - 3) return false;
    return entry.types.some((t) => EXTERNAL_HISTORY_TYPES.includes(t));
  });
}

export function detectIntimateDyad(input: {
  sceneSignalText: string;
  adultModeEnabled?: boolean | null;
}): boolean {
  // Adult-mode flag alone is insufficient — require current/recent intimate scene cues.
  if (!includesAny(input.sceneSignalText, INTIMATE_SCENE_TERMS)) return false;
  return true;
}

const PATH_PROBE_TERMS = ["골목", "이쪽", "저쪽", "경로", "빠져", "지나", "단서", "조사", "탐색", "탐사"];

export function resolveScenePacingMode(input: {
  sceneSignalText: string;
  contentKind?: ContentKind | null;
  party?: boolean | null;
  triggerActive: boolean;
  immediateDanger: boolean;
}): ScenePacingMode {
  if (input.contentKind === "simulation" || input.party) return "ENSEMBLE";

  const text = input.sceneSignalText;
  // Active danger / operation / hard trigger can outrank quiet dyad.
  if (input.immediateDanger || includesAny(text, OPERATION_TERMS)) {
    return "OPERATION";
  }
  if (input.triggerActive && includesAny(text, [...OPERATION_TERMS, ...DANGER_NOW_TERMS])) {
    return "OPERATION";
  }

  const dyadCue =
    includesAny(text, DYAD_TERMS) || resolveSceneKind(text) === "rest";
  const pathProbe = includesAny(text, PATH_PROBE_TERMS);
  const explorationCue = includesAny(text, EXPLORATION_TERMS);

  // Path/investigation probes win over ambient world words (e.g. fog mentioned at dinner).
  if (pathProbe && explorationCue) return "EXPLORATION";
  if (pathProbe && !dyadCue) return "EXPLORATION";
  if (dyadCue) return "DYAD";
  if (explorationCue) return "EXPLORATION";
  // Neutral single_primary defaults toward dyad-safe HOLD/AMBIENT policy bucket
  return "DYAD";
}

export function resolveNpcActionEligible(input: {
  sceneSignalText: string;
  groundingText: string;
  triggeredEventText?: string | null;
  knownSupportingCastNames?: string[] | null;
  userMentionsNpc: boolean;
  castAlreadyPresent: boolean;
  triggerRequiresNpc: boolean;
}): boolean {
  if (input.triggerRequiresNpc) return true;
  if (input.castAlreadyPresent) return true;
  if (input.userMentionsNpc) return true;
  if (input.knownSupportingCastNames?.some((n) => n && input.sceneSignalText.includes(n))) {
    return true;
  }
  return (
    includesAny(input.sceneSignalText, NPC_GROUND_TERMS) ||
    includesAny(input.groundingText, NPC_GROUND_TERMS) ||
    includesAny(input.triggeredEventText ?? "", NPC_GROUND_TERMS)
  );
}

/**
 * Resolve motion budget for this turn.
 * HOLD is a first-class valid result (no forced environment+relationship floor).
 */
export function resolveScenePacingDecision(
  input: ScenePacingControllerInput
): ScenePacingDecision {
  const sceneSignalText = buildSceneSignalText({
    recentMessages: input.recentMessages,
    currentUserMessage: input.currentUserMessage,
    triggeredEventText: input.triggeredEventText,
  });
  const groundingText = buildGroundingText({
    memoryText: input.memoryText,
    relationshipMemoryText: input.relationshipMemoryText,
    lorebookText: input.lorebookText,
  });
  const sceneKind = resolveSceneKind(sceneSignalText);
  const castFocus = resolveSceneCastFocus({
    contentKind: input.contentKind,
    party: input.party,
    primaryCharacterName: input.primaryCharacterName,
    establishedActiveCastNames: input.establishedActiveCastNames,
  });
  const triggerActive = Boolean(input.triggeredEventText?.trim());
  const immediateDanger = includesAny(sceneSignalText, DANGER_NOW_TERMS);
  const recentStagnation = detectSceneStagnation(input.recentMessages);
  const intimateDyad = detectIntimateDyad({
    sceneSignalText,
    adultModeEnabled: input.adultModeEnabled,
  });
  const externalCooldownActive = isExternalCooldownActive(
    input.progressionHistory,
    input.currentTurn
  );

  const pacingMode = resolveScenePacingMode({
    sceneSignalText,
    contentKind: input.contentKind,
    party: input.party,
    triggerActive,
    immediateDanger,
  });

  const userMentionsNpc =
    includesAny(input.currentUserMessage ?? "", NPC_GROUND_TERMS) ||
    (input.knownSupportingCastNames ?? []).some((n) =>
      Boolean(n && (input.currentUserMessage ?? "").includes(n))
    );
  const castAlreadyPresent =
    castFocus.activeSpeakingCast.length > 1 ||
    includesAny(sceneSignalText, NPC_GROUND_TERMS);
  const npcActionEligible = resolveNpcActionEligible({
    sceneSignalText,
    groundingText,
    triggeredEventText: input.triggeredEventText,
    knownSupportingCastNames: input.knownSupportingCastNames,
    userMentionsNpc,
    castAlreadyPresent,
    triggerRequiresNpc:
      triggerActive && includesAny(input.triggeredEventText ?? "", NPC_GROUND_TERMS),
  });

  const reasonCodes: string[] = [
    `kind:${sceneKind}`,
    `mode:${pacingMode}`,
    `cast:${castFocus.sceneCastMode}`,
  ];
  if (intimateDyad) reasonCodes.push("intimate_dyad");
  if (triggerActive) reasonCodes.push("trigger");
  if (immediateDanger) reasonCodes.push("immediate_danger");
  if (recentStagnation) reasonCodes.push("stagnation");
  if (externalCooldownActive) reasonCodes.push("external_cooldown");

  // Trigger semantics win — do not suppress/delay triggered events.
  if (triggerActive) {
    const motionLevel: SceneMotionLevel = immediateDanger ? "EXTERNAL" : "LOCAL";
    return {
      pacingMode: pacingMode === "ENSEMBLE" ? "ENSEMBLE" : "OPERATION",
      motionLevel,
      sceneKind,
      castMode: castFocus.sceneCastMode,
      intimateDyad,
      recentStagnation,
      externalCooldownActive,
      triggerActive,
      meaningfulBeatBudget: castFocus.sceneCastMode === "single_primary" ? 1 : 2,
      carrierHints: ["consequence", "world_reaction", "relationship"],
      primaryProgression: "consequence",
      npcActionEligible,
      externalEligible: true,
      reasonCodes: [...reasonCodes, "trigger_priority"],
    };
  }

  if (castFocus.sceneCastMode !== "single_primary" || pacingMode === "ENSEMBLE") {
    return {
      pacingMode: "ENSEMBLE",
      motionLevel: "EXTERNAL",
      sceneKind,
      castMode: castFocus.sceneCastMode,
      intimateDyad: false,
      recentStagnation,
      externalCooldownActive: false,
      triggerActive,
      meaningfulBeatBudget: 3,
      carrierHints: [
        "relationship",
        "npc_action",
        "world_reaction",
        "environment",
        "consequence",
      ],
      primaryProgression: "world_reaction",
      npcActionEligible: true,
      externalEligible: true,
      reasonCodes: [...reasonCodes, "ensemble_legacy_freedom"],
    };
  }

  // single_primary controller
  let motionLevel: SceneMotionLevel = "HOLD";
  let externalEligible = false;
  let primaryProgression: SceneProgressionType | null = null;
  let carrierHints: SceneProgressionType[] = ["relationship", "daily_life", "environment"];

  if (intimateDyad || pacingMode === "DYAD") {
    // DYAD: HOLD/AMBIENT only. EXTERNAL ineligible unless current danger (handled above).
    externalEligible = false;
    if (recentStagnation) {
      // Stagnation → relationship/daily/environment enrichment — never EXTERNAL promote.
      motionLevel = "AMBIENT";
      primaryProgression = "environment";
      carrierHints = ["relationship", "daily_life", "environment"];
      reasonCodes.push("dyad_stagnation_ambient");
    } else {
      motionLevel = "HOLD";
      primaryProgression = null;
      carrierHints = ["relationship", "daily_life", "environment"];
      reasonCodes.push("dyad_hold");
    }
    if (intimateDyad) {
      // Generated EXTERNAL / NPC_ACTION / NEW_EVENT ineligible
      reasonCodes.push("intimate_external_ineligible");
    }
  } else if (pacingMode === "EXPLORATION") {
    externalEligible = !externalCooldownActive;
    motionLevel = "LOCAL";
    primaryProgression = "lore_clue";
    carrierHints = ["lore_clue", "environment", "consequence"];
    if (recentStagnation) {
      motionLevel = "LOCAL";
      primaryProgression = "environment";
      reasonCodes.push("exploration_stagnation_local");
    }
    // EXTERNAL optional — only with grounded reason + cooldown clear.
    if (externalEligible && immediateDanger) {
      motionLevel = "EXTERNAL";
      primaryProgression = npcActionEligible ? "npc_action" : "world_reaction";
      reasonCodes.push("exploration_external_grounded");
    } else {
      reasonCodes.push("exploration_local");
    }
  } else if (pacingMode === "OPERATION") {
    externalEligible = !externalCooldownActive;
    if (externalEligible) {
      motionLevel = "EXTERNAL";
      primaryProgression = npcActionEligible ? "npc_action" : "world_reaction";
      carrierHints = ["world_reaction", "consequence", "tactical_planning"];
      reasonCodes.push("operation_external");
    } else {
      motionLevel = "LOCAL";
      primaryProgression = "consequence";
      carrierHints = ["consequence", "environment", "tactical_planning"];
      reasonCodes.push("operation_local_cooldown");
    }
  }

  // NPC action never primary unless eligible.
  if (primaryProgression === "npc_action" && !npcActionEligible) {
    primaryProgression = "world_reaction";
    reasonCodes.push("npc_ungrounded_demote");
  }

  return {
    pacingMode,
    motionLevel,
    sceneKind,
    castMode: castFocus.sceneCastMode,
    intimateDyad,
    recentStagnation,
    externalCooldownActive,
    triggerActive,
    meaningfulBeatBudget: 1,
    carrierHints,
    primaryProgression,
    npcActionEligible,
    externalEligible,
    reasonCodes,
  };
}

/** Compact 1–2 sentence cue — no legacy intensity/avoid/next-beat dump. */
export function renderCompactScenePacingCue(
  decision: ScenePacingDecision
): string {
  const body = (() => {
    switch (decision.motionLevel) {
      case "HOLD":
        return "현재 두 인물의 상호작용을 중심으로, 관계·내면·행동·감각에서 장면을 이어간다.";
      case "AMBIENT":
        return "현재 중심 상호작용을 유지하며, 주변 세계의 변화는 배경 수준에서 자연스럽게 반영한다.";
      case "LOCAL":
        return "현재 인과에서 직접 이어지는 새 정보나 결과 하나를 장면 안에서 진행한다.";
      case "EXTERNAL":
        return "현재 인과와 직접 연결된 외부 변화 하나를 진행하고, 현재 중심 상호작용과 연결한다.";
      default: {
        const _exhaustive: never = decision.motionLevel;
        return _exhaustive;
      }
    }
  })();

  // ONE PRIMARY RESPONSE POINT — not a dialogue % quota.
  const anchor =
    decision.castMode === "single_primary"
      ? " 이번 전개는 유저에게 동시에 여러 독립 결정을 요구하지 않는다."
      : "";

  return `[SCENE PACING]\n${body}${anchor}`;
}

/**
 * Derive Scene State Authority from a frozen pacing decision.
 * Does not re-classify mode/motion — maps motion → continuity + domains only.
 */
export function resolveSceneStateAuthority(
  decision: ScenePacingDecision
): SceneStateAuthority {
  switch (decision.motionLevel) {
    case "HOLD":
      return {
        stateAuthority: "RECENT_SCENE_CURRENT_USER_TRIGGER",
        canonRole: "POSSIBILITY_AND_CONSTRAINT",
        externalContinuity: "PRESERVE",
        transitionDomains: [
          "relationship",
          "ai_interior",
          "ai_action",
          "sensory",
          "ambient_environment",
        ],
      };
    case "AMBIENT":
      return {
        stateAuthority: "RECENT_SCENE_CURRENT_USER_TRIGGER",
        canonRole: "POSSIBILITY_AND_CONSTRAINT",
        externalContinuity: "AMBIENT_ONLY",
        transitionDomains: [
          "relationship",
          "ai_interior",
          "ai_action",
          "sensory",
          "ambient_environment",
        ],
      };
    case "LOCAL":
      return {
        stateAuthority: "RECENT_SCENE_CURRENT_USER_TRIGGER",
        canonRole: "POSSIBILITY_AND_CONSTRAINT",
        externalContinuity: "LOCAL_CHANGE",
        transitionDomains: [
          "ai_action",
          "sensory",
          "ambient_environment",
          "existing_consequence",
          "local_information",
        ],
      };
    case "EXTERNAL":
      return {
        stateAuthority: "RECENT_SCENE_CURRENT_USER_TRIGGER",
        canonRole: "POSSIBILITY_AND_CONSTRAINT",
        externalContinuity: "EXTERNAL_CHANGE",
        transitionDomains: [
          "existing_consequence",
          "local_information",
          "external_actor",
          "ambient_environment",
        ],
      };
    default: {
      const _exhaustive: never = decision.motionLevel;
      return _exhaustive;
    }
  }
}

function focusLineForDecision(decision: ScenePacingDecision): string {
  switch (decision.pacingMode) {
    case "DYAD":
      return "두 인물의 현재 상호작용";
    case "EXPLORATION":
      return "현재 탐사와 상호작용";
    case "OPERATION":
      return "현재 작전 인과와 상호작용";
    case "ENSEMBLE":
      return "현재 장면의 다중 인물 상호작용";
    default: {
      const _exhaustive: never = decision.pacingMode;
      return _exhaustive;
    }
  }
}

function transitionScopeLine(authority: SceneStateAuthority): string {
  switch (authority.externalContinuity) {
    case "PRESERVE":
      return "관계·내면·AI 행동·감각";
    case "AMBIENT_ONLY":
      return "관계·내면·AI 행동·감각·배경 환경";
    case "LOCAL_CHANGE":
      return "AI 행동·관찰·환경·직접 이어지는 정보/결과 하나";
    case "EXTERNAL_CHANGE":
      return "직접 이어지는 외부 변화·정보·결과 하나";
    default: {
      const _exhaustive: never = authority.externalContinuity;
      return _exhaustive;
    }
  }
}

function externalContinuityLine(authority: SceneStateAuthority): string {
  switch (authority.externalContinuity) {
    case "PRESERVE":
      return "현재 성립한 상태를 이어간다";
    case "AMBIENT_ONLY":
      return "배경 수준만 자연스럽게 반영한다";
    case "LOCAL_CHANGE":
      return "현재 인과 안의 국소 변화";
    case "EXTERNAL_CHANGE":
      return "현재 인과와 직접 연결된 외부 변화";
    default: {
      const _exhaustive: never = authority.externalContinuity;
      return _exhaustive;
    }
  }
}

/**
 * G10-SD3 compact Scene State Authority envelope.
 * Integrates authority into one cue — does not stack beside [SCENE PACING].
 * Positive authority contract only — no DO NOT / NEVER threat list.
 */
export function renderCompactSceneStateEnvelope(
  decision: ScenePacingDecision
): string {
  const authority = resolveSceneStateAuthority(decision);
  const focus = focusLineForDecision(decision);
  const scope = transitionScopeLine(authority);
  const external = externalContinuityLine(authority);
  const anchor =
    decision.castMode === "single_primary"
      ? " 이번 전개는 유저에게 동시에 여러 독립 결정을 요구하지 않는다."
      : "";

  return (
    `[SCENE STATE]\n` +
    `현재 장면의 사실은 현재 입력·최근 장면·발동된 사건이 기준이며, ` +
    `정본은 가능한 세계 규칙과 인물의 판단 기준이다. ` +
    `현재 초점: ${focus}. ` +
    `이번 턴의 변화 범위: ${scope}. ` +
    `외부 상태: ${external}.` +
    `${anchor}`
  );
}

/**
 * Progression types to commit into scene_progression_state after finalize.
 * HOLD → no EXTERNAL history markers (relationship/daily_life optional soft).
 */
export function progressionTypesForCommit(
  decision: ScenePacingDecision
): SceneProgressionType[] {
  if (decision.motionLevel === "HOLD") {
    return decision.primaryProgression ? [decision.primaryProgression] : ["relationship"];
  }
  if (decision.motionLevel === "AMBIENT") {
    return ["environment"];
  }
  if (decision.primaryProgression) return [decision.primaryProgression];
  if (decision.motionLevel === "LOCAL") return ["lore_clue"];
  return ["world_reaction"];
}

/** Strip genre-derived [SCENE MODE] pacing hint from RUNTIME STYLE (candidate only). */
export function stripGenreSceneModePacingHint(systemText: string): string {
  return systemText
    .replace(/\[SCENE MODE\][^\n]*\n?/g, "")
    .replace(/\[RUNTIME STYLE\]\n(?:\[genre_tone\][^\n]*\n)?\n?/g, (block) => {
      // If RUNTIME STYLE becomes empty after SCENE MODE strip, drop the shell.
      const cleaned = block
        .replace(/\[SCENE MODE\][^\n]*\n?/g, "")
        .trim();
      if (cleaned === "[RUNTIME STYLE]") return "";
      return `${cleaned}\n`;
    })
    .replace(/\n{3,}/g, "\n\n");
}

export function countPacingOwners(systemText: string): {
  scene_pacing: number;
  scene_state: number;
  scene_flow: number;
  genre_scene_mode: number;
  pacing_sot_count: number;
} {
  const scene_pacing = (systemText.match(/\[SCENE PACING\]/g) ?? []).length;
  const scene_state = (systemText.match(/\[SCENE STATE\]/g) ?? []).length;
  const scene_flow = (systemText.match(/\[SCENE FLOW\]/g) ?? []).length;
  const genre_scene_mode = (systemText.match(/\[SCENE MODE\]/g) ?? []).length;
  return {
    scene_pacing,
    scene_state,
    scene_flow,
    genre_scene_mode,
    // Competing owners: SCENE PACING + SCENE STATE + SCENE FLOW
    pacing_sot_count: scene_pacing + scene_state + scene_flow,
  };
}

/** G10-D1 — compact single_primary dialogue block-cap owner (no % quota). */
export const DIALOGUE_BLOCK_CAP_PARAGRAPH =
  "1:1 RP의 직접 발화는 필요한 만큼만 사용하며, 보통 1~3개, 최대 4개의 발화 블록 안에서 이번 응답의 대화 의도를 완결한다. 나머지 장면은 행동·내면·감각·환경·관계와 결과로 전개한다.";

/**
 * G10-D2/D3 — private runtime terminal dialogue budget (CURRENT USER TURN end).
 * Not user RP content. No %, no central-intent / function explanation.
 * D2 fixed owner kept for contrast; D3 renders ceiling dynamically.
 */
export const TERMINAL_DIALOGUE_BUDGET_MARKER = "[이번 응답 대화]";
/** @deprecated D2 fixed max-4 owner — Arm U only. Prefer renderTerminalDialogueBudgetOwner. */
export const TERMINAL_DIALOGUE_BUDGET_OWNER =
  `${TERMINAL_DIALOGUE_BUDGET_MARKER}\n` +
  `직접 발화는 최대 4개 블록으로 구성한다. 보통 1~3개면 충분하다.`;

const COMM_HEAVY_TERMS = [
  "무전",
  "통신",
  "교신",
  "연락",
  "보고",
  "브리핑",
  "협상",
  "심문",
  "응답하라",
  "들리나",
  "수신",
  "송신",
];

/** Current-user asks for active comm / report — not mere past mention of radios. */
const COMM_USER_DEMAND_TERMS = [
  "응답해야",
  "응답해",
  "보고해",
  "보고해야",
  "무전으로",
  "교신",
  "수신됐나",
  "들리나",
  "응답하라",
  "협상",
  "브리핑",
  "송신해",
];

/**
 * Deterministic communication-demand heuristic — no LLM classifier.
 * Keyword alone is insufficient for HIGH (false-positive guard).
 */
export function resolveCommunicationDemand(input: {
  currentUserMessage?: string | null;
  recentMessages?: ChatMsg[] | null;
  decision: ScenePacingDecision;
  knownSupportingCastNames?: string[] | null;
}): CommunicationDemand {
  const current = input.currentUserMessage ?? "";
  const recent = (input.recentMessages ?? [])
    .map((m) => m.content)
    .join("\n");
  const joined = `${current}\n${recent}`;
  const keywordHit = includesAny(joined, COMM_HEAVY_TERMS);
  if (!keywordHit) {
    return input.decision.pacingMode === "OPERATION" ? "NORMAL" : "LOW";
  }

  const groundedSpeaker =
    (input.knownSupportingCastNames ?? []).some((n) =>
      Boolean(n && joined.includes(n))
    ) || input.decision.npcActionEligible;
  const activeRemoteInRecent = includesAny(recent, [
    "무전",
    "수신",
    "송신",
    "교신",
    "들리나",
    "응답하라",
  ]);
  const userDemandsComm = includesAny(current, COMM_USER_DEMAND_TERMS);
  const operation = input.decision.pacingMode === "OPERATION";

  // Keyword + ≥1 corroborating signal → HIGH.
  // Past mention alone in calm dyad (no corroboration) stays NORMAL.
  if (operation || groundedSpeaker || activeRemoteInRecent || userDemandsComm) {
    return "HIGH";
  }
  return "NORMAL";
}

export function resolveTerminalDialogueBudget(input: {
  decision: ScenePacingDecision;
  communicationDemand: CommunicationDemand;
  party?: boolean | null;
  contentKind?: ContentKind | null;
}): TerminalDialogueBudgetResolution {
  const { decision, communicationDemand } = input;
  if (
    input.party ||
    input.contentKind === "simulation" ||
    decision.pacingMode === "ENSEMBLE" ||
    decision.castMode !== "single_primary"
  ) {
    return {
      maxBlocks: null,
      reason: "ensemble_uncapped",
      communicationDemand,
    };
  }
  if (decision.intimateDyad) {
    return {
      maxBlocks: 4,
      reason: "intimate_dyad",
      communicationDemand,
    };
  }
  if (communicationDemand === "HIGH") {
    return {
      maxBlocks: 6,
      reason: "communication_heavy",
      communicationDemand,
    };
  }
  if (decision.pacingMode === "OPERATION") {
    return {
      maxBlocks: 6,
      reason: "operation",
      communicationDemand,
    };
  }
  if (decision.pacingMode === "EXPLORATION") {
    return {
      maxBlocks: 5,
      reason: "exploration",
      communicationDemand,
    };
  }
  return {
    maxBlocks: 4,
    reason: "quiet_dyad",
    communicationDemand,
  };
}

/** D3 terminal wording — ceiling only; no fixed 1–3 preferred line. */
export function renderTerminalDialogueBudgetOwner(
  maxBlocks: Exclude<DialogueBudget, null>
): string {
  return (
    `${TERMINAL_DIALOGUE_BUDGET_MARKER}\n` +
    `직접 발화는 필요한 만큼 사용하되 최대 ${maxBlocks}개 블록으로 구성한다.`
  );
}

/**
 * REPLACE closest dialogue owner ([DIALOGUE & NARRATION]) with one integrated
 * [대화 운용] section — formatting lines kept; no duplicate dialogue owners.
 */
export function renderDialogueBlockCapOwner(): string {
  return (
    `[대화 운용]\n` +
    `${DIALOGUE_BLOCK_CAP_PARAGRAPH}\n` +
    `대사는 독립 문단으로 표시한다.\n` +
    `화자가 바뀌면 새 대사 문단을 사용한다.\n` +
    `- 대사 중간에 지문을 끼워 넣어 발화를 분절하지 말 것.`
  );
}

export function countDialogueBlockOwners(systemText: string): {
  dialogue_block_owner: number;
  dialogue_narration_owner: number;
  numeric_dialogue_percentage: number;
} {
  return {
    dialogue_block_owner: (systemText.match(/\[대화 운용\]/g) ?? []).length,
    dialogue_narration_owner: (systemText.match(/\[DIALOGUE & NARRATION\]/g) ?? [])
      .length,
    numeric_dialogue_percentage: (
      systemText.match(/대사\s*\d+\s*%|지문\s*\d+\s*%|dialogue\s*\d+\s*%/gi) ?? []
    ).length,
  };
}

export function countTerminalDialogueBudgetOwners(text: string): {
  terminal_dialogue_budget_owner: number;
  numeric_dialogue_percentage: number;
} {
  return {
    terminal_dialogue_budget_owner: (
      text.match(/\[이번 응답 대화\]/g) ?? []
    ).length,
    numeric_dialogue_percentage: (
      text.match(/대사\s*\d+\s*%|지문\s*\d+\s*%|dialogue\s*\d+\s*%/gi) ?? []
    ).length,
  };
}

/**
 * Append private dialogue-budget line at CURRENT USER TURN end (after length
 * owner / layout). single_primary only — sim/party/ensemble skip (null budget).
 */
export function appendTerminalDialogueBudgetToUserTurn(input: {
  userContent: string;
  decision: ScenePacingDecision;
  /** When omitted, D2 fixed max-4 owner is used (Arm U). */
  budget?: TerminalDialogueBudgetResolution | null;
}): {
  userContent: string;
  appended: boolean;
  skippedReason: string | null;
  maxBlocks: DialogueBudget;
} {
  const budget =
    input.budget ??
    ({
      maxBlocks: 4 as const,
      reason: "quiet_dyad" as const,
      communicationDemand: "NORMAL" as const,
    } satisfies TerminalDialogueBudgetResolution);

  if (budget.maxBlocks == null) {
    return {
      userContent: input.userContent,
      appended: false,
      skippedReason: budget.reason,
      maxBlocks: null,
    };
  }
  if (input.decision.castMode !== "single_primary") {
    return {
      userContent: input.userContent,
      appended: false,
      skippedReason: `cast:${input.decision.castMode}`,
      maxBlocks: null,
    };
  }
  if (input.decision.pacingMode === "ENSEMBLE") {
    return {
      userContent: input.userContent,
      appended: false,
      skippedReason: "mode:ENSEMBLE",
      maxBlocks: null,
    };
  }
  if (input.userContent.includes(TERMINAL_DIALOGUE_BUDGET_MARKER)) {
    return {
      userContent: input.userContent,
      appended: true,
      skippedReason: null,
      maxBlocks: budget.maxBlocks,
    };
  }
  const owner =
    input.budget != null
      ? renderTerminalDialogueBudgetOwner(budget.maxBlocks)
      : TERMINAL_DIALOGUE_BUDGET_OWNER;
  return {
    userContent: `${input.userContent.trimEnd()}\n\n${owner}`,
    appended: true,
    skippedReason: null,
    maxBlocks: budget.maxBlocks,
  };
}

/** Integrate block-cap owner for single_primary only (sim/party/ensemble skip). */
export function integrateDialogueBlockCap(input: {
  systemText: string;
  decision: ScenePacingDecision;
}): { systemText: string; integrated: boolean; skippedReason: string | null } {
  if (input.decision.castMode !== "single_primary") {
    return {
      systemText: input.systemText,
      integrated: false,
      skippedReason: `cast:${input.decision.castMode}`,
    };
  }
  if (input.decision.pacingMode === "ENSEMBLE") {
    return {
      systemText: input.systemText,
      integrated: false,
      skippedReason: "mode:ENSEMBLE",
    };
  }
  if (input.systemText.includes("[대화 운용]")) {
    return {
      systemText: input.systemText,
      integrated: true,
      skippedReason: null,
    };
  }

  const owner = renderDialogueBlockCapOwner();
  if (input.systemText.includes("[DIALOGUE & NARRATION]")) {
    const systemText = input.systemText.replace(
      /\[DIALOGUE & NARRATION\][\s\S]*?(?=\n\[|$)/,
      `${owner}\n`
    );
    return { systemText, integrated: true, skippedReason: null };
  }

  // Fallback: place before OUTPUT LAYOUT / IMMERSIVE PROSE, else append.
  if (input.systemText.includes("[OUTPUT LAYOUT]")) {
    return {
      systemText: input.systemText.replace(
        "[OUTPUT LAYOUT]",
        `${owner}\n\n[OUTPUT LAYOUT]`
      ),
      integrated: true,
      skippedReason: null,
    };
  }
  if (input.systemText.includes("[IMMERSIVE LONGFORM PROSE]")) {
    return {
      systemText: input.systemText.replace(
        "[IMMERSIVE LONGFORM PROSE]",
        `${owner}\n\n[IMMERSIVE LONGFORM PROSE]`
      ),
      integrated: true,
      skippedReason: null,
    };
  }
  if (input.systemText.includes("[IMMERSIVE PROSE]")) {
    return {
      systemText: input.systemText.replace(
        "[IMMERSIVE PROSE]",
        `${owner}\n\n[IMMERSIVE PROSE]`
      ),
      integrated: true,
      skippedReason: null,
    };
  }
  return {
    systemText: `${input.systemText.trim()}\n\n${owner}`,
    integrated: true,
    skippedReason: null,
  };
}

/**
 * Apply pacing arm to assembled messages.
 * - A: production (no cue)
 * - P: G10-SD1 — INSERT [SCENE PACING] before SCENE FLOW (two pacing owners)
 * - Q: G10-SD2 — REPLACE SCENE_FLOW_BLOCK with [SCENE PACING]
 * - R: G10-SD3 — REPLACE SCENE_FLOW_BLOCK with [SCENE STATE] authority envelope
 * - T: G10-D1 — Q + single_primary system [대화 운용]
 * - U: G10-D2 — Q + fixed terminal max-4 [이번 응답 대화]
 * - V: G10-D3 — Q + server-resolved terminal ceiling (4|5|6|absent)
 */
export function applyScenePacingArmToMessages(input: {
  messages: Array<{ role: string; content: string }>;
  arm: ScenePacingArm;
  decision: ScenePacingDecision;
  /** Optional signals for Arm V dynamic budget (ignored by other arms). */
  dialogueBudgetInput?: {
    currentUserMessage?: string | null;
    recentMessages?: ChatMsg[] | null;
    knownSupportingCastNames?: string[] | null;
    party?: boolean | null;
    contentKind?: ContentKind | null;
  } | null;
}): {
  messages: Array<{ role: string; content: string }>;
  systemText: string;
  lastUserContent: string;
  insertedCue: boolean;
  replacedSceneFlow: boolean;
  strippedGenreSceneMode: boolean;
  dialogueBlockCapIntegrated: boolean;
  terminalDialogueBudgetAppended: boolean;
  dialogueBudget: TerminalDialogueBudgetResolution | null;
} {
  const messages = input.messages.map((m) => ({ ...m, content: m.content }));
  if (input.arm === "A") {
    const systemText = messages.find((m) => m.role === "system")?.content ?? "";
    const lastUserContent =
      [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
    return {
      messages,
      systemText,
      lastUserContent,
      insertedCue: false,
      replacedSceneFlow: false,
      strippedGenreSceneMode: false,
      dialogueBlockCapIntegrated: false,
      terminalDialogueBudgetAppended: false,
      dialogueBudget: null,
    };
  }

  let strippedGenreSceneMode = false;
  let insertedCue = false;
  let replacedSceneFlow = false;
  let dialogueBlockCapIntegrated = false;
  let terminalDialogueBudgetAppended = false;
  let dialogueBudget: TerminalDialogueBudgetResolution | null = null;
  // T/U/V share Q pacing path; R keeps state envelope.
  const pacingArm: ScenePacingArm =
    input.arm === "T" || input.arm === "U" || input.arm === "V"
      ? "Q"
      : input.arm;
  const cue =
    pacingArm === "R"
      ? renderCompactSceneStateEnvelope(input.decision)
      : renderCompactScenePacingCue(input.decision);

  for (const m of messages) {
    if (m.role !== "system") continue;
    const before = m.content;
    m.content = stripGenreSceneModePacingHint(m.content);
    if (m.content !== before) strippedGenreSceneMode = true;

    if (
      m.content.includes("[SCENE PACING]") ||
      m.content.includes("[SCENE STATE]")
    ) {
      // still allow T dialogue-cap integrate below
    } else if (pacingArm === "Q" || pacingArm === "R") {
      // REPLACE SCENE FLOW — single owner (pacing cue or state envelope).
      if (m.content.includes(SCENE_FLOW_BLOCK)) {
        m.content = m.content.split(SCENE_FLOW_BLOCK).join(cue);
        replacedSceneFlow = true;
        insertedCue = true;
      } else if (m.content.includes("[SCENE FLOW]")) {
        m.content = m.content.replace(
          /\[SCENE FLOW\][\s\S]*?(?=\n\[|$)/,
          `${cue}\n`
        );
        replacedSceneFlow = true;
        insertedCue = true;
      } else {
        m.content = `${m.content.trim()}\n\n${cue}`;
        insertedCue = true;
      }
    } else {
      // Arm P — G10-SD1 insert-before (kept for owner-count contrast only).
      if (m.content.includes("[SCENE FLOW]")) {
        m.content = m.content.replace(
          "[SCENE FLOW]",
          `${cue}\n\n[SCENE FLOW]`
        );
      } else if (m.content.includes("[IMMERSIVE LONGFORM PROSE]")) {
        m.content = m.content.replace(
          "[IMMERSIVE LONGFORM PROSE]",
          `${cue}\n\n[IMMERSIVE LONGFORM PROSE]`
        );
      } else if (m.content.includes("[IMMERSIVE PROSE]")) {
        m.content = m.content.replace(
          "[IMMERSIVE PROSE]",
          `${cue}\n\n[IMMERSIVE PROSE]`
        );
      } else {
        m.content = `${m.content.trim()}\n\n${cue}`;
      }
      insertedCue = true;
    }

    if (input.arm === "T") {
      const integrated = integrateDialogueBlockCap({
        systemText: m.content,
        decision: input.decision,
      });
      m.content = integrated.systemText;
      if (integrated.integrated) dialogueBlockCapIntegrated = true;
    }
  }

  // G10-D2/D3: append private budget after production terminal length/layout lines.
  if (input.arm === "U" || input.arm === "V") {
    const budgetInput = input.dialogueBudgetInput;
    if (input.arm === "V") {
      const demand = resolveCommunicationDemand({
        currentUserMessage: budgetInput?.currentUserMessage,
        recentMessages: budgetInput?.recentMessages,
        decision: input.decision,
        knownSupportingCastNames: budgetInput?.knownSupportingCastNames,
      });
      dialogueBudget = resolveTerminalDialogueBudget({
        decision: input.decision,
        communicationDemand: demand,
        party: budgetInput?.party,
        contentKind: budgetInput?.contentKind,
      });
    } else {
      dialogueBudget = {
        maxBlocks: 4,
        reason: "quiet_dyad",
        communicationDemand: "NORMAL",
      };
    }

    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i]!;
      if (m.role !== "user") continue;
      const appended = appendTerminalDialogueBudgetToUserTurn({
        userContent: m.content,
        decision: input.decision,
        budget: input.arm === "V" ? dialogueBudget : undefined,
      });
      m.content = appended.userContent;
      terminalDialogueBudgetAppended = appended.appended;
      break;
    }
  }

  const systemText = messages.find((m) => m.role === "system")?.content ?? "";
  const lastUserContent =
    [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
  return {
    messages,
    systemText,
    lastUserContent,
    insertedCue,
    replacedSceneFlow,
    strippedGenreSceneMode,
    dialogueBlockCapIntegrated,
    terminalDialogueBudgetAppended,
    dialogueBudget,
  };
}
