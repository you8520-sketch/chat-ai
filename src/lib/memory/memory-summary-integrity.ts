/**
 * 6-turn summary integrity — contiguous batches, reason codes, diagnostics.
 * Never trust summarized_turn_count alone.
 */
import { ROLLING_SUMMARY_INTERVAL } from "@/lib/hybridMemory";
import { ROLLING_SUMMARY_MIN_CHARS } from "./memory-constants";
import { isFallbackMemoryRecordSummary } from "./memory-summary-clamp";

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

/** Stored in summary column for ooc_only rows — never injected into prompt/UI/recent_summary. */
export const OOC_ONLY_SUMMARY_MARKER = "__SUMMARY_KIND_OOC_ONLY__";

export type SummaryKind = "narrative" | "ooc_only";

export function isOocOnlySummaryKind(kind: string | null | undefined): boolean {
  return kind === "ooc_only";
}

/** OOC-only batch marker body (not narrative LTM text). */
export function buildOocOnlyBatchPlaceholder(_startTurn: number, _endTurn: number): string {
  return OOC_ONLY_SUMMARY_MARKER;
}

export function isOocOnlyPlaceholderText(text: string): boolean {
  return text.trim() === OOC_ONLY_SUMMARY_MARKER;
}

/** Validate LLM / fixture summary before persist. */
export function validateSummaryNarrative(
  text: string,
  kind: SummaryKind = "narrative"
): { ok: true; text: string; kind: SummaryKind } | { ok: false; reason: SummaryReasonCode } {
  if (kind === "ooc_only") {
    // Marker only — never store narrative prose under ooc_only
    return { ok: true, text: OOC_ONLY_SUMMARY_MARKER, kind: "ooc_only" };
  }

  const t = text.replace(/\s+/g, " ").trim();
  if (!t) return { ok: false, reason: "SUMMARY_EMPTY" };
  if (isOocOnlyPlaceholderText(t)) return { ok: false, reason: "SUMMARY_INVALID" };
  if (isFallbackMemoryRecordSummary(t)) return { ok: false, reason: "SUMMARY_INVALID" };
  if (t.length < ROLLING_SUMMARY_MIN_CHARS) return { ok: false, reason: "SUMMARY_INVALID" };
  if (/^(null|undefined|n\/a|none|empty)$/i.test(t)) {
    return { ok: false, reason: "SUMMARY_INVALID" };
  }
  return { ok: true, text: t, kind: "narrative" };
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
