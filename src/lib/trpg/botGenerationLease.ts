import type Database from "better-sqlite3";
import type { TrpgRoundRow } from "./store";

/** Bot provider timeout is 90s; stale recovery must exceed a healthy single call. */
export const TRPG_BOT_PROVIDER_TIMEOUT_MS = 90_000;
export const TRPG_BOT_GENERATION_STALE_MS = 120_000;

export type BotGenerationClaimResult =
  | { claimed: true; reason: "claimed" | "stale_reclaimed" }
  | { claimed: false; reason: "in_flight" };

function staleSeconds(): number {
  return Math.ceil(TRPG_BOT_GENERATION_STALE_MS / 1000);
}

export function isBotGenerationLeaseStaleOnDb(db: Database.Database, roundId: number): boolean {
  const row = db
    .prepare(
      `SELECT bot_generation_id
       FROM trpg_rounds
       WHERE id = ?
         AND bot_generation_id IS NOT NULL
         AND datetime(bot_generation_heartbeat_at) < datetime('now', ?)`
    )
    .get(roundId, `-${staleSeconds()} seconds`) as { bot_generation_id: string } | undefined;
  return Boolean(row);
}

export function botGenerationInFlight(
  db: Database.Database,
  round: Pick<TrpgRoundRow, "id" | "bot_generation_id" | "bot_generation_heartbeat_at">
): boolean {
  if (!round.bot_generation_id) return false;
  return !isBotGenerationLeaseStaleOnDb(db, round.id);
}

/** Conditional DB claim: at most one active bot-generation owner per round. */
export function tryClaimBotGeneration(
  db: Database.Database,
  roundId: number,
  requestId: string
): BotGenerationClaimResult {
  const fresh = db
    .prepare(
      `UPDATE trpg_rounds
       SET phase = CASE WHEN phase = 'ACTION_INPUT' THEN 'BOT_ACTION' ELSE phase END,
           bot_generation_id = ?,
           bot_generation_started_at = COALESCE(bot_generation_started_at, datetime('now')),
           bot_generation_heartbeat_at = datetime('now'),
           updated_at = datetime('now')
       WHERE id = ?
         AND bot_generation_id IS NULL
         AND phase IN ('ACTION_INPUT', 'BOT_ACTION')
         AND (error_json IS NULL OR error_json NOT LIKE '%"bot"%')`
    )
    .run(requestId, roundId);
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
           bot_generation_id = ?,
           bot_generation_started_at = datetime('now'),
           bot_generation_heartbeat_at = datetime('now'),
           updated_at = datetime('now')
       WHERE id = ?
         AND bot_generation_id IS NOT NULL
         AND datetime(bot_generation_heartbeat_at) < datetime('now', ?)`
    )
    .run(requestId, roundId, `-${staleSeconds()} seconds`);
  if (reclaimed.changes === 1) return { claimed: true, reason: "stale_reclaimed" };
  return { claimed: false, reason: "in_flight" };
}

export function refreshBotGenerationHeartbeat(
  db: Database.Database,
  roundId: number,
  requestId: string
): void {
  db.prepare(
    `UPDATE trpg_rounds
     SET bot_generation_heartbeat_at = datetime('now'), updated_at = datetime('now')
     WHERE id = ? AND bot_generation_id = ?`
  ).run(roundId, requestId);
}

export function releaseBotGeneration(
  db: Database.Database,
  roundId: number,
  requestId: string
): void {
  db.prepare(
    `UPDATE trpg_rounds
     SET bot_generation_id = NULL,
         bot_generation_started_at = NULL,
         bot_generation_heartbeat_at = NULL,
         updated_at = datetime('now')
     WHERE id = ? AND bot_generation_id = ?`
  ).run(roundId, requestId);
}
