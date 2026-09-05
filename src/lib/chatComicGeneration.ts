import { type ImagePromptGender } from "@/lib/chatImageGeneration";
import {
  buildChatImagePairGenderLock,
} from "@/lib/chatImageGender";
import {
  bindApprovedCastManifest,
  renderApprovedCastManifest,
  renderCastGenderLock,
  type ChatImageCastGroundedManifest,
  type ChatImageCastGroundedSubject,
} from "@/lib/chatImageCastManifest";
import type { ScenePanelCount, ScenePlan, ScenePresentationVisibility } from "@/lib/chatImageScenePlan";
import {
  resolveScenePresentationVisibility,
  collectApprovedComicText,
  normalizeDialogueTextForOutput,
} from "@/lib/chatImageScenePlan";
import { buildIllustrationSafeDepiction } from "@/lib/chatImageIllustrationSanitizer";
import {
  projectTextForSafeImagePrompt,
  shouldOmitDialogueFromImageProjection,
  type SafeVisualProjectionContext,
} from "@/lib/chatImageSafeVisualProjection";
import {
  buildChatComicPanelSpecVisualSection,
  type ChatComicCompositionMode,
} from "@/lib/chatComicPanelSpec";
import type { ContentKind } from "@/lib/simulationMode";
import {
  bindChatImageReferencePack,
  buildChatDuoVisualSubjects,
  renderChatImageVisualIdentity,
  type ChatImageAppearanceMode,
  type ChatImageVisualSubject,
} from "@/lib/chatImageVisualIdentity";

export {
  CHAT_COMIC_FOUR_PANEL_OUTPUT_SIZE,
  CHAT_COMIC_GENERATION_DEFAULT_POINTS,
  CHAT_COMIC_IMAGE_OUTPUT_SIZE,
  CHAT_COMIC_MAX_INPUT_CHARS,
  CHAT_COMIC_MOODS,
  CHAT_COMIC_PANEL_OPTIONS,
  CHAT_COMIC_TEMPLATE_ID,
  CHAT_COMIC_TEMPLATE_NAME,
  CHAT_COMIC_TEMPLATE_PREVIEW_URL,
  type ChatComicMood,
  type ChatComicPanelCount,
  resolveChatComicOutputSize,
  resolveChatComicPrice,
  sanitizeChatComicOptions,
} from "@/lib/chatComicGenerationConstants";
import {
  CHAT_COMIC_MOODS,
  CHAT_COMIC_TEMPLATE_PREVIEW_URL,
  type ChatComicMood,
  type ChatComicPanelCount,
  resolveChatComicOutputSize,
} from "@/lib/chatComicGenerationConstants";

function defaultComicSubjects(opts: {
  characterName: string;
  characterGender: ImagePromptGender;
  personaName: string;
  personaGender: ImagePromptGender;
  subjects?: readonly ChatImageVisualSubject[];
  characterImageUrl?: string;
  characterSavedAppearance?: string;
  characterAppearanceMode?: ChatImageAppearanceMode;
  personaImageUrl?: string;
  personaSavedAppearance?: string;
  personaAppearanceMode?: ChatImageAppearanceMode;
}): ChatImageVisualSubject[] {
  if (opts.subjects?.length) return [...opts.subjects];
  return bindChatImageReferencePack({
    template: {
      url: CHAT_COMIC_TEMPLATE_PREVIEW_URL,
      role: "layout template",
    },
    subjectsInImageOrder: buildChatDuoVisualSubjects({
      characterName: opts.characterName,
      characterGender: opts.characterGender,
      characterImageUrl: opts.characterImageUrl || "/character-ref",
      characterSavedAppearance: opts.characterSavedAppearance ?? "",
      characterAppearanceMode: opts.characterAppearanceMode ?? "image_only",
      personaName: opts.personaName,
      personaGender: opts.personaGender,
      personaImageUrl: opts.personaImageUrl || "/persona-ref",
      personaSavedAppearance: opts.personaSavedAppearance ?? "",
      personaAppearanceMode: opts.personaAppearanceMode ?? "image_only",
    }),
  }).subjects;
}

