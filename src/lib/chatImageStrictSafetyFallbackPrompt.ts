/**
 * Tier-2 strict provider-safe fallback prompts — independently compiled from safe
 * structured fields only. Never copies Tier-1 full prompt or raw scene text.
 */

import {
  CHAT_COMIC_MOODS,
  CHAT_COMIC_TEMPLATE_PREVIEW_URL,
  chatComicPageProductFraming,
  type ChatComicMood,
  type ChatComicPanelCount,
} from "@/lib/chatComicGenerationConstants";
import {
  buildImageGenderLockPrompt,
  type ImagePromptGender,
} from "@/lib/chatImageGeneration";
import { buildChatImagePairGenderLock } from "@/lib/chatImageGender";
import { buildIllustrationSafeDepiction } from "@/lib/chatImageIllustrationSanitizer";
import {
  renderApprovedCastManifest,
  renderCastGenderLock,
  type ChatImageCastGroundedManifest,
  type ChatImageCastGroundedSubject,
} from "@/lib/chatImageCastManifest";
import {
  CHAT_LD_ILLUSTRATION_PRODUCT_FRAMING,
  type ChatLdIllustrationCastMember,
} from "@/lib/chatLdIllustrationGeneration";
import { genderWordForImagePrompt } from "@/lib/chatImageGender";
import {
  renderChatImageVisualIdentity,
  type ChatImageVisualSubject,
} from "@/lib/chatImageVisualIdentity";
import {
  renderComicSafeStructureForTier2Prompt,
  renderTier2ComicGlobalClothingFooter,
  renderTier2PanelClothingContract,
  type ComicSafeStructureProjection,
} from "@/lib/chatComicSafeStructure";
import type { ChatComicCompositionMode } from "@/lib/chatComicPanelSpec";
import {
  renderComicStrictBalloonSlotMetadata,
  type ComicBalloonSlotMetadata,
} from "@/lib/chatComicPanelSpec";
import {
  COMIC_TIER2_POSITIVE_SAFE_DEPICTION,
  containsBedroomBedContext,
  containsSafeLyingOrRestContext,
} from "@/lib/chatComicTier2SafeProjection";
import {
  collectLdKnownSpeakerNames,
  hasCharacterShirtlessUpperTorso,
  hasCurrentCanonicalDuoKiss,
  type LdStrictSceneSemanticContext,
} from "@/lib/chatImageLdStrictSceneSemantics";
import {
  containsRawRiskySourceLeak,
  projectSceneBlockForSafeImageGeneration,
} from "@/lib/chatImageSafeVisualProjection";
import type { ContentKind } from "@/lib/simulationMode";

/** Tier-2 uses reference identity only — omit untrusted freeform saved appearance prose. */
function subjectsForStrictFallback(
  subjects: readonly ChatImageVisualSubject[]
): ChatImageVisualSubject[] {
  return subjects.map((subject) => ({
    ...subject,
    savedAppearance: "",
    appearanceMode: subject.referenceImageUrl ? "image_only" : subject.appearanceMode,
  }));
}

/** Tier 2 always uses base safe depiction — never adult-grounded allowance. */
export const STRICT_SAFE_DEPICTION = buildIllustrationSafeDepiction({ adultGrounded: false });

export type LdStrictFallbackSceneFacts = {
  safeBroadLocation: string;
  safeMood: string;
  safeComposition: string;
  /** When true, coverage footer must not contradict the adult male shirtless contract. */
  adultMaleShirtlessContract: boolean;
};

