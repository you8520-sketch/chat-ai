/**
 * Durable summary batch spans — legacy 6-turn (NULL turn_end) vs new 5-turn rows.
 * NULL turn_end always resolves as turn_start + 5 (six-turn legacy), never current interval.
 */
import {
  LEGACY_NULL_TURN_END_OFFSET,
  NEW_ROLLING_SUMMARY_INTERVAL,
} from "./memory-constants";
import { resolveNewBatchEndForStart } from "./memory-5plus4-flag";

export { LEGACY_NULL_TURN_END_OFFSET } from "./memory-constants";

export type SummarySpan = {
  turnStart: number;
  turnEnd: number;
  turnCount: number;
};

export function resolveStoredTurnEnd(
  turnStart: number,
  turnEnd: number | null | undefined
): number {
  if (turnEnd != null && Number.isFinite(turnEnd) && turnEnd >= turnStart) {
    return Math.floor(turnEnd);
  }
  return turnStart + LEGACY_NULL_TURN_END_OFFSET;
}

export function resolveRecordSpan(row: {
  turn_number: number;
  turn_end?: number | null;
}): SummarySpan {
  const turnStart = row.turn_number;
  const turnEnd = resolveStoredTurnEnd(turnStart, row.turn_end);
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

/** New automatically-created batches follow MEMORY_5PLUS4_ENABLED (5 or legacy 6). */
export function newBatchEndForStart(turnStart: number): number {
  return resolveNewBatchEndForStart(turnStart);
}

export function isNewIntervalBatch(span: SummarySpan): boolean {
  return span.turnCount === NEW_ROLLING_SUMMARY_INTERVAL;
}

export function isLegacySixTurnBatch(span: SummarySpan): boolean {
  return span.turnCount === LEGACY_NULL_TURN_END_OFFSET + 1;
}

/** Next new batch after highest contiguous sealed turn (frontier-based, not global modulo). */
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
