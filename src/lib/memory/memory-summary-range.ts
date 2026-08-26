/**
 * Durable summary batch spans — explicit stored turn_end only (Phase C).
 * NULL / missing turn_end is invalid at runtime; no silent span inference.
 */
import {
  ROLLING_SUMMARY_INTERVAL,
  newAutomaticBatchEnd,
  targetSummarizedThrough,
} from "./memory-constants";

export { targetSummarizedThrough } from "./memory-constants";

export type SummarySpan = {
  turnStart: number;
  turnEnd: number;
  turnCount: number;
};

export function resolveStoredTurnEnd(
  turnStart: number,
  turnEnd: number | null | undefined
): number | null {
  if (turnEnd != null && Number.isFinite(turnEnd) && turnEnd >= turnStart) {
    return Math.floor(turnEnd);
  }
  return null;
}

export function resolveRecordSpan(row: {
  turn_number: number;
  turn_end?: number | null;
}): SummarySpan | null {
  const turnStart = row.turn_number;
  const turnEnd = resolveStoredTurnEnd(turnStart, row.turn_end);
  if (turnEnd == null) return null;
  return {
    turnStart,
    turnEnd,
    turnCount: turnEnd - turnStart + 1,
  };
}

export function spanFromView(row: { turnStart: number; turnEnd: number }): SummarySpan {
  return {
    turnStart: row.turnStart,
    turnEnd: row.turnEnd,
    turnCount: row.turnEnd - row.turnStart + 1,
  };
}

/** New automatically-created batches are always 5-turn. */
export function newBatchEndForStart(turnStart: number): number {
  return newAutomaticBatchEnd(turnStart);
}

export function isNewIntervalBatch(span: SummarySpan): boolean {
  return span.turnCount === ROLLING_SUMMARY_INTERVAL;
}

/** Next new 5-turn batch after highest contiguous sealed turn (frontier-based, not global modulo). */
export function resolveNextBatchRange(
  highestContiguousTurn: number,
  completedPlayableTurns: number
): { turnStart: number; turnEnd: number } | null {
  const turnStart = highestContiguousTurn + 1;
  if (turnStart < 1) return null;
  const turnEnd = newBatchEndForStart(turnStart);
  if (completedPlayableTurns < turnEnd) return null;
  return { turnStart, turnEnd };
}

export function isSummarySealDue(
  highestContiguousTurn: number,
  completedPlayableTurns: number
): boolean {
  return resolveNextBatchRange(highestContiguousTurn, completedPlayableTurns) !== null;
}

export function unsummarizedCompletedTurns(
  completedPlayableTurns: number,
  summarizedThroughTurn: number
): number {
  return Math.max(0, completedPlayableTurns - summarizedThroughTurn);
}

export function summaryBatchLabel(turnStart: number, turnEnd: number): string {
  return `${turnStart}~${turnEnd}턴`;
}

export function listTargetFiveTurnBatches(
  completedPlayableTurns: number
): Array<{ turnStart: number; turnEnd: number }> {
  const through = targetSummarizedThrough(completedPlayableTurns);
  const batches: Array<{ turnStart: number; turnEnd: number }> = [];
  for (let start = 1; start <= through; start += ROLLING_SUMMARY_INTERVAL) {
    batches.push({ turnStart: start, turnEnd: start + ROLLING_SUMMARY_INTERVAL - 1 });
  }
  return batches;
}
