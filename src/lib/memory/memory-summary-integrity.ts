/**
 * Summary integrity — contiguous batches from stored spans (legacy 6-turn + new 5-turn).
 * Never trust summarized_turn_count alone.
 */
import { ROLLING_SUMMARY_INTERVAL, ROLLING_SUMMARY_MIN_CHARS } from "./memory-constants";
import { isFallbackMemoryRecordSummary } from "./memory-summary-clamp";
import {
  LEGACY_NULL_TURN_END_OFFSET,
  newBatchEndForStart,
  resolveNextBatchRange,
  resolveRecordSpan,
  resolveStoredTurnEnd,
} from "./memory-summary-range";
import {
  EMPTY_OOC_SUMMARY_MARKER,
  isEmptyOocScope,
  normalizeSummaryScope,
  type MemorySummaryScope,
  type SummaryKind,
} from "./memory-summary-scope";

export type { SummaryKind, MemorySummaryScope };

type BatchSpan = { turnStart: number; turnEnd: number; inactive?: boolean };

/**
 * Active (non soft-deleted) summary rows only.
 * Soft-deleted (`inactive`) batches must not count as sealed coverage or
 * block reseal after the user deletes a wrong history/LTM entry.
 */
export function activeMemoryRecords<T extends { inactive?: boolean }>(
  records: readonly T[]
): T[] {
  return records.filter((r) => !r.inactive);
}

export type SummaryReasonCode =
  | "SUMMARY_TIMEOUT"
  | "SUMMARY_EMPTY"
  | "SUMMARY_INVALID"
  | "SUMMARY_SAVE_FAILED"
  | "SUMMARY_TRANSACTION_ROLLBACK"
  | "SUMMARY_BATCH_GAP"
  | "STALE_MEMORY_EPOCH"
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

function normalizeSpan(row: BatchSpan): { turnStart: number; turnEnd: number } {
  return {
    turnStart: row.turnStart,
    turnEnd: resolveStoredTurnEnd(row.turnStart, row.turnEnd),
  };
}

function sortedActiveSpans(records: BatchSpan[], actualTurnCount: number) {
  return activeMemoryRecords(records)
    .map(normalizeSpan)
    .filter((r) => r.turnEnd <= actualTurnCount)
    .sort((a, b) => a.turnStart - b.turnStart);
}

function sortedAllSpans(records: BatchSpan[], actualTurnCount: number) {
  return records
    .map(normalizeSpan)
    .filter((r) => r.turnEnd <= actualTurnCount)
    .sort((a, b) => a.turnStart - b.turnStart);
}

/**
 * Highest turn covered by contiguous batches starting at 1, including soft-deleted rows.
 * Used for persist gap checks so inactive historical rows still occupy their span.
 */
export function highestContiguousOccupiedTurn(
  records: BatchSpan[],
  actualTurnCount: number
): number {
  let expectedStart = 1;
  let highest = 0;
  for (const r of sortedAllSpans(records, actualTurnCount)) {
    if (r.turnStart !== expectedStart) break;
    highest = r.turnEnd;
    expectedStart = r.turnEnd + 1;
  }
  return highest;
}

/**
 * Highest turn covered by contiguous complete batches starting at 1.
 * Gap at 1 (e.g. only 7~12 present) → 0.
 * Supports mixed legacy 6-turn and new 5-turn stored spans.
 */
export function highestContiguousCompletedTurn(
  records: BatchSpan[],
  actualTurnCount: number
): number {
  let expectedStart = 1;
  let highest = 0;
  for (const r of sortedActiveSpans(records, actualTurnCount)) {
    if (r.turnStart !== expectedStart) break;
    highest = r.turnEnd;
    expectedStart = r.turnEnd + 1;
  }
  return highest;
}