/** Derive same-scene facts from projected source for LD Tier-2 — not a new scene selector. */
export function deriveLdStrictFallbackSceneFacts(opts: {
  sceneSourceText: string;
  adultGrounded?: boolean;
  characterName?: string;
  personaName?: string;
  /** Required for adult male shirtless preservation — do not infer from raw keywords alone. */
  characterGender?: ImagePromptGender;
  personaGender?: ImagePromptGender;
  knownSpeakerNames?: readonly string[];
  subjects?: readonly ChatImageVisualSubject[];
}): LdStrictFallbackSceneFacts {
  const raw = String(opts.sceneSourceText ?? "").trim();
  const projected = projectSceneBlockForSafeImageGeneration(raw, {
    adultGrounded: opts.adultGrounded ?? false,
  }).text.trim();

  // Raw-only category/boolean detection → fixed safe literals (never copy raw substrings).
  const rawHasBedroom = containsBedroomBedContext(raw);
  const rawHasLying = containsSafeLyingOrRestContext(raw);
  const characterName = opts.characterName?.trim() || "character";
  const personaName = opts.personaName?.trim() || "persona";
  const semanticCtx: LdStrictSceneSemanticContext = {
    characterName,
    personaName,
    characterGender: opts.characterGender,
    personaGender: opts.personaGender,
    knownSpeakerNames: collectLdKnownSpeakerNames({
      characterName,
      personaName,
      subjects: opts.subjects,
      knownSpeakerNames: opts.knownSpeakerNames,
    }),
  };
  const hasCurrentCanonicalDuoKissEvent = hasCurrentCanonicalDuoKiss(raw, semanticCtx);
  const hasCharacterShirtlessUpperTorsoEvent = hasCharacterShirtlessUpperTorso(raw, semanticCtx);
  const rawHasHug = /(?:껴안|포옹|안아|hug|embrace)/iu.test(raw);
  const rawHasShyMood = /(?:수줍|부끄|활(?:활)?(?:기|홍)|awkward|flushed|shy|홍조|상기)/iu.test(raw);
  const rawHasTenderMood = /(?:애틋|다정|tender|친밀|설렘|떨림|열감|heated)/iu.test(raw);
  const rawHasMessyBed =
    /(?:이불(?:이)?.{0,24}?(?:엉|구|헤|뒤)|rumpled|dishevel|messy\s*bed|흐트러|구김)/iu.test(raw);
  const rawHasCafe = /(?:카페|cafe)/iu.test(raw);
  const rawHasPark = /(?:공원|park)/iu.test(raw);

  let safeBroadLocation = "";
  if (rawHasBedroom) {
    safeBroadLocation = "same private bedroom with the bed visible";
  } else {
    const trpgLocation = projected.match(/(?:^|\n)장소:\s*(.+)/imu)?.[1]?.trim();
    if (trpgLocation && !containsRawRiskySourceLeak(trpgLocation)) {
      safeBroadLocation = `same location: ${trpgLocation.slice(0, 120)}`;
    } else if (rawHasCafe) {
      safeBroadLocation = "same cafe setting as the source scene";
    } else if (rawHasPark) {
      safeBroadLocation = "same outdoor park setting as the source scene";
    } else {
      safeBroadLocation = "the same location as the approved safe source scene";
    }
  }

  const adultGrounded = opts.adultGrounded === true;
  const adultMaleShirtlessContract =
    adultGrounded && hasCharacterShirtlessUpperTorsoEvent;

  const compositionParts = ["same two characters"];
  if (rawHasBedroom && rawHasLying) {
    compositionParts.push("resting side by side on the bed");
  } else if (rawHasBedroom) {
    compositionParts.push("in the bedroom with bed proximity preserved");
  } else if (rawHasLying) {
    compositionParts.push("resting together, preserving lying posture");
  }

  if (hasCurrentCanonicalDuoKissEvent) {
    compositionParts.push(
      adultGrounded
        ? "sharing a brief non-explicit affectionate kiss"
        : "with faces close in calm affectionate proximity, general-audience depiction"
    );
  } else if (rawHasHug) {
    compositionParts.push(
      adultGrounded
        ? "sharing a calm affectionate embrace"
        : "sharing calm affectionate proximity"
    );
  }

  if (adultMaleShirtlessContract) {
    compositionParts.push(
      renderTier2PanelClothingContract("adult_male_character_shirtless_upper_torso")
    );
  } else if (rawHasBedroom || rawHasLying) {
    compositionParts.push("modest covered clothing or soft sheet coverage");
  }

  if (rawHasShyMood) {
    compositionParts.push("flushed or shy expressions");
  }
  if (rawHasMessyBed) {
    compositionParts.push("gently rumpled bedding");
  }

  const safeComposition =
    compositionParts.length > 1
      ? compositionParts.join(", ")
      : "same two characters in the same location with modest posture and readable expressions";

  let safeMood = "warm, gentle emotional connection";
  if (rawHasShyMood) {
    safeMood = "shy, flushed, or gently heated emotional tone preserved from the source";
  } else if (rawHasTenderMood) {
    safeMood = "warm, tender emotional connection preserved from the source";
  } else if (rawHasMessyBed) {
    safeMood = "soft intimate bedroom mood with gently disheveled bedding preserved from the source";
  }

  return { safeBroadLocation, safeMood, safeComposition, adultMaleShirtlessContract };
}

