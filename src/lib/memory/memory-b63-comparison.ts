import { estimateTokens } from "@/lib/tokenEstimate";
import { inspectLexicalRelevanceForDebug } from "@/lib/episodicMemoryFacts";
import { loadMemoryEligibleTurnContentsForRanges } from "./memory-turn-loader";
import {
  listPromptInjectibleMemoryRecords,
  resolvePromptInjectibleMemoryRecordBody,
  type MemoryRecordView,
} from "./memory-turn-summary";

/**
 * B63 comparison-only projections. These are read-only views over the existing
 * chat_turn_summaries / messages owners. They are not a new memory system and
 * are only wired when the comparison option is enabled.
 */

export const B63_RECENT_DETAIL_TURN_COUNT = 20;
export const B63_RECENT_DETAIL_MAX_CHARS = 7000;
export const B63_RECENT_DETAIL_MAX_TOKENS = 8000;
export const B63_PAST_SEARCH_MAX_RESULTS = 3;
export const B63_PAST_SEARCH_MAX_CHARS = 5000;
export const B63_PAST_SEARCH_MAX_TOKENS = 2500;
export const B63_PAST_ORIGINAL_MAX_CHARS = 700;

export type B63TurnRange = { start: number; end: number };

export type B63RecentDetailBlock = {
  turnStart: number;
  turnEnd: number;
  label: string;
  body: string;
  recordId: number;
};

export type B63RecentDetailProjection = {
  detailStart: number;
  detailEnd: number;
  text: string;
  blocks: B63RecentDetailBlock[];
  coveredTurns: number[];
  missingTurns: number[];
  omittedTurns: number[];
  chars: number;
  estimatedTokens: number;
  maxChars: number;
  maxTokens: number;
};

export type B63PastOriginalTurn = {
  turnNumber: number;
  user: string;
  assistant: string;
  userMessageId: number | null;
  assistantMessageId: number;
};

export type B63PastSearchHit = {
  recordId: number;
  turnStart: number;
  turnEnd: number;
  score: number;
  summary: string;
  original: B63PastOriginalTurn[];
};

export type B63PastSearchResult = {
  text: string;
  hits: B63PastSearchHit[];
  chars: number;
  estimatedTokens: number;
  queryTokens: string[];
  excludedRanges: B63TurnRange[];
  maxResults: number;
  maxChars: number;
  maxTokens: number;
};

function overlaps(a: B63TurnRange, b: B63TurnRange): boolean {
  return a.start <= b.end && a.end >= b.start;
}

function clampText(text: string, maxChars: number): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxChars) return normalized;
  const cut = normalized.slice(0, maxChars);
  const last = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("다. "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
  return (last > maxChars * 0.6 ? cut.slice(0, last + 1) : cut).trim();
}

function blockLabel(record: Pick<MemoryRecordView, "turnStart" | "turnEnd">): string {
  return record.turnStart === record.turnEnd
    ? `[T${record.turnStart}]`
    : `[T${record.turnStart}~${record.turnEnd}]`;
}

function coveredTurnSet(records: readonly Pick<MemoryRecordView, "turnStart" | "turnEnd">[]): Set<number> {
  const covered = new Set<number>();
  for (const record of records) {
    for (let turn = record.turnStart; turn <= record.turnEnd; turn += 1) covered.add(turn);
  }
  return covered;
}

/**
 * Newest N turns immediately before RAW, read from existing summary rows.
 * Records are rendered with their real range. A missing turn is reported as
 * missing, never filled with a placeholder or a neighbouring summary.
 */
