import crypto from "crypto";
import { getDb } from "@/lib/db";
import {
  callPromptTranslation,
  resolveBackgroundPrimaryModelId,
  resolveBackgroundTextModelId,
} from "@/lib/ai";
import {
  CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_MODEL,
  CHEAPER_INFERENCE_GPT_56_LUNA_MODEL,
  isCheaperInferenceModel,
} from "@/lib/chatModels";
import { toOpenRouterModelId } from "@/lib/openRouterCompletion";
import { deserializeCharacterChunks, serializeCharacterChunks } from "@/utils/characterParser";
import type { CharacterChunk } from "@/types";
import { enqueueCharacterDerivedRefreshJob } from "@/lib/derivedCache/characterEnqueue";
import { kickDerivedCacheWorker } from "@/lib/derivedCache/jobs";
import { translationSourceFingerprint } from "@/lib/derivedCache/versions";

/**
 * Save-time Korean→English translation of character prompt data.
 *
 * Why chunk-level (`setting_chunks_en`) instead of per-field `system_prompt_en`/`world_en`:
 *  - The RP prompt builder (contextBuilder) consumes parsed CharacterChunk[]; raw columns
 *    are only a fallback source. Translating per chunk keeps category/importance/keyword
 *    metadata intact (the chunk parser is Korean-regex based and would mis-categorize
 *    English text if re-parsed).
 *  - Chunk-level mapping lets relevance scoring keep running on the Korean source while
 *    the English text is what actually gets sent to the model.
 *  - speech-category chunks (말투 rules + 예시 대화) are intentionally NOT translated:
 *    they define the Korean prose/speech style the model must reproduce.
 *  - greeting is never part of the prompt chunks (it is shown/stored as the first
 *    assistant message), so it is not translated either.
 */

import type { BilingualDialoguePolicy } from "@/lib/bilingualDialoguePolicy";

export function buildKoreanOutputDirective(_bilingual?: BilingualDialoguePolicy): string {
  /** @deprecated OUTPUT LANG + [PROSE STYLE] cover Korean output — injection removed */
  return "";
}

/** @deprecated buildKoreanOutputDirective() */
export const KOREAN_OUTPUT_DIRECTIVE =
  "[ULTIMATE DIRECTIVE: All internal processing, structures, and rules are in English, but you MUST write your actual response, narrative, and dialogue EXCLUSIVELY in KOREAN (한국어). Any output in English is a critical failure.]";

const KOREAN_OUTPUT_DIRECTIVE_LEGACY = KOREAN_OUTPUT_DIRECTIVE;

export function buildEnglishSettingKoreanOutputRule(_bilingual?: BilingualDialoguePolicy): string {
  /** @deprecated OUTPUT LANG covers English-settings → Korean output — injection removed */
  return "";
}

/** English character settings layer — force Korean RP output (identity/rules zone) */
export const ENGLISH_SETTING_KOREAN_OUTPUT_RULE =
  "[LANGUAGE RULE] Regardless of the language of the character's settings, prompt, or lorebook, you MUST generate all responses, narratives, and dialogue entirely in Korean (Natural Korean Webnovel Style).";

const ENGLISH_SETTING_KOREAN_OUTPUT_RULE_LEGACY = ENGLISH_SETTING_KOREAN_OUTPUT_RULE;

/** @deprecated OUTPUT LANG + [PROSE STYLE] — injection removed */
export const KOREAN_NARRATION_ENDING_RULE = "";

/** @deprecated WEBNOVEL_OUTPUT_FORMAT_BLOCK — Gemini tail injection용 alias */
export { WEBNOVEL_OUTPUT_FORMAT_BLOCK as DIALOGUE_FORMAT_DIRECTIVE } from "@/lib/webnovelOutputFormat";

const SEG_OPEN = (n: number) => `⟦SEG ${n}⟧`;
const SEG_CLOSE = (n: number) => `⟦/SEG ${n}⟧`;

/** Save-time KO→EN translation system prompt (OpenRouter via callGemini). */
export const CHARACTER_TRANSLATION_SYSTEM_PROMPT = `You are an expert localization translator for Roleplaying Game character sheets. Translate the given Korean character settings into English.

CRITICAL RULES:
1. Names & Proper Nouns: DO NOT translate Korean names or specific lore terms literally. Transliterate them using natural English phonetics (e.g., '은우' -> 'Eunwoo', NOT 'Silver Rain').
2. Tone & Persona Preservation: Preserve the exact personality, tone, and crudeness of the original text. If the dialogue is rough, slang-heavy, or NSFW/explicit, translate it to be equally rough, slang-heavy, or explicit in English. DO NOT sanitize or polite-ify the text.
3. Format Retention: If the input uses specific formats like JSON, W++ formatting, brackets [ ], bullet points, section tags (【...】, [...]), headers (#), line breaks, status-window format specs, or {{user}}/{{char}} placeholders, YOU MUST keep the exact same formatting structure. Only translate the text inside.
4. Token Efficiency: Make the English translation dense and concise to save tokens without losing meaning.

Additional constraints:
- Do NOT summarize, omit, or add content beyond the source.
- Example dialogue inside quotes: translate meaning faithfully under rules 2–4.

Output protocol:
- The input contains numbered segments delimited by ⟦SEG n⟧ ... ⟦/SEG n⟧. Output EVERY segment in the same order with the SAME delimiters, containing only the English translation.
- Output nothing outside the segment delimiters.`;

