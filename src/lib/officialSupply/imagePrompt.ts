import { buildImageGenderLockPrompt } from "@/lib/chatImageGeneration";
import { buildIllustrationSafeDepiction } from "@/lib/chatImageIllustrationSanitizer";
import { STRICT_SAFE_DEPICTION } from "@/lib/chatImageStrictSafetyFallbackPrompt";
import { buildMatureMaleVisualAgePrompt, renderAppearanceBlock } from "@/lib/officialSupply/appearance";
import { adultDepictionAllowed } from "@/lib/officialSupply/assetPlan";
import { officialImageProfileForSlot } from "@/lib/officialSupply/imageProfile";
import {
  renderOfficialShotResponsibility,
  renderOfficialStyleFramingOverride,
  resolveOfficialSlotShot,
} from "@/lib/officialSupply/shotPlan";
import {
  isClusterBGraphicStyleSeed,
  resolveOfficialAssetStyleDna,
  ROFAN_CLUSTER_B_GRAPHIC_STYLE_DIRECTION,
} from "@/lib/officialSupply/style";
import type {
  OfficialAppearanceLock,
  OfficialAssetSlotPlan,
  OfficialCharacterDraft,
  StyleReference,
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
    `atmosphere: ${dna.atmosphere}`,
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

function framingForSlot(slot: OfficialAssetSlotPlan, draftKey: string): string {
  const profile = officialImageProfileForSlot(slot.kind);
  const shot = resolveOfficialSlotShot(slot, draftKey);
  const shotLine = renderOfficialShotResponsibility(shot);
  switch (slot.kind) {
    case "representative":
      return [
        `Create one vertical ${profile.aspect} character card portrait (${profile.width}x${profile.height}).`,
        "Head and upper body, face clearly readable in the upper third (the card crops from the top).",
        "Personality readable at first glance. Keep the background simple and uncluttered; no important features near the edges.",
        shotLine,
      ].join(" ");
    case "signature":
    case "emotion":
      return [
        `Create one horizontal ${profile.aspect} roleplay illustration (${profile.width}x${profile.height}).`,
        "This is a distinct cut of the same character — not another bust-card portrait.",
        "Follow the shot responsibility for face direction, camera, crop, and pose. Do not default to face-and-upper-body.",
        shotLine,
      ].join(" ");
    case "scene":
      return [
        `Create one horizontal ${profile.aspect} roleplay SCENE illustration (${profile.width}x${profile.height}).`,
        `This is a scene, not a portrait substitute. Location and incident must be readable: ${slot.location}.`,
        "Show spatial depth, environment, and the character acting inside the situation.",
        "Do not crop as a bust/card portrait with a blurred backdrop. The character is visible in the scene, but the place and event share the frame.",
        shotLine,
      ].join(" ");
    default: {
      const exhaustive: never = slot.kind;
      throw new Error(`Unknown slot kind ${String(exhaustive)}`);
    }
  }
}

export type OfficialReferenceRoleLayout = "slot_default" | "identity_then_style";

export type OfficialAssetPromptInput = {
  draft: OfficialCharacterDraft;
  appearance: OfficialAppearanceLock;
  style: VisualStyleDna;
  slot: OfficialAssetSlotPlan;
  /** Approved style seed — when Cluster B, calibrates DNA + reference semantics. */
  styleSeed?: StyleReference | null;
  /**
   * Default `slot_default` keeps the production official path:
   * representative = STYLE ONLY, other slots = IDENTITY ANCHOR ONLY.
   * `identity_then_style` is opt-in for the lucian-sig4 style proof only.
   */
  referenceRoleLayout?: OfficialReferenceRoleLayout;
};

/** Shared identity-keep clause — used by IDENTITY ANCHOR and Image 1 IDENTITY ONLY. */
export const OFFICIAL_IDENTITY_KEEP_CLAUSE =
  "Use the supplied image solely to keep the same face structure, hair, eyes, marks, age, and body type.";

/** Shared identity copy-ban — camera/pose/expression stay with shotPlan + slot lines. */
export const OFFICIAL_IDENTITY_COPY_FORBIDDEN_CLAUSE =
  "Do not copy the reference camera, head angle, face direction, crop, hand position, pose, expression, or background.";

export const OFFICIAL_SHOT_POSE_EXPRESSION_OWNER_CLAUSE = [
  "SHOT RESPONSIBILITY owns camera, face direction, and shot distance.",
  "The Pose line owns action and props. The Expression line owns emotion.",
].join(" ");

/** Shared style-use clause — used by representative STYLE ONLY and Image 2 STYLE ONLY. */
export const OFFICIAL_STYLE_USE_CLAUSE =
  "Use the supplied image(s) solely for drawing/rendering language, facial illustration treatment, coloring, lighting, hair rendering density, material detail, detail density, and overall polish.";

/** Shared style copy-ban — style references never donate identity or costume. */
export const OFFICIAL_STYLE_COPY_FORBIDDEN_CLAUSE =
  "Do not copy any reference person's face identity, hairstyle, hair color, eye color, outfit design, jewelry, marks/tattoos/scars, pose, or background.";

export const OFFICIAL_IDENTITY_LOCK_OWNER_CLAUSE =
  "The IDENTITY LOCK / Appearance Lock below is the sole character-identity owner and overrides any resemblance to the style references.";

export const OFFICIAL_IDENTITY_THEN_STYLE_IMAGE1_LABEL = "Image 1 IDENTITY ONLY";
export const OFFICIAL_IDENTITY_THEN_STYLE_IMAGE2_LABEL = "Image 2 STYLE ONLY";

/** Dual-role only. Shared style copy-ban already owns face/hair/outfit/jewelry/pose/background. */
export const OFFICIAL_IMAGE2_STYLE_ONLY_EXTRA_BAN =
  "Image 2 additionally must not contribute gender or body identity, camera, framing, scene, or a character-specific palette.";

function clusterBStyleReferenceExtras(styleSeed: StyleReference | null | undefined): string[] {
  if (!isClusterBGraphicStyleSeed(styleSeed)) return [];
  return [
    ROFAN_CLUSTER_B_GRAPHIC_STYLE_DIRECTION,
    "Render with crisp graphic webtoon linework, decisive cel-style shading, clear hue separation, and vivid accent contrast consistent with the references.",
    "Translate the target character's canonical Appearance Lock colors into that saturation/contrast/highlight treatment; reference colors are examples of color handling, not colors to copy.",
    "Never merge reference characters into one face; never import reference costumes, insignia, props, or seasonal/event setups.",
  ];
}

function representativeStyleReferenceRule(styleSeed: StyleReference | null | undefined): string {
  return [
    "REFERENCE IMAGE(S): STYLE ONLY.",
    OFFICIAL_STYLE_USE_CLAUSE,
    "Create a brand-new original person.",
    OFFICIAL_STYLE_COPY_FORBIDDEN_CLAUSE,
    OFFICIAL_IDENTITY_LOCK_OWNER_CLAUSE,
    ...clusterBStyleReferenceExtras(styleSeed),
  ].join(" ");
}

/** Non-representative slots: the supplied image is the same person, not a composition to edit. */
export const OFFICIAL_IDENTITY_ANCHOR_REFERENCE_RULE = [
  "REFERENCE IMAGE: IDENTITY ANCHOR ONLY.",
  OFFICIAL_IDENTITY_KEEP_CLAUSE,
  OFFICIAL_IDENTITY_COPY_FORBIDDEN_CLAUSE,
  OFFICIAL_SHOT_POSE_EXPRESSION_OWNER_CLAUSE,
].join(" ");

/** Dual-role proof: Image 1 = identity, Image 2 = style. Opt-in only — not the default official path. */
export function officialIdentityThenStyleReferenceRule(
  styleSeed: StyleReference | null | undefined
): string {
  return [
    `REFERENCE IMAGES: Image 1 is IDENTITY ONLY. Image 2 is STYLE ONLY.`,
    `${OFFICIAL_IDENTITY_THEN_STYLE_IMAGE1_LABEL} — keep face identity, canonical hair, eye identity, character-specific identity features named in the IDENTITY LOCK, and body proportions.`,
    OFFICIAL_IDENTITY_KEEP_CLAUSE,
    OFFICIAL_IDENTITY_COPY_FORBIDDEN_CLAUSE,
    `${OFFICIAL_IDENTITY_THEN_STYLE_IMAGE2_LABEL} — drawing/rendering language, line treatment, cel shading, face rendering grammar, hair highlight treatment, material/detail rendering, hue separation, and finishing/polish.`,
    OFFICIAL_STYLE_USE_CLAUSE,
    OFFICIAL_STYLE_COPY_FORBIDDEN_CLAUSE,
    OFFICIAL_IMAGE2_STYLE_ONLY_EXTRA_BAN,
    OFFICIAL_SHOT_POSE_EXPRESSION_OWNER_CLAUSE,
    OFFICIAL_IDENTITY_LOCK_OWNER_CLAUSE,
    ...clusterBStyleReferenceExtras(styleSeed),
  ].join(" ");
}

function officialSlotReferenceRule(
  slot: OfficialAssetSlotPlan,
  styleSeed: StyleReference | null | undefined,
  referenceRoleLayout: OfficialReferenceRoleLayout = "slot_default"
): string {
  switch (referenceRoleLayout) {
    case "identity_then_style":
      return officialIdentityThenStyleReferenceRule(styleSeed);
    case "slot_default":
      return slot.kind === "representative"
        ? representativeStyleReferenceRule(styleSeed)
        : OFFICIAL_IDENTITY_ANCHOR_REFERENCE_RULE;
    default: {
      const exhaustive: never = referenceRoleLayout;
      throw new Error(`Unknown official reference role layout ${String(exhaustive)}`);
    }
  }
}

/**
 * Official asset prompt. Gender lock and safety come from the canonical image
 * owners; `adultGrounded` is decided per slot (depiction) and only honoured for
 * confirmed-adult sheets — the character's nsfw flag alone never widens it.
 */
export function buildOfficialAssetPrompts(input: OfficialAssetPromptInput): {
  primaryPrompt: string;
  strictFallbackPrompt: string;
} {
  const { draft, appearance, style, slot, styleSeed } = input;
  const adultGrounded =
    slot.depiction === "adult_grounded_non_explicit" && adultDepictionAllowed(draft);
  const genderLock = buildImageGenderLockPrompt([
    { label: "Character", name: draft.name, gender: draft.gender },
  ]);
  const effectiveStyle = resolveOfficialAssetStyleDna(style, styleSeed);
  const referenceRule = officialSlotReferenceRule(
    slot,
    styleSeed,
    input.referenceRoleLayout ?? "slot_default"
  );
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
    framingForSlot(slot, draft.draftKey),
    referenceRule,
    `Character: ${draft.name}, age ${draft.age}.`,
    renderIdentityLock(appearance),
    buildMatureMaleVisualAgePrompt(draft) ?? "",
    genderLock,
    renderStyleDna(effectiveStyle),
    renderOfficialStyleFramingOverride(slot.kind),
    buildIllustrationSafeDepiction({ adultGrounded }),
    moment,
    "Exactly one person unless the situation explicitly needs unnamed background extras. No text, speech bubbles, captions, logos, signatures or watermarks.",
  ].join("\n");
  const strictFallbackPrompt = [
    framingForSlot(slot, draft.draftKey),
    referenceRule,
    STRICT_SAFE_DEPICTION,
    "STRICT PROVIDER-SAFE FALLBACK — modest, fully clothed, non-explicit.",
    `Character: ${draft.name}, age ${draft.age}.`,
    renderIdentityLock(appearance),
    buildMatureMaleVisualAgePrompt(draft) ?? "",
    genderLock,
    renderOfficialStyleFramingOverride(slot.kind),
    moment,
    "No text, logos or watermarks.",
  ]
    .filter(Boolean)
    .join("\n");
  return { primaryPrompt, strictFallbackPrompt };
}
