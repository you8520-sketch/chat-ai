/**
 * Selective adult-intimacy cluster distillation for strict Tier-2 fallback only.
 * Collapses cumulative intimacy narration/progression while preserving chronology,
 * dialogue, location, and one representative safe intimacy cue.
 */

import type {
  ComicSafeStructurePanel,
  ComicSafeStructureProjection,
} from "@/lib/chatComicSafeStructure";
import {
  boundTier2PanelDialogue,
  containsBedroomBedContext,
  TIER2_PANEL_CONTINUITY_POSE,
} from "@/lib/chatComicTier2SafeProjection";
import type { Tier2PhysicalBeatCategory } from "@/lib/chatComicTier2SafeProjection";

const INTIMACY_BEAT_CATEGORIES = new Set<Tier2PhysicalBeatCategory>([
  "kiss",
  "embrace",
  "close_proximity",
  "resting",
]);

const INTIMACY_CATEGORY_PRIORITY: Record<Tier2PhysicalBeatCategory, number> = {
  kiss: 50,
  embrace: 40,
  close_proximity: 30,
  resting: 20,
  blush_emotion: 15,
  seated: 5,
  standing: 5,
  general: 0,
};

/** Mood-neutral reaction pose — no invented calm mood. */
export const TIER2_PANEL_EMOTIONAL_REACTION_POSE =
  "same cast in the same location — emotional reaction visible through expression and posture";

export function isTier2IntimacyHeavyPanel(panel: ComicSafeStructurePanel): boolean {
  if (INTIMACY_BEAT_CATEGORIES.has(panel.physicalBeatCategory)) return true;
  const haystack = `${panel.situation} ${panel.poseHint} ${panel.background}`;
  if (containsBedroomBedContext(haystack) && panel.situation.length >= 120) return true;
  if (
    /(?:affectionate|resting close|calm affectionate|껴안|키스|kiss|embrace|proximity|밀착)/iu.test(
      panel.poseHint
    )
  ) {
    return true;
  }
  return false;
}

function intimacyPanelScore(panel: ComicSafeStructurePanel): number {
  let score = INTIMACY_CATEGORY_PRIORITY[panel.physicalBeatCategory] ?? 0;
  score += Math.min(12, Math.floor(panel.situation.length / 100));
  if (containsBedroomBedContext(`${panel.background} ${panel.situation}`)) score += 2;
  return score;
}

/** Dense multi-panel intimacy cluster — not triggered for single-cue P1/P3 scenes. */
export function shouldDistillAdultIntimacyCluster(
  panels: readonly ComicSafeStructurePanel[]
): boolean {
  const heavy = panels.filter(isTier2IntimacyHeavyPanel);
  if (heavy.length < 2) return false;

  const totalSituationChars = heavy.reduce((sum, panel) => sum + panel.situation.length, 0);
  const distinctIntimacyCategories = new Set(
    heavy
      .map((panel) => panel.physicalBeatCategory)
      .filter((category) => INTIMACY_BEAT_CATEGORIES.has(category))
  );

  if (totalSituationChars >= 800) return true;
  if (heavy.length >= 3 && totalSituationChars >= 400) return true;
  if (heavy.length >= 2 && distinctIntimacyCategories.size >= 2 && totalSituationChars >= 200) {
    return true;
  }
  if (heavy.length >= 3 && distinctIntimacyCategories.size >= 2) return true;
  if (heavy.length >= 4 && heavy.length === panels.length) return true;
  return false;
}

function setupPoseForPanel(panel: ComicSafeStructurePanel): string {
  if (containsBedroomBedContext(panel.background)) {
    return "same characters in the bedroom with modest covered clothing and readable expressions";
  }
  return "same cast in the same location with modest posture and readable expressions";
}

function boundPanelDialogue(panel: ComicSafeStructurePanel): ComicSafeStructurePanel {
  return {
    ...panel,
    dialogue: boundTier2PanelDialogue(panel.dialogue),
  };
}

/**
 * Selective intimacy distillation — one representative beat, setup location on first heavy panel,
 * reaction/continuity elsewhere. Non-heavy panels pass through with dialogue bounding only.
 */
export function distillAdultIntimacyClusterForTier2(
  structure: ComicSafeStructureProjection
): ComicSafeStructureProjection {
  if (!shouldDistillAdultIntimacyCluster(structure.panels)) {
    return {
      ...structure,
      panels: structure.panels.map(boundPanelDialogue),
    };
  }

  const heavyIndexes = structure.panels
    .map((panel, index) => ({ panel, index }))
    .filter(({ panel }) => isTier2IntimacyHeavyPanel(panel));

  const representativeIndex = heavyIndexes.reduce((best, current) =>
    intimacyPanelScore(current.panel) > intimacyPanelScore(best.panel) ? current : best
  ).index;
  const setupIndex = heavyIndexes[0]?.index ?? representativeIndex;

  const panels = structure.panels.map((panel, index) => {
    if (!isTier2IntimacyHeavyPanel(panel)) {
      return boundPanelDialogue(panel);
    }

    if (index === representativeIndex) {
      return boundPanelDialogue(panel);
    }

    if (index === setupIndex) {
      const locationOnly = panel.background.trim();
      return boundPanelDialogue({
        ...panel,
        situation: locationOnly,
        poseHint: setupPoseForPanel(panel),
      });
    }

    if (panel.physicalBeatCategory === "blush_emotion") {
      return boundPanelDialogue({
        ...panel,
        situation: "",
        poseHint: TIER2_PANEL_EMOTIONAL_REACTION_POSE,
      });
    }

    return boundPanelDialogue({
      ...panel,
      situation: "",
      poseHint: TIER2_PANEL_CONTINUITY_POSE,
    });
  });

  return { ...structure, panels };
}
