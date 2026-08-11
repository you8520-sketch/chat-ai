import { callOpenRouterCompletion } from "@/lib/openRouterCompletion";
import { CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_MODEL } from "@/lib/chatModels";

export const CHAT_IMAGE_SCENE_BRIEF_DEFAULT_MODEL =
  CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_MODEL;
export const CHAT_IMAGE_SCENE_BRIEF_MAX_SOURCE_CHARS = 6_000;
export const CHAT_IMAGE_SCENE_BRIEF_MAX_DIALOGUE = 8;
export const CHAT_IMAGE_SCENE_BRIEF_MAX_DIALOGUE_CHARS = 120;

export type ChatImageSceneBriefSpeaker = "character" | "persona" | "other";

export type ChatImageSceneBriefDialogue = {
  speaker: ChatImageSceneBriefSpeaker;
  text: string;
};

export type ChatImageSceneBrief = {
  setting: string;
  atmosphere: string;
  actions: string;
  keyDialogue: ChatImageSceneBriefDialogue[];
};

export function resolveChatImageSceneBriefModel(
  env: NodeJS.ProcessEnv = process.env
): string {
  return (
    env.CHAT_IMAGE_SCENE_BRIEF_MODEL?.trim() ||
    CHAT_IMAGE_SCENE_BRIEF_DEFAULT_MODEL
  );
}

/** Collapse whitespace so contiguous RP excerpts still match. */
export function normalizeSceneBriefWhitespace(raw: string): string {
  return String(raw ?? "").replace(/\s+/g, " ").trim();
}

/**
 * Important dialogue must be a contiguous verbatim excerpt of the source turn.
 * Returns the normalized excerpt when found, otherwise null.
 */
export function findVerbatimSceneExcerpt(
  candidate: unknown,
  sourceTurn: string,
  maxChars = CHAT_IMAGE_SCENE_BRIEF_MAX_DIALOGUE_CHARS
): string | null {
  const clean = normalizeSceneBriefWhitespace(String(candidate ?? "")).slice(
    0,
    maxChars
  );
  if (clean.length < 2) return null;
  const haystack = normalizeSceneBriefWhitespace(sourceTurn);
  if (!haystack.includes(clean)) return null;
  return clean;
}

