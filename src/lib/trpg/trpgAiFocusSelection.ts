import {
  buildDeterministicTrpgFocusHeroScene,
  buildSceneSourceMessages,
  type ScenePlan,
  type SceneSourceMessage,
} from "@/lib/chatImageScenePlan";
import { planChatImageScene, type ScenePlanCompleter } from "@/lib/chatImageScenePlanner";
import type { TrpgImageSceneMode } from "@/lib/trpg/trpgImageSceneMode";

export type TrpgAiFocusDiagnostics = {
  modeRequested: TrpgImageSceneMode;
  modeApplied: "AI_FOCUS" | "RAW";
  aiModel: string;
  aiAttempts: number;
  aiUsedFallback: boolean;
  aiDeterministicFallback: boolean;
  aiLatencyMs: number;
  canonicalLocation: string;
  selectedHeroScene: string;
  heroEventIds: string[];
  overSelectionRejected: boolean;
  fallbackReason?: string;
};

export type TrpgAiFocusResolution =
  | {
      modeApplied: "AI_FOCUS";
      heroScene: string;
      diagnostics: TrpgAiFocusDiagnostics;
    }
  | {
      modeApplied: "RAW";
      diagnostics: TrpgAiFocusDiagnostics;
    };

/** Benchmark-compatible GM narration → SceneSourceMessage adapter (benchmark-only boundary reused). */
export function buildTrpgGmNarrationSceneMessages(narration: string): SceneSourceMessage[] {
  return buildSceneSourceMessages([{ id: 1, role: "assistant", content: narration }]);
}

/**
 * Post-validation over-selection gate derived from #777 F3/F6/F10 evidence.
 * F3 combat (11/11 visual events) → reject; F6/F10 ratios below threshold → allow.
 */
export function detectTrpgAiFocusOverSelection(plan: ScenePlan): boolean {
  const visualEvents = plan.events.filter((event) => event.kind !== "assistant_echo");
  if (visualEvents.length < 8) return false;
  const ratio = plan.heroEventIds.length / visualEvents.length;
  return ratio >= 0.85;
}

function emptyDiagnostics(canonicalLocation: string): Omit<TrpgAiFocusDiagnostics, "modeApplied"> {
  return {
    modeRequested: "AI_FOCUS",
    aiModel: "",
    aiAttempts: 0,
    aiUsedFallback: false,
    aiDeterministicFallback: false,
    aiLatencyMs: 0,
    canonicalLocation,
    selectedHeroScene: "",
    heroEventIds: [],
    overSelectionRejected: false,
  };
}

/** Single canonical owner: TRPG AI important-visual-focus selection from GM narration. */
export async function resolveTrpgAiFocusHeroScene(opts: {
  narration: string;
  canonicalLocation: string;
  complete?: ScenePlanCompleter;
  planScene?: typeof planChatImageScene;
}): Promise<TrpgAiFocusResolution> {
  const base = emptyDiagnostics(opts.canonicalLocation);
  const messages = buildTrpgGmNarrationSceneMessages(opts.narration);
  const planScene = opts.planScene ?? planChatImageScene;
  const started = Date.now();
  let result;
  try {
    result = await planScene({
      characterName: "TRPG GM",
      personaName: "Party",
      messages,
      scenePlanIntent: "trpg_illustration",
      complete: opts.complete,
    });
  } catch {
    const latencyMs = Date.now() - started;
    return {
      modeApplied: "RAW",
      diagnostics: {
        ...base,
        modeApplied: "RAW",
        aiLatencyMs: latencyMs,
        fallbackReason: "planner-error",
      },
    };
  }
  const latencyMs = Date.now() - started;
  const heroScene = result.plan.heroScene.trim();
  const deterministicFallback = result.model === "deterministic-fallback";
  const overSelectionRejected = detectTrpgAiFocusOverSelection(result.plan);

  const diagnostics: TrpgAiFocusDiagnostics = {
    ...base,
    modeApplied: "RAW",
    aiModel: result.model,
    aiAttempts: result.attempts,
    aiUsedFallback: result.usedFallback,
    aiDeterministicFallback: deterministicFallback,
    aiLatencyMs: latencyMs,
    selectedHeroScene: heroScene,
    heroEventIds: [...result.plan.heroEventIds],
    overSelectionRejected,
  };

  if (deterministicFallback) {
    return {
      modeApplied: "RAW",
      diagnostics: {
        ...diagnostics,
        fallbackReason: "deterministic-fallback",
      },
    };
  }

  if (!heroScene) {
    return {
      modeApplied: "RAW",
      diagnostics: {
        ...diagnostics,
        fallbackReason: "empty-hero-scene",
      },
    };
  }

  if (overSelectionRejected) {
    const focused = buildDeterministicTrpgFocusHeroScene(result.plan);
    const focusedPlan: ScenePlan = {
      ...result.plan,
      heroEventIds: focused.heroEventIds,
      heroScene: focused.heroScene,
    };
    if (
      focused.heroScene.trim() &&
      !detectTrpgAiFocusOverSelection(focusedPlan)
    ) {
      return {
        modeApplied: "AI_FOCUS",
        heroScene: focused.heroScene,
        diagnostics: {
          ...diagnostics,
          modeApplied: "AI_FOCUS",
          selectedHeroScene: focused.heroScene,
          heroEventIds: [...focused.heroEventIds],
          aiDeterministicFallback: true,
          fallbackReason: "over-selection-deterministic-focus",
        },
      };
    }
    return {
      modeApplied: "RAW",
      diagnostics: {
        ...diagnostics,
        fallbackReason: "over-selection",
      },
    };
  }

  return {
    modeApplied: "AI_FOCUS",
    heroScene,
    diagnostics: {
      ...diagnostics,
      modeApplied: "AI_FOCUS",
    },
  };
}

export type TrpgIllustrationSceneFocusResult = {
  narration: string;
  modeApplied: TrpgImageSceneMode;
  diagnostics: TrpgAiFocusDiagnostics | null;
  plannerInvocations: number;
};

/** TRPG illustration narration owner: RAW skips planner; AI_FOCUS invokes focus owner once. */
export async function resolveTrpgIllustrationSceneFocus(opts: {
  sceneMode: TrpgImageSceneMode;
  rawNarration: string;
  canonicalLocation: string;
  complete?: ScenePlanCompleter;
  planScene?: typeof planChatImageScene;
}): Promise<TrpgIllustrationSceneFocusResult> {
  if (opts.sceneMode === "RAW") {
    return {
      narration: opts.rawNarration,
      modeApplied: "RAW",
      diagnostics: null,
      plannerInvocations: 0,
    };
  }

  let plannerInvocations = 0;
  const focus = await resolveTrpgAiFocusHeroScene({
    narration: opts.rawNarration,
    canonicalLocation: opts.canonicalLocation,
    complete: opts.complete,
    planScene: async (input) => {
      plannerInvocations += 1;
      const planScene = opts.planScene ?? planChatImageScene;
      return planScene(input);
    },
  });

  if (focus.modeApplied === "AI_FOCUS") {
    return {
      narration: focus.heroScene,
      modeApplied: "AI_FOCUS",
      diagnostics: focus.diagnostics,
      plannerInvocations,
    };
  }

  return {
    narration: opts.rawNarration,
    modeApplied: "RAW",
    diagnostics: focus.diagnostics,
    plannerInvocations,
  };
}
