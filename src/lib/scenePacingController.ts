/**
 * Phase G10-SD1 — Scene Pacing Controller (Motion Budget).
 *
 * Experiment / harness-first. Does NOT wire into chat route by default.
 * Production standard interactive SceneDirective injection remains OFF (ARM D).
 *
 * Sole architecture: SERVER MOTION BUDGET — not a new Gemini negative prompt list.
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

export type ScenePacingMode =
  | "DYAD"
  | "EXPLORATION"
  | "OPERATION"
  | "ENSEMBLE";

export type SceneMotionLevel = "HOLD" | "AMBIENT" | "LOCAL" | "EXTERNAL";

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

export function applyScenePacingArmToMessages(input: {
  messages: Array<{ role: string; content: string }>;
  arm: "A" | "P";
  decision: ScenePacingDecision;
}): {
  messages: Array<{ role: string; content: string }>;
  systemText: string;
  insertedCue: boolean;
  strippedGenreSceneMode: boolean;
} {
  const messages = input.messages.map((m) => ({ ...m, content: m.content }));
  if (input.arm === "A") {
    const systemText = messages.find((m) => m.role === "system")?.content ?? "";
    return {
      messages,
      systemText,
      insertedCue: false,
      strippedGenreSceneMode: false,
    };
  }

  let strippedGenreSceneMode = false;
  let insertedCue = false;
  const cue = renderCompactScenePacingCue(input.decision);

  for (const m of messages) {
    if (m.role !== "system") continue;
    const before = m.content;
    m.content = stripGenreSceneModePacingHint(m.content);
    if (m.content !== before) strippedGenreSceneMode = true;
    // Do not inject legacy verbose SceneDirective — compact cue only.
    if (!m.content.includes("[SCENE PACING]")) {
      // Place near prose/SCENE FLOW if present, else append before POV tail.
      if (m.content.includes("[SCENE FLOW]")) {
        m.content = m.content.replace(
          "[SCENE FLOW]",
          `${cue}\n\n[SCENE FLOW]`
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
  }

  const systemText = messages.find((m) => m.role === "system")?.content ?? "";
  return { messages, systemText, insertedCue, strippedGenreSceneMode };
}
