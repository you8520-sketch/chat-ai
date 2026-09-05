/**
 * Tier-2 strict provider-safe fallback prompts — independently compiled from safe
 * structured fields only. Never copies Tier-1 full prompt or raw scene text.
 */

import {
  CHAT_COMIC_MOODS,
  CHAT_COMIC_TEMPLATE_PREVIEW_URL,
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
  type ChatLdIllustrationCastMember,
} from "@/lib/chatLdIllustrationGeneration";
import { genderWordForImagePrompt } from "@/lib/chatImageGender";
import {
  renderChatImageVisualIdentity,
  type ChatImageVisualSubject,
} from "@/lib/chatImageVisualIdentity";
import {
  renderComicSafeStructureForTier2Prompt,
  type ComicSafeStructureProjection,
} from "@/lib/chatComicSafeStructure";
import type { ChatComicCompositionMode } from "@/lib/chatComicPanelSpec";
import {
  renderComicStrictBalloonSlotMetadata,
  type ComicBalloonSlotMetadata,
} from "@/lib/chatComicPanelSpec";
import { COMIC_TIER2_POSITIVE_SAFE_DEPICTION } from "@/lib/chatComicTier2SafeProjection";
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
}): string {
  const location =
    opts.safeBroadLocation?.trim() ||
    "a calm, well-lit indoor or outdoor setting suited to the characters";
  const mood = opts.safeMood?.trim() || "warm, gentle emotional connection";
  return [
    "Create one polished vertical 2:3 Korean character illustration, not a comic page.",
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
    STRICT_SAFE_DEPICTION,
    "STRICT PROVIDER-SAFE FALLBACK — depict a clearly non-sexual, non-graphic scene.",
    `Setting: ${location}.`,
    `Mood: ${mood}.`,
    "Composition: two characters standing or sitting near each other with modest, fully covered clothing.",
    "Show gentle eye contact or a calm shared moment — no physical intimacy beyond neutral closeness.",
    "No speech bubbles, captions, blood, weapons, injury, or suggestive poses.",
    "Match reference identity and art style. Vertical 800×1200 composition.",
  ].join("\n");
}

export function buildStrictLdPartyFallbackPrompt(opts: {
  cast: readonly ChatLdIllustrationCastMember[];
  subjects: readonly ChatImageVisualSubject[];
  safeBroadLocation?: string;
}): string {
  const count = opts.cast.length;
  const location =
    opts.safeBroadLocation?.trim() ||
    "a calm group-friendly indoor or outdoor setting with clear lighting";
  return [
    "Create one polished vertical 2:3 Korean character illustration, not a comic page.",
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
    "STRICT PROVIDER-SAFE FALLBACK — non-sexual, non-graphic group scene.",
    `Setting: ${location}.`,
    "Composition: group mid-shot; every listed face visible; modest clothing; calm alert or thoughtful expressions.",
    "No combat action, blood, weapons in use, speech bubbles, or suggestive poses.",
    "Match reference identities and art style. Vertical 800×1200 composition.",
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
  contentKind?: ContentKind;
  safeStructure?: ComicSafeStructureProjection;
  /** overlay_first = current exact Tier-2; blank_balloon_hybrid = GPT blank-balloon composition. */
  compositionMode?: ChatComicCompositionMode;
  /** Structural blank-balloon slot metadata for hybrid Tier-2 (text-free, provider-safe). */
  balloonSlots?: ReadonlyArray<{ panelIndex: number; slots: ComicBalloonSlotMetadata[] }>;
}): string {
  const strictSubjects = subjectsForStrictFallback(opts.subjects);
  const castAware = Boolean(opts.castManifest && opts.castSelected?.length);
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
        "GPT IS COMIC DIRECTOR — create the complete comic artwork: panel composition, camera direction, character staging, facial reactions, blank speech balloons, natural balloon tails, blank narration boxes where needed, and decorative manga/manhwa effects.",
        "Draw natural white manga/manhwa speech balloons with black outlines in visually appropriate negative space. Tails must naturally point toward the actual speaker. Do not cover faces, eyes, hands, or important actions. Leave sufficient empty interior space for later Korean text.",
        "Blank narration boxes only where the beat needs context, with empty interiors. Render no readable letters, dialogue, captions, placeholder words, random symbols, or gibberish anywhere in the image.",
        ...(opts.balloonSlots?.length
          ? renderComicStrictBalloonSlotMetadata(opts.balloonSlots).split("\n")
          : []),
      ]
    : fullProvider
      ? [
          "RENDER THE COMPLETE MANHWA PAGE — the image is the final comic; no server text is added later.",
          "Readable Korean speech bubbles are allowed for the approved safe dialogue listed below. Do not invent replacement dialogue.",
          "Make balloon tails point toward the actual speaker. Do not cover faces, eyes, hands, or important actions as much as possible. Vary shot distance across the page.",
          "If a panel has no approved dialogue, keep it a silent visual panel.",
          "Use narration sparingly — include only very short time-ordered narration boxes for crucial transitions, never long prose paragraphs.",
        ]
      : ["VISUAL LAYER ONLY — zero speech bubbles, captions, SFX, or readable letters in the image. Text is added later by server overlay."];
  return [
    `Create one polished Korean manhwa-style page with exactly ${opts.panelCount} wide horizontal panels stacked vertically.`,
    "Reference image 1 is LAYOUT AND FINISH ONLY.",
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
      ? `Exactly ${opts.castSelected!.length} recurring identities — no extras.`
      : "Exactly two recurring characters — no extras.",
    "Keep all panel borders visible. Modest clothing throughout.",
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
