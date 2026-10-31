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
/** Comparison target: roughly 400-500 characters of detail per delivered turn. */
export const B63_RECENT_DETAIL_CHARS_PER_TURN = 500;
export const B63_RECENT_DETAIL_MIN_CHARS_PER_TURN = 400;
/** 20 turns x 500 chars + labels/newlines/header must fit. */
export const B63_RECENT_DETAIL_MAX_CHARS = 10_500;
export const B63_RECENT_DETAIL_MAX_TOKENS = 10_000;
export const B63_PAST_SEARCH_MAX_RESULTS = 3;
export const B63_PAST_SEARCH_MAX_CHARS = 5_000;
export const B63_PAST_SEARCH_MAX_TOKENS = 2_500;
export const B63_PAST_SUMMARY_MAX_CHARS = 500;
export const B63_PAST_ORIGINAL_MAX_CHARS = 1_200;
export const B63_PAST_ORIGINAL_WINDOW_CHARS = 320;

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
  /** Actual turns delivered by blocks, not merely eligible records. */
  coveredTurns: number[];
  /** Delivered turns intersected with the requested detail interval. */
  deliveredDetailTurns: number[];
  /** Detail turns with no usable stored record. */
  missingTurns: number[];
  /** Detail turns whose stored records were excluded by the output budget. */
  omittedTurns: number[];
  /** Delivered detail turns whose block body is below the per-turn char target. */
  shortTurns: number[];
  coverageComplete: boolean;
  charTargetMet: boolean;
  budgetLimited: boolean;
  targetMet: boolean;
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

export type B63PastOriginalSpan = {
  turnNumber: number;
  role: "user" | "assistant";
  messageId: number | null;
  /** Character offset in the original message content. */
  start: number;
  end: number;
  text: string;
  matchedTokens: string[];
};

export type B63PastSearchHit = {
  recordId: number;
  turnStart: number;
  turnEnd: number;
  score: number;
  /** Full stored summary (not necessarily what was injected). */
  summary: string;
  /** Bounded summary text actually used in the prompt line. */
  summaryInPrompt: string;
  /** Full loaded original turns; not necessarily all injected. */
  original: B63PastOriginalTurn[];
  /** Exact original excerpt inserted into search.text. */
  originalExcerpt: string;
  /** Exact spans inserted into search.text, with message IDs and offsets. */
  originalSpans: B63PastOriginalSpan[];
  /** Exact prompt line inserted for this hit. */
  promptLine: string;
};

export type B63PastSearchResult = {
  text: string;
  hits: B63PastSearchHit[];
  chars: number;
  estimatedTokens: number;
  queryTokens: string[];
  excludedRanges: B63TurnRange[];
  excludedCoveredRanges: B63TurnRange[];
  maxResults: number;
  maxChars: number;
  maxTokens: number;
};

function overlaps(a: B63TurnRange, b: B63TurnRange): boolean {
  return a.start <= b.end && a.end >= b.start;
}

function isFullyCovered(inner: B63TurnRange, outer: B63TurnRange): boolean {
  return inner.start >= outer.start && inner.end <= outer.end;
}

function clampText(text: string, maxChars: number): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxChars) return normalized;
  const cut = normalized.slice(0, maxChars);
  const last = Math.max(
    cut.lastIndexOf(". "),
    cut.lastIndexOf("다. "),
    cut.lastIndexOf("! "),
    cut.lastIndexOf("? ")
  );
  return (last > maxChars * 0.6 ? cut.slice(0, last + 1) : cut).trim();
}

function blockLabel(record: Pick<MemoryRecordView, "turnStart" | "turnEnd">): string {
  return record.turnStart === record.turnEnd
    ? `[T${record.turnStart}]`
    : `[T${record.turnStart}~${record.turnEnd}]`;
}

function coveredTurnSet(
  records: readonly Pick<B63RecentDetailBlock, "turnStart" | "turnEnd">[]
): Set<number> {
  const covered = new Set<number>();
  for (const record of records) {
    for (let turn = record.turnStart; turn <= record.turnEnd; turn += 1) covered.add(turn);
  }
  return covered;
}

