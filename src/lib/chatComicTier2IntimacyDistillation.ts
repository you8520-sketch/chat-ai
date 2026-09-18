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

/** Structured intimacy beats — resting excluded (not sufficient alone). */
const STRUCTURED_INTIMACY_CATEGORIES = new Set<Tier2PhysicalBeatCategory>([
  "kiss",
  "embrace",
  "close_proximity",
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
  if (panel.situationHadAdultExplicitProjection) return true;
  return STRUCTURED_INTIMACY_CATEGORIES.has(panel.physicalBeatCategory);
}

function intimacyPanelScore(panel: ComicSafeStructurePanel): number {
  let score = INTIMACY_CATEGORY_PRIORITY[panel.physicalBeatCategory] ?? 0;
  if (panel.situationHadAdultExplicitProjection) score += 20;
  score += Math.min(12, Math.floor(panel.situation.length / 100));
  if (containsBedroomBedContext(`${panel.background} ${panel.situation}`)) score += 2;
  return score;
}

/** Dense multi-panel adult/intimacy cluster — provenance-first, never bedroom/length primary. */
export function shouldDistillAdultIntimacyCluster(
  panels: readonly ComicSafeStructurePanel[]
): boolean {
  const adultExplicitPanels = panels.filter((panel) => panel.situationHadAdultExplicitProjection);
  const structuredIntimacyPanels = panels.filter((panel) =>
    STRUCTURED_INTIMACY_CATEGORIES.has(panel.physicalBeatCategory)
  );
  const distinctStructuredCategories = new Set(
    structuredIntimacyPanels.map((panel) => panel.physicalBeatCategory)
  );

  if (adultExplicitPanels.length >= 2) return true;
  if (adultExplicitPanels.length >= 1 && structuredIntimacyPanels.length >= 2) return true;
  if (structuredIntimacyPanels.length >= 3 && distinctStructuredCategories.size >= 2) {
    return true;
  }

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