function resolveLdStrictFallbackSceneFacts(opts: {
  sceneSourceText?: string;
  adultGrounded?: boolean;
  characterName?: string;
  personaName?: string;
  characterGender?: ImagePromptGender;
  personaGender?: ImagePromptGender;
  knownSpeakerNames?: readonly string[];
  subjects?: readonly ChatImageVisualSubject[];
  safeBroadLocation?: string;
  safeMood?: string;
  safeComposition?: string;
}): LdStrictFallbackSceneFacts {
  const derived =
    opts.sceneSourceText != null
      ? deriveLdStrictFallbackSceneFacts({
          sceneSourceText: opts.sceneSourceText,
          adultGrounded: opts.adultGrounded,
          characterName: opts.characterName,
          personaName: opts.personaName,
          characterGender: opts.characterGender,
          personaGender: opts.personaGender,
          knownSpeakerNames: opts.knownSpeakerNames,
          subjects: opts.subjects,
        })
      : null;
  const safeComposition =
    opts.safeComposition?.trim() ||
    derived?.safeComposition ||
    "same two characters in the same location with modest posture and readable expressions";
  const adultMaleShirtlessContract =
    derived?.adultMaleShirtlessContract ??
    safeComposition.includes(
      renderTier2PanelClothingContract("adult_male_character_shirtless_upper_torso")
    );
  return {
    safeBroadLocation:
      opts.safeBroadLocation?.trim() ||
      derived?.safeBroadLocation ||
      "the same location as the approved safe source scene",
    safeMood:
      opts.safeMood?.trim() || derived?.safeMood || "warm, gentle emotional connection",
    safeComposition,
    adultMaleShirtlessContract,
  };
}

function strictLdCoverageFooter(adultMaleShirtlessContract: boolean): string {
  if (adultMaleShirtlessContract) {
    return "Stricter coverage: preserve above-the-waist shirtless framing; persona remains modestly clothed.";
  }
  return "Stricter coverage: fully modest clothing or soft coverage.";
}

function formatStrictCastLine(member: ChatLdIllustrationCastMember, index: number): string {
  const name = member.name.trim() || `person ${index + 1}`;
  const gender = genderWordForImagePrompt(member.gender);
  return `${index + 1}. ${name} (${member.role}). Gender: confirmed ${gender}.`;
}

function strictComicPanelBeats(
  panelCount: ChatComicPanelCount,
  safeStructure?: ComicSafeStructureProjection,
  mode: "overlay_first" | "full_provider_rendered" = "overlay_first"
): string {
  if (safeStructure?.panels.length) {
    return renderComicSafeStructureForTier2Prompt(safeStructure, mode)
      .filter((line) => line.startsWith("Panel "))
      .slice(0, panelCount)
      .join("\n");
  }
  const beats =
    mode === "full_provider_rendered"
      ? [
          "Panel 1 — establishing: same cast in a calm, well-lit setting; neutral relaxed poses; silent panel unless approved dialogue is listed.",
          "Panel 2 — reaction: medium shot; gentle emotional expression; modest clothing; silent panel unless approved dialogue is listed.",
          "Panel 3 — close interaction: calm affectionate proximity; expressive faces; modest clothing; silent panel unless approved dialogue is listed.",
          "Panel 4 — closing beat: warm general-audience group or duo moment; silent panel unless approved dialogue is listed.",
        ]
      : [
          "Panel 1 — establishing: same cast in a calm, well-lit setting; neutral relaxed poses; no readable text.",
          "Panel 2 — reaction: medium shot; gentle emotional expression; modest clothing; no readable text.",
          "Panel 3 — close interaction: calm affectionate proximity; expressive faces; modest clothing; no readable text.",
          "Panel 4 — closing beat: warm general-audience group or duo moment; no readable text.",
        ];
  return beats.slice(0, panelCount).join("\n");
}