function renderDetailText(
  blocks: readonly B63RecentDetailBlock[],
  detailStart: number,
  detailEnd: number,
  detailTurnCount: number
): string {
  if (blocks.length === 0) return "";
  const header = `[최근 ${detailTurnCount}턴 상세 기억 — T${detailStart}~${detailEnd}]\n\n`;
  return `${header}${blocks.map((block) => `${block.label} ${block.body}`).join("\n\n")}`;
}

function detailTurnList(detailStart: number, detailEnd: number): number[] {
  const turns: number[] = [];
  for (let turn = detailStart; turn <= detailEnd; turn += 1) turns.push(turn);
  return turns;
}

/**
 * Newest N turns immediately before RAW, read from existing summary rows.
 *
 * Records overlapping the detail interval are eligible, including a 5-turn
 * block that straddles detailStart. Selection is newest-first, so an older
 * summary can never evict a newer one when the output budget is tight. The
 * final header/labels/newlines are included in the char and token caps.
 */
export function buildRecentTurnDetailProjection(opts: {
  chatId: number;
  rawStartTurn: number;
  detailTurnCount?: number;
  maxChars?: number;
  maxTokens?: number;
}): B63RecentDetailProjection {
  const detailTurnCount = Math.max(
    1,
    Math.floor(opts.detailTurnCount ?? B63_RECENT_DETAIL_TURN_COUNT)
  );
  const maxChars = Math.max(1, Math.floor(opts.maxChars ?? B63_RECENT_DETAIL_MAX_CHARS));
  const maxTokens = Math.max(1, Math.floor(opts.maxTokens ?? B63_RECENT_DETAIL_MAX_TOKENS));
  const detailEnd = Math.max(0, Math.floor(opts.rawStartTurn) - 1);
  const detailStart = Math.max(1, detailEnd - detailTurnCount + 1);
  const detailRange = { start: detailStart, end: detailEnd };
  const requestedTurns = detailEnd >= detailStart ? detailTurnList(detailStart, detailEnd) : [];

  const candidates = listPromptInjectibleMemoryRecords(opts.chatId)
    .filter((record) => {
      const range = { start: record.turnStart, end: record.turnEnd };
      // Overlap at the older boundary is intentional. A record crossing RAW
      // (turnEnd > detailEnd) is left to Global/search so RAW is not duplicated.
      return overlaps(range, detailRange) && record.turnEnd <= detailEnd;
    })
    .map((record) => ({
      record,
      rawBody: resolvePromptInjectibleMemoryRecordBody(record),
    }))
    .filter((entry) => entry.rawBody.length > 0)
    .sort(
      (a, b) =>
        b.record.turnEnd - a.record.turnEnd ||
        b.record.turnStart - a.record.turnStart ||
        b.record.id - a.record.id
    );

  const selected: B63RecentDetailBlock[] = [];
  const omitted = new Set<number>();
  for (const entry of candidates) {
    const record = entry.record;
    const turnCount = Math.max(1, record.turnEnd - record.turnStart + 1);
    const body = clampText(
      entry.rawBody,
      Math.max(1, B63_RECENT_DETAIL_CHARS_PER_TURN * turnCount)
    );
    if (!body) continue;
    const block: B63RecentDetailBlock = {
      turnStart: record.turnStart,
      turnEnd: record.turnEnd,
      label: blockLabel(record),
      body,
      recordId: record.id,
    };
    const candidateBlocks = [...selected, block].sort(
      (a, b) => a.turnStart - b.turnStart || a.turnEnd - b.turnEnd
    );
    const candidateText = renderDetailText(
      candidateBlocks,
      detailStart,
      detailEnd,
      detailTurnCount
    );
    if (
      candidateText.length > maxChars ||
      estimateTokens(candidateText) > maxTokens
    ) {
      for (let turn = record.turnStart; turn <= record.turnEnd; turn += 1) {
        if (turn >= detailStart && turn <= detailEnd) omitted.add(turn);
      }
      continue;
    }
    selected.push(block);
  }

  selected.sort((a, b) => a.turnStart - b.turnStart || a.turnEnd - b.turnEnd);
  const text = renderDetailText(selected, detailStart, detailEnd, detailTurnCount);
  const delivered = coveredTurnSet(selected);
  const stored = coveredTurnSet(candidates.map((entry) => entry.record));
  const coveredTurns = [...delivered].sort((a, b) => a - b);
  const deliveredDetailTurns = requestedTurns.filter((turn) => delivered.has(turn));
  const missingTurns = requestedTurns.filter((turn) => !stored.has(turn));
  const omittedTurns = requestedTurns.filter(
    (turn) => stored.has(turn) && !delivered.has(turn)
  );
  const shortTurns = requestedTurns.filter((turn) => {
    const block = selected.find(
      (entry) => turn >= entry.turnStart && turn <= entry.turnEnd
    );
    if (!block) return false;
    const turnCount = Math.max(1, block.turnEnd - block.turnStart + 1);
    return block.body.length / turnCount < B63_RECENT_DETAIL_MIN_CHARS_PER_TURN;
  });
  const coverageComplete = missingTurns.length === 0 && omittedTurns.length === 0;
  const charTargetMet = shortTurns.length === 0;

  return {
    detailStart,
    detailEnd,
    text,
    blocks: selected,
    coveredTurns,
    deliveredDetailTurns,
    missingTurns,
    omittedTurns,
    shortTurns,
    coverageComplete,
    charTargetMet,
    budgetLimited: omittedTurns.length > 0,
    targetMet: coverageComplete && charTargetMet,
    chars: text.length,
    estimatedTokens: estimateTokens(text),
    maxChars,
    maxTokens,
  };
}

