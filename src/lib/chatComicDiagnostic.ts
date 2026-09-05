import type { ChatComicPanelCount } from "@/lib/chatComicGenerationConstants";
import type { ComicSafeStructureProjection } from "@/lib/chatComicSafeStructure";
import type {
  ScenePanel,
  ScenePlan,
} from "@/lib/chatImageScenePlan";
import type {
  ComicReferenceIsolationMode,
  ComicVisualContextIsolationMode,
} from "@/lib/chatComicReferenceIsolation";

export type ComicDiagnosticMode =
  | "normal"
  | "semantic_ladder"
  | "blank_balloon_hybrid";

export type ComicSemanticLevel =
  | "L0"
  | "L1"
  | "L2"
  | "L3"
  | "L4"
  | "L5"
  | "L6"
  | "L7"
  | "L8";

export type ComicBlankBalloonTextStrategy =
  | "local_image_detection"
  | "shared_anchor_regions";

export type ComicSemanticLevelDefinition = {
  id: ComicSemanticLevel;
  name: string;
  visualSemantics: string;
  location: string;
  safePose: string;
};

/**
 * The ladder is intentionally provider-facing visual semantics only.
 * It contains no source dialogue, user prose, or placeholder text.
 */
export const COMIC_SEMANTIC_LADDER: readonly ComicSemanticLevelDefinition[] = [
  {
    id: "L0",
    name: "neutral_indoor_standing",
    visualSemantics:
      "two explicitly adult subjects, both fully clothed, standing separately in an ordinary indoor room",
    location: "ordinary indoor room",
    safePose: "standing separately with neutral expressions",
  },
  {
    id: "L1",
    name: "bedroom_standing",
    visualSemantics:
      "an adult bedroom with two explicitly adult subjects, both fully clothed, standing naturally in the room",
    location: "adult bedroom",
    safePose: "standing naturally with clear personal space",
  },
  {
    id: "L2",
    name: "bed_sitting",
    visualSemantics:
      "a visible bed with two explicitly adult subjects, both fully clothed, sitting on the edge of the bed",
    location: "adult bedroom with a clearly visible bed",
    safePose: "sitting separately on the edge of the bed",
  },
  {
    id: "L3",
    name: "one_lying",
    visualSemantics:
      "one explicitly adult subject lying on the bed while the other explicitly adult subject sits nearby; both are fully clothed",
    location: "adult bedroom with a clearly visible bed",
    safePose: "one subject lying on the bed and the other sitting nearby",
  },
  {
    id: "L4",
    name: "both_on_bed",
    visualSemantics:
      "two explicitly adult subjects resting on the bed in ordinary affectionate proximity; both are fully clothed",
    location: "adult bedroom with a clearly visible bed",
    safePose: "both subjects resting on the bed with ordinary affectionate proximity",
  },
  {
    id: "L5",
    name: "clothed_embrace",
    visualSemantics:
      "two fully clothed adult men sharing a gentle embrace on the bed",
    location: "adult bedroom with a clearly visible bed",
    safePose: "a gentle clothed embrace on the bed",
  },
  {
    id: "L6",
    name: "clothed_kiss",
    visualSemantics:
      "two fully clothed adult men sharing a gentle kiss in the bedroom",
    location: "adult bedroom with a clearly visible bed",
    safePose: "a gentle clothed kiss with faces readable",
  },
  {
    id: "L7",
    name: "shirtless_nonsexual",
    visualSemantics:
      "one explicitly adult man is shirtless in an ordinary non-sexual pose while the other explicitly adult subject, fully clothed, is nearby",
    location: "ordinary indoor room",
    safePose: "shirtless adult man in an ordinary non-sexual pose with the other subject nearby",
  },
  {
    id: "L8",
    name: "shirtless_bed",
    visualSemantics:
      "one explicitly adult man is shirtless while resting on the bed in a non-sexual everyday depiction; the other explicitly adult subject is nearby and fully clothed",
    location: "adult bedroom with a clearly visible bed",
    safePose: "shirtless adult man resting on the bed in a non-sexual everyday pose",
  },
] as const;

