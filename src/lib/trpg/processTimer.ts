import type Database from "better-sqlite3";
import type { LiveTurnProcessStage } from "./liveTurnStatus";

export type TrpgProcessStage = Exclude<LiveTurnProcessStage, "none" | "wait_humans">;

export function ensureTrpgProcessStage(
  db: Database.Database,
  roundId: number,
  stage: TrpgProcessStage
): void {
  db.prepare(
    `UPDATE trpg_rounds
     SET process_stage = ?,
         process_started_at = CASE
           WHEN process_stage IS NULL OR process_stage != ? THEN datetime('now')
           ELSE process_started_at
         END,
         updated_at = datetime('now')
     WHERE id = ?`
  ).run(stage, stage, roundId);
}

export function parseProcessStartedAtMs(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const normalized = raw.includes("T") ? raw : raw.replace(" ", "T") + "Z";
  const ms = Date.parse(normalized);
  return Number.isFinite(ms) ? ms : null;
}

export function processElapsedSecFromStartedAt(startedAtMs: number | null, nowMs: number): number {
  if (startedAtMs == null) return 0;
  return Math.max(0, Math.floor((nowMs - startedAtMs) / 1000));
}