export function buildRecentTurnDetailProjection(opts: {
  chatId: number;
  rawStartTurn: number;
  detailTurnCount?: number;
  maxChars?: number;
  maxTokens?: number;
}): B63RecentDetailProjection {
  const detailTurnCount = Math.max(1, Math.floor(opts.detailTurnCount ?? B63_RECENT_DETAIL_TURN_COUNT));
  const maxChars = Math.max(1, Math.floor(opts.maxChars ?? B63_RECENT_DETAIL_MAX_CHARS));
  const maxTokens = Math.max(1, Math.floor(opts.maxTokens ?? B63_RECENT_DETAIL_MAX_TOKENS));
  const detailEnd = Math.max(0, Math.floor(opts.rawStartTurn) - 1);
  const detailStart = Math.max(1, detailEnd - detailTurnCount + 1);

  const records = listPromptInjectibleMemoryRecords(opts.chatId)
    .filter((record) => record.turnStart >= detailStart && record.turnEnd <= detailEnd)
    .sort((a, b) => a.turnStart - b.turnStart || a.turnEnd - b.turnEnd);

  const blocks: B63RecentDetailBlock[] = [];
  const omittedTurns: number[] = [];
  let text = "";
  for (const record of records) {
    const body = resolvePromptInjectibleMemoryRecordBody(record);
    if (!body) continue;
    const block = `${blockLabel(record)} ${body}`;
    const candidate = text ? `${text}\n\n${block}` : block;
    if (candidate.length > maxChars || estimateTokens(candidate) > maxTokens) {
      for (let turn = record.turnStart; turn <= record.turnEnd; turn += 1) omittedTurns.push(turn);
      continue;
    }
    text = candidate;
    blocks.push({
      turnStart: record.turnStart,
      turnEnd: record.turnEnd,
      label: blockLabel(record),
      body,
      recordId: record.id,
    });
  }

  const covered = coveredTurnSet(records);
  const missingTurns: number[] = [];
  for (let turn = detailStart; turn <= detailEnd; turn += 1) {
    if (!covered.has(turn)) missingTurns.push(turn);
  }

  const header = text
    ? `[최근 ${detailTurnCount}턴 상세 기억 — T${detailStart}~${detailEnd}]\n\n`
    : "";
  const fullText = `${header}${text}`.trim();

  return {
    detailStart,
    detailEnd,
    text: fullText,
    blocks,
    coveredTurns: [...covered].sort((a, b) => a - b),
    missingTurns,
    omittedTurns: [...new Set(omittedTurns)].sort((a, b) => a - b),
    chars: fullText.length,
    estimatedTokens: estimateTokens(fullText),
    maxChars,
    maxTokens,
  };
}

function formatOriginalTurn(turn: B63PastOriginalTurn, budget: number): { text: string; used: number } {
  const user = clampText(turn.user, Math.max(80, Math.floor(budget * 0.45)));
  const assistant = clampText(turn.assistant, Math.max(120, budget - user.length));
  const text = `[T${turn.turnNumber}] USER: ${user}\n[T${turn.turnNumber}] ASSISTANT: ${assistant}`;
  return { text, used: text.length };
}

/**
 * Search older stored summaries with the explicit question and current-scene
 * cues. The scorer is the existing lexical relevance owner; a rare matched
 * token is required so a recurring character name alone does not inject a
 * record. Original messages are loaded from the existing turn loader.
 */