type B63TextSpan = {
  start: number;
  end: number;
  text: string;
  matchedTokens: string[];
  /** True when this span is the tail of a long message; truncation keeps the end. */
  tail?: boolean;
};

function queryMatches(text: string, queryText: string): {
  tokens: string[];
  positions: Array<{ token: string; index: number }>;
} {
  if (!text.trim() || !queryText.trim()) return { tokens: [], positions: [] };
  const inspection = inspectLexicalRelevanceForDebug(
    { subject: "", attribute: "", value: "", fact_text: text },
    queryText
  );
  const tokens = [
    ...new Set(
      inspection.tokens
        .filter((token) => token.targetFactTextMatch)
        .map((token) => (token.raw || token.normalized || "").trim())
        .filter((token) => token.length >= 1)
    ),
  ];
  const lower = text.toLowerCase();
  const positions: Array<{ token: string; index: number }> = [];
  for (const token of tokens) {
    const needle = token.toLowerCase();
    let from = 0;
    while (positions.length < 80) {
      const index = lower.indexOf(needle, from);
      if (index < 0) break;
      positions.push({ token, index });
      from = index + Math.max(1, needle.length);
    }
  }
  return { tokens, positions };
}

/**
 * Pick a bounded message span. Query-matched text gets a window around the
 * best match. Without a match, long messages keep both a prefix and a suffix
 * so a late quote is not silently dropped. Offsets are relative to the original
 * message content.
 */
function selectMessageSpans(text: string, queryText: string, maxChars: number): B63TextSpan[] {
  const normalized = text.replace(/\r\n/g, "\n");
  if (!normalized) return [];
  const budget = Math.max(40, Math.floor(maxChars));
  const { positions } = queryMatches(normalized, queryText);

  if (positions.length > 0) {
    let bestIndex = positions[0]!.index;
    let bestScore = -1;
    for (const position of positions) {
      const start = Math.max(0, position.index - Math.floor(budget * 0.35));
      const end = Math.min(normalized.length, start + budget);
      const score = new Set(
        positions
          .filter((entry) => entry.index >= start && entry.index < end)
          .map((entry) => entry.token)
      ).size;
      if (score > bestScore || (score === bestScore && position.index > bestIndex)) {
        bestScore = score;
        bestIndex = position.index;
      }
    }
    let start = Math.max(0, bestIndex - Math.floor(budget * 0.35));
    const end = Math.min(normalized.length, start + budget);
    const spanText = normalized.slice(start, end);
    const matchedTokens = [
      ...new Set(
        positions
          .filter((entry) => entry.index >= start && entry.index < end)
          .map((entry) => entry.token)
      ),
    ];
    return [{ start, end: start + spanText.length, text: spanText, matchedTokens }];
  }

  if (normalized.length <= budget) {
    return [{ start: 0, end: normalized.length, text: normalized, matchedTokens: [] }];
  }
  const prefixChars = Math.max(40, Math.floor(budget * 0.55));
  const suffixChars = Math.max(40, budget - prefixChars);
  return [
    {
      start: 0,
      end: prefixChars,
      text: normalized.slice(0, prefixChars),
      matchedTokens: [],
    },
    {
      start: Math.max(0, normalized.length - suffixChars),
      end: normalized.length,
      text: normalized.slice(Math.max(0, normalized.length - suffixChars)),
      matchedTokens: [],
      tail: true,
    },
  ];
}

