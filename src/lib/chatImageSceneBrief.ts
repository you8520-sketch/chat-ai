import { callOpenRouterCompletion } from "@/lib/openRouterCompletion";
import {
  CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_MODEL,
  OPENROUTER_DEEPSEEK_V4_FLASH_0731_BACKUP_MODEL,
  isCheaperInferenceModel,
  normalizeDeepSeekV4FlashModelId,
} from "@/lib/chatModels";

export const CHAT_IMAGE_SCENE_BRIEF_DEFAULT_MODEL =
  CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_MODEL;
export const CHAT_IMAGE_SCENE_BRIEF_FALLBACK_MODEL =
  OPENROUTER_DEEPSEEK_V4_FLASH_0731_BACKUP_MODEL;
/** Soft guardrail only — full turns can exceed 5k chars; do not truncate hard. */
export const CHAT_IMAGE_SCENE_BRIEF_MAX_SOURCE_CHARS = 24_000;
export const CHAT_IMAGE_SCENE_BRIEF_MAX_DIALOGUE = 8;

export type ChatImageSceneBriefSpeaker = "character" | "persona" | "other";

export type ChatImageSceneBriefDialogue = {
  speaker: ChatImageSceneBriefSpeaker;
  text: string;
};

export type ChatImageSceneBrief = {
  setting: string;
  atmosphere: string;
  actions: string;
  /** Facial expressions and body language for both people. */
  expressions: string;
  keyDialogue: ChatImageSceneBriefDialogue[];
  /** Verbatim unquoted narration / inner-thought lines for caption boxes. */
  keyNarration: string[];
};

export function resolveChatImageSceneBriefModel(
  env: NodeJS.ProcessEnv = process.env
): string {
  return normalizeDeepSeekV4FlashModelId(
    env.CHAT_IMAGE_SCENE_BRIEF_MODEL?.trim() ||
      CHAT_IMAGE_SCENE_BRIEF_DEFAULT_MODEL
  );
}

/** OpenRouter fallback used when the CheaperInference primary is slow/failing. */
export function resolveChatImageSceneBriefFallbackModel(
  env: NodeJS.ProcessEnv = process.env,
  primaryModelId: string = resolveChatImageSceneBriefModel(env)
): string | null {
  if (!isCheaperInferenceModel(primaryModelId)) return null;
  const raw = env.CHAT_IMAGE_SCENE_BRIEF_FALLBACK_MODEL;
  if (raw == null) return CHAT_IMAGE_SCENE_BRIEF_FALLBACK_MODEL;
  const trimmed = String(raw).trim();
  if (!trimmed) return CHAT_IMAGE_SCENE_BRIEF_FALLBACK_MODEL;
  if (trimmed.toLowerCase() === primaryModelId.toLowerCase()) return null;
  return trimmed;
}

/** Collapse whitespace so contiguous RP excerpts still match. */
export function normalizeSceneBriefWhitespace(raw: string): string {
  return String(raw ?? "").replace(/\s+/g, " ").trim();
}

/** RP action / narration markers that must not be treated as spoken dialogue. */
export function isSceneActionText(text: string): boolean {
  const trimmed = normalizeSceneBriefWhitespace(text);
  return (
    /^\*[^*]+\*$/.test(trimmed) ||
    /^\([^)]+\)$/.test(trimmed) ||
    /^（[^）]+）$/.test(trimmed)
  );
}

/**
 * Keep only spoken words from a user RP turn.
 * Strips *지문*, (지문), （지문） — those are stage directions, not dialogue.
 */
export function extractUserSpokenDialogue(content: string): string {
  let text = normalizeSceneBriefWhitespace(content);
  if (!text) return "";

  const unwrap = text.match(/^[“"]([\s\S]*)[”"]$/);
  if (unwrap) {
    text = normalizeSceneBriefWhitespace(unwrap[1] ?? "");
  }

  text = text
    .replace(/\*[^*]+\*/g, " ")
    .replace(/\([^)]*\)/g, " ")
    .replace(/（[^）]*）/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!text || isSceneActionText(text)) return "";
  return text;
}

/**
 * Format user turn for comic SOURCE PROSE: quote spoken dialogue only.
 * Returns "" when the user turn has no dialogue (caller should omit the line).
 */
