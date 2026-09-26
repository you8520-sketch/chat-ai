import { buildImageGenderLockPrompt } from "@/lib/chatImageGeneration";
import { buildIllustrationSafeDepiction } from "@/lib/chatImageIllustrationSanitizer";
import { STRICT_SAFE_DEPICTION } from "@/lib/chatImageStrictSafetyFallbackPrompt";
import { renderAppearanceBlock } from "@/lib/officialSupply/appearance";
import { adultDepictionAllowed } from "@/lib/officialSupply/assetPlan";
import { officialImageProfileForSlot } from "@/lib/officialSupply/imageProfile";
import type {
  OfficialAppearanceLock,
  OfficialAssetSlotPlan,
  OfficialCharacterDraft,
  VisualStyleDna,
} from "@/lib/officialSupply/types";

export const OFFICIAL_ASSET_TEMPLATE_ID = "official_character_asset" as const;

function renderStyleDna(dna: VisualStyleDna): string {
  return [
    "ART STYLE (structured attributes — follow these, do not imitate any specific artist or existing character):",
    `face proportion: ${dna.faceProportion}; eyes: ${dna.eyeShape}; nose/mouth: ${dna.noseMouthDetail}`,
    `line density: ${dna.lineDensity}; rendering: ${dna.rendering}; skin: ${dna.skinRendering}; hair: ${dna.hairRendering}`,
    `body proportion: ${dna.bodyProportion}; costume complexity: ${dna.costumeComplexity}`,
    `palette: ${dna.palette}; light: ${dna.lightSoftness}; contrast: ${dna.contrast}; background density: ${dna.backgroundDensity}`,
    `framing: ${dna.framing}; atmosphere: ${dna.atmosphere}`,
  ].join("\n");
}

function renderIdentityLock(lock: OfficialAppearanceLock): string {
  return [
    "IDENTITY LOCK — identical across every image of this character:",
    renderAppearanceBlock(lock),
    lock.forbiddenDrift.length ? `Never drift: ${lock.forbiddenDrift.join("; ")}.` : "",
    `Outfit policy: ${lock.outfit.alternateOutfitPolicy}`,
  ]
    .filter(Boolean)
    .join("\n");
}

function framingForSlot(slot: OfficialAssetSlotPlan): string {
  const profile = officialImageProfileForSlot(slot.kind);
  switch (slot.kind) {
    case "representative":
      return [
        `Create one vertical ${profile.aspect} character card portrait (${profile.width}x${profile.height}).`,
        "Head and upper body, face clearly readable in the upper third (the card crops from the top).",
        "Personality readable at first glance. Keep the background simple and uncluttered; no important features near the edges.",
      ].join(" ");
    case "signature":
    case "emotion":
      return [
        `Create one horizontal ${profile.aspect} roleplay illustration (${profile.width}x${profile.height}).`,
        "The character is the clear subject, face and upper body readable; supporting background only.",
      ].join(" ");
    case "scene":
      return [
        `Create one horizontal ${profile.aspect} roleplay scene illustration (${profile.width}x${profile.height}).`,
        `The character MUST appear prominently in the scene at ${slot.location}. This is not a background-only image.`,
      ].join(" ");
    default: {
      const exhaustive: never = slot.kind;
      throw new Error(`Unknown slot kind ${String(exhaustive)}`);
    }
  }
}

export type OfficialAssetPromptInput = {
  draft: OfficialCharacterDraft;
  appearance: OfficialAppearanceLock;
  style: VisualStyleDna;
  slot: OfficialAssetSlotPlan;
};

/**
 * Official asset prompt. Gender lock and safety come from the canonical image
 * owners; `adultGrounded` is decided per slot (depiction) and only honoured for
 * confirmed-adult sheets — the character's nsfw flag alone never widens it.
 */
export function buildOfficialAssetPrompts(input: OfficialAssetPromptInput): {
  primaryPrompt: string;
  strictFallbackPrompt: string;
} {
  const { draft, appearance, style, slot } = input;
  const adultGrounded =
    slot.depiction === "adult_grounded_non_explicit" && adultDepictionAllowed(draft);
  const genderLock = buildImageGenderLockPrompt([
    { label: "Character", name: draft.name, gender: draft.gender },
  ]);
  const referenceRule =
    slot.kind === "representative"
      ? "REFERENCE IMAGE: style reference only. Create a brand-new original person; do not copy the face, hair, outfit, pose or identity of anyone in the reference."
      : "REFERENCE IMAGE: the approved identity anchor of this same character. Keep the exact same person; only expression, pose, outfit variant and setting change.";
  const moment = [
    `Expression: ${slot.expression}.`,
    slot.pose.trim() ? `Pose: ${slot.pose}.` : "",
    slot.outfit.trim() && slot.outfit !== "default"
      ? `Outfit variant: ${slot.outfit} (identity unchanged).`
      : `Outfit: ${appearance.outfit.defaultOutfit}.`,
    slot.kind === "scene" ? `Situation: ${slot.situation}.` : "",
  ]
    .filter(Boolean)
    .join(" ");
  const primaryPrompt = [
    framingForSlot(slot),
    referenceRule,
    `Character: ${draft.name}, age ${draft.age}.`,
    renderIdentityLock(appearance),
    genderLock,
    renderStyleDna(style),
    buildIllustrationSafeDepiction({ adultGrounded }),
    moment,
    "Exactly one person unless the situation explicitly needs unnamed background extras. No text, speech bubbles, captions, logos, signatures or watermarks.",
  ].join("\n");
  const strictFallbackPrompt = [
    framingForSlot(slot),
    referenceRule,
    STRICT_SAFE_DEPICTION,
    "STRICT PROVIDER-SAFE FALLBACK — modest, fully clothed, non-explicit.",
    `Character: ${draft.name}, age ${draft.age}.`,
    renderIdentityLock(appearance),
    genderLock,
    `Expression: ${slot.expression}.`,
    slot.kind === "scene" ? `Setting: ${slot.location}. The character must be visible.` : "",
    "No text, logos or watermarks.",
  ]
    .filter(Boolean)
    .join("\n");
  return { primaryPrompt, strictFallbackPrompt };
}
