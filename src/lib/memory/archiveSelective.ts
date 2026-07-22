import {
  extractKeywords,
  scoreArchiveRelevance,
  shouldIncludeArchive,
} from "@/lib/memory/memory-injector";
import { ARCHIVE_RELEVANCE_THRESHOLD } from "@/lib/memory/memory-constants";

export type ArchiveChunk = {
  index: number;
  text: string;
};

export type ArchiveSelectiveResult = {
  selectedChunks: ArchiveChunk[];
  selectedText: string;
  selectedChars: number;
  candidateCount: number;
  candidateChars: number;
  budgetChars: number;
  keywords: string[];
  /** Recent-context bridge keywords actually used for scoring (observability). */
  recentKeywords: string[];
  /** Per-chunk provenance: how much score came from current-user vs recent-context. */
  chunkScores: Array<{ index: number; currentScore: number; recentScore: number; score: number }>;
  included: boolean;
};

export function splitArchiveIntoChunks(archive: string): ArchiveChunk[] {
  const normalized = archive.replace(/\r\n?/g, "\n").trim();
  if (!normalized) return [];

  const paragraphChunks = normalized
    .split(/\n\s*\n+/)
    .map((text) => text.trim())
    .filter(Boolean);

  if (paragraphChunks.length > 1) {
    return paragraphChunks.map((text, index) => ({ index, text }));
  }

  const lineChunks = normalized
    .split(/\n+/)
    .map((text) => text.trim())
    .filter(Boolean);

  if (lineChunks.length > 1) {
    return lineChunks.map((text, index) => ({ index, text }));
  }

  return [{ index: 0, text: normalized }];
}

/**
 * Korean-aware loose token hit — trims trailing 1–2 chars so particle-laden
 * tokens (e.g. "실종이라") still match a stem present in the haystack ("실종").
 * Reuses the same heuristic as userNoteReferenceInjector.koreanLooseTokenHit.
 */
function koreanLooseTokenHit(haystack: string, token: string): boolean {
  if (token.length < 2) return false;
  if (haystack.includes(token)) return true;
  if (token.length >= 3 && haystack.includes(token.slice(0, token.length - 1))) return true;
  if (token.length >= 4 && haystack.includes(token.slice(0, token.length - 2))) return true;
  return false;
}

function scoreArchiveChunkCurrent(chunk: ArchiveChunk, keywords: string[]): number {
  return scoreArchiveRelevance(chunk.text, keywords);
}

function scoreArchiveChunkRecent(chunk: ArchiveChunk, recentKeywords: string[]): number {
  if (recentKeywords.length === 0) return 0;
  const lower = chunk.text.toLowerCase();
  let score = 0;
  for (const kw of recentKeywords) {
    if (koreanLooseTokenHit(lower, kw)) score += 1;
  }
  return score;
}

/**
 * Gate semantics preserved from HEAD:
 *   score >= ARCHIVE_RELEVANCE_THRESHOLD (2)
 *   OR (currentUserKeywordCount <= 2 && score >= 1) — short-query relaxation
 *
 * `currentUserKeywordCount` keeps the relaxation anchored to the current user
 * message only, so adding recent-context keywords cannot widen the relaxation.
 */
function chunkPassesRelevanceGate(score: number, currentUserKeywordCount: number): boolean {
  if (score >= ARCHIVE_RELEVANCE_THRESHOLD) return true;
  if (currentUserKeywordCount <= 2 && score >= 1) return true;
  return false;
}

/**
 * Paragraph/chunk split → relevance → deterministic ordering → char budget.
 *
 * D1.1 retrieval context repair:
 *   Relevance is judged against CURRENT SCENE STATE, not the current user
 *   message alone. `recentContext` (bounded recent RP history) acts as an
 *   indirect causal bridge so archive facts connected only through recent
 *   conversation can be recalled.
 *
 * Signal weighting (current user > recent context):
 *   - Current-user keyword hits use the strict HEAD scorer (weight 1 each),
 *     so when `recentContext` is absent behavior is byte-identical to HEAD.
 *   - Recent-context hits use Korean-aware loose matching (weight 1 each).
 *   - A single stray recent word cannot cross the threshold alone (needs 2
 *     distinct recent hits, or 1 recent hit on top of a current-user hit).
 *
 * `archiveMaxChars` is a ceiling, not a quota. `selected=0` is a valid runtime
 * state and never triggers whole-blob fallback.
 */
