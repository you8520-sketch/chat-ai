/**
 * Tier-2 safe structural fidelity — preserves location/pose/mood facts without raw scene text.
 */

import type { ScenePlan, ScenePresentationVisibility } from "@/lib/chatImageScenePlan";
import {
  DEFAULT_SCENE_PRESENTATION_VISIBILITY,
  projectComicPanelBeat,
  projectComicSharedContext,
} from "@/lib/chatImageScenePlan";
import {
  projectSceneTextForSafeImageGeneration,
} from "@/lib/chatImageSafeVisualProjection";
import { distillAdultIntimacyClusterForTier2 } from "@/lib/chatComicTier2IntimacyDistillation";
import {
  deriveTier2PanelVisualBeat,
  projectSceneBlockForTier2Comic,
  projectSceneTextForTier2Comic,
  TIER2_PANEL_GLOBAL_CLOTHING_CONTRACT,
  type Tier2PhysicalBeatCategory,
} from "@/lib/chatComicTier2SafeProjection";

export type ComicSafeStructurePanel = {
  index: number;
  situation: string;
  background: string;
  poseHint: string;
  /** Structured-source beat bucket — set once at projection, consumed by bounding only. */
  physicalBeatCategory: Tier2PhysicalBeatCategory;
  /** Tier-2 SAFE_PROJECTED_PROVIDER_TEXT: provider-safe readable dialogue, risky rows omitted. */
  dialogue?: string[];
};

export type ComicSafeStructureProjection = {
  sharedBackground: string;
  atmosphere?: string;
  panels: ComicSafeStructurePanel[];
};

/** TIER2_TEXT_MODE = SAFE_PROJECTED_PROVIDER_TEXT: safe dialogue is kept, risky rows are omitted (no invented replacements). */
function projectTier2Dialogue(raw: string): string | null {
  const projected = projectSceneTextForTier2Comic(raw);
  if (projected.omitFromImage || projected.reasonCategories.length > 0) return null;
  const text = projected.text.trim();
  return text || null;
}

function projectSafeField(raw: string): string {
  const projected = projectSceneBlockForTier2Comic(raw);
  return projected.omitFromImage ? "" : projected.text.trim();
}

function buildComicSafeStructureForTier2(
  plan: ScenePlan,
  visibility: ScenePresentationVisibility
): ComicSafeStructureProjection {
  const { sharedBackground } = projectComicSharedContext(plan, visibility);
  const atmosphere = plan.atmosphere ? projectSafeField(plan.atmosphere) : undefined;

  const panels = plan.panels.map((panel) => {
    const beat = projectComicPanelBeat(plan, panel, visibility);
    const situation = projectSafeField(beat.situation);
    const background = projectSafeField(beat.background || sharedBackground);
    const structuredSource = {
      personaAction: beat.personaAction,
      characterAction: beat.characterAction,
      situation: beat.situation,
      background: beat.background || sharedBackground,
    };
    const visualBeat = deriveTier2PanelVisualBeat(structuredSource);
    return {
      index: panel.index,
      situation,
      background,
      poseHint: visualBeat.poseHint,
      physicalBeatCategory: visualBeat.physicalBeatCategory,
      dialogue: beat.dialogue
        .map((line) => projectTier2Dialogue(line.text))
        .filter((text): text is string => text != null),
    };
  });

  return {
    sharedBackground: projectSafeField(sharedBackground),
    atmosphere,
    panels,
  };
}

/** Canonical Tier-2 safe structural projection owner — no raw SceneEvent.text. */
export function projectComicSafeStructureForTier2(
  plan: ScenePlan,
  visibility: ScenePresentationVisibility = DEFAULT_SCENE_PRESENTATION_VISIBILITY
): ComicSafeStructureProjection {
  return distillAdultIntimacyClusterForTier2(buildComicSafeStructureForTier2(plan, visibility));
}

export function renderComicSafeStructureForTier2Prompt(
  structure: ComicSafeStructureProjection,
  mode: "overlay_first" | "full_provider_rendered" = "overlay_first"
): string[] {
  const lines: string[] = [];
  if (structure.sharedBackground) {
    lines.push(`Safe shared location: ${structure.sharedBackground}.`);
  }
  if (structure.atmosphere) {
    lines.push(`Emotional atmosphere: ${structure.atmosphere}.`);
  }
  for (const panel of structure.panels) {
    if (mode === "full_provider_rendered") {
      const dialogue = panel.dialogue?.length
        ? panel.dialogue.map((text) => `Speech bubble: "${text}"`).join("\n")
        : "Speech bubble: (silent panel — no approved dialogue)";
      const parts = [
        `Panel ${panel.index}`,
        panel.background ? `location ${panel.background}` : "",
        panel.situation ? `beat ${panel.situation}` : "",
        panel.poseHint,
        TIER2_PANEL_GLOBAL_CLOTHING_CONTRACT,
        dialogue,
      ].filter(Boolean);
      lines.push(parts.join(" — "));
    } else {
      const parts = [
        `Panel ${panel.index}`,
        panel.background ? `location ${panel.background}` : "",
        panel.situation ? `beat ${panel.situation}` : "",
        panel.poseHint,
        TIER2_PANEL_GLOBAL_CLOTHING_CONTRACT,
        "leave a clean upper area for later text overlay",
        "no readable letters in the image",
      ].filter(Boolean);
      lines.push(parts.join(" — "));
    }
  }
  return lines;
}

export function containsBedroomBedStructure(structure: ComicSafeStructureProjection): boolean {
  const haystack = [
    structure.sharedBackground,
    ...structure.panels.map((panel) => `${panel.background} ${panel.situation} ${panel.poseHint}`),
  ]
    .join(" ")
    .toLowerCase();
  return /(?:bedroom|bed|침실|침대|이불)/iu.test(haystack);
}

/** Short narration candidate for overlay when a panel has no dialogue. */
export function deriveOverlayNarrationCandidate(raw: string): string | null {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) return null;
  const projected = projectSceneTextForSafeImageGeneration(trimmed, { isDialogue: false });
  if (projected.omitFromImage || !projected.text.trim()) return null;
  if (projected.text.length > 120) return `${projected.text.slice(0, 117).trimEnd()}…`;
  return projected.text;
}