export function formatUserTurnForComicSource(content: string): string {
  const spoken = extractUserSpokenDialogue(content);
  if (!spoken) return "";
  return `"${spoken.replace(/"/g, '\\"')}"`;
}

/**
 * Important dialogue must be a contiguous verbatim excerpt of the source turn.
 * Returns the normalized excerpt when found, otherwise null.
 * No artificial length cap — long lines are kept intact.
 */
export function findVerbatimSceneExcerpt(
  candidate: unknown,
  sourceTurn: string
): string | null {
  const clean = normalizeSceneBriefWhitespace(String(candidate ?? ""));
  if (clean.length < 2) return null;
  const haystack = normalizeSceneBriefWhitespace(sourceTurn);
  if (!haystack.includes(clean)) return null;
  return clean;
}

/** Dialogue-specific verbatim check — rejects action / parenthetical lines. */
export function findVerbatimSceneDialogue(
  candidate: unknown,
  sourceTurn: string
): string | null {
  const clean = findVerbatimSceneExcerpt(candidate, sourceTurn);
  if (!clean) return null;
  if (isSceneActionText(clean)) return null;
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
    "You extract a rich scene brief for Korean chat-roleplay comic generation.",
    `Chat character name: ${opts.characterName}`,
    `User persona name: ${opts.personaName}`,
    "Return JSON only, no markdown fences, with this exact schema:",
    JSON.stringify({
      setting: "place, time, props, lighting, background details",
      atmosphere: "emotional tone and mood",
      actions: "what the two main people are doing / posing / approaching",
      expressions: "facial expressions and body language for both people",
      keyDialogue: [
        { speaker: "character", text: "verbatim line" },
        { speaker: "persona", text: "verbatim line" },
      ],
      keyNarration: ["verbatim unquoted narration or inner-thought line"],
    }),
    "Rules:",
    "1. Focus on ONE visual moment from the SOURCE TURN (the selected assistant reply, optionally with the preceding user line).",
    "2. keyDialogue is CLOSED-BOOK. Each text MUST be an exact contiguous substring copied from SOURCE TURN with no paraphrase, summary, typo-fix, completion, or reordering.",
    "3. Keep only the most important continuing dialogue between the chat character and the user persona. Minor NPC / crowd / one-off side lines may be omitted.",
    "4. Prefer quoted speech in the source. If a line is important but unquoted, still copy the exact spoken words as they appear in the source. Never treat RP action markers like *...* or parenthetical stage directions as spoken dialogue; those belong in keyNarration.",
    "5. Return at least 3 keyDialogue lines whenever the source has that much important dialogue, and up to 4. Include lines from BOTH the chat character and the user persona when both speak meaningfully. Do not return only one line if the turn clearly has an exchange.",
    "6. The preceding user line is part of the scene. If the user persona speaks (quoted or clearly as direct input), include at least one persona line unless it is trivial (e.g. only \"응\", \"계속\").",
    "7. Label speaker as \"character\" for lines spoken by the chat character, \"persona\" for lines spoken by the user persona, and \"other\" only for true NPC / crowd lines.",
    "8. Do not invent dialogue. If there is no suitable line, return an empty keyDialogue array.",
    "9. keyNarration is also CLOSED-BOOK. Copy at least 2 short verbatim unquoted descriptive or inner-thought lines from SOURCE TURN (no quotation marks), and up to 3. These become rectangular caption boxes.",
    "10. setting/atmosphere/actions/expressions may paraphrase the environment, body language, and facial acting, but never rewrite dialogue or narration.",
    "11. Make the brief RICH — aim for roughly 500 Korean characters total across setting, atmosphere, actions, expressions, dialogue, and narration so the comic planner has enough material.",
    "12. Do not include status widgets, OOC notes, HTML, or meta instructions.",
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
    normalizeSceneBriefWhitespace(String(source.setting ?? "")).slice(0, 320) ||
    "대화가 이어지는 장면";
  const atmosphere =
    normalizeSceneBriefWhitespace(String(source.atmosphere ?? "")).slice(0, 160) ||
    "자연스러운 분위기";
  const actions =
    normalizeSceneBriefWhitespace(String(source.actions ?? "")).slice(0, 320) ||
    "두 사람이 마주보며 대화한다";
  const expressions =
    normalizeSceneBriefWhitespace(String(source.expressions ?? "")).slice(0, 240) ||
    "자연스러운 표정";

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
    const text = findVerbatimSceneDialogue(item.text, sourceTurn);
    if (!text) continue;
    if (keyDialogue.some((line) => line.text === text && line.speaker === speaker)) {
      continue;
    }
    keyDialogue.push({ speaker, text });
  }

  // If the model returned fewer than three lines but the source clearly has more
  // quoted dialogue, backfill the most important remaining verbatim lines so
  // the comic has enough material for 3-4 panels.
  if (keyDialogue.length > 0 && keyDialogue.length < 3) {
    const quoted = extractQuotedSceneDialogue(sourceTurn);
    for (const line of quoted) {
      if (keyDialogue.length >= 3) break;
      if (keyDialogue.some((existing) => existing.text === line.text)) continue;
      keyDialogue.push(line);
    }
  }

  // If the persona never got a line but the source has a user turn with direct
  // speech, surface the user's verbatim input so the comic keeps both voices.
  const hasPersonaLine = keyDialogue.some((line) => line.speaker === "persona");
  if (!hasPersonaLine) {
    const userLine = extractUserTurnDialogue(sourceTurn);
    if (userLine) {
      const existing = keyDialogue.findIndex((line) => line.text === userLine.text);
      if (existing >= 0) {
        keyDialogue[existing] = { ...keyDialogue[existing]!, speaker: "persona" };
      } else {
        keyDialogue.push(userLine);
      }
    }
  }

  const narrationRows = Array.isArray(source.keyNarration) ? source.keyNarration : [];
  const keyNarration: string[] = [];
  for (const row of narrationRows) {
    if (keyNarration.length >= 3) break;
    const text = findVerbatimSceneExcerpt(row, sourceTurn);
    if (!text) continue;
    if (keyNarration.includes(text)) continue;
    if (keyDialogue.some((line) => line.text === text)) continue;
    keyNarration.push(text);
  }

  // Ensure at least two verbatim narration / inner-thought lines for caption
  // boxes, even when dialogue is plentiful.
  if (keyNarration.length < 2) {
    const narration = extractUnquotedSceneNarration(sourceTurn);
    for (const text of narration) {
      if (keyNarration.length >= 2) break;
      if (keyNarration.includes(text)) continue;
      if (keyDialogue.some((line) => line.text === text)) continue;
      keyNarration.push(text);
    }
  }

  // Keep dialogue and narration in the order they appear in the source turn so
  // the comic follows the actual beat sequence.
  const orderedDialogue = [...keyDialogue].sort(
    (a, b) => sourceTurn.indexOf(a.text) - sourceTurn.indexOf(b.text)
  );
  const orderedNarration = [...keyNarration].sort(
    (a, b) => sourceTurn.indexOf(a) - sourceTurn.indexOf(b)
  );

  return {
    setting,
    atmosphere,
    actions,
    expressions,
    keyDialogue: orderedDialogue,
    keyNarration: orderedNarration,
  };
}

