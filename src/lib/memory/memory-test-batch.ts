/** Shared batch-start helpers for memory integration tests (5-turn greenfield). */
import { newBatchEndForStart } from "./memory-summary-range";

/** Second greenfield batch start (was 7 under legacy six-turn cadence). */
export const GREENFIELD_BATCH2_START = 6;

/** Third greenfield batch start (was 13 under legacy six-turn cadence). */
export const GREENFIELD_BATCH3_START = 11;

export function greenfieldBatchEnd(turnStart: number): number {
  return newBatchEndForStart(turnStart);
}

/** Explicit legacy six-turn span for compatibility fixtures. */
export function legacySixTurnEnd(turnStart: number): number {
  return turnStart + 5;
}
