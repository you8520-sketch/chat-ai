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
import type { ScenePanelCount, ScenePlan } from "@/lib/chatImageScenePlan";
import { resolveScenePresentationVisibility, collectApprovedComicText } from "@/lib/chatImageScenePlan";
import { collectFinalOverlayBubbleTexts } from "@/lib/chatComicTextOverlay";
import { buildIllustrationSafeDepiction } from "@/lib/chatImageIllustrationSanitizer";
import {
  projectTextForSafeImagePrompt,
  shouldOmitDialogueFromImageProjection,
  type SafeVisualProjectionContext,
} from "@/lib/chatImageSafeVisualProjection";
import { buildChatComicPanelSpecVisualSection } from "@/lib/chatComicPanelSpec";
import type { ContentKind } from "@/lib/simulationMode";
import {
  bindChatImageReferencePack,
  buildChatDuoVisualSubjects,
  renderChatImageVisualIdentity,
  type ChatImageAppearanceMode,
  type ChatImageVisualSubject,
} from "@/lib/chatImageVisualIdentity";

export const CHAT_COMIC_TEMPLATE_ID = "comic_horizontal_2_4" as const;
export const CHAT_COMIC_TEMPLATE_NAME = "2~4컷 가로 만화";
export const CHAT_COMIC_TEMPLATE_PREVIEW_URL =
  "/image-templates/comic-vertical-sample-hq.webp";

/** Soft guardrail for pasted prose — selected-turn summaries are not truncated. */
export const CHAT_COMIC_MAX_INPUT_CHARS = 4_000;
export const CHAT_COMIC_IMAGE_OUTPUT_SIZE = "1008x1408" as const;
/** Promoted four-panel page size for the canonical 2|3|4 panel count. */
export const CHAT_COMIC_FOUR_PANEL_OUTPUT_SIZE = "864x1824" as const;
export const CHAT_COMIC_GENERATION_DEFAULT_POINTS = 230;

export const CHAT_COMIC_PANEL_OPTIONS = [
  { id: 2, label: "2컷" },
  { id: 3, label: "3컷" },
  { id: 4, label: "4컷" },
] as const;

export const CHAT_COMIC_MOODS = [
  {
    id: "comic",
    label: "코믹",
    prompt: "light romantic-comedy energy, exaggerated reactions and playful timing",
  },
  {
    id: "lovely",
    label: "달달",
    prompt: "soft affectionate romance, warm blushes and tender expressions",
  },
  {
    id: "daily",
    label: "일상",
    prompt: "natural slice-of-life interaction, relaxed and believable expressions",
  },
  {
    id: "serious",
    label: "진지",
    prompt: "restrained emotional tension, cinematic expressions and clear acting",
  },
] as const;

export type ChatComicPanelCount = ScenePanelCount;
export type ChatComicMood = (typeof CHAT_COMIC_MOODS)[number]["id"];

export function resolveChatComicOutputSize(panelCount: ChatComicPanelCount) {
  return panelCount === 4
    ? CHAT_COMIC_FOUR_PANEL_OUTPUT_SIZE
    : CHAT_COMIC_IMAGE_OUTPUT_SIZE;
}

function toMood(raw: unknown): ChatComicMood {
  const value = String(raw ?? "");
  return CHAT_COMIC_MOODS.some((item) => item.id === value)
    ? (value as ChatComicMood)
    : "comic";
}

export function sanitizeChatComicOptions(raw: {
  mood?: unknown;
}) {
  return {
    mood: toMood(raw.mood),
  };
}

export function resolveChatComicPrice(
  _panelCount: ChatComicPanelCount,
  env: NodeJS.ProcessEnv = process.env
): number {
  const override = Number(env.CHAT_COMIC_GENERATION_POINTS);
  if (Number.isFinite(override) && override >= 1) return Math.ceil(override);
  return CHAT_COMIC_GENERATION_DEFAULT_POINTS;
}

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
          plan: opts.plan,
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
    "VISUAL LAYER ONLY — depict characters, background, pose, expression, and camera. Do not render any readable text, speech bubbles, captions, narration boxes, or SFX in the image.",
    "Readable dialogue and narration will be added later by server overlay. Leave clean negative space (especially upper-right of each panel) for text overlay.",
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
    }),
  };
}

export function countProviderPromptReadableDialogue(prompt: string): number {
  return prompt.match(/^Speech bubble \(/gm)?.length ?? 0;
}

/** Overlay-boundary audit: approved plan text vs final overlay bubble owner. */
export function auditComicDialogueWhitelist(opts: {
  plan: ScenePlan;
  personaName: string;
  characterName: string;
  contentKind?: ContentKind;
  castManifest?: ChatImageCastGroundedManifest | null;
  panelCount?: number;
  width?: number;
  height?: number;
}): {
  panelTextWhitelistMismatchCount: number;
  userEditDialogueMismatchCount: number;
} {
  const visibility = resolveScenePresentationVisibility({
    contentKind: opts.contentKind,
    castManifest: opts.castManifest,
  });
  const whitelist = collectApprovedComicText(opts.plan, visibility);
  const whitelistSet = new Set(whitelist);
  const panelCount = opts.panelCount ?? opts.plan.panels.length;
  const width = opts.width ?? 1008;
  const height = opts.height ?? (panelCount === 4 ? 1824 : 1408);
  const subjects = bindChatImageReferencePack({
    subjectsInImageOrder: buildChatDuoVisualSubjects({
      characterName: opts.characterName,
      characterGender: "male",
      characterImageUrl: "/character-ref",
      characterSavedAppearance: "",
      characterAppearanceMode: "image_only",
      personaName: opts.personaName,
      personaGender: "female",
      personaImageUrl: "/persona-ref",
      personaSavedAppearance: "",
      personaAppearanceMode: "image_only",
    }),
  }).subjects;
  const overlayTexts = collectFinalOverlayBubbleTexts({
    width,
    height,
    panelCount,
    plan: opts.plan,
    visibility,
    subjects,
  });
  const overlaySet = new Set(overlayTexts);
  let panelTextWhitelistMismatchCount = 0;
  for (const text of overlaySet) {
    if (!whitelistSet.has(text)) panelTextWhitelistMismatchCount += 1;
  }
  for (const text of whitelistSet) {
    if (!overlaySet.has(text)) panelTextWhitelistMismatchCount += 1;
  }
  const userEditDialogueMismatchCount = countUserEditDialogueMismatch(
    opts.plan,
    overlayTexts
  );
  return { panelTextWhitelistMismatchCount, userEditDialogueMismatchCount };
}

/** Counts user-edited dialogue lines whose text is missing from final visible bubbles. */
export function countUserEditDialogueMismatch(
  plan: ScenePlan,
  finalBubbleTexts: Iterable<string>
): number {
  const bubbleSet = new Set(finalBubbleTexts);
  let count = 0;
  for (const panel of plan.panels) {
    for (const line of panel.dialogue) {
      if (line.provenance !== "user_edit" || !line.text.trim()) continue;
      if (!bubbleSet.has(line.text)) count += 1;
    }
  }
  return count;
}
