/**
 * 6-turn summary integrity — contiguous batches, reason codes, diagnostics.
 * Never trust summarized_turn_count alone.
 */
import { ROLLING_SUMMARY_INTERVAL } from "@/lib/hybridMemory";
import { ROLLING_SUMMARY_MIN_CHARS } from "./memory-constants";
import { isFallbackMemoryRecordSummary } from "./memory-summary-clamp";
import {
  EMPTY_OOC_SUMMARY_MARKER,
  isEmptyOocScope,
  normalizeSummaryScope,
  type MemorySummaryScope,
  type SummaryKind,
} from "./memory-summary-scope";

export type { SummaryKind, MemorySummaryScope };

type BatchSpan = { turnStart: number; turnEnd: number };

export type SummaryReasonCode =
  | "SUMMARY_TIMEOUT"
  | "SUMMARY_EMPTY"
  | "SUMMARY_INVALID"
  | "SUMMARY_SAVE_FAILED"
  | "SUMMARY_TRANSACTION_ROLLBACK"
  | "SUMMARY_BATCH_GAP"
  | "SUMMARY_SUCCESS"
  | "SUMMARY_OOC_PLACEHOLDER";

export type SummaryBatchDiag = {
  chatId: number;
  persistedBatchStarts: number[];
  missingBatchStarts: number[];
  summarizedTurnCount: number;
  highestContiguousTurn: number;
  recentSummaryBatchRange: string | null;
  reasonCode: SummaryReasonCode | "SUMMARY_OK" | "SUMMARY_COUNTER_DRIFT";
};

/** Expected batch starts: 1, 7, 13, … up to floor(playable/INTERVAL)*INTERVAL window. */
export function expectedBatchStartsThrough(playableTurnCount: number): number[] {
  const completeEnds =
    Math.floor(Math.max(0, playableTurnCount) / ROLLING_SUMMARY_INTERVAL) *
    ROLLING_SUMMARY_INTERVAL;
  const starts: number[] = [];
  for (let s = 1; s <= completeEnds; s += ROLLING_SUMMARY_INTERVAL) {
    starts.push(s);
  }
  return starts;
}

export function batchEndForStart(startTurn: number): number {
  return startTurn + ROLLING_SUMMARY_INTERVAL - 1;
}

/**
 * Highest turn covered by contiguous complete batches starting at 1.
 * Gap at 1 (e.g. only 7~12 present) → 0.
 */
export function highestContiguousCompletedTurn(
  records: BatchSpan[],
  actualTurnCount: number
): number {
  const byStart = new Map<number, { turnStart: number; turnEnd: number }>();
  for (const r of records) {
    const span = r.turnEnd - r.turnStart + 1;
    if (span !== ROLLING_SUMMARY_INTERVAL) continue;
    if (r.turnEnd > actualTurnCount) continue;
    if ((r.turnStart - 1) % ROLLING_SUMMARY_INTERVAL !== 0) continue;
    byStart.set(r.turnStart, r);
  }

  let expectedStart = 1;
  let highest = 0;
  while (byStart.has(expectedStart)) {
    const r = byStart.get(expectedStart)!;
    if (r.turnEnd > actualTurnCount) break;
    highest = r.turnEnd;
    expectedStart = r.turnEnd + 1;
  }
  return highest;
}

export function missingContiguousBatchStarts(
  records: BatchSpan[],
  playableTurnCount: number
): number[] {
  const expected = expectedBatchStartsThrough(playableTurnCount);
  const have = new Set(
    records
      .filter((r) => r.turnEnd - r.turnStart + 1 === ROLLING_SUMMARY_INTERVAL)
      .map((r) => r.turnStart)
  );
  const missing: number[] = [];
  for (const s of expected) {
    if (!have.has(s)) missing.push(s);
    // stop listing after first gap for "earliest missing first" semantics in callers
  }
  return missing;
}

export function earliestMissingBatchStart(
  records: BatchSpan[],
  playableTurnCount: number
): number | null {
  const missing = missingContiguousBatchStarts(records, playableTurnCount);
  return missing[0] ?? null;
}

/** @deprecated use EMPTY_OOC_SUMMARY_MARKER — kept for legacy imports/tests */
export const OOC_ONLY_SUMMARY_MARKER = EMPTY_OOC_SUMMARY_MARKER;

