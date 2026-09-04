/**
 * Client-safe comic generation constants and pricing helpers.
 * No sharp, overlay compositing, or server-only image pipeline imports.
 */

import type { ScenePanelCount } from "@/lib/chatImageScenePlan";
import { CHAT_ROOM_IMAGE_GENERATION_POINTS } from "@/lib/chatImagePricing";

export const CHAT_COMIC_TEMPLATE_ID = "comic_horizontal_2_4" as const;
export const CHAT_COMIC_TEMPLATE_NAME = "2~4컷 가로 만화";
export const CHAT_COMIC_TEMPLATE_PREVIEW_URL =
  "/image-templates/comic-vertical-sample-hq.webp";

/** Soft guardrail for pasted prose — selected-turn summaries are not truncated. */
export const CHAT_COMIC_MAX_INPUT_CHARS = 4_000;
export const CHAT_COMIC_IMAGE_OUTPUT_SIZE = "1008x1408" as const;
/** Promoted four-panel page size for the canonical 2|3|4 panel count. */
export const CHAT_COMIC_FOUR_PANEL_OUTPUT_SIZE = "864x1824" as const;
export const CHAT_COMIC_GENERATION_DEFAULT_POINTS = CHAT_ROOM_IMAGE_GENERATION_POINTS;

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
  _env: NodeJS.ProcessEnv = process.env
): number {
  return CHAT_COMIC_GENERATION_DEFAULT_POINTS;
}
