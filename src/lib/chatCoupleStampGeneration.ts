/**
 * SD couple profile stamps — fixed 2x2 badge sheet.
 * The template sheet is reproduced as layout: all four motifs are always drawn,
 * so there is no per-motif picker. Only the two people are swapped in.
 */

import { CHAT_IMAGE_EXPRESSIONS } from "@/lib/chatImageGeneration";

export const CHAT_COUPLE_STAMP_TEMPLATE_ID = "couple_stamps_4" as const;
export const CHAT_COUPLE_STAMP_TEMPLATE_NAME = "커플 인장";
export const CHAT_COUPLE_STAMP_TEMPLATE_PREVIEW_URL =
  "/image-templates/sd-couple-stamps-4.webp";

export const CHAT_COUPLE_STAMP_GENERATION_DEFAULT_POINTS = 200;
/** gpt-image-2 requires edges as multiples of 16 — nearest valid square to 1000. */
export const CHAT_COUPLE_STAMP_API_OUTPUT_WIDTH = 1008;
export const CHAT_COUPLE_STAMP_API_OUTPUT_HEIGHT = 1008;
export const CHAT_COUPLE_STAMP_API_OUTPUT_SIZE =
  `${CHAT_COUPLE_STAMP_API_OUTPUT_WIDTH}x${CHAT_COUPLE_STAMP_API_OUTPUT_HEIGHT}` as const;
export const CHAT_COUPLE_STAMP_OUTPUT_WIDTH = 1000;
export const CHAT_COUPLE_STAMP_OUTPUT_HEIGHT = 1000;
export const CHAT_COUPLE_STAMP_QUALITY = "medium" as const;

/** Fixed 2x2 layout of the template sheet — always rendered in this order. */
export const CHAT_COUPLE_STAMP_PANELS = [
  {
    id: "cat_paws",
    prompt:
      "TOP-LEFT badge: both wear matching cat ears and raise oversized plush paw mittens toward the viewer — one dark paw, one cream paw. Light blue background with paw prints and sparkles.",
  },
  {
    id: "plush_hug",
    prompt:
      "TOP-RIGHT badge: no animal ears. They lean together and each holds a plush toy — a brown teddy bear and a white bunny, both with checkered ribbon bows. Lavender background with hearts and a bow.",
  },
  {
    id: "bunny_heart",
    prompt:
      "BOTTOM-LEFT badge: both wear soft bunny-eared hoodies and together form a single heart shape with their hands in front of their chests. Mint background with stars and comic sparkle marks.",
  },
  {
    id: "cheek_closeup",
    prompt:
      "BOTTOM-RIGHT badge: no animal ears. Tight cheek-to-cheek face close-up, faces noticeably larger and more zoomed-in than the other three badges, one hand raised near the cheek. Pink background with a heart and a ribbon.",
  },
] as const;

export const CHAT_COUPLE_STAMP_EXPRESSIONS = CHAT_IMAGE_EXPRESSIONS;

export const CHAT_COUPLE_STAMP_HEIGHTS = [
  {
    id: "same",
    label: "키 같게",
    prompt:
      "Keep both faces at the same vertical height inside the circle — equal eye-line, neither person taller.",
  },
  {
    id: "character_taller",
    label: "캐릭터 키크게",
    prompt:
      "Make the chat character visibly taller: their face sits higher in the frame than the user persona's face.",
  },
  {
    id: "persona_taller",
    label: "유저 키크게",
    prompt:
      "Make the user persona visibly taller: their face sits higher in the frame than the chat character's face.",
  },
] as const;

export const CHAT_COUPLE_STAMP_BACKGROUNDS = [
  {
    id: "default",
    label: "기본 (틀 그대로)",
    prompt:
      "Keep each badge's own template background: blue, lavender, mint and pink in that order.",
  },
  {
    id: "peach_paws",
    label: "복숭아 발바닥",
    prompt:
      "Give all four badges the same pale peach background with tiny paw prints and star sparkles.",
  },
  {
    id: "lavender_hearts",
    label: "라벤더 하트",
    prompt:
      "Give all four badges the same light lavender background with small floating pink hearts.",
  },
  {
    id: "mint_stars",
    label: "민트 별빛",
    prompt:
      "Give all four badges the same light mint/teal background with stars and soft sparkles.",
  },
  {
    id: "blush_ribbon",
    label: "블러시 리본",
    prompt:
      "Give all four badges the same soft pink background with hearts, sparkles and a gentle ribbon accent.",
  },
] as const;

export const CHAT_COUPLE_STAMP_BORDERS = [
  {
    id: "none",
    label: "테두리 없음",
    prompt: "No extra outer frame beyond each badge's clean circular edge.",
  },
  {
    id: "thin_white",
    label: "얇은 흰 테두리",
    prompt: "Add a thin clean white circular border around every badge.",
  },
  {
    id: "gold_ring",
    label: "골드 링",
    prompt: "Add a delicate thin gold ring border around every badge.",
  },
  {
    id: "ribbon_bottom",
    label: "하단 리본",
    prompt: "Add a decorative ribbon bow along the lower edge of every badge.",
  },
] as const;

