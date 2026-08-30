import {
  CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_LEGACY_MODEL,
  CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_MODEL,
  CHEAPER_INFERENCE_GPT_56_LUNA_MODEL,
  OPENROUTER_DEEPSEEK_V3_MODEL,
  OPENROUTER_DEEPSEEK_V4_FLASH_0731_BACKUP_MODEL,
  OPENROUTER_DEEPSEEK_V4_FLASH_MODEL,
  OPENROUTER_GEMINI_31_FLASH_MODEL,
  isCheaperInferenceModel,
} from "@/lib/chatModels";

const STALE_SCENE_PRIMARY_ALIASES = new Set([
  CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_MODEL.toLowerCase(),
  CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_LEGACY_MODEL.toLowerCase(),
  OPENROUTER_DEEPSEEK_V4_FLASH_MODEL.toLowerCase(),
  OPENROUTER_DEEPSEEK_V4_FLASH_0731_BACKUP_MODEL.toLowerCase(),
  OPENROUTER_DEEPSEEK_V3_MODEL.toLowerCase(),
  "deepseek-v4-flash",
  "deepseek/deepseek-v4-flash",
]);

export const CHAT_IMAGE_SCENE_BRIEF_DEFAULT_MODEL =
  CHEAPER_INFERENCE_GPT_56_LUNA_MODEL;
export const CHAT_IMAGE_SCENE_BRIEF_FALLBACK_MODEL = OPENROUTER_GEMINI_31_FLASH_MODEL;

const STALE_SCENE_FALLBACK_ALIASES = new Set([
  OPENROUTER_DEEPSEEK_V4_FLASH_0731_BACKUP_MODEL.toLowerCase(),
  OPENROUTER_DEEPSEEK_V3_MODEL.toLowerCase(),
  OPENROUTER_DEEPSEEK_V4_FLASH_MODEL.toLowerCase(),
  CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_MODEL.toLowerCase(),
  CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_LEGACY_MODEL.toLowerCase(),
]);
/** Soft guardrail only — full turns can exceed 5k chars; do not truncate hard. */
export const CHAT_IMAGE_SCENE_BRIEF_MAX_SOURCE_CHARS = 24_000;

export function resolveChatImageSceneBriefModel(
  env: NodeJS.ProcessEnv = process.env
): string {
  const raw =
    env.CHAT_IMAGE_SCENE_BRIEF_MODEL?.trim() ||
    CHAT_IMAGE_SCENE_BRIEF_DEFAULT_MODEL;
  if (!raw || STALE_SCENE_PRIMARY_ALIASES.has(raw.toLowerCase())) {
    return CHEAPER_INFERENCE_GPT_56_LUNA_MODEL;
  }
  return raw;
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
  if (STALE_SCENE_FALLBACK_ALIASES.has(trimmed.toLowerCase())) {
    return CHAT_IMAGE_SCENE_BRIEF_FALLBACK_MODEL;
  }
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
 * Spoken-word helper for dialogue provenance lock.
 * Does not filter Scene Builder source rows — source keeps actions + dialogue.
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