export const COMIC_DIAGNOSTIC_MODES: readonly ComicDiagnosticMode[] = [
  "normal",
  "semantic_ladder",
  "blank_balloon_hybrid",
];

/**
 * Canonical human-QA order. `local_image_detection` places server glyphs inside
 * actually-detected provider balloon interiors — the only provable strategy.
 * `shared_anchor_regions` is EXPERIMENTAL_UNPROVEN: the provider is only told
 * speaker/length/side and the server computes its own coordinates, so there is
 * no proof glyphs land inside provider balloons.
 */
export const COMIC_BLANK_BALLOON_TEXT_STRATEGIES: readonly ComicBlankBalloonTextStrategy[] = [
  "local_image_detection",
  "shared_anchor_regions",
];

function isSemanticLevel(value: unknown): value is ComicSemanticLevel {
  return COMIC_SEMANTIC_LADDER.some((level) => level.id === value);
}

function isDiagnosticMode(value: unknown): value is ComicDiagnosticMode {
  return COMIC_DIAGNOSTIC_MODES.includes(value as ComicDiagnosticMode);
}

function isTextStrategy(value: unknown): value is ComicBlankBalloonTextStrategy {
  return COMIC_BLANK_BALLOON_TEXT_STRATEGIES.includes(
    value as ComicBlankBalloonTextStrategy
  );
}

export function getComicSemanticLevel(
  level: ComicSemanticLevel
): ComicSemanticLevelDefinition {
  const definition = COMIC_SEMANTIC_LADDER.find((item) => item.id === level);
  if (!definition) {
    throw new Error("INVALID_COMIC_SEMANTIC_LEVEL");
  }
  return definition;
}

export function resolveComicDiagnosticMode(opts: {
  canSeeCost: boolean;
  mode?: unknown;
  semanticLevel?: unknown;
  textStrategy?: unknown;
}): {
  mode: ComicDiagnosticMode;
  semanticLevel: ComicSemanticLevel | null;
  textStrategy: ComicBlankBalloonTextStrategy;
} {
  const requestedMode = opts.mode == null ? "normal" : opts.mode;
  const requestedLevel = opts.semanticLevel == null ? null : opts.semanticLevel;
  const strategyProvided = opts.textStrategy != null;
  const requestedStrategy =
    opts.textStrategy == null ? "local_image_detection" : opts.textStrategy;

  if (!isDiagnosticMode(requestedMode)) {
    throw new Error("INVALID_COMIC_DIAGNOSTIC_MODE");
  }
  if (!isTextStrategy(requestedStrategy)) {
    throw new Error("INVALID_COMIC_BLANK_BALLOON_TEXT_STRATEGY");
  }
  if (
    !opts.canSeeCost &&
    (requestedMode !== "normal" ||
      requestedLevel != null ||
      requestedStrategy !== "local_image_detection")
  ) {
    throw new Error("COMIC_DIAGNOSTIC_MODE_FORBIDDEN");
  }
  if (requestedMode === "semantic_ladder") {
    if (!isSemanticLevel(requestedLevel)) {
      throw new Error("COMIC_SEMANTIC_LEVEL_REQUIRED");
    }
  } else if (requestedLevel != null) {
    throw new Error("COMIC_SEMANTIC_LEVEL_ONLY_FOR_LADDER");
  }
  if (requestedMode !== "blank_balloon_hybrid" && strategyProvided) {
    throw new Error("COMIC_TEXT_STRATEGY_ONLY_FOR_HYBRID");
  }

  return {
    mode: requestedMode,
    semanticLevel: requestedMode === "semantic_ladder" ? requestedLevel : null,
    textStrategy: requestedStrategy,
  };
}

function diagnosticPanelBeat(
  definition: ComicSemanticLevelDefinition,
  panelIndex: number
): string {
  const beat =
    panelIndex === 1
      ? "setup"
      : panelIndex === 2
        ? "interaction and escalation"
        : panelIndex === 3
          ? "reaction close-up when narratively justified"
          : "payoff and resolution";
  return `${beat}: ${definition.visualSemantics}`;
}

/**
 * Creates the fixed, source-free scene used by one manually-triggered ladder call.
 * Four panels and empty dialogue keep size, layout, and text inputs constant.
 */