/** Expected sealed-through turn for a greenfield 5-turn cadence (diagnostics only). */
export function expectedSealedTurnCount(playableTurnCount: number): number {
  const n = Math.max(0, Math.floor(playableTurnCount));
  if (n < ROLLING_SUMMARY_INTERVAL) return 0;
  let sealed = 0;
  let start = 1;
  while (start + ROLLING_SUMMARY_INTERVAL - 1 <= n) {
    sealed = start + ROLLING_SUMMARY_INTERVAL - 1;
    start = sealed + 1;
  }
  return sealed;
}

/** Expected 5-turn batch starts for a greenfield chat (diagnostics only — not legacy). */
export function expectedBatchStartsThrough(playableTurnCount: number): number[] {
  const starts: number[] = [];
  let start = 1;
  while (start + ROLLING_SUMMARY_INTERVAL - 1 <= playableTurnCount) {
    starts.push(start);
    start += ROLLING_SUMMARY_INTERVAL;
  }
  return starts;
}

/** New 5-turn batch end for a batch starting at startTurn. */
export function batchEndForStart(startTurn: number): number {
  return newBatchEndForStart(startTurn);
}

export function missingContiguousBatchStarts(
  records: BatchSpan[],
  playableTurnCount: number
): number[] {
  const missing: number[] = [];
  let expectedStart = 1;
  for (const r of sortedActiveSpans(records, playableTurnCount)) {
    if (r.turnStart > expectedStart) {
      missing.push(expectedStart);
      return missing;
    }
    expectedStart = r.turnEnd + 1;
  }
  const highest = highestContiguousCompletedTurn(records, playableTurnCount);
  const next = resolveNextBatchRange(highest, playableTurnCount);
  if (next) {
    const has = activeMemoryRecords(records).some((r) => r.turnStart === next.turnStart);
    if (!has) missing.push(next.turnStart);
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

/** Resolve stored batch start containing turnNumber (legacy or new span). */
export function resolveBatchStartForTurnNumber(
  turnNumber: number,
  records: BatchSpan[]
): number {
  const n = Math.max(1, Math.floor(turnNumber));
  for (const r of sortedActiveSpans(records, n)) {
    if (n >= r.turnStart && n <= r.turnEnd) return r.turnStart;
  }
  const highest = highestContiguousCompletedTurn(records, n);
  let start = Math.max(1, highest + 1);
  while (start + ROLLING_SUMMARY_INTERVAL - 1 < n) {
    start += ROLLING_SUMMARY_INTERVAL;
  }
  return start;
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

const SUMMARY_INSTRUCTION_ECHO_PATTERNS = [
  /(?:6|여섯)\s*턴\s*배치의?\s*사건을?\s*발생\s*순서대로\s*요약/i,
  /(?:5|다섯)\s*턴\s*배치의?\s*사건을?\s*발생\s*순서대로\s*요약/i,
  /사건\s*시기와?\s*인과관계를?\s*누락하지\s*않/i,
  /요약\s*(?:대상|작성|규칙|지침|형식|본문만\s*출력)/i,
  /(?:source|소스)\s*(?:턴|내용).*(?:검토|요약)/i,
  /최종\s*출력.*(?:턴\s*번호|점검표|노출)/i,
] as const;

export function isLikelySummaryInstructionEcho(text: string): boolean {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return false;
  return SUMMARY_INSTRUCTION_ECHO_PATTERNS.some((pattern) => pattern.test(normalized));
}

const STRONG_GLOBAL_MEMORY_LOSS =
  /(?:기억상실|기억을\s*(?:완전히\s*)?(?:잃(?:었|은|고|어)?|상실)|모든\s*기억(?:이|을)\s*(?:없|잃))/i;
const EPISTEMIC_MARKER =
  /(?:추측|의심|가능성|확정되지|불확실|모른|알\s*수\s*없|듯|것\s*같|보인|여긴|판단|주장|말했|생각|진단|추정|감지|느꼈|경험했|여기게|실감)/i;
const SOURCE_UNCERTAINTY_MARKER =
  /(?:추측|의심|가능성|확실하지|모른|아마|일지도|일\s*수|듯|것\s*같|보인|여긴|판단|진단)/i;

const STRONG_UNCERTAIN_CLAIM =
  /(?:각성|폭주|등급\s*상승|정체|정체성|임신|중독|저주|기억상실|조종|세뇌|배신)/i;
const CLAIM_TOKEN_STOPWORDS = new Set([
  "현재", "상태", "사건", "상황", "진행", "미해결", "그는", "그녀", "자신",
  "유저", "사용자", "캐릭터", "말했다", "생각했다", "판단했다", "추측했다",
]);

function normalizeClaimToken(token: string): string {
  return token
    .toLowerCase()
    .replace(/(?:이라고|라고|에게서|에서는|으로|에서|에게|까지|부터|처럼|이며|이고|은|는|이|가|을|를|의|에|와|과|도|만)$/u, "");
}

function significantClaimTokens(text: string): string[] {
  const matches = text.match(/[가-힣A-Za-z0-9_]{2,}/g) ?? [];
  return [
    ...new Set(
      matches
        .map(normalizeClaimToken)
        .filter((token) => token.length >= 2 && !CLAIM_TOKEN_STOPWORDS.has(token))
    ),
  ];
}

function splitDialogueSources(dialogue: string): { user: string; assistant: string } {
  const users: string[] = [];
  const assistants: string[] = [];
  const batchPattern = /\[\d+턴\]\s*\n유저:\s*([\s\S]*?)\n[^:\n]+:\s*([\s\S]*?)(?=\n\n\[\d+턴\]|$)/g;
  let match: RegExpExecArray | null;
  while ((match = batchPattern.exec(dialogue))) {
    users.push(match[1] ?? "");
    assistants.push(match[2] ?? "");
  }
  return { user: users.join("\n"), assistant: assistants.join("\n") };
}

/** Conservative source check for known certainty inflation before DB persistence. */
export function isRollingSummaryGroundedInDialogue(
  summary: string,
  dialogue: string
): boolean {
  if (isLikelySummaryInstructionEcho(summary)) return false;

  const source = splitDialogueSources(dialogue);
  if (STRONG_GLOBAL_MEMORY_LOSS.test(summary) && !STRONG_GLOBAL_MEMORY_LOSS.test(dialogue)) {
    return false;
  }

  const uncertainAssistantParts = source.assistant
    .split(/(?<=[.!?。！？]|다\.)\s+|\n+/)
    .filter(
      (part) =>
        SOURCE_UNCERTAINTY_MARKER.test(part) && STRONG_UNCERTAIN_CLAIM.test(part)
    );
  const summaryParts = summary
    .split(/(?<=[.!?。！？]|다\.)\s+|\n+/)
    .map((part) => part.trim())
    .filter(Boolean);
  for (const part of uncertainAssistantParts) {
    const assistantOnlyTerms = significantClaimTokens(part).filter(
      (token) => !source.user.includes(token)
    );
    const matchingSummaryParts = summaryParts.filter((summaryPart) =>
      assistantOnlyTerms.some((token) => summaryPart.includes(token))
    );
    if (
      matchingSummaryParts.some(
        (summaryPart) =>
          STRONG_UNCERTAIN_CLAIM.test(summaryPart) &&
          !EPISTEMIC_MARKER.test(summaryPart)
      )
    ) {
      return false;
    }
  }

  return true;
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
  if (isLikelySummaryInstructionEcho(t)) return { ok: false, reason: "SUMMARY_INVALID" };

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
  const lastEndMatch = recentSummary.match(
    new RegExp(`\\[${lastStart}~(\\d+)턴\\]`)
  );
  const lastEnd = lastEndMatch
    ? Number(lastEndMatch[1])
    : resolveStoredTurnEnd(lastStart, null);
  return `${first}~${lastEnd}`;
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
      activeMemoryRecords(opts.records).map((r) => normalizeSpan(r).turnStart)
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

export { LEGACY_NULL_TURN_END_OFFSET, resolveRecordSpan, resolveStoredTurnEnd };
