import type Database from "better-sqlite3";
import {
  isBotGenerationLeaseStaleOnDb,
  type BotGenerationClaimResult,
  TRPG_BOT_GENERATION_STALE_MS,
} from "./botGenerationLease";

import type { TrpgActorReady, TrpgRoundWork } from "./roundLock";
import { nextTrpgRoundWork } from "./roundLock";
import type { TrpgRoundPhase } from "./types";

/** One automatic bot recovery attempt after a genuine provider failure. */
export const AUTO_BOT_RECOVERY_MAX = 1;

export function roundHasBotGenerateFailed(errorJson: string | null | undefined): boolean {
  return errorJson?.includes('"bot"') === true;
}

export function botRecoveryEligible(
  recoveryAttempts: number | null | undefined,
  botGenerateFailed: boolean
): boolean {
  return botGenerateFailed && (recoveryAttempts ?? 0) < AUTO_BOT_RECOVERY_MAX;
}

function parseErrorJsonRecord(errorJson: string | null | undefined): Record<string, unknown> | null {
  if (!errorJson) return null;
  try {
    const parsed = JSON.parse(errorJson) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    /* keep null */
  }
  return null;
}

/** Remove only the bot-generation error key; preserve unrelated round error state. */
export function clearBotErrorFromErrorJson(errorJson: string | null | undefined): string | null {
  const parsed = parseErrorJsonRecord(errorJson);
  if (!parsed) return errorJson ?? null;
  if (!("bot" in parsed)) return errorJson ?? null;
  const next = { ...parsed };
  delete next.bot;
  return Object.keys(next).length > 0 ? JSON.stringify(next) : null;
}

/** Set or replace only the bot error key; preserve unrelated round error state. */
export function setBotErrorInErrorJson(
  errorJson: string | null | undefined,
  message: string
): string {
  const parsed = parseErrorJsonRecord(errorJson);
  const next = parsed ? { ...parsed, bot: message } : { bot: message };
  return JSON.stringify(next);
}

function staleSeconds(): number {
  return Math.ceil(TRPG_BOT_GENERATION_STALE_MS / 1000);
}

/**
 * Atomically consume the one recovery attempt, clear bot error, and claim the #634 lease.
 * Only the winning request may start recovery generation.
 */
export function tryClaimBotRecoveryGeneration(
  db: Database.Database,
  roundId: number,
  requestId: string
): BotGenerationClaimResult {
  const row = db
    .prepare(
      `SELECT error_json, bot_generation_recovery_attempts
       FROM trpg_rounds WHERE id = ?`
    )
    .get(roundId) as
    | { error_json: string | null; bot_generation_recovery_attempts: number | null }
    | undefined;
  if (!row || !roundHasBotGenerateFailed(row.error_json)) {
    return { claimed: false, reason: "in_flight" };
  }
  if ((row.bot_generation_recovery_attempts ?? 0) >= AUTO_BOT_RECOVERY_MAX) {
    return { claimed: false, reason: "in_flight" };
  }
  const clearedError = clearBotErrorFromErrorJson(row.error_json);

  const fresh = db
    .prepare(
      `UPDATE trpg_rounds
       SET phase = CASE WHEN phase = 'ACTION_INPUT' THEN 'BOT_ACTION' ELSE phase END,
           bot_generation_recovery_attempts = COALESCE(bot_generation_recovery_attempts, 0) + 1,
           error_json = ?,
           bot_generation_id = ?,
           bot_generation_started_at = datetime('now'),
           bot_generation_heartbeat_at = datetime('now'),
           process_stage = 'bots',
           process_started_at = datetime('now'),
           updated_at = datetime('now')
       WHERE id = ?
         AND bot_generation_id IS NULL
         AND phase IN ('ACTION_INPUT', 'BOT_ACTION')
         AND error_json LIKE '%"bot"%'
         AND COALESCE(bot_generation_recovery_attempts, 0) < ?`
    )
    .run(clearedError, requestId, roundId, AUTO_BOT_RECOVERY_MAX);
  if (fresh.changes === 1) return { claimed: true, reason: "claimed" };

  const inFlight = db
    .prepare(`SELECT bot_generation_id FROM trpg_rounds WHERE id=? AND bot_generation_id IS NOT NULL`)
    .get(roundId) as { bot_generation_id: string } | undefined;
  if (!inFlight) return { claimed: false, reason: "in_flight" };

  if (!isBotGenerationLeaseStaleOnDb(db, roundId)) {
    return { claimed: false, reason: "in_flight" };
  }

  const reclaimed = db
    .prepare(
      `UPDATE trpg_rounds
       SET phase = CASE WHEN phase = 'ACTION_INPUT' THEN 'BOT_ACTION' ELSE phase END,
           bot_generation_recovery_attempts = COALESCE(bot_generation_recovery_attempts, 0) + 1,
           error_json = ?,
           bot_generation_id = ?,
           bot_generation_started_at = datetime('now'),
           bot_generation_heartbeat_at = datetime('now'),
           process_stage = 'bots',
           process_started_at = datetime('now'),
           updated_at = datetime('now')
       WHERE id = ?
         AND bot_generation_id IS NOT NULL
         AND error_json LIKE '%"bot"%'
         AND COALESCE(bot_generation_recovery_attempts, 0) < ?
         AND datetime(bot_generation_heartbeat_at) < datetime('now', ?)`
    )
    .run(clearedError, requestId, roundId, AUTO_BOT_RECOVERY_MAX, `-${staleSeconds()} seconds`);
  if (reclaimed.changes === 1) return { claimed: true, reason: "stale_reclaimed" };
  return { claimed: false, reason: "in_flight" };
}