export function buildChatComicImagePrompt(opts: {
  characterName: string;
  characterGender: ImagePromptGender;
  personaName: string;
  personaGender: ImagePromptGender;
  mood?: ChatComicMood;
  plan: ScenePlan;
  subjects?: readonly ChatImageVisualSubject[];
  castManifest?: ChatImageCastGroundedManifest | null;
  castSelected?: readonly ChatImageCastGroundedSubject[];
  characterImageUrl?: string;
  characterSavedAppearance?: string;
  characterAppearanceMode?: ChatImageAppearanceMode;
  personaImageUrl?: string;
  personaSavedAppearance?: string;
  personaAppearanceMode?: ChatImageAppearanceMode;
  contentKind?: ContentKind;
  adultGrounded?: boolean;
  compositionMode?: ChatComicCompositionMode;
}): string {
  const projectionContext: SafeVisualProjectionContext = {
    adultGrounded: opts.adultGrounded ?? false,
  };
  const sceneVisibility = resolveScenePresentationVisibility({
    contentKind: opts.contentKind,
    castManifest: opts.castManifest,
  });
  const subjects = defaultComicSubjects(opts);
  const castAware = Boolean(opts.castManifest && opts.castSelected?.length);
  const castBlock =
    opts.castManifest && opts.castSelected?.length
      ? renderApprovedCastManifest({
          manifest: opts.castManifest,
          selected: opts.castSelected,
          subjects,
          contentKind: opts.contentKind,
        })
      : "";
  return [
    `Create one polished Korean manhwa-style page with exactly ${opts.plan.panels.length} wide horizontal panels stacked vertically.`,
    "Reference image 1 is LAYOUT AND FINISH ONLY. Follow its clean gutters, polished full-color rendering, and panel polish, but do not copy its exact poses.",
    "Ignore the sample people drawn on reference image 1. Do not copy their gender presentation, body type, face shape, age, or hair color. Especially do not treat any pink-haired feminine sample figure as either subject.",
    castBlock,
    renderChatImageVisualIdentity({
      subjects,
      hasTemplate: true,
    }),
    castAware
      ? renderCastGenderLock(subjects)
      : buildChatImagePairGenderLock({
          characterName: opts.characterName,
          characterGender: opts.characterGender,
          personaName: opts.personaName,
          personaGender: opts.personaGender,
        }),
    buildIllustrationSafeDepiction({ adultGrounded: opts.adultGrounded ?? false }),
    `Overall tone: ${CHAT_COMIC_MOODS.find((item) => item.id === (opts.mood ?? "comic"))?.prompt ?? "comic"}.`,
    opts.compositionMode === "blank_balloon_hybrid"
      ? "GPT IS COMIC DIRECTOR — create the complete comic artwork, including panel composition, camera direction, character poses, facial reactions, blank speech balloons, natural balloon tails, blank narration boxes where needed, and decorative manga/manhwa effects."
      : "VISUAL LAYER ONLY — depict characters, background, pose, expression, and camera. Do not render any readable text, speech bubbles, captions, narration boxes, or SFX in the image.",
    opts.compositionMode === "blank_balloon_hybrid"
      ? "Draw natural white manga/manhwa speech balloons with black outlines. Place them in visually appropriate negative space. Their tails must naturally point toward the actual speaker. Do not cover faces, eyes, hands, or important actions. Leave sufficient empty interior space for later Korean text. Render no readable letters, dialogue, captions, placeholder words, random symbols or gibberish inside speech balloons."
      : "Readable dialogue and narration will be added later by server overlay. Leave clean negative space (especially upper-right of each panel) for text overlay.",
    castAware
      ? `Exactly ${opts.castSelected!.length} recurring human ${opts.castSelected!.length === 1 ? "identity" : "identities"}. No extra person, duplicate face, identity swap, malformed hands, watermark, or logo.`
      : "Exactly two recurring human characters. No extra person, duplicate face, identity swap, malformed hands, watermark, or logo.",
    "Keep all panel borders and the full page visible. Do not crop off the last panel.",
    buildChatComicPanelSpecVisualSection({
      plan: opts.plan,
      personaName: opts.personaName,
      characterName: opts.characterName,
      visibility: sceneVisibility,
      castSelected: castAware ? opts.castSelected : undefined,
      subjects,
      eventSubjectBindings: opts.castManifest?.eventSubjectBindings,
      compositionMode: opts.compositionMode,
      projection: {
        projectSceneText: (text) => projectTextForSafeImagePrompt(text, projectionContext),
        omitDialogueText: shouldOmitDialogueFromImageProjection,
      },
    }),
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function buildChatComicGenerationPlan(opts: {
  characterName: string;
  characterGender: ImagePromptGender;
  personaName: string;
  personaGender: ImagePromptGender;
  characterImageUrl: string;
  characterSavedAppearance: string;
  characterAppearanceMode: ChatImageAppearanceMode;
  personaImageUrl: string;
  personaSavedAppearance: string;
  personaAppearanceMode: ChatImageAppearanceMode;
  mood?: ChatComicMood;
  plan: ScenePlan;
  castManifest?: ChatImageCastGroundedManifest | null;
  contentKind?: ContentKind;
  adultGrounded?: boolean;
  compositionMode?: ChatComicCompositionMode;
}) {
  const useCast = Boolean(opts.castManifest);
  let pack: { subjects: ChatImageVisualSubject[]; referenceUrls: string[] };
  let castSelected: readonly ChatImageCastGroundedSubject[] | undefined;
  if (useCast) {
    const bound = bindApprovedCastManifest(opts.castManifest!, {
      template: {
        url: CHAT_COMIC_TEMPLATE_PREVIEW_URL,
        role: "layout template",
      },
      contentKind: opts.contentKind,
    });
    pack = bound;
    castSelected = bound.selected;
  } else {
    pack = bindChatImageReferencePack({
      template: {
        url: CHAT_COMIC_TEMPLATE_PREVIEW_URL,
        role: "layout template",
      },
      subjectsInImageOrder: buildChatDuoVisualSubjects({
        characterName: opts.characterName,
        characterGender: opts.characterGender,
        characterImageUrl: opts.characterImageUrl,
        characterSavedAppearance: opts.characterSavedAppearance,
        characterAppearanceMode: opts.characterAppearanceMode,
        personaName: opts.personaName,
        personaGender: opts.personaGender,
        personaImageUrl: opts.personaImageUrl,
        personaSavedAppearance: opts.personaSavedAppearance,
        personaAppearanceMode: opts.personaAppearanceMode,
      }),
    });
    castSelected = undefined;
  }
  return {
    subjects: pack.subjects,
    referenceUrls: pack.referenceUrls,
    prompt: buildChatComicImagePrompt({
      characterName: opts.characterName,
      characterGender: opts.characterGender,
      personaName: opts.personaName,
      personaGender: opts.personaGender,
      mood: opts.mood,
      plan: opts.plan,
      subjects: pack.subjects,
      castManifest: useCast ? opts.castManifest : null,
      castSelected,
      characterImageUrl: opts.characterImageUrl,
      characterSavedAppearance: opts.characterSavedAppearance,
      characterAppearanceMode: opts.characterAppearanceMode,
      personaImageUrl: opts.personaImageUrl,
      personaSavedAppearance: opts.personaSavedAppearance,
      personaAppearanceMode: opts.personaAppearanceMode,
      contentKind: opts.contentKind,
      adultGrounded: opts.adultGrounded,
      compositionMode: opts.compositionMode,
    }),
  };
}

export function parseChatComicOutputDimensions(panelCount: ChatComicPanelCount): {
  width: number;
  height: number;
} {
  const [widthRaw, heightRaw] = resolveChatComicOutputSize(panelCount).split("x");
  return { width: Number(widthRaw), height: Number(heightRaw) };
}

export function countProviderPromptReadableDialogue(prompt: string): number {
  return prompt.match(/^Speech bubble \(/gm)?.length ?? 0;
}

function normalizePromptAuditText(text: string): string {
  return normalizeDialogueTextForOutput(text);
}

/** Provider prompt audit — verifies known dialogue source strings are absent from prompt. */
export function auditProviderPromptDialogueLeak(opts: {
  prompt: string;
  plan: ScenePlan;
  visibility?: ScenePresentationVisibility;
}): {
  speechBubbleDirectiveCount: number;
  canonicalDialogueOccurrenceCount: number;
  userEditOccurrenceCount: number;
  leakedTexts: string[];
} {
  const visibility = opts.visibility ?? { personaVisible: true };
  const speechBubbleDirectiveCount = countProviderPromptReadableDialogue(opts.prompt);
  const leakedTexts: string[] = [];
  let canonicalDialogueOccurrenceCount = 0;
  let userEditOccurrenceCount = 0;

  for (const panel of opts.plan.panels) {
    for (const line of panel.dialogue) {
      const norm = normalizePromptAuditText(line.text);
      if (!norm || norm.length < 2) continue;
      if (!opts.prompt.includes(norm)) continue;
      leakedTexts.push(norm);
      if (line.provenance === "user_edit") {
        userEditOccurrenceCount += 1;
      } else {
        canonicalDialogueOccurrenceCount += 1;
      }
    }
  }

  for (const text of collectApprovedComicText(opts.plan, visibility)) {
    const norm = normalizePromptAuditText(text);
    if (!norm || norm.length < 2) continue;
    if (!opts.prompt.includes(norm)) continue;
    if (leakedTexts.includes(norm)) continue;
    leakedTexts.push(norm);
    canonicalDialogueOccurrenceCount += 1;
  }

  return {
    speechBubbleDirectiveCount,
    canonicalDialogueOccurrenceCount,
    userEditOccurrenceCount,
    leakedTexts,
  };
}
