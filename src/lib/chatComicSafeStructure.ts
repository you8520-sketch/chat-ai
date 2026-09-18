/**
 * Tier-2 safe structural fidelity — preserves location/pose/mood facts without raw scene text.
 */

import type { ImagePromptGender } from "@/lib/chatImageGeneration";
import type {
  ScenePanel,
  ScenePanelClothingCoverage,
  ScenePlan,
  ScenePresentationVisibility,
} from "@/lib/chatImageScenePlan";
import {
  DEFAULT_SCENE_PRESENTATION_VISIBILITY,
  projectComicPanelBeat,
  projectComicSharedContext,
} from "@/lib/chatImageScenePlan";
import {
  projectSceneTextForSafeImageGeneration,
} from "@/lib/chatImageSafeVisualProjection";
import {
  canonicalTier2SafePose,
  projectSceneBlockForTier2Comic,
  projectSceneTextForTier2Comic,
} from "@/lib/chatComicTier2SafeProjection";

export type Tier2PanelClothingCoverage = ScenePanelClothingCoverage;

export type ComicSafeStructurePanel = {
  index: number;
  situation: string;
  background: string;
  poseHint: string;
  clothingCoverage: Tier2PanelClothingCoverage;
  /** Tier-2 SAFE_PROJECTED_PROVIDER_TEXT: provider-safe readable dialogue, risky rows omitted. */
  dialogue?: string[];
};

export type ComicSafeStructureProjection = {
  sharedBackground: string;
  atmosphere?: string;
  panels: ComicSafeStructurePanel[];
};

export type ProjectComicSafeStructureForTier2Options = {
  /** Required to honor adult_male_character_shirtless_upper_torso panel coverage. */
  adultGrounded?: boolean;
  /** Required for male-specific shirtless coverage. */
  characterGender?: ImagePromptGender;
};

const TIER2_PANEL_CLOTHING_MODEST = "modest covered clothing" as const;

const TIER2_PANEL_CLOTHING_ADULT_MALE_SHIRTLESS =
  "confirmed adult male chat character with bare upper torso framed from shoulders upward; persona modestly covered; no lower-body or genital exposure" as const;

/** Canonical Tier-2 panel clothing contract renderer — single owner for provider panel lines. */
export function renderTier2PanelClothingContract(
  coverage: Tier2PanelClothingCoverage
): string {
  switch (coverage) {
    case "adult_male_character_shirtless_upper_torso":
      return TIER2_PANEL_CLOTHING_ADULT_MALE_SHIRTLESS;
    case "modest_covered":
      return TIER2_PANEL_CLOTHING_MODEST;
    default: {
      const _exhaustive: never = coverage;
      return TIER2_PANEL_CLOTHING_MODEST;
    }
  }
}

/** Resolve panel clothing from structured ScenePlan input. Shirtless requires adultGrounded + male chat character. */
export function resolveTier2PanelClothingCoverage(
  panel: ScenePanel,
  adultGrounded: boolean,
  characterGender?: ImagePromptGender
): Tier2PanelClothingCoverage {
  const requested = panel.clothingCoverage ?? "modest_covered";
  if (
    requested === "adult_male_character_shirtless_upper_torso" &&
    adultGrounded &&
    characterGender === "male"
  ) {
    return requested;
  }
  return "modest_covered";
}

/** Global comic clothing footer — modest default; mixed panels use non-contradictory contract. */
export function renderTier2ComicGlobalClothingFooter(
  structure?: ComicSafeStructureProjection
): string {
  if (!structure?.panels.length) {
    return "Keep all panel borders visible. Modest clothing throughout.";
  }
  const allModest = structure.panels.every(
    (panel) => panel.clothingCoverage === "modest_covered"
  );
  if (allModest) {
    return "Keep all panel borders visible. Modest clothing throughout.";
  }
  return "Keep all panel borders visible. Follow each panel's clothing contract above.";
}

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

function derivePoseHint(opts: {
  personaAction?: string;
  characterAction?: string;
  situation: string;
  background: string;
}): string {
  const canonical = canonicalTier2SafePose({
    personaAction: opts.personaAction,
    characterAction: opts.characterAction,
    situation: opts.situation,
    background: opts.background,
  });
  if (canonical) return canonical;

  const persona = opts.personaAction ? projectSafeField(opts.personaAction) : "";
  const character = opts.characterAction ? projectSafeField(opts.characterAction) : "";
  const combined = [persona, character].filter(Boolean).join("; ");
  if (combined) return combined;

  const situation = opts.situation.trim();
  if (/누(?:워|운|어)/u.test(situation)) {
    return "same characters resting on the bed with calm expressions";
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
  visibility: ScenePresentationVisibility = DEFAULT_SCENE_PRESENTATION_VISIBILITY,
  opts?: ProjectComicSafeStructureForTier2Options
): ComicSafeStructureProjection {
  const adultGrounded = opts?.adultGrounded ?? false;
  const characterGender = opts?.characterGender;
  const { sharedBackground } = projectComicSharedContext(plan, visibility);
  const atmosphere = plan.atmosphere ? projectSafeField(plan.atmosphere) : undefined;

  const panels = plan.panels.map((panel) => {
    const beat = projectComicPanelBeat(plan, panel, visibility);
    const situation = projectSafeField(beat.situation);
    const background = projectSafeField(beat.background || sharedBackground);
    const clothingCoverage = resolveTier2PanelClothingCoverage(
      panel,
      adultGrounded,
      characterGender
    );
    return {
      index: panel.index,
      situation,
      background,
      clothingCoverage,
      poseHint: derivePoseHint({
        personaAction: beat.personaAction,
        characterAction: beat.characterAction,
        situation,
        background,
      }),
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
    const clothingContract = renderTier2PanelClothingContract(panel.clothingCoverage);
    if (mode === "full_provider_rendered") {
      const dialogue = panel.dialogue?.length
        ? panel.dialogue.map((text) => `Speech bubble: "${text}"`).join("\n")
        : "Speech bubble: (silent panel — no approved dialogue)";
      const parts = [
        `Panel ${panel.index}`,
        panel.background ? `location ${panel.background}` : "",
        panel.situation ? `beat ${panel.situation}` : "",
        panel.poseHint,
        clothingContract,
        dialogue,
      ].filter(Boolean);
      lines.push(parts.join(" — "));
    } else {
      const parts = [
        `Panel ${panel.index}`,
        panel.background ? `location ${panel.background}` : "",
        panel.situation ? `beat ${panel.situation}` : "",
        panel.poseHint,
        clothingContract,
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