export function buildStrictLdDuoFallbackPrompt(opts: {
  characterName: string;
  characterGender: ImagePromptGender;
  personaName: string;
  personaGender: ImagePromptGender;
  subjects: readonly ChatImageVisualSubject[];
  safeBroadLocation?: string;
  safeMood?: string;
  safeComposition?: string;
  /** When set, derives same-scene facts from projected source (Tier-2 same-scene contract). */
  sceneSourceText?: string;
  adultGrounded?: boolean;
  knownSpeakerNames?: readonly string[];
}): string {
  const adultGrounded = opts.adultGrounded ?? false;
  const { safeBroadLocation, safeMood, safeComposition, adultMaleShirtlessContract } =
    resolveLdStrictFallbackSceneFacts(opts);
  return [
    CHAT_LD_ILLUSTRATION_PRODUCT_FRAMING,
    renderChatImageVisualIdentity({
      subjects: subjectsForStrictFallback(opts.subjects),
      hasTemplate: false,
    }),
    buildChatImagePairGenderLock({
      characterName: opts.characterName,
      characterGender: opts.characterGender,
      personaName: opts.personaName,
      personaGender: opts.personaGender,
    }),
    buildIllustrationSafeDepiction({ adultGrounded }),
    "STRICT PROVIDER-SAFE FALLBACK — same scene, non-sexual non-graphic general-audience depiction.",
    `Setting: ${safeBroadLocation}.`,
    `Mood: ${safeMood}.`,
    `Composition: ${safeComposition}.`,
    strictLdCoverageFooter(adultMaleShirtlessContract),
    "No speech bubbles, captions, blood, weapons, injury, or suggestive poses.",
    "Vertical 800×1200 composition.",
  ].join("\n");
}

export function buildStrictLdPartyFallbackPrompt(opts: {
  cast: readonly ChatLdIllustrationCastMember[];
  subjects: readonly ChatImageVisualSubject[];
  safeBroadLocation?: string;
  safeMood?: string;
  safeComposition?: string;
  sceneSourceText?: string;
  adultGrounded?: boolean;
}): string {
  const count = opts.cast.length;
  const { safeBroadLocation, safeMood, safeComposition } = resolveLdStrictFallbackSceneFacts(opts);
  const groupComposition = safeComposition.replace(
    /same two characters/giu,
    `same ${count} listed characters`
  );
  return [
    CHAT_LD_ILLUSTRATION_PRODUCT_FRAMING,
    `TRPG party group illustration — show ALL ${count} listed people together.`,
    "CAST:",
    ...opts.cast.map((member, index) => formatStrictCastLine(member, index)),
    renderChatImageVisualIdentity({
      subjects: subjectsForStrictFallback(opts.subjects),
      hasTemplate: false,
    }),
    buildImageGenderLockPrompt(
      opts.cast.map((member) => ({
        label: member.role,
        name: member.name.trim() || member.role,
        gender: member.gender,
      }))
    ),
    STRICT_SAFE_DEPICTION,
    "STRICT PROVIDER-SAFE FALLBACK — same scene, non-sexual non-graphic general-audience group depiction.",
    `Setting: ${safeBroadLocation}.`,
    `Mood: ${safeMood}.`,
    `Composition: ${groupComposition}.`,
    "Group mid-shot; every listed face visible; stricter modest coverage throughout.",
    "No combat action, blood, weapons in use, speech bubbles, or suggestive poses.",
    "Vertical 800×1200 composition.",
  ].join("\n");
}

