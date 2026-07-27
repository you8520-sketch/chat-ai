export const CHAT_IMAGE_TEMPLATE_ID = "gift_box_duo" as const;
export const CHAT_IMAGE_TEMPLATE_NAME = "선물상자 2인 SD";
export const CHAT_IMAGE_TEMPLATE_PREVIEW_URL =
  "/image-templates/sd-gift-box-duo.webp";

export const CHAT_IMAGE_GENERATION_DEFAULT_MODEL = "openai/gpt-image-2";
export const CHAT_IMAGE_GENERATION_DEFAULT_POINTS = 350;

export const CHAT_COMIC_STYLE_PREVIEW_URL =
  "/image-templates/comic-horizontal-style.svg";
export const CHAT_COMIC_MAX_INPUT_CHARS = 500;
export const CHAT_COMIC_PANEL_COUNTS = [2, 3, 4] as const;
export const CHAT_COMIC_DEFAULT_PANEL_COUNT = 4 as const;
export const CHAT_COMIC_DEFAULT_MOOD = "comic" as const;
export const CHAT_COMIC_PRICE_POINTS = {
  2: 250,
  3: 300,
  4: 350,
} as const;

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

export const CHAT_COMIC_MOODS = [
  {
    id: "comic",
    label: "코믹",
    prompt: "romantic comedy timing, expressive reactions, playful visual effects",
  },
  {
    id: "lovely",
    label: "달달",
    prompt: "soft affectionate romance, warm blushes, tender close distance",
  },
  {
    id: "daily",
    label: "일상",
    prompt: "natural slice-of-life acting, grounded setting, relaxed expressions",
  },
  {
    id: "serious",
    label: "진지",
    prompt: "restrained emotional drama, cinematic acting, clear emotional progression",
  },
] as const;

export type ChatImagePlacement = (typeof CHAT_IMAGE_PLACEMENTS)[number]["id"];
export type ChatImageExpression = (typeof CHAT_IMAGE_EXPRESSIONS)[number]["id"];
export type ChatImageMood = (typeof CHAT_IMAGE_MOODS)[number]["id"];
export type ChatComicPanelCount = (typeof CHAT_COMIC_PANEL_COUNTS)[number];
export type ChatComicMood = (typeof CHAT_COMIC_MOODS)[number]["id"];
export type ChatComicSpeaker = "character" | "persona" | "narration";

export type ChatImageGenerationOptions = {
  placement: ChatImagePlacement;
  topExpression: ChatImageExpression;
  bottomExpression: ChatImageExpression;
  mood: ChatImageMood;
};

export type ChatComicDialogue = {
  speaker: ChatComicSpeaker;
  text: string;
};

export type ChatComicPanelPlan = {
  panel: number;
  scene: string;
  dialogue: ChatComicDialogue[];
  characterExpression: string;
  personaExpression: string;
  caption: string;
};

