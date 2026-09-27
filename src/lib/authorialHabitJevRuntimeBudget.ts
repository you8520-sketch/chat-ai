import "server-only";

import type Database from "better-sqlite3";
import { getDb } from "@/lib/db";

export const AUTHORIAL_HABIT_JEV_RUNTIME_BUDGET_KEY =
  "authorial_habit_jev_runtime_attempts_v1";
export const AUTHORIAL_HABIT_JEV_RUNTIME_MAX_CALLS = 50_000;

export type AuthorialHabitJevBudgetReservation = {
  reserved: boolean;
  used: number | null;
  limit: number;
  reason: "reserved" | "budget_exhausted" | "budget_state_invalid";
};

function parseStoredCount(value: unknown): number | null {
  if (typeof value !== "string" || !/^\d+$/.test(value)) return null;
  const n = Number(value);
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
}

/**
 * Durable, atomic pre-provider reservation using the existing app_meta owner.
 *
 * The reservation is intentionally not refunded after provider failure: the
 * 50k cap limits attempted runtime-shadow provider calls, not only successes.
 * No new table or migration is introduced.
 */
export function tryReserveAuthorialHabitJevRuntimeCall(input?: {
  db?: Database.Database;
  limit?: number;
}): AuthorialHabitJevBudgetReservation {
  const db = input?.db ?? getDb();
  const limit = input?.limit ?? AUTHORIAL_HABIT_JEV_RUNTIME_MAX_CALLS;
  if (!Number.isSafeInteger(limit) || limit <= 0) {
    return {
      reserved: false,
      used: null,
      limit,
      reason: "budget_state_invalid",
    };
  }

  const result = db
    .prepare(
      `INSERT INTO app_meta (key, value)
       VALUES (?, '1')
       ON CONFLICT(key) DO UPDATE SET
         value = CAST(app_meta.value AS INTEGER) + 1
       WHERE app_meta.value != ''
         AND app_meta.value NOT GLOB '*[^0-9]*'
         AND CAST(app_meta.value AS INTEGER) < ?`
    )
    .run(AUTHORIAL_HABIT_JEV_RUNTIME_BUDGET_KEY, limit);

  const row = db
    .prepare("SELECT value FROM app_meta WHERE key = ?")
    .get(AUTHORIAL_HABIT_JEV_RUNTIME_BUDGET_KEY) as
    | { value: string }
    | undefined;
  const used = parseStoredCount(row?.value);

  if (result.changes === 1 && used != null && used <= limit) {
    return { reserved: true, used, limit, reason: "reserved" };
  }
  if (used != null && used >= limit) {
    return { reserved: false, used, limit, reason: "budget_exhausted" };
  }
  return {
    reserved: false,
    used,
    limit,
    reason: "budget_state_invalid",
  };
}