export type ChatCoupleStampHeight = (typeof CHAT_COUPLE_STAMP_HEIGHTS)[number]["id"];
export type ChatCoupleStampBackground =
  (typeof CHAT_COUPLE_STAMP_BACKGROUNDS)[number]["id"];
export type ChatCoupleStampBorder = (typeof CHAT_COUPLE_STAMP_BORDERS)[number]["id"];
export type ChatCoupleStampExpression =
  (typeof CHAT_COUPLE_STAMP_EXPRESSIONS)[number]["id"];

export type ChatCoupleStampOptions = {
  height: ChatCoupleStampHeight;
  background: ChatCoupleStampBackground;
  border: ChatCoupleStampBorder;
  characterExpression: ChatCoupleStampExpression;
  personaExpression: ChatCoupleStampExpression;
};

export const CHAT_COUPLE_STAMP_DEFAULT_OPTIONS: ChatCoupleStampOptions = {
  height: "same",
  background: "default",
  border: "none",
  characterExpression: "calm",
  personaExpression: "bright",
};

function oneOf<T extends readonly { id: string }[]>(
  raw: unknown,
  choices: T,
  fallback: T[number]["id"]
): T[number]["id"] {
  const value = String(raw ?? "");
  return (choices.some((choice) => choice.id === value)
    ? value
    : fallback) as T[number]["id"];
}

export function sanitizeChatCoupleStampOptions(
  raw: Partial<Record<keyof ChatCoupleStampOptions, unknown>> | null | undefined
): ChatCoupleStampOptions {
  // Legacy "motif_default" background id from older clients → default.
  const backgroundRaw =
    raw?.background === "motif_default" ? "default" : raw?.background;
  return {
    height: oneOf(
      raw?.height,
      CHAT_COUPLE_STAMP_HEIGHTS,
      CHAT_COUPLE_STAMP_DEFAULT_OPTIONS.height
    ),
    background: oneOf(
      backgroundRaw,
      CHAT_COUPLE_STAMP_BACKGROUNDS,
      CHAT_COUPLE_STAMP_DEFAULT_OPTIONS.background
    ),
    border: oneOf(
      raw?.border,
      CHAT_COUPLE_STAMP_BORDERS,
      CHAT_COUPLE_STAMP_DEFAULT_OPTIONS.border
    ),
    characterExpression: oneOf(
      raw?.characterExpression,
      CHAT_COUPLE_STAMP_EXPRESSIONS,
      CHAT_COUPLE_STAMP_DEFAULT_OPTIONS.characterExpression
    ),
    personaExpression: oneOf(
      raw?.personaExpression,
      CHAT_COUPLE_STAMP_EXPRESSIONS,
      CHAT_COUPLE_STAMP_DEFAULT_OPTIONS.personaExpression
    ),
  };
}

function findPrompt<T extends readonly { id: string; prompt: string }[]>(
  choices: T,
  id: T[number]["id"]
): string {
  return choices.find((choice) => choice.id === id)?.prompt ?? choices[0]!.prompt;
}

export function buildChatCoupleStampPrompt(opts: {
  characterName: string;
  personaName: string;
  options?: Partial<ChatCoupleStampOptions> | null;
}): string {
  const options = sanitizeChatCoupleStampOptions(opts.options);

  return [
    "Create ONE square couple profile stamp sheet: exactly four circular badges arranged in a 2-by-2 grid on a clean white background, with even gaps and equal badge sizes.",
    "Reference image 1 is the fixed template. Reproduce its layout, its four motifs, its bold thick outlines and its soft chibi / SD illustration finish. Replace only the two people.",
    `Reference image 2 is the identity reference for chat character ${opts.characterName}. Reference image 3 is the identity reference for user persona ${opts.personaName}.`,
    "The same two people appear in all four badges. Identity separation is critical: preserve each person's hair color, eye color, hairstyle, facial details, accessories and signature outfit impression. Never blend, swap or duplicate the two identities.",
    CHAT_COUPLE_STAMP_PANELS.map((panel) => panel.prompt).join("\n"),
    `Chat character ${opts.characterName} expression in every badge: ${findPrompt(CHAT_COUPLE_STAMP_EXPRESSIONS, options.characterExpression)}.`,
    `User persona ${opts.personaName} expression in every badge: ${findPrompt(CHAT_COUPLE_STAMP_EXPRESSIONS, options.personaExpression)}.`,
    "Keep each person's chosen expression recognizable in all four badges; only small natural variation such as a wink or a wider smile is allowed.",
    `Height / face position in every badge: ${findPrompt(CHAT_COUPLE_STAMP_HEIGHTS, options.height)}`,
    `Background decoration: ${findPrompt(CHAT_COUPLE_STAMP_BACKGROUNDS, options.background)}`,
    `Border decoration: ${findPrompt(CHAT_COUPLE_STAMP_BORDERS, options.border)}`,
    "Keep both faces and important gestures fully inside each circle. Bold clean line art, pastel digital coloring, merchandise-quality kawaii finish.",
    "Exactly two people per badge and exactly four badges. No extra person, identity swap, merged face, text, letters, signature, logo, watermark, UI, screenshot border or cropping mark.",
  ].join("\n\n");
}

export function resolveChatCoupleStampPrice(): number {
  return CHAT_COUPLE_STAMP_GENERATION_DEFAULT_POINTS;
}
