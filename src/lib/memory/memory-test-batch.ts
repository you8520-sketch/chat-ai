/** Shared batch-start helpers for memory integration tests (5-turn greenfield). */
import { getDb } from "@/lib/db";
import { newBatchEndForStart } from "./memory-summary-range";

/** Second greenfield batch start (was 7 under legacy six-turn cadence). */
export const GREENFIELD_BATCH2_START = 6;

/** Third greenfield batch start (was 13 under legacy six-turn cadence). */
export const GREENFIELD_BATCH3_START = 11;

export function greenfieldBatchEnd(turnStart: number): number {
  return newBatchEndForStart(turnStart);
}

/** Explicit six-turn span for user-edited test fixtures (not automatic policy). */
export function explicitSixTurnEnd(turnStart: number): number {
  return turnStart + 5;
}

/** Seed historical automatic six-turn rows for migration/audit tests only. */
export function insertAutomaticLegacySixTurnSummaryRow(opts: {
  chatId: number;
  turnStart: number;
  turnEnd: number;
  summary: string;
  inactive?: boolean;
}): void {
  getDb()
    .prepare(
      `INSERT INTO chat_turn_summaries
        (chat_id, turn_number, turn_end, assistant_message_id, summary, summary_kind, user_edited, inactive)
       VALUES (?,?,?,?,?, 'main_canon', 0, ?)`
    )
    .run(
      opts.chatId,
      opts.turnStart,
      opts.turnEnd,
      null,
      opts.summary,
      opts.inactive ? 1 : 0
    );
}
