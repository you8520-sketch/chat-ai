/**
 * Tier-2 strict provider-safe fallback prompts — independently compiled from safe
 * structured fields only. Never copies Tier-1 full prompt or raw scene text.
 */

import {
  CHAT_COMIC_MOODS,
  CHAT_COMIC_TEMPLATE_PREVIEW_URL,
  type ChatComicMood,
  type ChatComicPanelCount,
} from "@/lib/chatComicGeneration";
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
import type { ScenePlan } from "@/lib/chatImageScenePlan";
import {
  renderChatImageVisualIdentity,
  type ChatImageVisualSubject,
} from "@/lib/chatImageVisualIdentity";
import type { ContentKind } from "@/lib/simulationMode";

/** Tier 2 always uses base safe depiction — never adult-grounded allowance. */
export const STRICT_SAFE_DEPICTION = buildIllustrationSafeDepiction({ adultGrounded: false });

function formatStrictCastLine(member: ChatLdIllustrationCastMember, index: number): string {
  const name = member.name.trim() || `person ${index + 1}`;
  const gender = genderWordForImagePrompt(member.gender);
  return `${index + 1}. ${name} (${member.role}). Gender: confirmed ${gender}.`;
}

function strictComicPanelBeats(panelCount: ChatComicPanelCount): string {
  const beats = [
    "Panel 1 — establishing: same cast in a calm, well-lit setting; neutral relaxed poses; no readable text.",
    "Panel 2 — reaction: medium shot; gentle emotional expression; modest clothing; no readable text.",
    "Panel 3 — close interaction: safe neutral proximity; expressive faces; no suggestive pose; no readable text.",
    "Panel 4 — closing beat: warm but non-explicit group or duo moment; no readable text.",
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
    renderChatImageVisualIdentity({ subjects: opts.subjects, hasTemplate: false }),
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
    renderChatImageVisualIdentity({ subjects: opts.subjects, hasTemplate: false }),
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
  plan?: ScenePlan;
}): string {
  const castAware = Boolean(opts.castManifest && opts.castSelected?.length);
  const castBlock =
    opts.castManifest && opts.castSelected?.length
      ? renderApprovedCastManifest({
          manifest: opts.castManifest,
          selected: opts.castSelected,
          subjects: opts.subjects,
          plan: opts.plan,
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
    renderChatImageVisualIdentity({ subjects: opts.subjects, hasTemplate: true }),
    castAware
      ? renderCastGenderLock(opts.subjects)
      : buildChatImagePairGenderLock({
          characterName: opts.characterName,
          characterGender: opts.characterGender,
          personaName: opts.personaName,
          personaGender: opts.personaGender,
        }),
    STRICT_SAFE_DEPICTION,
    "STRICT PROVIDER-SAFE FALLBACK — sequential safe poses only.",
    `Overall tone: ${moodPrompt} — keep expressions readable but non-explicit.`,
    "NO TEXT CONTRACT: zero speech bubbles, captions, SFX, or readable letters anywhere.",
    strictComicPanelBeats(opts.panelCount),
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
  return [
    "Create one polished chibi SD duo illustration inside a decorative gift box frame.",
    renderChatImageVisualIdentity({ subjects: opts.subjects, hasTemplate: true }),
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
  return [
    "Create one polished couple stamp / sticker illustration of two chibi characters.",
    renderChatImageVisualIdentity({ subjects: opts.subjects, hasTemplate: true }),
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
  return [
    "Create one polished emoticon / sticker sheet with cute chibi expressions.",
    renderChatImageVisualIdentity({ subjects: opts.subjects, hasTemplate: true }),
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
