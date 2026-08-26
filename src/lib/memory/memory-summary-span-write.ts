import { ROLLING_SUMMARY_INTERVAL } from "./memory-constants";
import { newBatchEndForStart } from "./memory-summary-range";

export type SummarySpanWriteValidation =
  | { ok: true; turnStart: number; turnEnd: number; turnSpan: number }
  | { ok: false; reason: "SUMMARY_INVALID" };

/** Single runtime owner for durable summary batch span writes. */
export function validateSummarySpanWrite(opts: {
  turnStart: number;
  turnEnd?: number | null;
  userEdited?: boolean;
}): SummarySpanWriteValidation {
  const turnEnd = opts.turnEnd ?? newBatchEndForStart(opts.turnStart);
  const turnSpan = turnEnd - opts.turnStart + 1;
  if (opts.turnStart < 1 || turnSpan < 1) {
    return { ok: false, reason: "SUMMARY_INVALID" };
  }
  // Implicit automatic span (no explicit turnEnd) must be exactly 5 turns.
  if (opts.turnEnd == null && turnSpan !== ROLLING_SUMMARY_INTERVAL) {
    return { ok: false, reason: "SUMMARY_INVALID" };
  }
  // Automatic / non-user-edited rows must be exactly 5 turns.
  if (!opts.userEdited && turnSpan !== ROLLING_SUMMARY_INTERVAL) {
    return { ok: false, reason: "SUMMARY_INVALID" };
  }
  return { ok: true, turnStart: opts.turnStart, turnEnd, turnSpan };
}
