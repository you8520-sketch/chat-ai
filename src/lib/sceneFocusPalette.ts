/**
 * Structured scene-focus palette — server-side SceneDirective input only.
 *
 * NOT a separate prompt section. When null (production default), builder
 * behavior is unchanged. Canary harness sets ACTIVE_DYAD / STALLING explicitly;
 * no production auto-resolver in this experiment.
 */

import type { SceneProgressionType } from "@/lib/sceneDirective";

export type SceneFocusState =
  | "ACTIVE_DYAD"
  | "STALLING"
  | "EXTERNAL_REQUIRED";

export type SceneProgressionSource =
  | "USER_CUE_RESPONSE"
  | "PRIMARY_INTERPRETATION"
  | "PRIMARY_DECISION"
  | "PRIMARY_ACTION"
  | "RELATIONSHIP_MOVEMENT"
  | "EXISTING_ENVIRONMENT"
  | "EXISTING_GOAL"
  | "EXISTING_EXTERNAL_ACTOR"
  | "NEW_EXTERNAL_EVENT"
  | "NEW_SPEAKING_NPC"
  | "ADMINISTRATIVE_PROCESS"
  | "OPEN_REACTION_CHANGE";

export type SceneFocusPalette = {
  state: SceneFocusState;
  allowedSources: SceneProgressionSource[];
  preferredSources: SceneProgressionSource[];
  allowNewSpeakingNpc: boolean;
  allowAdministrativeProcess: boolean;
  allowNewExternalEvent: boolean;
};

export type SceneFocusDiagnostics = {
  state: SceneFocusState;
  requestedBeatCount: number;
  resolvedBeatCount: number;
  resolvedProgressionSources: SceneProgressionSource[];
  externalSourcesWithheld: SceneProgressionSource[];
  replacementSources: SceneProgressionSource[];
  resolvedProgressionTypes: SceneProgressionType[];
  /**
   * Palette motion sentence kept for diagnostics only — never serialized into
   * the model prompt under base-engine-preservation variants.
   */
  engineMotionDiagnostic?: string | null;
};

/** Positive engine-rule body for ACTIVE_DYAD — selection, not prohibition. */
export const ACTIVE_DYAD_SCENE_ENGINE_MOTION =
  "반복된 감정 확인에 멈추지 말고 주 캐릭터의 해석·선택·행동, 관계 온도, 이미 있는 환경과 목표 중 하나를 조용히 움직인다.";

export const STALLING_SCENE_ENGINE_MOTION =
  "반복된 감정 확인에 멈추지 말고 주 캐릭터의 선택·행동, 이미 있는 환경·목표, 관계 변화를 먼저 움직인다. 그것만으로 진행이 안 될 때만 의미 있는 외부 사건을 쓴다.";

export const ACTIVE_DYAD_PALETTE: SceneFocusPalette = {
  state: "ACTIVE_DYAD",
  allowedSources: [
    "USER_CUE_RESPONSE",
    "PRIMARY_INTERPRETATION",
    "PRIMARY_DECISION",
    "PRIMARY_ACTION",
    "RELATIONSHIP_MOVEMENT",
    "EXISTING_ENVIRONMENT",
    "EXISTING_GOAL",
    "EXISTING_EXTERNAL_ACTOR",
  ],
  preferredSources: [
    "USER_CUE_RESPONSE",
    "PRIMARY_INTERPRETATION",
    "PRIMARY_DECISION",
    "PRIMARY_ACTION",
    "RELATIONSHIP_MOVEMENT",
    "EXISTING_ENVIRONMENT",
  ],
  allowNewSpeakingNpc: false,
  allowAdministrativeProcess: false,
  allowNewExternalEvent: false,
};