export function isOocOnlySummaryKind(kind: string | null | undefined): boolean {
  return isEmptyOocScope(kind);
}

/** empty_ooc / legacy ooc_only batch marker body (not LTM narrative). */
export function buildOocOnlyBatchPlaceholder(_startTurn: number, _endTurn: number): string {
  return EMPTY_OOC_SUMMARY_MARKER;
}

export function buildEmptyOocBatchPlaceholder(
  startTurn: number,
  endTurn: number
): string {
  return buildOocOnlyBatchPlaceholder(startTurn, endTurn);
}

export function isOocOnlyPlaceholderText(text: string): boolean {
  return text.trim() === EMPTY_OOC_SUMMARY_MARKER;
}

/** Validate LLM / fixture summary before persist. */
export function validateSummaryNarrative(
  text: string,
  kind: SummaryKind | MemorySummaryScope = "main_canon"
):
  | { ok: true; text: string; kind: MemorySummaryScope }
  | { ok: false; reason: SummaryReasonCode } {
  const scope = normalizeSummaryScope(kind);

  if (scope === "empty_ooc") {
    return { ok: true, text: EMPTY_OOC_SUMMARY_MARKER, kind: "empty_ooc" };
  }

  const t = text.replace(/\s+/g, " ").trim();
  if (!t) return { ok: false, reason: "SUMMARY_EMPTY" };
  if (isOocOnlyPlaceholderText(t)) return { ok: false, reason: "SUMMARY_INVALID" };
  if (isFallbackMemoryRecordSummary(t)) return { ok: false, reason: "SUMMARY_INVALID" };

  // Preference / noncanon / branch may be shorter than main_canon floor
  const minChars =
    scope === "preference" || scope === "noncanon" || scope === "branch_canon"
      ? 12
      : ROLLING_SUMMARY_MIN_CHARS;
  if (t.length < minChars) return { ok: false, reason: "SUMMARY_INVALID" };
  if (/^(null|undefined|n\/a|none|empty)$/i.test(t)) {
    return { ok: false, reason: "SUMMARY_INVALID" };
  }
  return { ok: true, text: t, kind: scope };
}

export function parseRecentSummaryBatchStarts(recentSummary: string): number[] {
  const starts: number[] = [];
  const re = /\[(\d+)~\d+턴\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(recentSummary))) {
    const n = Number(m[1]);
    if (Number.isFinite(n) && n > 0) starts.push(n);
  }
  return starts;
}

export function describeRecentSummaryBatchRange(recentSummary: string): string | null {
  const starts = parseRecentSummaryBatchStarts(recentSummary);
  if (starts.length === 0) return null;
  const first = Math.min(...starts);
  const lastStart = Math.max(...starts);
  return `${first}~${batchEndForStart(lastStart)}`;
}

export function buildSummaryBatchDiagnostics(opts: {
  chatId: number;
  records: BatchSpan[];
  playableTurnCount: number;
  summarizedTurnCount: number;
  recentSummary: string;
}): SummaryBatchDiag {
  const persistedBatchStarts = [
    ...new Set(
      opts.records
        .filter((r) => r.turnEnd - r.turnStart + 1 === ROLLING_SUMMARY_INTERVAL)
        .map((r) => r.turnStart)
    ),
  ].sort((a, b) => a - b);

  const highestContiguousTurn = highestContiguousCompletedTurn(
    opts.records,
    opts.playableTurnCount
  );
  const missingBatchStarts = missingContiguousBatchStarts(
    opts.records,
    opts.playableTurnCount
  );
  const recentSummaryBatchRange = describeRecentSummaryBatchRange(opts.recentSummary);

  let reasonCode: SummaryBatchDiag["reasonCode"] = "SUMMARY_OK";
  if (missingBatchStarts.length > 0) reasonCode = "SUMMARY_BATCH_GAP";
  else if (opts.summarizedTurnCount !== highestContiguousTurn) {
    reasonCode = "SUMMARY_COUNTER_DRIFT";
  }

  return {
    chatId: opts.chatId,
    persistedBatchStarts,
    missingBatchStarts,
    summarizedTurnCount: opts.summarizedTurnCount,
    highestContiguousTurn,
    recentSummaryBatchRange,
    reasonCode,
  };
}
