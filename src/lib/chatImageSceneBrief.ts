import { resolveBackgroundPrimaryModelId } from "@/lib/ai";
import {
  CHEAPER_INFERENCE_GPT_56_LUNA_MODEL,
  OPENROUTER_DEEPSEEK_V4_FLASH_0731_BACKUP_MODEL,
  isCheaperInferenceModel,
} from "@/lib/chatModels";

export const CHAT_IMAGE_SCENE_BRIEF_DEFAULT_MODEL =
  CHEAPER_INFERENCE_GPT_56_LUNA_MODEL;
export const CHAT_IMAGE_SCENE_BRIEF_FALLBACK_MODEL =
  OPENROUTER_DEEPSEEK_V4_FLASH_0731_BACKUP_MODEL;
/** Soft guardrail only — full turns can exceed 5k chars; do not truncate hard. */
export const CHAT_IMAGE_SCENE_BRIEF_MAX_SOURCE_CHARS = 24_000;

export function resolveChatImageSceneBriefModel(
  env: NodeJS.ProcessEnv = process.env
): string {
  return resolveBackgroundPrimaryModelId(
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
