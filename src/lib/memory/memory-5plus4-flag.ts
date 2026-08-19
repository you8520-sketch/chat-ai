import {
  ROLLING_SUMMARY_INTERVAL,
  RAW_HISTORY_COMPLETE_EXCHANGES,
} from "@/lib/hybridMemory";
import { LEGACY_NULL_TURN_END_OFFSET } from "./memory-summary-range";
import { isMemoryFeatureEnabled } from "./memory-feature";

/** Phase-2 gate — default OFF until all instances run the mixed-span reader. */
export function isMemory5Plus4Enabled(): boolean {
  const raw = process.env.MEMORY_5PLUS4_ENABLED?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

/** Writer batch end for the next automatic seal (6-turn legacy vs 5-turn new). */
export function resolveNewBatchEndForStart(turnStart: number): number {
  if (isMemory5Plus4Enabled()) {
    return turnStart + ROLLING_SUMMARY_INTERVAL - 1;
  }
  return turnStart + LEGACY_NULL_TURN_END_OFFSET;
}

/** Expected span length for a newly written batch row. */
export function resolveNewBatchSpanLength(): number {
  return isMemory5Plus4Enabled()
    ? ROLLING_SUMMARY_INTERVAL
    : LEGACY_NULL_TURN_END_OFFSET + 1;
}

/** Provider playable RAW exchange cap (4 when Phase 2, legacy 5 when Phase 1). */
export function resolveProviderRawExchangeCount(): number {
  return isMemory5Plus4Enabled() ? RAW_HISTORY_COMPLETE_EXCHANGES : 5;
}

/** Summary barrier + RAW-4 contract active only in Phase 2. */
export function isSummaryBarrierActive(): boolean {
  return isMemory5Plus4Enabled() && isMemoryFeatureEnabled();
}

export const PHASE1_DEPLOY_PROCEDURE = [
  "Deploy revision with turn_end schema + mixed-span reader (MEMORY_5PLUS4_ENABLED unset/false).",
  "Verify DB migration/backfill completed; existing 1-6 / 7-12 rows readable.",
  "Confirm all Railway instances report compatible reader before Phase 2.",
].join(" ");

export const PHASE1_VERIFY_CHECKLIST = [
  "chat_turn_summaries.turn_end populated/backfilled",
  "highestContiguousCompletedTurn accepts legacy NULL + explicit turn_end",
  "No new 5-turn rows written while flag OFF",
  "Legacy 6-turn writer still seals 7-12 after 1-6",
].join(" ");

export const PHASE2_ENABLE_PROCEDURE = [
  "Set MEMORY_5PLUS4_ENABLED=true on all instances (rolling restart).",
  "Do not rewrite existing summary rows.",
  "Next seal after frontier 12 writes 13-17 (5-turn).",
].join(" ");

export const PHASE2_VERIFY_CHECKLIST = [
  "Provider RAW <= 4 playable exchanges",
  "Summary barrier blocks main model when seal pending",
  "Receipt shows REAL_RAW metrics separate from opening/bridge",
  "Adult handoff raw remains 4/4/0",
].join(" ");