/** Character-save translation primary — shared background text primary (CI GPT-5.6 Luna). */
export const DEFAULT_TRANSLATION_PRIMARY_MODEL =
  CHEAPER_INFERENCE_GPT_56_LUNA_MODEL;

/** Distinct CI Flash fallback — same resolved model is not a fallback. */
export const DEFAULT_TRANSLATION_FALLBACK_MODEL =
  CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_MODEL;

/** Invariant template placeholders — count must match after translation. */
export const TRANSLATION_PLACEHOLDER_TOKENS = ["{{user}}", "{{char}}"] as const;

export const TRANSLATION_BATCH_MAX_CHUNKS = 3;
export const TRANSLATION_BATCH_MAX_SOURCE_CHARS = 1800;
export const ENGLISH_BACKFILL_FAILURE_COOLDOWN_MS = 30 * 60 * 1000;

export type EnglishLayerStatus =
  | "CURRENT"
  | "STALE"
  | "MISSING"
  | "NO_TRANSLATABLE_CONTENT";

export type CharacterPromptLanguage = "english" | "korean_fallback";

/** Distinct provider+model identity — same resolved model is not a fallback. */
export function translationModelIdentity(modelId: string): string {
  const resolved = resolveBackgroundTextModelId(modelId);
  const provider = isCheaperInferenceModel(resolved) ? "cheaperinference" : "openrouter";
  return `${provider}:${resolved.trim().toLowerCase()}`;
}

/** Primary + distinct fallback models for save-time KO→EN translation. */
export function resolveTranslationModels(
  env: NodeJS.ProcessEnv = process.env
): string[] {
  const primary = resolveBackgroundPrimaryModelId(
    env.PROMPT_TRANSLATION_MODEL?.trim() || DEFAULT_TRANSLATION_PRIMARY_MODEL
  );
  const fallbacksRaw = env.PROMPT_TRANSLATION_FALLBACK_MODELS?.trim();
  const fallbacks = fallbacksRaw
    ? fallbacksRaw.split(",").map((s) => s.trim()).filter(Boolean)
    : [DEFAULT_TRANSLATION_FALLBACK_MODEL];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const model of [primary, ...fallbacks]) {
    const resolvedModel = resolveBackgroundTextModelId(model);
    const key = translationModelIdentity(resolvedModel);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(resolvedModel);
  }
  return out;
}

/** True when at least one resolved translation model has a usable transport key. */
export function hasPromptTranslationTransport(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return resolveTranslationModels(env).some((model) =>
    isCheaperInferenceModel(model)
      ? Boolean(env.CHEAPER_INFERENCE_API_KEY?.trim())
      : Boolean(env.OPENROUTER_API_KEY?.trim())
  );
}

export function hashKoreanChunks(chunks: CharacterChunk[]): string {
  const src = chunks.map((c) => `${c.id}\u0000${c.content}`).join("\u0001");
  return crypto.createHash("sha256").update(src, "utf8").digest("hex");
}

/** Composite source fingerprint including derivation contract version. */
export function koreanChunksTranslationFingerprint(chunks: CharacterChunk[]): string {
  return translationSourceFingerprint(hashKoreanChunks(chunks));
}

function countPlaceholderOccurrences(text: string, token: string): number {
  let count = 0;
  let idx = 0;
  while (idx <= text.length) {
    const found = text.indexOf(token, idx);
    if (found < 0) break;
    count += 1;
    idx = found + token.length;
  }
  return count;
}

export function translationPlaceholderCounts(text: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const token of TRANSLATION_PLACEHOLDER_TOKENS) {
    out[token] = countPlaceholderOccurrences(text, token);
  }
  return out;
}

export function validateTranslationPlaceholderPreservation(
  source: string,
  translated: string
): boolean {
  for (const token of TRANSLATION_PLACEHOLDER_TOKENS) {
    if (
      countPlaceholderOccurrences(source, token) !==
      countPlaceholderOccurrences(translated, token)
    ) {
      return false;
    }
  }
  return true;
}

function validateTranslatedBatch(
  source: CharacterChunk[],
  translated: CharacterChunk[]
): boolean {
  if (source.length !== translated.length) return false;
  for (let i = 0; i < source.length; i++) {
    if (!validateTranslationPlaceholderPreservation(source[i]!.content, translated[i]!.content)) {
      return false;
    }
  }
  return true;
}