function buildOriginalExcerpt(
  turns: readonly B63PastOriginalTurn[],
  queryText: string,
  originalMaxChars: number
): { excerpt: string; spans: B63PastOriginalSpan[] } {
  if (turns.length === 0) return { excerpt: "", spans: [] };
  const perMessageBudget = Math.max(
    180,
    Math.floor(originalMaxChars / Math.max(1, turns.length))
  );
  const entries = turns.map((turn) => {
    const userSpans = selectMessageSpans(turn.user, queryText, perMessageBudget);
    const assistantSpans = selectMessageSpans(turn.assistant, queryText, perMessageBudget);
    const score = Math.max(
      0,
      ...userSpans.map((span) => span.matchedTokens.length),
      ...assistantSpans.map((span) => span.matchedTokens.length)
    );
    return { turn, userSpans, assistantSpans, score };
  });
  const hasMatch = entries.some((entry) => entry.score > 0);
  const ordered = hasMatch
    ? [...entries].sort((a, b) => b.score - a.score || a.turn.turnNumber - b.turn.turnNumber)
    : entries;

  const lines: string[] = [];
  const spans: B63PastOriginalSpan[] = [];
  let remaining = originalMaxChars;
  for (const entry of ordered) {
    const roleSpans: Array<{ role: "user" | "assistant"; spans: B63TextSpan[]; messageId: number | null }> = [
      {
        role: "user",
        spans: hasMatch
          ? entry.userSpans.filter((span) => span.matchedTokens.length > 0)
          : entry.userSpans,
        messageId: entry.turn.userMessageId,
      },
      {
        role: "assistant",
        spans: hasMatch
          ? entry.assistantSpans.filter((span) => span.matchedTokens.length > 0)
          : entry.assistantSpans,
        messageId: entry.turn.assistantMessageId,
      },
    ];
    for (const roleEntry of roleSpans) {
      for (const span of roleEntry.spans) {
        const header = `[T${entry.turn.turnNumber}] ${roleEntry.role.toUpperCase()} (message ${
          roleEntry.messageId ?? "unknown"
        }, chars ${span.start}-${span.end}): `;
        const available = remaining - header.length - 1;
        if (available < 24) break;
        const text =
          span.text.length > available
            ? span.tail
              ? span.text.slice(-available)
              : span.text.slice(0, available)
            : span.text;
        if (!text) continue;
        const line = `${header}${text}`;
        lines.push(line);
        spans.push({
          turnNumber: entry.turn.turnNumber,
          role: roleEntry.role,
          messageId: roleEntry.messageId,
          start: span.tail ? span.end - text.length : span.start,
          end: span.tail ? span.end : span.start + text.length,
          text,
          matchedTokens: span.matchedTokens,
        });
        remaining -= line.length + 1;
        if (remaining <= 24) break;
      }
      if (remaining <= 24) break;
    }
    if (remaining <= 24) break;
  }
  return { excerpt: lines.join("\n"), spans };
}

function renderSearchText(lines: readonly string[]): string {
  if (lines.length === 0) return "";
  return `[과거 기억 검색 — 질의/장면 단서]\n\n${lines.join("\n")}`;
}

/**
 * Search older stored summaries with the explicit question and current-scene
 * cues. The scorer is the existing lexical relevance owner; a rare matched
 * token is required so a recurring character name alone does not inject a
 * record. Original messages are loaded from the existing turn loader, and the
 * top hit carries query-focused spans with turn/message IDs and offsets.
 */