export const STALLING_PALETTE: SceneFocusPalette = {
  state: "STALLING",
  allowedSources: [
    "PRIMARY_DECISION",
    "PRIMARY_ACTION",
    "EXISTING_ENVIRONMENT",
    "EXISTING_GOAL",
    "RELATIONSHIP_MOVEMENT",
    "NEW_EXTERNAL_EVENT",
    "NEW_SPEAKING_NPC",
  ],
  preferredSources: [
    "PRIMARY_DECISION",
    "PRIMARY_ACTION",
    "EXISTING_ENVIRONMENT",
    "EXISTING_GOAL",
    "RELATIONSHIP_MOVEMENT",
  ],
  allowNewSpeakingNpc: true,
  allowAdministrativeProcess: false,
  allowNewExternalEvent: true,
};

export function paletteForSceneFocusState(
  state: SceneFocusState | null | undefined
): SceneFocusPalette | null {
  if (!state) return null;
  if (state === "ACTIVE_DYAD") return ACTIVE_DYAD_PALETTE;
  if (state === "STALLING") return STALLING_PALETTE;
  // EXTERNAL_REQUIRED reserved for future resolver — not used this canary.
  return null;
}

/** Map V1 progression types → abstract progression sources for diagnostics. */
export function progressionTypeToSource(
  type: SceneProgressionType
): SceneProgressionSource {
  switch (type) {
    case "relationship":
      return "RELATIONSHIP_MOVEMENT";
    case "daily_life":
      return "PRIMARY_ACTION";
    case "lore_clue":
      return "PRIMARY_INTERPRETATION";
    case "npc_action":
      return "NEW_SPEAKING_NPC";
    case "world_reaction":
      return "NEW_EXTERNAL_EVENT";
    case "tactical_planning":
      return "EXISTING_GOAL";
    case "consequence":
      return "PRIMARY_DECISION";
    case "comedy":
      return "RELATIONSHIP_MOVEMENT";
    case "environment":
      return "EXISTING_ENVIRONMENT";
    default:
      return "PRIMARY_ACTION";
  }
}

/** Preferred internal replacements when external sources are withheld. */
const REPLACEMENT_CYCLE: SceneProgressionSource[] = [
  "PRIMARY_INTERPRETATION",
  "PRIMARY_DECISION",
  "PRIMARY_ACTION",
  "RELATIONSHIP_MOVEMENT",
  "EXISTING_ENVIRONMENT",
  "EXISTING_GOAL",
];

export function sourceToProgressionType(
  source: SceneProgressionSource
): SceneProgressionType {
  switch (source) {
    case "USER_CUE_RESPONSE":
    case "PRIMARY_INTERPRETATION":
      return "lore_clue";
    case "PRIMARY_DECISION":
      return "consequence";
    case "PRIMARY_ACTION":
      return "daily_life";
    case "RELATIONSHIP_MOVEMENT":
    case "OPEN_REACTION_CHANGE":
      return "relationship";
    case "EXISTING_ENVIRONMENT":
      return "environment";
    case "EXISTING_GOAL":
      return "tactical_planning";
    case "EXISTING_EXTERNAL_ACTOR":
      return "npc_action";
    case "NEW_EXTERNAL_EVENT":
      return "world_reaction";
    case "NEW_SPEAKING_NPC":
    case "ADMINISTRATIVE_PROCESS":
      return "npc_action";
    default:
      return "relationship";
  }
}

export function isExternalWithheldSource(
  source: SceneProgressionSource,
  palette: SceneFocusPalette
): boolean {
  if (source === "ADMINISTRATIVE_PROCESS") {
    return !palette.allowAdministrativeProcess;
  }
  if (source === "NEW_SPEAKING_NPC") {
    return !palette.allowNewSpeakingNpc;
  }
  if (source === "NEW_EXTERNAL_EVENT") {
    return !palette.allowNewExternalEvent;
  }
  // EXISTING_EXTERNAL_ACTOR is allowed by ACTIVE_DYAD palette but never
  // surfaces as a fresh speaking-NPC label — handled via remapping when
  // allowNewSpeakingNpc is false.
  if (source === "EXISTING_EXTERNAL_ACTOR" && !palette.allowNewSpeakingNpc) {
    return true;
  }
  return !palette.allowedSources.includes(source);
}

