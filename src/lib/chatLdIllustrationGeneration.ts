export const CHAT_LD_ILLUSTRATION_TEMPLATE_ID = "current_turn_ld_illustration" as const;
export const CHAT_LD_ILLUSTRATION_TEMPLATE_NAME = "현재 턴 2:3 LD 일러스트";
export const CHAT_LD_ILLUSTRATION_OUTPUT_SIZE = "800x1200" as const;
export const CHAT_LD_ILLUSTRATION_QUALITY = "medium" as const;
export const CHAT_LD_ILLUSTRATION_DEFAULT_POINTS = 200;

export function resolveChatLdIllustrationPrice(
  env: NodeJS.ProcessEnv = process.env
): number {
  const override = Number(env.CHAT_LD_ILLUSTRATION_POINTS);
  if (Number.isFinite(override) && override >= 1) return Math.ceil(override);
  return CHAT_LD_ILLUSTRATION_DEFAULT_POINTS;
}

export function buildChatLdIllustrationPrompt(opts: {
  characterName: string;
  personaName: string;
  currentTurn: string;
}) {
  return [
    "Create one polished vertical 2:3 Korean character illustration, not a comic page.",
    `Reference image 1 is the identity and art-style reference for ${opts.characterName}, the chat character.`,
    `Reference image 2 is the identity and art-style reference for ${opts.personaName}, the user persona.`,
    "Depict the current chat turn below as one cinematic, emotionally accurate scene.",
    "Keep both identities clearly separate and highly recognizable. Preserve each person's face, hairstyle, hair color, eye color, body impression, outfit details, accessories, and distinguishing traits.",
    "Match the drawing style, line quality, coloring, facial design, and overall finish of the supplied character references as closely as possible. If the two references differ, harmonize them into one coherent polished style without changing either identity.",
    "Use natural body language, facial expressions, camera framing, props, lighting, and background that accurately express the current situation.",
    "Show exactly these two people. Do not add extra people, duplicates, split panels, borders, speech bubbles, captions, sound effects, signatures, logos, or watermarks.",
    "Compose for a vertical 2:3 profile-friendly illustration around 800 by 1200 pixels. Keep important faces and gestures away from the outer crop edges.",
    "",
    "CURRENT CHAT TURN:",
    opts.currentTurn,
  ].join("\n");
}