export function searchPastTurnSummaries(opts: {
  chatId: number;
  query: string;
  sceneText?: string | null;
  /** Overlap exclusion (for example RAW). */
  excludeRanges?: readonly B63TurnRange[];
  /** Records fully contained in a delivered detail block are excluded. */
  excludeCoveredRanges?: readonly B63TurnRange[];
  maxResults?: number;
  maxChars?: number;
  maxTokens?: number;
  includeOriginal?: boolean;
  originalMaxChars?: number;
}): B63PastSearchResult {
  const maxResults = Math.max(0, Math.floor(opts.maxResults ?? B63_PAST_SEARCH_MAX_RESULTS));
  const maxChars = Math.max(1, Math.floor(opts.maxChars ?? B63_PAST_SEARCH_MAX_CHARS));
  const maxTokens = Math.max(1, Math.floor(opts.maxTokens ?? B63_PAST_SEARCH_MAX_TOKENS));
  const originalMaxChars = Math.max(
    80,
    Math.floor(opts.originalMaxChars ?? B63_PAST_ORIGINAL_MAX_CHARS)
  );
  const excludedRanges = [...(opts.excludeRanges ?? [])];
  const excludedCoveredRanges = [...(opts.excludeCoveredRanges ?? [])];
  const sceneText = opts.sceneText?.trim() ?? "";
  const queryText = `${opts.query}\n${sceneText}`.trim();

  const candidates = listPromptInjectibleMemoryRecords(opts.chatId).filter((record) => {
    const range = { start: record.turnStart, end: record.turnEnd };
    if (excludedRanges.some((excluded) => overlaps(range, excluded))) return false;
    if (excludedCoveredRanges.some((covered) => isFullyCovered(range, covered))) return false;
    return true;
  });

  if (maxResults === 0 || !queryText) {
    return {
      text: "",
      hits: [],
      chars: 0,
      estimatedTokens: 0,
      queryTokens: [],
      excludedRanges,
      excludedCoveredRanges,
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
      if (
        inspection.tokens.some(
          (entry) => entry.normalized === token && entry.targetFactTextMatch
        )
      ) {
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
  for (const entry of scored) {
    if (hits.length >= maxResults) break;
    const record = entry.record;
    const turns = loadMemoryEligibleTurnContentsForRanges(opts.chatId, [
      { turnStart: record.turnStart, turnEnd: record.turnEnd },
    ]);
    const original: B63PastOriginalTurn[] = turns.map((turn) => ({
      turnNumber: turn.turnNumber,
      user: turn.user,
      assistant: turn.assistant,
      userMessageId: turn.userMessageId,
      assistantMessageId: turn.assistantMessageId,
    }));
    const includeOriginal = opts.includeOriginal !== false && hits.length === 0;
    const originalExcerptResult = includeOriginal
      ? buildOriginalExcerpt(original, queryText, originalMaxChars)
      : { excerpt: "", spans: [] };
    const summaryInPrompt = clampText(entry.body, B63_PAST_SUMMARY_MAX_CHARS);
    const buildLine = (withOriginal: boolean) => {
      const originalBlock =
        withOriginal && originalExcerptResult.excerpt
          ? `\n  원문:\n${originalExcerptResult.excerpt
              .split("\n")
              .map((part) => `  ${part}`)
              .join("\n")}`
          : "";
      return `- ${blockLabel(record)} (score ${entry.score.toFixed(2)}) ${summaryInPrompt}${originalBlock}`;
    };

    let line = buildLine(true);
    let candidateText = renderSearchText([...lines, line]);
    if (candidateText.length > maxChars || estimateTokens(candidateText) > maxTokens) {
      line = buildLine(false);
      candidateText = renderSearchText([...lines, line]);
    }
    if (candidateText.length > maxChars || estimateTokens(candidateText) > maxTokens) break;

    const usedOriginal = line.includes("\n  원문:");
    lines.push(line);
    hits.push({
      recordId: record.id,
      turnStart: record.turnStart,
      turnEnd: record.turnEnd,
      score: entry.score,
      summary: entry.body,
      summaryInPrompt,
      original,
      originalExcerpt: usedOriginal ? originalExcerptResult.excerpt : "",
      originalSpans: usedOriginal ? originalExcerptResult.spans : [],
      promptLine: line,
    });
  }

  const fullText = renderSearchText(lines);
  return {
    text: fullText,
    hits,
    chars: fullText.length,
    estimatedTokens: estimateTokens(fullText),
    queryTokens: [...allMatchedTokens],
    excludedRanges,
    excludedCoveredRanges,
    maxResults,
    maxChars,
    maxTokens,
  };
}
