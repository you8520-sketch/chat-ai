/**
 * SD couple profile stamps — fixed circular template.
 * Preview sheet is style reference only; no per-motif picker.
 */

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
    label: "기본",
    prompt: "Soft pastel circular background with light hearts and gentle sparkles.",
  },
  {
    id: "peach_paws",
    label: "복숭아 발바닥",
    prompt: "Pale peach circular background with tiny paw prints and star sparkles.",
  },
  {
    id: "lavender_hearts",
    label: "라벤더 하트",
    prompt: "Light lavender circular background with small floating pink hearts.",
  },
  {
    id: "mint_stars",
    label: "민트 별빛",
    prompt: "Light mint/teal circular background with stars and soft sparkles.",
  },
  {
    id: "blush_ribbon",
    label: "블러시 리본",
    prompt: "Soft pink circular background with hearts, sparkles, and a gentle ribbon accent.",
  },
] as const;

export const CHAT_COUPLE_STAMP_BORDERS = [
  {
    id: "none",
    label: "테두리 없음",
    prompt: "No extra outer frame beyond the clean circular badge edge.",
  },
  {
    id: "thin_white",
    label: "얇은 흰 테두리",
    prompt: "Add a thin clean white circular border around the badge.",
  },
  {
    id: "gold_ring",
    label: "골드 링",
    prompt: "Add a delicate thin gold ring border around the circular badge.",
  },
  {
    id: "ribbon_bottom",
    label: "하단 리본",
    prompt: "Add a decorative ribbon bow along the lower edge of the circle only.",
  },
] as const;

export type ChatCoupleStampHeight = (typeof CHAT_COUPLE_STAMP_HEIGHTS)[number]["id"];
export type ChatCoupleStampBackground =
  (typeof CHAT_COUPLE_STAMP_BACKGROUNDS)[number]["id"];
export type ChatCoupleStampBorder = (typeof CHAT_COUPLE_STAMP_BORDERS)[number]["id"];

export type ChatCoupleStampOptions = {
  height: ChatCoupleStampHeight;
  background: ChatCoupleStampBackground;
  border: ChatCoupleStampBorder;
};

export const CHAT_COUPLE_STAMP_DEFAULT_OPTIONS: ChatCoupleStampOptions = {
  height: "same",
  background: "default",
  border: "none",
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
    "Create ONE polished square circular couple profile icon / seal stamp for Twitter/X or community profiles.",
    "Output a single centered circular badge on a clean square canvas with generous social-profile safe margins. Do NOT create a 2-by-2 contact sheet.",
    "Reference image 1 is the fixed layout and finish reference (sample contact sheet). Match the soft chibi / SD illustration finish and circular badge craft. Do not copy its people, and do not reproduce the whole 2-by-2 sheet.",
    "Compose an affectionate couple selfie or cheek-close pose inside one circle. No animal ears, animal hoods, or paw mittens unless a held plush toy naturally includes them.",
    `Reference image 2 is the identity reference for chat character ${opts.characterName}. Reference image 3 is the identity reference for user persona ${opts.personaName}.`,
    "Identity separation is critical. Preserve each person's hair color, eye color, hairstyle, facial details, accessories and signature outfit impression. Never blend, swap or duplicate the two identities.",
    `Height / face position: ${findPrompt(CHAT_COUPLE_STAMP_HEIGHTS, options.height)}`,
    `Background decoration: ${findPrompt(CHAT_COUPLE_STAMP_BACKGROUNDS, options.background)}`,
    `Border decoration: ${findPrompt(CHAT_COUPLE_STAMP_BORDERS, options.border)}`,
    "Keep both faces and important gestures fully inside the circle. Soft chibi / SD proportions, clean line art, pastel digital coloring.",
    "Exactly two people. No extra person, identity swap, merged face, text, letters, signature, logo, watermark, UI, screenshot border or cropping mark.",
  ].join("\n\n");
}

export function resolveChatCoupleStampPrice(): number {
  return CHAT_COUPLE_STAMP_GENERATION_DEFAULT_POINTS;
}
