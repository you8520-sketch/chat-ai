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
  projectSceneBlockForSafeImageGeneration,
  projectSceneTextForSafeImageGeneration,
} from "@/lib/chatImageSafeVisualProjection";

export type ComicSafeStructurePanel = {
  index: number;
  situation: string;
  background: string;
  poseHint: string;
};

export type ComicSafeStructureProjection = {
  sharedBackground: string;
  atmosphere?: string;
  panels: ComicSafeStructurePanel[];
};

function projectSafeField(raw: string): string {
  const projected = projectSceneBlockForSafeImageGeneration(raw);
  return projected.omitFromImage ? "" : projected.text.trim();
}

function derivePoseHint(opts: {
  personaAction?: string;
  characterAction?: string;
  situation: string;
}): string {
  const persona = opts.personaAction ? projectSafeField(opts.personaAction) : "";
  const character = opts.characterAction ? projectSafeField(opts.characterAction) : "";
  const combined = [persona, character].filter(Boolean).join("; ");
  if (combined) return combined;

  const situation = opts.situation.trim();
  if (/누(?:워|운|어)/u.test(situation)) {
    return "same characters lying on the bed with modest covered clothing and calm expressions";
  }
  if (/앉(?:아|은|어)/u.test(situation)) {
    return "same characters seated in the same location with modest posture";
  }
  if (/서(?: 있|서)/u.test(situation)) {
    return "same characters standing in the same location with readable expressions";
  }
  return "same cast in the same location with modest posture and readable expressions";
}

/** Canonical Tier-2 safe structural projection owner — no raw SceneEvent.text. */
export function projectComicSafeStructureForTier2(
  plan: ScenePlan,
  visibility: ScenePresentationVisibility = DEFAULT_SCENE_PRESENTATION_VISIBILITY
): ComicSafeStructureProjection {
  const { sharedBackground } = projectComicSharedContext(plan, visibility);
  const atmosphere = plan.atmosphere ? projectSafeField(plan.atmosphere) : undefined;

  const panels = plan.panels.map((panel) => {
    const beat = projectComicPanelBeat(plan, panel, visibility);
    const situation = projectSafeField(beat.situation);
    const background = projectSafeField(beat.background || sharedBackground);
    return {
      index: panel.index,
      situation,
      background,
      poseHint: derivePoseHint({
        personaAction: beat.personaAction,
        characterAction: beat.characterAction,
        situation,
      }),
    };
  });

  return {
    sharedBackground: projectSafeField(sharedBackground),
    atmosphere,
    panels,
  };
}

export function renderComicSafeStructureForTier2Prompt(
  structure: ComicSafeStructureProjection
): string[] {
  const lines: string[] = [];
  if (structure.sharedBackground) {
    lines.push(`Safe shared location: ${structure.sharedBackground}.`);
  }
  if (structure.atmosphere) {
    lines.push(`Emotional atmosphere: ${structure.atmosphere}.`);
  }
  for (const panel of structure.panels) {
    const parts = [
      `Panel ${panel.index}`,
      panel.background ? `location ${panel.background}` : "",
      panel.situation ? `beat ${panel.situation}` : "",
      panel.poseHint,
      "modest covered clothing",
      "leave a clean upper area for later text overlay",
      "no readable letters in the image",
    ].filter(Boolean);
    lines.push(parts.join(" — "));
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
