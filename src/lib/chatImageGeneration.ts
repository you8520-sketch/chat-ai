export const CHAT_IMAGE_TEMPLATE_ID = "gift_box_duo" as const;
export const CHAT_IMAGE_TEMPLATE_NAME = "선물상자 2인 SD";
export const CHAT_IMAGE_TEMPLATE_PREVIEW_URL =
  "/image-templates/sd-gift-box-duo.webp";

export const CHAT_IMAGE_GENERATION_DEFAULT_MODEL = "gpt-image-2";
export const CHAT_IMAGE_GENERATION_DEFAULT_POINTS = 350;
export const CHAT_IMAGE_GENERATION_OUTPUT_SIZE = "1200x800" as const;
export type ChatImageGenerationQuality = "medium" | "high";

export const CHAT_IMAGE_PLACEMENTS = [
  { id: "character_top", label: "위: 캐릭터 · 아래: 페르소나" },
  { id: "persona_top", label: "위: 페르소나 · 아래: 캐릭터" },
] as const;

export const CHAT_IMAGE_EXPRESSIONS = [
  { id: "playful", label: "장난스러움", prompt: "playful, lively smile" },
  { id: "shy", label: "수줍음", prompt: "shy smile with a gentle blush" },
  { id: "bright", label: "활짝 웃음", prompt: "bright open smile" },
  { id: "calm", label: "차분함", prompt: "calm, soft expression" },
  { id: "sleepy", label: "졸림", prompt: "cute sleepy expression" },
] as const;

export const CHAT_IMAGE_MOODS = [
  {
    id: "lovely",
    label: "러블리",
    prompt: "lovely pastel pink and sage-green accents, affectionate and sweet",
  },
  {
    id: "warm",
    label: "포근함",
    prompt: "warm cream colors, soft cozy lighting, tender and comforting",
  },
  {
    id: "anniversary",
    label: "기념일",
    prompt: "celebratory gift mood, elegant ribbons, hearts and golden sparkles",
  },
  {
    id: "playful",
    label: "장난꾸러기",
    prompt: "playful energetic mood, bouncing ribbons and cheerful decorations",
  },
] as const;

export type ChatImagePlacement = (typeof CHAT_IMAGE_PLACEMENTS)[number]["id"];
export type ChatImageExpression = (typeof CHAT_IMAGE_EXPRESSIONS)[number]["id"];
export type ChatImageMood = (typeof CHAT_IMAGE_MOODS)[number]["id"];

export type ChatImageGenerationOptions = {
  placement: ChatImagePlacement;
  topExpression: ChatImageExpression;
  bottomExpression: ChatImageExpression;
  mood: ChatImageMood;
};

export const CHAT_IMAGE_GENERATION_DEFAULT_OPTIONS: ChatImageGenerationOptions = {
  placement: "character_top",
  topExpression: "playful",
  bottomExpression: "calm",
  mood: "lovely",
};

function oneOf<T extends readonly { id: string }[]>(
  raw: unknown,
  choices: T,
  fallback: T[number]["id"]
): T[number]["id"] {
  const value = String(raw ?? "");
  return (choices.some((choice) => choice.id === value) ? value : fallback) as T[number]["id"];
}

export function sanitizeChatImageGenerationOptions(
  raw: Partial<Record<keyof ChatImageGenerationOptions, unknown>> | null | undefined
): ChatImageGenerationOptions {
  return {
    placement: oneOf(
      raw?.placement,
      CHAT_IMAGE_PLACEMENTS,
      CHAT_IMAGE_GENERATION_DEFAULT_OPTIONS.placement
    ) as ChatImagePlacement,
    topExpression: oneOf(
      raw?.topExpression,
      CHAT_IMAGE_EXPRESSIONS,
      CHAT_IMAGE_GENERATION_DEFAULT_OPTIONS.topExpression
    ) as ChatImageExpression,
    bottomExpression: oneOf(
      raw?.bottomExpression,
      CHAT_IMAGE_EXPRESSIONS,
      CHAT_IMAGE_GENERATION_DEFAULT_OPTIONS.bottomExpression
    ) as ChatImageExpression,
    mood: oneOf(
      raw?.mood,
      CHAT_IMAGE_MOODS,
      CHAT_IMAGE_GENERATION_DEFAULT_OPTIONS.mood
    ) as ChatImageMood,
  };
}