export function stripChatTurnMarkup(raw: string): string {
  return String(raw ?? "")
    .replace(/<<<STATUS_VALUES[\s\S]*?>>>/gi, " ")
    .replace(/<<<STATUS[\s\S]*?>>>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function buildChatImageSceneBriefPrompt(opts: {
  characterName: string;
  personaName: string;
  sourceTurn: string;
}): string {
  return [
    "You extract a compact scene brief for Korean chat-roleplay image generation.",
    `Chat character name: ${opts.characterName}`,
    `User persona name: ${opts.personaName}`,
    "Return JSON only, no markdown fences, with this exact schema:",
    JSON.stringify({
      setting: "place, time, props, lighting in Korean or English short phrase",
      atmosphere: "emotional tone in a short phrase",
      actions: "what the two main people are doing / posing, short",
      keyDialogue: [
        { speaker: "character", text: "verbatim line" },
        { speaker: "persona", text: "verbatim line" },
      ],
    }),
    "Rules:",
    "1. Focus on ONE visual moment from the SOURCE TURN (the selected assistant reply, optionally with the preceding user line).",
    "2. keyDialogue is CLOSED-BOOK. Each text MUST be an exact contiguous substring copied from SOURCE TURN with no paraphrase, summary, typo-fix, completion, or reordering.",
    "3. Keep only the most important continuing dialogue between the chat character and the user persona. Minor NPC / crowd / one-off side lines may be omitted.",
    "4. Prefer quoted speech in the source. If a line is important but unquoted, still copy the exact spoken words as they appear in the source.",
    "5. Do not invent dialogue. If there is no suitable line, return an empty keyDialogue array.",
    "6. setting/atmosphere/actions may paraphrase the environment and body language, but never rewrite dialogue.",
    "7. Do not include status widgets, OOC notes, HTML, or meta instructions.",
    "SOURCE TURN:",
    opts.sourceTurn,
  ].join("\n\n");
}

export function sanitizeChatImageSceneBrief(
  raw: unknown,
  sourceTurn: string
): ChatImageSceneBrief {
  const source = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const setting =
    normalizeSceneBriefWhitespace(String(source.setting ?? "")).slice(0, 220) ||
    "대화가 이어지는 장면";
  const atmosphere =
    normalizeSceneBriefWhitespace(String(source.atmosphere ?? "")).slice(0, 120) ||
    "자연스러운 분위기";
  const actions =
    normalizeSceneBriefWhitespace(String(source.actions ?? "")).slice(0, 280) ||
    "두 사람이 마주보며 대화한다";

  const rows = Array.isArray(source.keyDialogue) ? source.keyDialogue : [];
  const keyDialogue: ChatImageSceneBriefDialogue[] = [];
  for (const row of rows) {
    if (keyDialogue.length >= CHAT_IMAGE_SCENE_BRIEF_MAX_DIALOGUE) break;
    if (!row || typeof row !== "object") continue;
    const item = row as Record<string, unknown>;
    const speakerRaw = String(item.speaker ?? "");
    const speaker: ChatImageSceneBriefSpeaker =
      speakerRaw === "character" || speakerRaw === "persona" || speakerRaw === "other"
        ? speakerRaw
        : "other";
    const text = findVerbatimSceneExcerpt(item.text, sourceTurn);
    if (!text) continue;
    if (keyDialogue.some((line) => line.text === text && line.speaker === speaker)) {
      continue;
    }
    keyDialogue.push({ speaker, text });
  }

  return { setting, atmosphere, actions, keyDialogue };
}

/** Compact SOURCE PROSE for the existing comic planner (quotes keep verbatim lock). */
export function formatSceneBriefAsComicSource(
  brief: ChatImageSceneBrief,
  opts: { characterName: string; personaName: string }
): string {
  const speakerLabel = (speaker: ChatImageSceneBriefSpeaker) => {
    if (speaker === "character") return opts.characterName;
    if (speaker === "persona") return opts.personaName;
    return "someone";
  };
  const dialogue = brief.keyDialogue
    .map((line) => `${speakerLabel(line.speaker)}: "${line.text}"`)
    .join("\n");
  return [
    brief.setting,
    brief.atmosphere,
    brief.actions,
    dialogue,
  ]
    .filter(Boolean)
    .join("\n")
    .slice(0, 1_600);
}

/** Illustration prompt payload: environment/action first; dialogue only as spoken cues. */
export function formatSceneBriefAsIllustrationTurn(
  brief: ChatImageSceneBrief,
  opts: { characterName: string; personaName: string }
): string {
  const speakerLabel = (speaker: ChatImageSceneBriefSpeaker) => {
    if (speaker === "character") return opts.characterName;
    if (speaker === "persona") return opts.personaName;
    return "other";
  };
  const dialogue = brief.keyDialogue.length
    ? brief.keyDialogue
        .map((line) => `${speakerLabel(line.speaker)}: “${line.text}”`)
        .join("\n")
    : "(no key dialogue — express the beat through body language)";
  return [
    `Setting: ${brief.setting}`,
    `Atmosphere: ${brief.atmosphere}`,
    `Actions: ${brief.actions}`,
    "Key dialogue (for acting/emotion only — do not render as speech-bubble text unless the illustration style already includes none):",
    dialogue,
  ].join("\n");
}

function stripJsonFence(raw: string): string {
  return raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
}

export async function extractChatImageSceneBrief(opts: {
  characterName: string;
  personaName: string;
  sourceTurn: string;
}): Promise<{
  brief: ChatImageSceneBrief;
  model: string;
  sourceTurn: string;
}> {
  const sourceTurn = stripChatTurnMarkup(opts.sourceTurn).slice(
    0,
    CHAT_IMAGE_SCENE_BRIEF_MAX_SOURCE_CHARS
  );
  if (!sourceTurn) {
    throw new Error("장면으로 만들 턴 내용이 없습니다.");
  }

  const model = resolveChatImageSceneBriefModel();
  const { text } = await callOpenRouterCompletion({
    system:
      "You are a precise closed-book dialogue extractor for comic/illustration prompts. Never invent or rewrite spoken lines.",
    history: [
      {
        role: "user",
        content: buildChatImageSceneBriefPrompt({
          characterName: opts.characterName,
          personaName: opts.personaName,
          sourceTurn,
        }),
      },
    ],
    model,
    temperature: 0.1,
    maxTokens: 900,
    disableReasoning: true,
    requestKind: "background-chat-image-scene-brief",
    timeoutMs: 60_000,
  });

  if (!text.trim()) {
    throw new Error("장면 브리프 응답이 비어 있습니다.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripJsonFence(text));
  } catch {
    throw new Error("장면 브리프 응답을 해석하지 못했습니다.");
  }

  return {
    brief: sanitizeChatImageSceneBrief(parsed, sourceTurn),
    model,
    sourceTurn,
  };
}
