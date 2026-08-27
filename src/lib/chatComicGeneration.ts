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
import {
  collectApprovedComicText,
  formatApprovedScenePlanForComic,
} from "@/lib/chatImageScenePlan";
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
}): string {
  const approvedText = collectApprovedComicText(opts.plan);
  const subjects = defaultComicSubjects(opts);
  const multiCast = Boolean(opts.castManifest && opts.castSelected && opts.castSelected.length > 2);
  const castBlock =
    opts.castManifest && opts.castSelected?.length
      ? renderApprovedCastManifest({
          manifest: opts.castManifest,
          selected: opts.castSelected,
          subjects,
          plan: opts.plan,
        })
      : "";
  return [
    `Create one polished Korean manhwa-style page with exactly ${opts.plan.panels.length} wide horizontal panels stacked vertically.`,
    "Reference image 1 is LAYOUT AND FINISH ONLY. Follow its clean gutters, readable Korean bubbles, expressive acting, polished full-color rendering, and romantic-comedy timing, but do not copy its exact poses.",
    "Ignore the sample people drawn on reference image 1. Do not copy their gender presentation, body type, face shape, age, or hair color. Especially do not treat any pink-haired feminine sample figure as either subject.",
    castBlock,
    renderChatImageVisualIdentity({
      subjects,
      hasTemplate: true,
    }),
    multiCast
      ? renderCastGenderLock(subjects)
      : buildChatImagePairGenderLock({
          characterName: opts.characterName,
          characterGender: opts.characterGender,
          personaName: opts.personaName,
          personaGender: opts.personaGender,
        }),
    `Overall tone: ${CHAT_COMIC_MOODS.find((item) => item.id === (opts.mood ?? "comic"))?.prompt ?? "comic"}.`,
    "STRICT CLOSED TEXT WHITELIST: the only text allowed anywhere in the image is listed below. Copy each used string exactly, character for character.",
    approvedText.length
      ? approvedText.map((text) => `- “${text}”`).join("\n")
      : "- NO TEXT IS ALLOWED",
    "Never invent reaction dialogue, bridge dialogue, narration, captions, labels, titles, signs, or sound effects. Silent panels with no speech are valid. Do not create a speech bubble for a panel marked No speech bubble.",
    "Use proper speech bubbles with tails pointing to the correct speaker. Keep all approved text large, centered, uncropped, and easy to read.",
    multiCast
      ? `Exactly ${subjects.length} recurring human identities. No extra person, duplicate face, identity swap, malformed hands, watermark, or logo.`
      : "Exactly two recurring human characters. No extra person, duplicate face, identity swap, malformed hands, watermark, or logo.",
    "Keep all panel borders and the full page visible. Do not crop off speech bubbles or the last panel.",
    "APPROVED SCENE PLAN",
    formatApprovedScenePlanForComic(opts.plan),
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
}) {
  const useCast = Boolean(
    opts.castManifest &&
      opts.castManifest.subjects.filter((subject) => subject.included).length > 2
  );
  let pack: { subjects: ChatImageVisualSubject[]; referenceUrls: string[] };
  let castSelected: readonly ChatImageCastGroundedSubject[] | undefined;
  if (useCast) {
    const bound = bindApprovedCastManifest(opts.castManifest!, {
      template: {
        url: CHAT_COMIC_TEMPLATE_PREVIEW_URL,
        role: "layout template",
      },
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
    }),
  };
}