export function buildStrictComicFallbackPrompt(opts: {
  panelCount: ChatComicPanelCount;
  mood?: ChatComicMood;
  characterName: string;
  characterGender: ImagePromptGender;
  personaName: string;
  personaGender: ImagePromptGender;
  subjects: readonly ChatImageVisualSubject[];
  castManifest?: ChatImageCastGroundedManifest | null;
  castSelected?: readonly ChatImageCastGroundedSubject[];
  /** Explicit recurring-identity count when there is no general cast manifest (e.g. TRPG party). */
  castCount?: number;
  contentKind?: ContentKind;
  safeStructure?: ComicSafeStructureProjection;
  /** overlay_first = current exact Tier-2; blank_balloon_hybrid = GPT blank-balloon composition. */
  compositionMode?: ChatComicCompositionMode;
  /** Structural blank-balloon slot metadata for hybrid Tier-2 (text-free, provider-safe). */
  balloonSlots?: ReadonlyArray<{ panelIndex: number; slots: ComicBalloonSlotMetadata[] }>;
}): string {
  const strictSubjects = subjectsForStrictFallback(opts.subjects);
  const castCount =
    opts.castManifest && opts.castSelected?.length
      ? opts.castSelected.length
      : opts.castCount ?? 0;
  const castAware = castCount > 0;
  const castBlock =
    opts.castManifest && opts.castSelected?.length
      ? renderApprovedCastManifest({
          manifest: opts.castManifest,
          selected: opts.castSelected,
          subjects: strictSubjects,
          contentKind: opts.contentKind,
        })
      : "";
  const moodPrompt =
    CHAT_COMIC_MOODS.find((item) => item.id === (opts.mood ?? "comic"))?.prompt ??
    "natural slice-of-life interaction";
  const compositionMode = opts.compositionMode ?? "overlay_first";
  const hybrid = compositionMode === "blank_balloon_hybrid";
  const fullProvider = compositionMode === "full_provider_rendered";
  const compositionLine = hybrid
    ? [
        "GPT IS COMIC DIRECTOR — create the complete comic artwork: panel composition, camera direction, character staging, facial reactions, blank speech balloons, natural balloon tails, blank narration boxes where needed, and decorative comic effects.",
        "Draw natural white comic speech balloons with black outlines in visually appropriate negative space. Tails must naturally point toward the actual speaker. Do not cover faces, eyes, hands, or important actions. Leave sufficient empty interior space for later Korean text.",
        "Blank narration boxes only where the beat needs context, with empty interiors. Render no readable letters, dialogue, captions, placeholder words, random symbols, or gibberish anywhere in the image.",
        ...(opts.balloonSlots?.length
          ? renderComicStrictBalloonSlotMetadata(opts.balloonSlots).split("\n")
          : []),
      ]
    : fullProvider
      ? [
          "RENDER THE COMPLETE COMIC PAGE — the image is the final comic; no server text is added later.",
          "Readable Korean speech bubbles are allowed for the approved safe dialogue listed below. Do not invent replacement dialogue.",
          "Make balloon tails point toward the actual speaker. Do not cover faces, eyes, hands, or important actions as much as possible. Vary shot distance across the page.",
          "If a panel has no approved dialogue, keep it a silent visual panel.",
          "Use narration sparingly — include only very short time-ordered narration boxes for crucial transitions, never long prose paragraphs.",
        ]
      : ["VISUAL LAYER ONLY — zero speech bubbles, captions, SFX, or readable letters in the image. Text is added later by server overlay."];
  return [
    chatComicPageProductFraming(opts.panelCount),
    `Layout reference: ${CHAT_COMIC_TEMPLATE_PREVIEW_URL}`,
    castBlock,
    renderChatImageVisualIdentity({ subjects: strictSubjects, hasTemplate: true }),
    castAware
      ? renderCastGenderLock(strictSubjects)
      : buildChatImagePairGenderLock({
          characterName: opts.characterName,
          characterGender: opts.characterGender,
          personaName: opts.personaName,
          personaGender: opts.personaGender,
        }),
    COMIC_TIER2_POSITIVE_SAFE_DEPICTION,
    "STRICT PROVIDER-SAFE FALLBACK — preserve the same safe location, cast, and emotional beat with general-audience visual depiction.",
    opts.safeStructure?.sharedBackground
      ? `Preserve safe location continuity: ${opts.safeStructure.sharedBackground}.`
      : "",
    opts.safeStructure?.atmosphere ? `Preserve mood: ${opts.safeStructure.atmosphere}.` : "",
    `Overall tone: ${moodPrompt} — keep expressions readable and family-safe.`,
    ...compositionLine,
    strictComicPanelBeats(opts.panelCount, opts.safeStructure, fullProvider ? "full_provider_rendered" : "overlay_first"),
    castAware
      ? `Exactly ${castCount} recurring identities — no extras.`
      : "Exactly two recurring characters — no extras.",
    renderTier2ComicGlobalClothingFooter(opts.safeStructure),
  ].join("\n");
}

