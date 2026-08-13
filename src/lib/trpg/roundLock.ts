import type Database from "better-sqlite3";
import type { TrpgParticipantKind, TrpgRoundPhase } from "./types";

export type TrpgActorReady = {
  id: number;
  kind: TrpgParticipantKind;
  canAct: boolean;
  submitted: boolean;
};

export type TrpgRoundWork =
  | { type: "wait_humans"; pendingIds: number[] }
  | { type: "generate_bots"; botIds: number[] }
  | { type: "wait_host_fill"; botIds: number[] }
  | { type: "acquire_gm_lock" }
  | { type: "idle" };

function actingIds(actors: TrpgActorReady[]): number[] {
  return actors.filter((a) => a.canAct).map((a) => a.id);
}

function pendingIds(actors: TrpgActorReady[]): number[] {
  return actors.filter((a) => a.canAct && !a.submitted).map((a) => a.id);
}

/**
 * Humans always submit first. Bots only generate after every acting human
 * has locked a submission, using that round's human text + prior GM scene.
 */
export function nextTrpgRoundWork(opts: {
  phase: TrpgRoundPhase;
  humans: TrpgActorReady[];
  bots: TrpgActorReady[];
  botGenerateFailed?: boolean;
}): TrpgRoundWork {
  const { phase, humans, bots, botGenerateFailed } = opts;
  switch (phase) {
    case "CHARACTER_SETUP":
    case "WAITING_FOR_PLAYERS":
    case "LOCKING_ACTIONS":
    case "ADJUDICATING":
    case "ROLLING":
    case "GENERATING_NARRATION":
    case "APPLYING_STATE":
    case "ROUND_COMPLETE":
    case "CAMPAIGN_COMPLETE":
    case "ERROR_RECOVERY":
      return { type: "idle" };
    case "ACTION_INPUT": {
      const waiting = pendingIds(humans);
      if (waiting.length > 0) return { type: "wait_humans", pendingIds: waiting };
      const botPending = pendingIds(bots);
      if (botPending.length > 0) return { type: "generate_bots", botIds: botPending };
      if (actingIds(humans).length === 0 && actingIds(bots).length === 0) {
        return { type: "idle" };
      }
      return { type: "acquire_gm_lock" };
    }
    case "BOT_ACTION": {
      const stillHuman = pendingIds(humans);
      if (stillHuman.length > 0) return { type: "wait_humans", pendingIds: stillHuman };
      const botPending = pendingIds(bots);
      if (botPending.length === 0) return { type: "acquire_gm_lock" };
      if (botGenerateFailed) return { type: "wait_host_fill", botIds: botPending };
      return { type: "generate_bots", botIds: botPending };
    }
    default: {
      const _exhaustive: never = phase;
      return _exhaustive;
    }
  }
}

/** Conditional lock: exactly one request may start GM for a round. */
export function tryAcquireGmLock(
  db: Database.Database,
  roundId: number,
  requestId: string
): boolean {
  const info = db
    .prepare(
      `UPDATE trpg_rounds
       SET phase = 'LOCKING_ACTIONS',
           lock_holder_request_id = ?,
           updated_at = datetime('now')
       WHERE id = ?
         AND lock_holder_request_id IS NULL
         AND phase IN ('ACTION_INPUT', 'BOT_ACTION')`
    )
    .run(requestId, roundId);
  return info.changes === 1;
}

export function tryBeginGmGeneration(
  db: Database.Database,
  roundId: number,
  requestId: string
): boolean {
  const info = db
    .prepare(
      `UPDATE trpg_rounds
       SET phase = 'GENERATING_NARRATION',
           gm_generation_id = ?,
           updated_at = datetime('now')
       WHERE id = ?
         AND lock_holder_request_id = ?
         AND gm_generation_id IS NULL
         AND phase IN ('LOCKING_ACTIONS', 'ADJUDICATING', 'ROLLING')`
    )
    .run(requestId, roundId, requestId);
  return info.changes === 1;
}

export type TrpgLlmBoundary =
  | { kind: "snapshot_saved"; mayCallLlm: true }
  | { kind: "llm_in_flight"; mayCallLlm: true }
  | { kind: "apply_result"; mayCallLlm: false };

/**
 * LLM must run only after the SQLite transaction that saved the snapshot
 * has committed. Never call the model inside BEGIN…COMMIT.
 */
export function trpgLlmBoundary(phase: TrpgRoundPhase): TrpgLlmBoundary {
  switch (phase) {
    case "LOCKING_ACTIONS":
    case "ADJUDICATING":
    case "ROLLING":
      return { kind: "snapshot_saved", mayCallLlm: true };
    case "GENERATING_NARRATION":
      return { kind: "llm_in_flight", mayCallLlm: true };
    case "CHARACTER_SETUP":
    case "WAITING_FOR_PLAYERS":
    case "ACTION_INPUT":
    case "BOT_ACTION":
    case "APPLYING_STATE":
    case "ROUND_COMPLETE":
    case "CAMPAIGN_COMPLETE":
    case "ERROR_RECOVERY":
      return { kind: "apply_result", mayCallLlm: false };
    default: {
      const _exhaustive: never = phase;
      return _exhaustive;
    }
  }
}
