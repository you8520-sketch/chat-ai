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
  safeStructure?: ComicSafeStructureProjection
): string {
  if (safeStructure?.panels.length) {
    return renderComicSafeStructureForTier2Prompt(safeStructure)
      .filter((line) => line.startsWith("Panel "))
      .slice(0, panelCount)
      .join("\n");
  }
  const beats = [
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
    "VISUAL LAYER ONLY — zero speech bubbles, captions, SFX, or readable letters in the image. Text is added later by server overlay.",
    strictComicPanelBeats(opts.panelCount, opts.safeStructure),
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
