/**
 * SD couple profile stamps — fixed circular template, one motif per generation.
 * Preview sheet shows all four motifs; user picks one plus height/decor options.
 */

export const CHAT_COUPLE_STAMP_TEMPLATE_ID = "couple_stamps_4" as const;
export const CHAT_COUPLE_STAMP_TEMPLATE_NAME = "커플 인장";
export const CHAT_COUPLE_STAMP_TEMPLATE_PREVIEW_URL =
  "/image-templates/sd-couple-stamps-4.png";

export const CHAT_COUPLE_STAMP_GENERATION_DEFAULT_POINTS = 220;
/** gpt-image-2 requires edges as multiples of 16 — nearest valid square to 1000. */
export const CHAT_COUPLE_STAMP_API_OUTPUT_WIDTH = 1008;
export const CHAT_COUPLE_STAMP_API_OUTPUT_HEIGHT = 1008;
export const CHAT_COUPLE_STAMP_API_OUTPUT_SIZE =
  `${CHAT_COUPLE_STAMP_API_OUTPUT_WIDTH}x${CHAT_COUPLE_STAMP_API_OUTPUT_HEIGHT}` as const;
export const CHAT_COUPLE_STAMP_OUTPUT_WIDTH = 1000;
export const CHAT_COUPLE_STAMP_OUTPUT_HEIGHT = 1000;
export const CHAT_COUPLE_STAMP_QUALITY = "medium" as const;

/** Four fixed motifs matching the template contact sheet (TL, TR, BL, BR). */
export const CHAT_COUPLE_STAMP_MOTIFS = [
  {
    id: "cat_paws",
    label: "고양이 발바닥",
    sheetCell: "TOP LEFT",
    prompt:
      "clean bold-line chibi selfie. Both wear matching cat ears and hold oversized cat-paw mittens toward the camera. Soft peach circular background with tiny paw prints and sparkles. This is the only motif that may include cat ears or paw mittens.",
  },
  {
    id: "plush_hug",
    label: "인형 포옹",
    sheetCell: "TOP RIGHT",
    prompt:
      "soft pastel watercolor chibi. No animal ears, animal hood, or paw gloves. Each holds a plush toy (teddy bear and bunny with tiny ribbons). Soft lavender circular background with small floating hearts.",
  },
  {
    id: "bunny_hand_heart",
    label: "토끼 후드 손하트",
    sheetCell: "BOTTOM LEFT",
    prompt:
      "retro sticker/doodle chibi. Both wear loose bunny-ear hoodies and form one small hand-heart together with bare hands in the center. Soft mint/teal circular background with stars. No cat ears and no paw gloves.",
  },
  {
    id: "cheek_closeup",
    label: "볼 밀착 클로즈업",
    sheetCell: "BOTTOM RIGHT",
    prompt:
      "glossy premium mini-anime extreme close-up. No animal ears, animal hood, paw gloves, or plush animals. Faces fill most of the circle, cheeks pressed together affectionately, one hand gently on the other's cheek. Soft pink circular background with hearts, sparkles, and a decorative ribbon along the lower edge.",
  },
] as const;

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
    id: "motif_default",
    label: "모티프 기본",
    prompt: "Keep the soft circular pastel background color family of the chosen motif cell.",
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

export const CHAT_COUPLE_STAMP_ANIMAL_EARS = [
  {
    id: "motif_default",
    label: "모티프 기본",
    prompt:
      "Follow the chosen motif's animal-ear rules exactly — do not add ears when the motif forbids them.",
  },
  {
    id: "none",
    label: "동물귀 없음",
    prompt:
      "No animal ears of any kind on either person, even if the motif usually has them. Keep hoods without ear tips if needed.",
  },
  {
    id: "cat",
    label: "고양이귀",
    prompt:
      "Add matching soft cat ears on both people if it does not conflict with an extreme close-up crop. Never add paw mittens unless the motif is cat paws.",
  },
  {
    id: "bunny",
    label: "토끼귀",
    prompt:
      "Add matching soft bunny ears (or bunny-ear hood tips) on both people if framing allows. Never add cat-paw mittens.",
  },
] as const;