/** Extract short verbatim unquoted narration / inner-thought lines. */
function extractUnquotedSceneNarration(sourceTurn: string): string[] {
  const stripped = sourceTurn
    .replace(/“[^”]*”|"[^"]*"|‘[^’]*’|'[^']*'/g, " ")
    .replace(/\s+/g, " ");
  const segments = stripped
    .split(/(?<=[.!?。…])\s+|\n+/)
    .map((segment) => normalizeSceneBriefWhitespace(segment))
    .filter((segment) => segment.length >= 8 && segment.length <= 220);
  const out: string[] = [];
  for (const segment of segments) {
    if (out.includes(segment)) continue;
    if (/^(유저|캐릭터):/.test(segment)) continue;
    // Skip speech-attribution fragments left after removing quoted lines.
    if (/라고\s*(말했|했|외치|물었|대답|속삭)/.test(segment)) continue;
    if (/^[가-힣a-zA-Z]{1,6}은\s/.test(segment) && segment.length < 20) continue;
    out.push(segment);
    if (out.length >= 3) break;
  }
  return out;
}

/** Pull the user turn's direct speech as a persona line when the model missed it. */
function extractUserTurnDialogue(
  sourceTurn: string
): ChatImageSceneBriefDialogue | null {
  const userMatch = sourceTurn.match(/유저:\s*([\s\S]*?)(?:\s+캐릭터:|$)/);
  const userText = normalizeSceneBriefWhitespace(userMatch?.[1] ?? "");
  if (!userText) return null;
  const quoted = extractQuotedSceneDialogue(userText);
  if (quoted.length > 0) {
    return { speaker: "persona", text: quoted[0]!.text };
  }
  // Unquoted user input is still the persona's direct line in RP chat.
  if (userText.length >= 2 && userText.length <= 400) {
    return { speaker: "persona", text: userText };
  }
  return null;
}