export function searchPastTurnSummaries(opts: {
  chatId: number;
  query: string;
  sceneText?: string | null;
  excludeRanges?: readonly B63TurnRange[];
  maxResults?: number;
  maxChars?: number;
  maxTokens?: number;
  includeOriginal?: boolean;
  originalMaxChars?: number;
}): B63PastSearchResult {
  const maxResults = Math.max(0, Math.floor(opts.maxResults ?? B63_PAST_SEARCH_MAX_RESULTS));
  const maxChars = Math.max(1, Math.floor(opts.maxChars ?? B63_PAST_SEARCH_MAX_CHARS));
  const maxTokens = Math.max(1, Math.floor(opts.maxTokens ?? B63_PAST_SEARCH_MAX_TOKENS));
  const originalMaxChars = Math.max(80, Math.floor(opts.originalMaxChars ?? B63_PAST_ORIGINAL_MAX_CHARS));
  const excludedRanges = [...(opts.excludeRanges ?? [])];
  const sceneText = opts.sceneText?.trim() ?? "";
  const queryText = `${opts.query}\n${sceneText}`.trim();

  const candidates = listPromptInjectibleMemoryRecords(opts.chatId).filter((record) => {
    const range = { start: record.turnStart, end: record.turnEnd };
    return !excludedRanges.some((excluded) => overlaps(range, excluded));
  });

  if (maxResults === 0 || !queryText) {
    return {
      text: "",
      hits: [],
      chars: 0,
      estimatedTokens: 0,
      queryTokens: [],
      excludedRanges,
      maxResults,
      maxChars,
      maxTokens,
    };
  }

  const bodies = new Map<number, string>();
  const inspections = new Map<number, ReturnType<typeof inspectLexicalRelevanceForDebug>>();
  for (const record of candidates) {
    const body = resolvePromptInjectibleMemoryRecordBody(record);
    bodies.set(record.id, body);
    inspections.set(
      record.id,
      inspectLexicalRelevanceForDebug(
        { subject: "", attribute: "", value: "", fact_text: body },
        queryText
      )
    );
  }
  const allMatchedTokens = new Set<string>();
  for (const inspection of inspections.values()) {
    for (const token of inspection.tokens) {
      if (token.targetFactTextMatch) allMatchedTokens.add(token.normalized);
    }
  }
  const documentFrequency = new Map<string, number>();
  for (const token of allMatchedTokens) {
    let count = 0;
    for (const inspection of inspections.values()) {
      if (inspection.tokens.some((entry) => entry.normalized === token && entry.targetFactTextMatch)) {
        count += 1;
      }
    }
    documentFrequency.set(token, count);
  }
  const rareThreshold = Math.max(1, Math.floor(candidates.length * 0.5));

  const scored = candidates
    .map((record) => {
      const body = bodies.get(record.id) ?? "";
      const inspection = inspections.get(record.id);
      const matched = inspection
        ? inspection.tokens
            .filter((token) => token.targetFactTextMatch)
            .map((token) => token.normalized)
        : [];
      const uniqueMatched = [...new Set(matched)];
      const idf = uniqueMatched.reduce(
        (sum, token) => sum + 1 / Math.max(1, documentFrequency.get(token) ?? 1),
        0
      );
      const hasDistinctiveToken = uniqueMatched.some(
        (token) => (documentFrequency.get(token) ?? 0) <= rareThreshold
      );
      const base = inspection?.relevanceScore ?? 0;
      return { record, body, score: base + idf, hasDistinctiveToken };
    })
    .filter((entry) => entry.body && entry.score > 0 && entry.hasDistinctiveToken)
    .sort((a, b) => b.score - a.score || b.record.turnEnd - a.record.turnEnd);

  const hits: B63PastSearchHit[] = [];
  const lines: string[] = [];
  let text = "";
  for (const entry of scored) {
    if (hits.length >= maxResults) break;
    const record = entry.record;
    const original: B63PastOriginalTurn[] = [];
    let originalText = "";
    // Keep the total block bounded: the top hit carries an original-turn excerpt;
    // lower-ranked hits keep their exact turn range so the caller can load them.
    if (opts.includeOriginal !== false && hits.length === 0) {
      const turns = loadMemoryEligibleTurnContentsForRanges(opts.chatId, [
        { turnStart: record.turnStart, turnEnd: record.turnEnd },
      ]);
      // Bound the excerpt but still show both ends of a multi-turn range.
      const excerptTurns = turns.length <= 2 ? turns : [turns[0]!, turns[turns.length - 1]!];
      const perTurnBudget = Math.max(
        80,
        Math.floor(originalMaxChars / Math.max(1, excerptTurns.length))
      );
      for (const turn of excerptTurns) {
        const formatted = formatOriginalTurn(
          {
            turnNumber: turn.turnNumber,
            user: turn.user,
            assistant: turn.assistant,
            userMessageId: turn.userMessageId,
            assistantMessageId: turn.assistantMessageId,
          },
          perTurnBudget
        );
        originalText += originalText ? `\n\n${formatted.text}` : formatted.text;
        original.push({
          turnNumber: turn.turnNumber,
          user: turn.user,
          assistant: turn.assistant,
          userMessageId: turn.userMessageId,
          assistantMessageId: turn.assistantMessageId,
        });
      }
    }
    const line = `- ${blockLabel(record)} (score ${entry.score.toFixed(2)}) ${entry.body}${
      originalText ? `\n  원문:\n${originalText.split("\n").map((part) => `  ${part}`).join("\n")}` : ""
    }`;
    const candidate = text ? `${text}\n${line}` : line;
    if (candidate.length > maxChars || estimateTokens(candidate) > maxTokens) break;
    text = candidate;
    lines.push(line);
    hits.push({
      recordId: record.id,
      turnStart: record.turnStart,
      turnEnd: record.turnEnd,
      score: entry.score,
      summary: entry.body,
      original,
    });
  }

  const fullText = text ? `[과거 기억 검색 — 질의/장면 단서]\n\n${text}` : "";
  return {
    text: fullText,
    hits,
    chars: fullText.length,
    estimatedTokens: estimateTokens(fullText),
    queryTokens: [...allMatchedTokens],
    excludedRanges,
    maxResults,
    maxChars,
    maxTokens,
  };
}