export type ChatComicPlan = {
  title: string;
  panels: ChatComicPanelPlan[];
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

function compactText(raw: unknown, maxChars: number): string {
  return String(raw ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxChars);
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

export function sanitizeChatComicPanelCount(raw: unknown): ChatComicPanelCount {
  const value = Number(raw);
  return CHAT_COMIC_PANEL_COUNTS.includes(value as ChatComicPanelCount)
    ? (value as ChatComicPanelCount)
    : CHAT_COMIC_DEFAULT_PANEL_COUNT;
}

export function sanitizeChatComicMood(raw: unknown): ChatComicMood {
  return oneOf(raw, CHAT_COMIC_MOODS, CHAT_COMIC_DEFAULT_MOOD) as ChatComicMood;
}

export function resolveChatComicGenerationPrice(panelCount: ChatComicPanelCount): number {
  return CHAT_COMIC_PRICE_POINTS[panelCount];
}

function promptForExpression(id: ChatImageExpression): string {
  return CHAT_IMAGE_EXPRESSIONS.find((item) => item.id === id)?.prompt ?? "soft smile";
}

function promptForMood(id: ChatImageMood): string {
  return CHAT_IMAGE_MOODS.find((item) => item.id === id)?.prompt ?? "lovely pastel mood";
}

function promptForComicMood(id: ChatComicMood): string {
  return CHAT_COMIC_MOODS.find((item) => item.id === id)?.prompt ?? "natural comic acting";
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

export function normalizeChatComicPlan(
  raw: unknown,
  panelCount: ChatComicPanelCount
): ChatComicPlan {
  if (!raw || typeof raw !== "object") {
    throw new Error("컷 구성 응답이 올바르지 않습니다.");
  }
  const record = raw as { title?: unknown; panels?: unknown };
  if (!Array.isArray(record.panels) || record.panels.length < panelCount) {
    throw new Error("요청한 컷 수만큼 장면을 구성하지 못했습니다.");
  }

  const panels = record.panels.slice(0, panelCount).map((item, index): ChatComicPanelPlan => {
    if (!item || typeof item !== "object") {
      throw new Error("컷 장면 정보가 올바르지 않습니다.");
    }
    const panel = item as {
      scene?: unknown;
      dialogue?: unknown;
      characterExpression?: unknown;
      personaExpression?: unknown;
      caption?: unknown;
    };
    const dialogue = Array.isArray(panel.dialogue)
      ? panel.dialogue
          .slice(0, 2)
          .map((entry): ChatComicDialogue | null => {
            if (!entry || typeof entry !== "object") return null;
            const d = entry as { speaker?: unknown; text?: unknown };
            const speakerRaw = String(d.speaker ?? "");
            const speaker: ChatComicSpeaker =
              speakerRaw === "persona" || speakerRaw === "narration"
                ? speakerRaw
                : "character";
            const text = compactText(d.text, 48);
            return text ? { speaker, text } : null;
          })
          .filter((entry): entry is ChatComicDialogue => entry != null)
      : [];

    const scene = compactText(panel.scene, 280);
    if (!scene) throw new Error(`${index + 1}컷 장면 설명이 비어 있습니다.`);

    return {
      panel: index + 1,
      scene,
      dialogue,
      characterExpression: compactText(panel.characterExpression, 70),
      personaExpression: compactText(panel.personaExpression, 70),
      caption: compactText(panel.caption, 56),
    };
  });

  return {
    title: compactText(record.title, 40) || `${panelCount}컷 만화`,
    panels,
  };
}

export function buildChatComicImagePrompt(opts: {
  characterName: string;
  personaName: string;
  panelCount: ChatComicPanelCount;
  mood: ChatComicMood;
  plan: ChatComicPlan;
}): string {
  const panelBlocks = opts.plan.panels.map((panel) => {
    const dialogue =
      panel.dialogue.length > 0
        ? panel.dialogue
            .map((line) => {
              const speaker =
                line.speaker === "character"
                  ? opts.characterName
                  : line.speaker === "persona"
                    ? opts.personaName
                    : "내레이션";
              return `- ${speaker}: ${JSON.stringify(line.text)}`;
            })
            .join("\n")
        : "- 대사 없음";
    return [
      `PANEL ${panel.panel}`,
      `- 장면: ${panel.scene}`,
      `- ${opts.characterName} 표정: ${panel.characterExpression || "장면에 맞는 자연스러운 표정"}`,
      `- ${opts.personaName} 표정: ${panel.personaExpression || "장면에 맞는 자연스러운 표정"}`,
      `- 대사/말풍선:\n${dialogue}`,
      `- 내레이션 상자: ${panel.caption || "없음"}`,
    ].join("\n");
  });

  return [
    `Create one polished Korean comic page with exactly ${opts.panelCount} wide horizontal panels stacked vertically.`,
    "Reference image 1 is ONLY a layout, rendering-quality, speech-bubble and emotional-staging example. Ignore and replace every character, outfit, background detail and every existing letter shown in reference image 1. Never copy its old dialogue.",
    `Reference image 2 is the identity reference for the chat character, ${opts.characterName}. Reference image 3 is the identity reference for the user persona, ${opts.personaName}.`,
    "Keep the two identities separate across every panel. Preserve each person's hair color, eye color, hairstyle, facial features, accessories and signature outfit impression. Exactly two recurring human characters; no extra people and no identity swapping.",
    `Overall direction: ${promptForComicMood(opts.mood)}. Use clean full-color Korean manhwa/webtoon rendering, readable panel gutters, natural acting, varied camera distance and expressive reaction shots.`,
    "The Korean dialogue below is FINAL COPY. Render every supplied Korean syllable exactly as written. Do not paraphrase, translate, invent, omit or duplicate dialogue. Put dialogue in clean white speech balloons with tails pointing to the correct speaker. Put caption text only in a small rectangular narration box.",
    "Keep balloons away from faces and hands. Use at most two dialogue balloons per panel. Do not add logos, signatures or watermarks.",
    `Comic title for metadata only (do not print it unless there is ample clean space): ${opts.plan.title}`,
    ...panelBlocks,
  ].join("\n\n");
}

export function resolveChatImageGenerationPrice(
  env: NodeJS.ProcessEnv = process.env
): number {
  const raw = Number(env.CHAT_IMAGE_GENERATION_POINTS);
  if (!Number.isFinite(raw) || raw < 1) return CHAT_IMAGE_GENERATION_DEFAULT_POINTS;
  return Math.ceil(raw);
}

export function resolveChatImageGenerationModel(
  env: NodeJS.ProcessEnv = process.env
): string {
  return env.OPENROUTER_IMAGE_MODEL?.trim() || CHAT_IMAGE_GENERATION_DEFAULT_MODEL;
}
