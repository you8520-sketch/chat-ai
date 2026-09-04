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

const KOREAN_SPEECH_PREDICATE_ENDINGS =
  /(?:다|요|냐|자|어|아|지|네|까|죠|세|래|마|라|야|여|해|가|와|봐|줘|써|서|쳐|켜|져|둬|내|돼|니|나|군|걸|음|함|임|오|소|게|거든|잖아|는데|은데|텐데|을까|을게|을래|려고|란다|렴|ㅂ니다|습니다)(?:[.!?…~]+)?$/u;

export type QuotedSpeechContext = {
  messageText: string;
  quoteStart: number;
  quoteEnd: number;
};

/** Post-quote patterns that mark quoted text as a term/label/sign, not spoken dialogue. */
const POST_QUOTE_TERM_OR_LABEL =
  /^\s*(?:(?:이라|라)\s*(?:불리|는)|(?:이라|라)고\s*(?:적|쓰|기록|새겨|지칭|불러)|[을를]\s*(?:들|꺼내|뽑|바라|내려|가리|향해|가진|쥐|건네|착용|사용|휘두))/u;

/** Canonical owner: quoted term/title/label vs speech — structure before lexical heuristic. */
export function isQuotedTermOrLabelNotSpeech(ctx: QuotedSpeechContext): boolean {
  const after = ctx.messageText.slice(ctx.quoteEnd, ctx.quoteEnd + 48);
  return POST_QUOTE_TERM_OR_LABEL.test(after);
}

/** Pre-quote explicit attribution such as `라이크: "..."` establishes spoken dialogue. */
export function hasExplicitSpeakerAttributionBeforeQuote(
  messageText: string,
  quoteStart: number
): boolean {
  const before = messageText.slice(Math.max(0, quoteStart - 40), quoteStart);
  return /(?:^|[\s。!?…])[\p{L}0-9_]{1,24}\s*:\s*["“‘']?\s*$/u.test(before);
}

const KOREAN_CONVERSATIONAL_WORDS = new Set([
  "안녕",
  "안녕하세요",
  "안녕히",
  "네",
  "예",
  "응",
  "어",
  "아니",
  "아니요",
  "글쎄",
  "그래",
  "좋아",
  "싫어",
  "뭐",
  "왜",
  "어째서",
  "누구",
  "어디",
  "언제",
  "제발",
  "잠깐",
  "멈춰",
  "부탁해",
  "고마워",
  "미안",
  "미안해",
  "사랑해",
  "바보",
  "젠장",
  "맙소사",
  "하하",
  "흐음",
  "큭",
  "쳇",
  "윽",
  "아악",
  "으음",
  "어머",
  "야",
  "여보세요",
  "누구냐",
  "어서",
  "어서와",
  "잘 가",
  "다녀왔어",
  "다녀와",
]);

/** Detects whether a string is valid spoken dialogue vs non-dialogue fragment. */
export function isEligibleSpeechDialogue(text: string, quoteContext?: QuotedSpeechContext): boolean {
  const trimmed = normalizeSceneBriefWhitespace(text);
  if (!trimmed || trimmed.length < 1) return false;
  if (isSceneActionText(trimmed)) return false;

  if (quoteContext && isQuotedTermOrLabelNotSpeech(quoteContext)) {
    return false;
  }
  if (
    quoteContext &&
    hasExplicitSpeakerAttributionBeforeQuote(quoteContext.messageText, quoteContext.quoteStart)
  ) {
    return true;
  }

  // Malformed attribution residue like '라고', '이라며'
  if (/^(?:이라고|라고|이라며|라며|이라면서|라면서)(?:\s|$)/u.test(trimmed)) return false;

  const strippedWord = trimmed.replace(/[.!?…~]/g, "").trim();
  const lastWord = strippedWord.split(/\s+/).pop() ?? strippedWord;

  // Conversational punctuation: ?, !, ~, or …
  if (/[?!~…]/.test(trimmed)) return true;

  // Single word conversational interjections / greetings
  if (KOREAN_CONVERSATIONAL_WORDS.has(strippedWord)) return true;

  // Sentence-ending punctuation (. or ,) on non-label text
  if (/[.,]/.test(trimmed)) return true;

  // Label-like noun fragments without sentence punctuation (e.g. "접근 금지", bare "살상 무기")
  if (
    !/[?!~….,]/.test(trimmed) &&
    strippedWord.split(/\s+/).length <= 2 &&
    /(?:금지|무기|구역|명령|경고|주의|목표|상태|완료|종료|임무|작전)$/u.test(lastWord)
  ) {
    return false;
  }

  // Sentence-ending predicative endings on the final word — preserves "임무 완료.", "작전 종료.", "경고."
  if (KOREAN_SPEECH_PREDICATE_ENDINGS.test(lastWord)) {
    return true;
  }

  return false;
}

/**
 * Spoken-word helper for dialogue provenance lock.
 * Does not filter Scene Builder source rows — source keeps actions + dialogue.
 */
export function extractUserSpokenDialogue(content: string): string {
  let text = normalizeSceneBriefWhitespace(content);
  if (!text) return "";

  const unwrap = text.match(/^[“"‘']([\s\S]*)[”"’']$/);
  if (unwrap) {
    text = normalizeSceneBriefWhitespace(unwrap[1] ?? "");
  }

  text = text
    .replace(/\*[^*]+\*/g, " ")
    .replace(/\([^)]*\)/g, " ")
    .replace(/（[^）]*）/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!text || isSceneActionText(text) || !isEligibleSpeechDialogue(text)) return "";
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