export type ChatCoupleStampMotif = (typeof CHAT_COUPLE_STAMP_MOTIFS)[number]["id"];
export type ChatCoupleStampHeight = (typeof CHAT_COUPLE_STAMP_HEIGHTS)[number]["id"];
export type ChatCoupleStampBackground =
  (typeof CHAT_COUPLE_STAMP_BACKGROUNDS)[number]["id"];
export type ChatCoupleStampBorder = (typeof CHAT_COUPLE_STAMP_BORDERS)[number]["id"];
export type ChatCoupleStampAnimalEars =
  (typeof CHAT_COUPLE_STAMP_ANIMAL_EARS)[number]["id"];

export type ChatCoupleStampOptions = {
  motif: ChatCoupleStampMotif;
  height: ChatCoupleStampHeight;
  background: ChatCoupleStampBackground;
  border: ChatCoupleStampBorder;
  animalEars: ChatCoupleStampAnimalEars;
};

export const CHAT_COUPLE_STAMP_DEFAULT_OPTIONS: ChatCoupleStampOptions = {
  motif: "cat_paws",
  height: "same",
  background: "motif_default",
  border: "none",
  animalEars: "motif_default",
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
  return {
    motif: oneOf(raw?.motif, CHAT_COUPLE_STAMP_MOTIFS, CHAT_COUPLE_STAMP_DEFAULT_OPTIONS.motif),
    height: oneOf(
      raw?.height,
      CHAT_COUPLE_STAMP_HEIGHTS,
      CHAT_COUPLE_STAMP_DEFAULT_OPTIONS.height
    ),
    background: oneOf(
      raw?.background,
      CHAT_COUPLE_STAMP_BACKGROUNDS,
      CHAT_COUPLE_STAMP_DEFAULT_OPTIONS.background
    ),
    border: oneOf(
      raw?.border,
      CHAT_COUPLE_STAMP_BORDERS,
      CHAT_COUPLE_STAMP_DEFAULT_OPTIONS.border
    ),
    animalEars: oneOf(
      raw?.animalEars,
      CHAT_COUPLE_STAMP_ANIMAL_EARS,
      CHAT_COUPLE_STAMP_DEFAULT_OPTIONS.animalEars
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
  const motif = CHAT_COUPLE_STAMP_MOTIFS.find((item) => item.id === options.motif)!;

  return [
    "Create ONE polished square circular couple profile icon / seal stamp for Twitter/X or community profiles.",
    "Output a single centered circular badge on a clean square canvas with generous social-profile safe margins. Do NOT create a 2-by-2 contact sheet.",
    "Reference image 1 is the fixed layout and finish reference (four-motif sample sheet). Match the illustration finish and circular badge craft of the chosen cell only. Do not copy its people.",
    `Use ONLY the ${motif.sheetCell} cell of the reference sheet as the pose/composition/finish guide: ${motif.prompt}`,
    `Reference image 2 is the identity reference for chat character ${opts.characterName}. Reference image 3 is the identity reference for user persona ${opts.personaName}.`,
    "Identity separation is critical. Preserve each person's hair color, eye color, hairstyle, facial details, accessories and signature outfit impression. Never blend, swap or duplicate the two identities.",
    `Height / face position: ${findPrompt(CHAT_COUPLE_STAMP_HEIGHTS, options.height)}`,
    `Background decoration: ${findPrompt(CHAT_COUPLE_STAMP_BACKGROUNDS, options.background)}`,
    `Border decoration: ${findPrompt(CHAT_COUPLE_STAMP_BORDERS, options.border)}`,
    `Animal-ear option: ${findPrompt(CHAT_COUPLE_STAMP_ANIMAL_EARS, options.animalEars)}`,
    "Keep both faces and important gestures fully inside the circle. Soft chibi / SD proportions, clean line art, pastel digital coloring.",
    "Exactly two people. No extra person, identity swap, merged face, text, letters, signature, logo, watermark, UI, screenshot border or cropping mark.",
  ].join("\n\n");
}

export function resolveChatCoupleStampPrice(): number {
  return CHAT_COUPLE_STAMP_GENERATION_DEFAULT_POINTS;
}