/**
 * Remap selected progression types through the palette, preserving beat count.
 * External/disallowed slots are replaced 1:1 with preferred internal sources.
 */
export function applySceneFocusPaletteToProgressionTypes(
  types: SceneProgressionType[],
  palette: SceneFocusPalette | null | undefined
): { types: SceneProgressionType[]; diagnostics: SceneFocusDiagnostics | null } {
  if (!palette) {
    return { types, diagnostics: null };
  }

  const requestedBeatCount = types.length;
  const externalSourcesWithheld: SceneProgressionSource[] = [];
  const replacementSources: SceneProgressionSource[] = [];
  const resolvedProgressionSources: SceneProgressionSource[] = [];
  const resolvedTypes: SceneProgressionType[] = [];
  let replaceIdx = 0;

  for (const type of types) {
    const source = progressionTypeToSource(type);
    if (isExternalWithheldSource(source, palette)) {
      externalSourcesWithheld.push(source);
      // Pick next preferred source not already heavily used in this turn.
      let chosen: SceneProgressionSource | null = null;
      for (let i = 0; i < REPLACEMENT_CYCLE.length; i++) {
        const candidate =
          REPLACEMENT_CYCLE[(replaceIdx + i) % REPLACEMENT_CYCLE.length]!;
        if (
          palette.preferredSources.includes(candidate) ||
          palette.allowedSources.includes(candidate)
        ) {
          chosen = candidate;
          replaceIdx = (replaceIdx + i + 1) % REPLACEMENT_CYCLE.length;
          break;
        }
      }
      if (!chosen) chosen = "RELATIONSHIP_MOVEMENT";
      replacementSources.push(chosen);
      resolvedProgressionSources.push(chosen);
      resolvedTypes.push(sourceToProgressionType(chosen));
    } else {
      // Soft remap: prefer PRIMARY_* labels for relationship/daily when ACTIVE_DYAD
      // so diagnostics show internal progression, while V1 type stays coherent.
      let resolvedSource = source;
      if (palette.state === "ACTIVE_DYAD") {
        if (type === "relationship") resolvedSource = "RELATIONSHIP_MOVEMENT";
        else if (type === "daily_life") resolvedSource = "PRIMARY_ACTION";
        else if (type === "lore_clue") resolvedSource = "PRIMARY_INTERPRETATION";
        else if (type === "consequence") resolvedSource = "PRIMARY_DECISION";
        else if (type === "environment") resolvedSource = "EXISTING_ENVIRONMENT";
        else if (type === "tactical_planning") resolvedSource = "EXISTING_GOAL";
      }
      resolvedProgressionSources.push(resolvedSource);
      resolvedTypes.push(type);
    }
  }

  // Guarantee preferred internal coverage — upgrade in place, or expand when
  // the weighted pick left a single abstract slot (beat count may grow, never shrink).
  const hasDecisionOrAction = () =>
    resolvedProgressionSources.some(
      (s) => s === "PRIMARY_DECISION" || s === "PRIMARY_ACTION"
    );
  const hasRelOrEnv = () =>
    resolvedProgressionSources.some(
      (s) => s === "RELATIONSHIP_MOVEMENT" || s === "EXISTING_ENVIRONMENT"
    );
  if (resolvedTypes.length > 0 && !hasDecisionOrAction()) {
    resolvedTypes[0] = "consequence";
    resolvedProgressionSources[0] = "PRIMARY_DECISION";
  }
  if (!hasRelOrEnv()) {
    if (resolvedTypes.length >= 2) {
      resolvedTypes[1] = "relationship";
      resolvedProgressionSources[1] = "RELATIONSHIP_MOVEMENT";
    } else if (palette.state === "ACTIVE_DYAD" || palette.state === "STALLING") {
      // Coverage expand — not a withhold replacement; beat count may grow.
      resolvedTypes.push("relationship");
      resolvedProgressionSources.push("RELATIONSHIP_MOVEMENT");
    }
  }

  // Ensure beat count never shrinks vs request.
  while (resolvedTypes.length < requestedBeatCount) {
    const fill =
      REPLACEMENT_CYCLE[resolvedTypes.length % REPLACEMENT_CYCLE.length]!;
    resolvedProgressionSources.push(fill);
    resolvedTypes.push(sourceToProgressionType(fill));
    replacementSources.push(fill);
  }

  return {
    types: resolvedTypes,
    diagnostics: {
      state: palette.state,
      requestedBeatCount,
      resolvedBeatCount: resolvedTypes.length,
      resolvedProgressionSources,
      externalSourcesWithheld,
      replacementSources,
      resolvedProgressionTypes: [...resolvedTypes],
      engineMotionDiagnostic: sceneEngineMotionForPalette(palette),
    },
  };
}