/** Host-initiated explicit retry after automatic recovery budget is exhausted. Does not reset recovery_attempts. */
export function tryClaimBotExplicitRetryGeneration(
  db: Database.Database,
  roundId: number,
  requestId: string
): BotGenerationClaimResult {
  const row = db
    .prepare(
      `SELECT error_json, bot_generation_recovery_attempts
       FROM trpg_rounds WHERE id = ?`
    )
    .get(roundId) as
    | { error_json: string | null; bot_generation_recovery_attempts: number | null }
    | undefined;
  if (!row || !roundHasBotGenerateFailed(row.error_json)) {
    return { claimed: false, reason: "in_flight" };
  }
  if ((row.bot_generation_recovery_attempts ?? 0) < AUTO_BOT_RECOVERY_MAX) {
    return { claimed: false, reason: "in_flight" };
  }
  const clearedError = clearBotErrorFromErrorJson(row.error_json);

  const fresh = db
    .prepare(
      `UPDATE trpg_rounds
       SET phase = CASE WHEN phase = 'ACTION_INPUT' THEN 'BOT_ACTION' ELSE phase END,
           error_json = ?,
           bot_generation_id = ?,
           bot_generation_started_at = datetime('now'),
           bot_generation_heartbeat_at = datetime('now'),
           process_stage = 'bots',
           process_started_at = datetime('now'),
           updated_at = datetime('now')
       WHERE id = ?
         AND bot_generation_id IS NULL
         AND phase IN ('ACTION_INPUT', 'BOT_ACTION')
         AND error_json LIKE '%"bot"%'
         AND COALESCE(bot_generation_recovery_attempts, 0) >= ?`
    )
    .run(clearedError, requestId, roundId, AUTO_BOT_RECOVERY_MAX);
  if (fresh.changes === 1) return { claimed: true, reason: "claimed" };

  const inFlight = db
    .prepare(`SELECT bot_generation_id FROM trpg_rounds WHERE id=? AND bot_generation_id IS NOT NULL`)
    .get(roundId) as { bot_generation_id: string } | undefined;
  if (!inFlight) return { claimed: false, reason: "in_flight" };

  if (!isBotGenerationLeaseStaleOnDb(db, roundId)) {
    return { claimed: false, reason: "in_flight" };
  }

  const reclaimed = db
    .prepare(
      `UPDATE trpg_rounds
       SET bot_generation_id = ?,
           bot_generation_started_at = datetime('now'),
           bot_generation_heartbeat_at = datetime('now'),
           process_stage = 'bots',
           process_started_at = datetime('now'),
           updated_at = datetime('now')
       WHERE id = ?
         AND bot_generation_id IS NOT NULL
         AND datetime(bot_generation_heartbeat_at) < datetime('now', ?)`
    )
    .run(requestId, roundId, `-${staleSeconds()} seconds`);
  if (reclaimed.changes === 1) return { claimed: true, reason: "stale_reclaimed" };
  return { claimed: false, reason: "in_flight" };
}

export function resolveTrpgRoundWork(opts: {
  phase: TrpgRoundPhase;
  humans: TrpgActorReady[];
  bots: TrpgActorReady[];
  errorJson: string | null | undefined;
  recoveryAttempts: number | null | undefined;
}): TrpgRoundWork {
  const botGenerateFailed = roundHasBotGenerateFailed(opts.errorJson);
  return nextTrpgRoundWork({
    phase: opts.phase,
    humans: opts.humans,
    bots: opts.bots,
    botGenerateFailed,
    botRecoveryEligible: botRecoveryEligible(opts.recoveryAttempts, botGenerateFailed),
  });
}