export function selectArchiveChunksSelective(opts: {
  archive: string;
  userMessage: string;
  /** Bounded recent RP scene context (user + assistant narrative). Optional. */
  recentContext?: string;
  budgetChars: number;
}): ArchiveSelectiveResult {
  const archive = opts.archive.trim();
  const budgetChars = Math.max(0, opts.budgetChars);
  const currentUserKeywords = extractKeywords(opts.userMessage);
  const currentUserKeywordCount = currentUserKeywords.length;
  const recentContextRaw = opts.recentContext?.trim() ?? "";
  const recentKeywordsAll = recentContextRaw ? extractKeywords(recentContextRaw) : [];
  // Current dominates — never double-count a keyword already in the current user message.
  const currentSet = new Set(currentUserKeywords);
  const recentKeywords = recentKeywordsAll.filter((k) => !currentSet.has(k));
  const keywords = [...new Set([...currentUserKeywords, ...recentKeywords])];

  const candidates = splitArchiveIntoChunks(archive);
  const candidateChars = candidates.reduce((sum, c) => sum + c.text.length, 0);

  if (!archive || candidates.length === 0) {
    return {
      selectedChunks: [],
      selectedText: "",
      selectedChars: 0,
      candidateCount: 0,
      candidateChars: 0,
      budgetChars,
      keywords,
      recentKeywords,
      chunkScores: [],
      included: false,
    };
  }

  const scored = candidates.map((chunk) => {
    const currentScore = scoreArchiveChunkCurrent(chunk, currentUserKeywords);
    const recentScore = scoreArchiveChunkRecent(chunk, recentKeywords);
    return {
      chunk,
      currentScore,
      recentScore,
      score: currentScore + recentScore,
    };
  });

  const ranked = scored
    .filter(({ score }) => chunkPassesRelevanceGate(score, currentUserKeywordCount))
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.chunk.index - b.chunk.index ||
        a.chunk.text.localeCompare(b.chunk.text)
    );

  const selectedChunks: ArchiveChunk[] = [];
  let selectedChars = 0;

  for (const { chunk } of ranked) {
    const next = selectedChars + chunk.text.length + (selectedChunks.length > 0 ? 2 : 0);
    if (selectedChunks.length > 0 && next > budgetChars) continue;
    if (chunk.text.length > budgetChars && selectedChunks.length === 0) {
      selectedChunks.push({ index: chunk.index, text: chunk.text.slice(0, budgetChars).trimEnd() });
      selectedChars = selectedChunks[0]!.text.length;
      break;
    }
    selectedChunks.push(chunk);
    selectedChars = next;
  }

  const chunkScores = scored.map(({ chunk, currentScore, recentScore, score }) => ({
    index: chunk.index,
    currentScore,
    recentScore,
    score,
  }));

  const selectedText = selectedChunks.map((c) => c.text).join("\n\n");
  return {
    selectedChunks,
    selectedText,
    selectedChars: selectedText.length,
    candidateCount: candidates.length,
    candidateChars,
    budgetChars,
    keywords,
    recentKeywords,
    chunkScores,
    included: selectedText.length > 0,
  };
}

/** Legacy whole-blob gate — retained for FULL_ALWAYS comparison */
export function shouldIncludeArchiveWholeBlob(archive: string, userMessage: string): boolean {
  return shouldIncludeArchive(archive, userMessage);
}

export function archiveWholeBlobWouldInject(archive: string, userMessage: string): boolean {
  const trimmed = archive.trim();
  if (!trimmed) return false;
  return shouldIncludeArchiveWholeBlob(trimmed, userMessage);
}