export function isTranslatableChunk(c: CharacterChunk): boolean {
  // speech chunks (말투/예시 대화) must stay Korean — they anchor the output style.
  return c.category !== "speech" && !!c.content.trim();
}

export function parseSegmentedResponse(text: string, count: number): string[] | null {
  const out: string[] = [];
  for (let i = 1; i <= count; i++) {
    const open = text.indexOf(SEG_OPEN(i));
    const close = text.indexOf(SEG_CLOSE(i));
    if (open < 0 || close < 0 || close <= open) return null;
    const body = text.slice(open + SEG_OPEN(i).length, close).replace(/^\r?\n/, "").trimEnd();
    if (!body.trim()) return null;
    out.push(body);
  }
  return out;
}

export function splitTranslationBatches(targets: CharacterChunk[]): CharacterChunk[][] {
  const batches: CharacterChunk[][] = [];
  let current: CharacterChunk[] = [];
  let chars = 0;
  for (const chunk of targets) {
    const len = chunk.content.length;
    const wouldExceed =
      current.length > 0 &&
      (current.length >= TRANSLATION_BATCH_MAX_CHUNKS ||
        chars + len > TRANSLATION_BATCH_MAX_SOURCE_CHARS);
    if (wouldExceed) {
      batches.push(current);
      current = [];
      chars = 0;
    }
    current.push(chunk);
    chars += len;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

function buildTranslationPayload(targets: CharacterChunk[]): string {
  return targets
    .map((c, i) => `${SEG_OPEN(i + 1)}\n${c.content}\n${SEG_CLOSE(i + 1)}`)
    .join("\n\n");
}

/**
 * Translate one bounded batch. Rejects finish=length and incomplete segment sets.
 * Does not persist.
 */
async function translateChunksWithModel(
  targets: CharacterChunk[],
  modelId: string
): Promise<CharacterChunk[] | null> {
  const payload = buildTranslationPayload(targets);
  const { text, usage } = await callPromptTranslation(
    CHARACTER_TRANSLATION_SYSTEM_PROMPT,
    [{ role: "user", content: payload }],
    modelId
  );
  const finish = usage.finishReason?.toLowerCase() ?? "";
  if (finish === "length" || finish === "max_tokens") {
    console.warn(
      `[promptTranslation] finish=${finish} (${toOpenRouterModelId(modelId)}) — batch rejected`
    );
    return null;
  }
  const parsed = parseSegmentedResponse(text, targets.length);
  if (!parsed) return null;
  const batch = targets.map((c, i) => ({ ...c, content: parsed[i]! }));
  if (!validateTranslatedBatch(targets, batch)) {
    console.warn(
      `[promptTranslation] placeholder preservation failed (${toOpenRouterModelId(modelId)})`
    );
    return null;
  }
  return batch;
}

/**
 * Translate translatable chunks to English via distinct primary + fallback models.
 * Batches so each request stays inside the translation-only output cap.
 * Returns null when any expected segment fails — never a partial set.
 */
export async function translateChunksToEnglish(
  chunks: CharacterChunk[]
): Promise<CharacterChunk[] | null> {
  const targets = chunks.filter(isTranslatableChunk);
  if (targets.length === 0) return [];

  const batches = splitTranslationBatches(targets);
  const models = resolveTranslationModels();
  const translated: CharacterChunk[] = [];

  for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
    const batch = batches[batchIndex]!;
    let batchResult: CharacterChunk[] | null = null;
    for (let i = 0; i < models.length; i++) {
      const model = models[i]!;
      try {
        batchResult = await translateChunksWithModel(batch, model);
        if (batchResult) {
          if (i > 0) {
            console.log(
              `[promptTranslation] batch ${batchIndex + 1}/${batches.length} succeeded with fallback ${toOpenRouterModelId(model)}`
            );
          }
          break;
        }
        console.warn(
          `[promptTranslation] segment parse failed (${toOpenRouterModelId(model)}) batch ${batchIndex + 1}/${batches.length}` +
            (i < models.length - 1 ? " — trying next model" : "")
        );
      } catch (e) {
        console.warn(
          `[promptTranslation] translation call failed (${toOpenRouterModelId(model)}) batch ${batchIndex + 1}/${batches.length}:`,
          (e as Error).message + (i < models.length - 1 ? " — trying next model" : "")
        );
      }
    }
    if (!batchResult) {
      console.warn(
        `[promptTranslation] batch ${batchIndex + 1}/${batches.length} failed on all models — keeping Korean fallback, no partial save`
      );
      return null;
    }
    translated.push(...batchResult);
  }
  return translated;
}

/**
 * Translate + persist `setting_chunks_en` and `prompt_translation_hash`.
 * Skips the Gemini call when the Korean source is unchanged.
 * Never throws — returns true when an up-to-date English layer exists after the call.
 */
export async function translateAndSaveCharacterPromptEn(
  characterId: number,
  chunks: CharacterChunk[]
): Promise<boolean> {
  try {
    const db = getDb();
    const fingerprint = koreanChunksTranslationFingerprint(chunks);
    const row = db
      .prepare("SELECT setting_chunks, setting_chunks_en, prompt_translation_hash FROM characters WHERE id=?")
      .get(characterId) as {
      setting_chunks?: string;
      setting_chunks_en?: string;
      prompt_translation_hash?: string;
    } | undefined;
    if (!row) return false;
    if (row.prompt_translation_hash === fingerprint && row.setting_chunks_en?.trim()) {
      return true;
    }

    const expectedSettingChunks = serializeCharacterChunks(chunks);
    const expectedTranslationFingerprint = koreanChunksTranslationFingerprint(chunks);

    const english = await translateChunksToEnglish(chunks);
    if (english === null) return false;

    const updated = db
      .prepare(
        "UPDATE characters SET setting_chunks_en=?, prompt_translation_hash=? WHERE id=? AND setting_chunks=?"
      )
      .run(JSON.stringify(english), expectedTranslationFingerprint, characterId, expectedSettingChunks);
    return updated.changes > 0;
  } catch (e) {
    console.warn("[promptTranslation] save failed:", (e as Error).message);
    return false;
  }
}

/**
 * Load the English chunk layer for chat-time use.
 * Returns null when missing OR stale (Korean source changed since translation),
 * in which case the caller falls back to Korean.
 */
export function loadEnglishChunks(
  row: { setting_chunks_en?: string | null; prompt_translation_hash?: string | null },
  koreanChunks: CharacterChunk[]
): CharacterChunk[] | null {
  const raw = row.setting_chunks_en;
  if (!raw?.trim()) return null;
  if (row.prompt_translation_hash !== koreanChunksTranslationFingerprint(koreanChunks)) return null;
  const parsed = deserializeCharacterChunks(raw);
  return parsed.length > 0 ? parsed : null;
}

export function classifyEnglishLayer(opts: {
  koreanChunks: CharacterChunk[];
  settingChunksEn?: string | null;
  promptTranslationHash?: string | null;
}): EnglishLayerStatus {
  const translatable = opts.koreanChunks.filter(isTranslatableChunk);
  if (translatable.length === 0) return "NO_TRANSLATABLE_CONTENT";
  const english = loadEnglishChunks(
    {
      setting_chunks_en: opts.settingChunksEn,
      prompt_translation_hash: opts.promptTranslationHash,
    },
    opts.koreanChunks
  );
  if (english) return "CURRENT";
  const storedHash = opts.promptTranslationHash?.trim() ?? "";
  const hasStoredEn = !!opts.settingChunksEn?.trim() && opts.settingChunksEn.trim() !== "[]";
  if (hasStoredEn && storedHash && storedHash !== koreanChunksTranslationFingerprint(opts.koreanChunks)) {
    return "STALE";
  }
  return "MISSING";
}

export function characterPromptLanguageFromUsedEnglish(
  usedEnglish: boolean
): CharacterPromptLanguage {
  return usedEnglish ? "english" : "korean_fallback";
}

/** World/share single-blob KO→EN translation using the same policy owner. */
export async function translateWorldContentToEnglish(content: string): Promise<string | null> {
  const trimmed = content.trim();
  if (!trimmed) return "";
  const chunk: CharacterChunk = {
    id: "world-0",
    characterId: "0",
    content: trimmed,
    category: "world",
    importance: "CRITICAL",
    tokenCount: Math.max(1, trimmed.length),
    keywords: [],
  };
  const translated = await translateChunksToEnglish([chunk]);
  if (!translated || translated.length === 0) return null;
  return translated[0]!.content.trim() || null;
}

// ---------- Durable derived refresh scheduling (replaces in-memory backfill) ----------

export function resetEnglishBackfillStateForTests(): void {
  // Legacy test hook — durable queue has no process-memory inflight state.
}

export function markEnglishBackfillFailureForTests(_characterId: number, _at = Date.now()): void {
  // Legacy test hook — no-op under durable derived jobs.
}

export function canScheduleEnglishBackfill(characterId: number, _now = Date.now()): boolean {
  if (!hasPromptTranslationTransport()) return false;
  void characterId;
  return true;
}

/** Enqueue durable derived refresh — never starts provider work on the caller stack. */
export function scheduleEnglishBackfill(characterId: number, _chunks?: CharacterChunk[]): void {
  if (!hasPromptTranslationTransport()) return;
  const db = getDb();
  enqueueCharacterDerivedRefreshJob(db, characterId);
  kickDerivedCacheWorker();
}