export function buildStrictSdFallbackPrompt(opts: {
  characterName: string;
  characterGender: ImagePromptGender;
  personaName: string;
  personaGender: ImagePromptGender;
  subjects: readonly ChatImageVisualSubject[];
  moodLabel?: string;
}): string {
  const strictSubjects = subjectsForStrictFallback(opts.subjects);
  return [
    "Create one polished chibi SD duo illustration inside a decorative gift box frame.",
    renderChatImageVisualIdentity({ subjects: strictSubjects, hasTemplate: true }),
    buildChatImagePairGenderLock({
      characterName: opts.characterName,
      characterGender: opts.characterGender,
      personaName: opts.personaName,
      personaGender: opts.personaGender,
    }),
    STRICT_SAFE_DEPICTION,
    "STRICT PROVIDER-SAFE FALLBACK — cute, non-explicit SD duo portrait.",
    opts.moodLabel ? `Mood accents: ${opts.moodLabel}.` : "Mood: warm and playful.",
    "Both characters fully clothed in modest outfits; cheerful neutral poses inside the gift box.",
    "No text, logos, or watermarks.",
  ].join("\n");
}

export function buildStrictPersonaFallbackPrompt(opts: {
  personaName: string;
  gender: ImagePromptGender;
  characterName: string;
}): string {
  return [
    "Create one polished persona portrait illustration inspired by the supplied character art style.",
    STRICT_SAFE_DEPICTION,
    "STRICT PROVIDER-SAFE FALLBACK — modest, non-explicit portrait.",
    `Subject: ${opts.personaName} (${opts.gender}).`,
    `Style reference from character: ${opts.characterName}.`,
    "Calm neutral expression, fully clothed, soft lighting, no text.",
  ].join("\n");
}

export function buildStrictCoupleStampFallbackPrompt(opts: {
  characterName: string;
  characterGender: ImagePromptGender;
  personaName: string;
  personaGender: ImagePromptGender;
  subjects: readonly ChatImageVisualSubject[];
}): string {
  const strictSubjects = subjectsForStrictFallback(opts.subjects);
  return [
    "Create one polished couple stamp / sticker illustration of two chibi characters.",
    renderChatImageVisualIdentity({ subjects: strictSubjects, hasTemplate: true }),
    buildChatImagePairGenderLock({
      characterName: opts.characterName,
      characterGender: opts.characterGender,
      personaName: opts.personaName,
      personaGender: opts.personaGender,
    }),
    STRICT_SAFE_DEPICTION,
    "STRICT PROVIDER-SAFE FALLBACK — cute duo stamp, modest clothing, neutral cheerful poses.",
    "Simple clean background. No text.",
  ].join("\n");
}

export function buildStrictEmoticonFallbackPrompt(opts: {
  characterName: string;
  characterGender: ImagePromptGender;
  personaName: string;
  personaGender: ImagePromptGender;
  subjects: readonly ChatImageVisualSubject[];
}): string {
  const strictSubjects = subjectsForStrictFallback(opts.subjects);
  return [
    "Create one polished emoticon / sticker sheet with cute chibi expressions.",
    renderChatImageVisualIdentity({ subjects: strictSubjects, hasTemplate: true }),
    buildChatImagePairGenderLock({
      characterName: opts.characterName,
      characterGender: opts.characterGender,
      personaName: opts.personaName,
      personaGender: opts.personaGender,
    }),
    STRICT_SAFE_DEPICTION,
    "STRICT PROVIDER-SAFE FALLBACK — playful neutral expressions only; modest clothing.",
    "No text labels. Safe, non-explicit acting.",
  ].join("\n");
}