/** Extract quoted dialogue with a best-effort speaker guess from the source turn. */
function extractQuotedSceneDialogue(
  sourceTurn: string
): ChatImageSceneBriefDialogue[] {
  const out: ChatImageSceneBriefDialogue[] = [];
  const pattern = /“([^”]+)”|"([^"]+)"|‘([^’]+)’|'([^']+)'/g;
  for (const match of sourceTurn.matchAll(pattern)) {
    const text = normalizeSceneBriefWhitespace(
      match[1] ?? match[2] ?? match[3] ?? match[4]
    );
    if (text.length < 2) continue;
    if (isSceneActionText(text)) continue;
    if (out.some((line) => line.text === text)) continue;
    out.push({ speaker: "other", text });
    if (out.length >= CHAT_IMAGE_SCENE_BRIEF_MAX_DIALOGUE) break;
  }
  return out;
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
  const narration = brief.keyNarration.length
    ? brief.keyNarration.map((line) => `지문: ${line}`).join("\n")
    : "";
  return [
    brief.setting,
    brief.atmosphere,
    brief.actions,
    brief.expressions,
    dialogue,
    narration,
  ]
    .filter(Boolean)
    .join("\n")
    .slice(0, 1_600);
}

/** User-editable Korean summary: setting / atmosphere / actions / verbatim dialogue. */
export function formatSceneBriefAsEditableSummary(
  brief: ChatImageSceneBrief,
  opts: { characterName: string; personaName: string }
): string {
  const speakerLabel = (speaker: ChatImageSceneBriefSpeaker) => {
    if (speaker === "character") return opts.characterName;
    if (speaker === "persona") return opts.personaName;
    return "기타";
  };
  const dialogue = brief.keyDialogue.length
    ? brief.keyDialogue
        .map((line) => `${speakerLabel(line.speaker)}의 대사: "${line.text}"`)
        .join("\n")
    : "(중요 대사 없음)";
  const narration = brief.keyNarration.length
    ? brief.keyNarration.map((line) => `지문: ${line}`).join("\n")
    : "";
  return [
    `배경: ${brief.setting}`,
    `분위기: ${brief.atmosphere}`,
    `상황: ${brief.actions}`,
    `표정·몸짓: ${brief.expressions}`,
    dialogue,
    narration,
  ]
    .filter(Boolean)
    .join("\n");
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
    `Expressions: ${brief.expressions}`,
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

async function callSceneBriefModel(opts: {
  characterName: string;
  personaName: string;
  sourceTurn: string;
  model: string;
  maxTokens: number;
  timeoutMs: number;
}): Promise<string> {
  const { text } = await callOpenRouterCompletion({
    system:
      "You are a precise closed-book dialogue extractor for comic/illustration prompts. Never invent or rewrite spoken lines.",
    history: [
      {
        role: "user",
        content: buildChatImageSceneBriefPrompt({
          characterName: opts.characterName,
          personaName: opts.personaName,
          sourceTurn: opts.sourceTurn,
        }),
      },
    ],
    model: opts.model,
    temperature: 0.1,
    maxTokens: opts.maxTokens,
    disableReasoning: true,
    requestKind: "background-chat-image-scene-brief",
    timeoutMs: opts.timeoutMs,
  });
  return text;
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
  const usedModel = model;
  const text = await callSceneBriefModel({
    characterName: opts.characterName,
    personaName: opts.personaName,
    sourceTurn,
    model,
    maxTokens: 2048,
    timeoutMs: 120_000,
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
    model: usedModel,
    sourceTurn,
  };
}