/** Zero / boost weights before weighted pick so RNG prefers palette sources. */
export function applyPaletteWeightGates(
  weights: Map<SceneProgressionType, number>,
  palette: SceneFocusPalette | null | undefined
): void {
  if (!palette) return;

  if (!palette.allowNewSpeakingNpc) {
    weights.set("npc_action", 0);
  }
  if (!palette.allowNewExternalEvent) {
    weights.set("world_reaction", 0);
  }
  if (!palette.allowAdministrativeProcess) {
    // Administrative filler typically arrives via npc_action / world_reaction —
    // already zeroed; no separate type.
  }

  // Boost preferred internal types so pickCount slots fill with replacements.
  const boost = (type: SceneProgressionType, factor: number) => {
    const w = weights.get(type) ?? 0;
    if (w > 0) weights.set(type, w * factor);
    else weights.set(type, factor);
  };
  if (palette.state === "ACTIVE_DYAD" || palette.state === "STALLING") {
    boost("relationship", 1.35);
    boost("daily_life", 1.25);
    boost("consequence", 1.3);
    boost("environment", 1.25);
    boost("lore_clue", 1.15);
  }
}

export function sceneEngineMotionForPalette(
  palette: SceneFocusPalette | null | undefined
): string | null {
  if (!palette) return null;
  if (palette.state === "ACTIVE_DYAD") return ACTIVE_DYAD_SCENE_ENGINE_MOTION;
  if (palette.state === "STALLING") return STALLING_SCENE_ENGINE_MOTION;
  return null;
}

/** Next-beat hints that own open reaction without a separate prompt block. */
export const ACTIVE_DYAD_HINT_BY_TYPE: Partial<Record<SceneProgressionType, string>> = {
  relationship:
    "주 캐릭터가 유저의 말에서 읽은 단서를 행동으로 받아내며 관계 거리가 실제로 한 걸음 달라지고, 유저가 고를 수 있는 변화를 남긴다.",
  daily_life:
    "주 캐릭터의 구체적 선택·행동이 생활 변수 하나를 바꾸고, 그 결과가 다음 응답을 연다.",
  lore_clue:
    "주 캐릭터가 유저의 단서를 성격에 맞게 해석하고, 그 해석이 다음 선택으로 이어진다.",
  consequence:
    "직전 단서에 따른 주 캐릭터의 결정이 장면 형태를 바꾸고, 열린 반응 지점을 남긴다.",
  environment:
    "이미 있는 장소·사물의 작은 변화가 주 캐릭터의 태도나 거리를 밀어 다음 행동을 연다.",
  tactical_planning:
    "이미 있는 목표·일정이 주 캐릭터의 선택으로 한 단계 구체화되며 유저 응답 여지를 남긴다.",
  comedy:
    "가벼운 엇갈림이 주 캐릭터의 반응으로 정리되며 관계 온도가 조금 움직인다.",
};