export function buildSemanticLadderScenePlan(
  level: ComicSemanticLevel,
  panelCount: ChatComicPanelCount = 4
): ScenePlan {
  const definition = getComicSemanticLevel(level);
  const panels: ScenePanel[] = Array.from({ length: panelCount }, (_, offset) => {
    const index = offset + 1;
    return {
      index,
      sourceEventIds: [],
      situation: diagnosticPanelBeat(definition, index),
      backgroundOverride: definition.location,
      personaAction: definition.safePose,
      characterAction: definition.safePose,
      dialogue: [],
    };
  });

  return {
    sceneBackground: definition.location,
    atmosphere: "clear visual continuity with adult subjects and expressive reactions",
    events: [],
    heroEventIds: [],
    heroScene: definition.visualSemantics,
    recommendedPanelCount: panelCount,
    panels,
  };
}

export function buildSemanticLadderSafeStructure(
  level: ComicSemanticLevel,
  panelCount: ChatComicPanelCount = 4
): ComicSafeStructureProjection {
  const definition = getComicSemanticLevel(level);
  return {
    sharedBackground: definition.location,
    atmosphere: "clear visual continuity with calm adult subjects",
    panels: Array.from({ length: panelCount }, (_, offset) => {
      const index = offset + 1;
      return {
        index,
        situation: diagnosticPanelBeat(definition, index),
        background: definition.location,
        poseHint: definition.safePose,
      };
    }),
  };
}

export function isComicDiagnosticMode(
  mode: ComicDiagnosticMode
): mode is Exclude<ComicDiagnosticMode, "normal"> {
  return mode !== "normal";
}

/**
 * One experiment = one variable. Semantic ladder and blank-balloon quality
 * comparisons both require the reference and visual-context isolation axes to
 * be NORMAL. Combined/confounded requests are rejected server-side.
 */
export function assertComicDiagnosticAxisIsolation(opts: {
  mode: ComicDiagnosticMode;
  referenceMode: ComicReferenceIsolationMode;
  visualContextMode: ComicVisualContextIsolationMode;
}): void {
  if (opts.mode === "semantic_ladder") {
    if (opts.referenceMode !== "normal") {
      throw new Error("COMIC_LADDER_REQUIRES_NORMAL_REFERENCE_ISOLATION");
    }
    if (opts.visualContextMode !== "normal") {
      throw new Error("COMIC_LADDER_REQUIRES_NORMAL_VISUAL_CONTEXT");
    }
  }
  if (opts.mode === "blank_balloon_hybrid") {
    if (opts.referenceMode !== "normal") {
      throw new Error("COMIC_HYBRID_REQUIRES_NORMAL_REFERENCE_ISOLATION");
    }
    if (opts.visualContextMode !== "normal") {
      throw new Error("COMIC_HYBRID_REQUIRES_NORMAL_VISUAL_CONTEXT");
    }
  }
}

export type ComicPrimaryTier2Boundary = {
  /** Primary result always owns the semantic moderation boundary. */
  semanticBoundaryOwner: "PRIMARY_RESULT";
  primaryBoundary: "PASS" | "BLOCKED" | "UNKNOWN";
  tier2SafeRecovery: "PASS" | "FAIL" | "NOT_RUN";
};

/** Primary owns the moderation boundary; Tier-2 is a separate safe-recovery evidence. */
export function resolveComicPrimaryTier2Boundary(input: {
  primaryOutcome?: string | null;
  tier2Outcome?: string | null;
}): ComicPrimaryTier2Boundary {
  const primary = input.primaryOutcome ?? null;
  const tier2 = input.tier2Outcome ?? null;
  return {
    semanticBoundaryOwner: "PRIMARY_RESULT",
    primaryBoundary:
      primary === "success" ? "PASS" : primary === "safety_rejected" ? "BLOCKED" : "UNKNOWN",
    tier2SafeRecovery:
      tier2 === "success"
        ? "PASS"
        : tier2 === "safety_rejected" || tier2 === "failed"
          ? "FAIL"
          : "NOT_RUN",
  };
}