function promptForExpression(id: ChatImageExpression): string {
  return CHAT_IMAGE_EXPRESSIONS.find((item) => item.id === id)?.prompt ?? "soft smile";
}

function promptForMood(id: ChatImageMood): string {
  return CHAT_IMAGE_MOODS.find((item) => item.id === id)?.prompt ?? "lovely pastel mood";
}

export function resolveChatImageReferenceOrder(opts: {
  characterName: string;
  characterImageUrl: string;
  personaName: string;
  personaImageUrl: string;
  placement: ChatImagePlacement;
}) {
  if (opts.placement === "persona_top") {
    return {
      top: { role: "user persona" as const, name: opts.personaName, imageUrl: opts.personaImageUrl },
      bottom: { role: "chat character" as const, name: opts.characterName, imageUrl: opts.characterImageUrl },
    };
  }
  return {
    top: { role: "chat character" as const, name: opts.characterName, imageUrl: opts.characterImageUrl },
    bottom: { role: "user persona" as const, name: opts.personaName, imageUrl: opts.personaImageUrl },
  };
}

export function buildChatImageGenerationPrompt(opts: {
  characterName: string;
  personaName: string;
  placement: ChatImagePlacement;
  topExpression: ChatImageExpression;
  bottomExpression: ChatImageExpression;
  mood: ChatImageMood;
}): string {
  const topName = opts.placement === "persona_top" ? opts.personaName : opts.characterName;
  const bottomName = opts.placement === "persona_top" ? opts.characterName : opts.personaName;

  return [
    "Create one polished 4:3 two-person SD/chibi fixed-template commission illustration.",
    "Reference image 1 is the composition and decoration template. Preserve its recognizable luxury gift-box layout: a cream gift box with lace trim, sage-green ribbon and heart charm, teddy bear, bunny plush, candies, pearls, floating hearts, curling ribbons and golden sparkles on a clean pale background.",
    `Reference image 2 is the identity reference for the TOP person, ${topName}. Reference image 3 is the identity reference for the BOTTOM person, ${bottomName}.`,
    "Identity separation is critical. Do not blend the two identities. Preserve each referenced person's hair color, eye color, hairstyle, facial details, accessories and signature outfit impression while converting them into cohesive cute SD/chibi proportions.",
    `TOP person expression: ${promptForExpression(opts.topExpression)}. The top person leans over from above and gently hugs or rests both hands on the bottom person's head.`,
    `BOTTOM person expression: ${promptForExpression(opts.bottomExpression)}. The bottom person sits inside the decorative gift box with both forearms resting naturally on the box edge.`,
    `Overall mood: ${promptForMood(opts.mood)}.`,
    "Exactly two human characters. No extra person, duplicate face, merged body, swapped hair, extra hands, malformed fingers, text, signature, logo or watermark.",
    "Keep the full gift box and the surrounding decorative objects visible. Do not crop to faces only. Centered, clean, detailed, harmonious, merchandise-quality kawaii anime illustration.",
  ].join("\n\n");
}

export function resolveChatImageGenerationPrice(
  env: NodeJS.ProcessEnv = process.env
): number {
  const raw = Number(env.CHAT_IMAGE_GENERATION_POINTS);
  if (!Number.isFinite(raw) || raw < 1) return CHAT_IMAGE_GENERATION_DEFAULT_POINTS;
  return Math.ceil(raw);
}

export function resolveChatImageGenerationQuality(
  raw: unknown,
  canSelectQuality: boolean
): ChatImageGenerationQuality {
  return canSelectQuality && raw === "medium" ? "medium" : "high";
}

export function resolveChatImageGenerationModel(
  env: NodeJS.ProcessEnv = process.env
): string {
  return env.OPENAI_IMAGE_MODEL?.trim() || CHAT_IMAGE_GENERATION_DEFAULT_MODEL;
}
