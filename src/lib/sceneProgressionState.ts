/**
 * Chat-scoped progression history for World-Motion V1.1 weighted rotation.
 * Commit only after successful assistant finalize (see chat route).
 */

import type Database from "better-sqlite3";
import { getDb } from "@/lib/db";
import type { SceneProgressionType } from "@/lib/sceneDirective";

export type SceneProgressionHistoryEntry = {
  turn: number;
  types: SceneProgressionType[];
};

export type SceneProgressionState = {
  chatId: number;
  lastCommittedTurn: number;
  recent: SceneProgressionHistoryEntry[];
};

const MAX_RECENT = 4;
const ALL_TYPES = new Set<string>([
  "relationship",
  "daily_life",
  "lore_clue",
  "npc_action",
  "world_reaction",
  "tactical_planning",
  "consequence",
  "comedy",
  "environment",
]);

export function ensureSceneProgressionSchema(
  db: Database.Database = getDb()
): void {
  try {
    db.pragma("busy_timeout = 5000");
  } catch {
    // ignore
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS scene_progression_state (
      chat_id INTEGER PRIMARY KEY,
      last_committed_turn INTEGER NOT NULL DEFAULT 0,
      recent_types_json TEXT NOT NULL DEFAULT '[]',
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

function parseRecent(raw: string): SceneProgressionHistoryEntry[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const out: SceneProgressionHistoryEntry[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== "object") continue;
      const turn = Number((item as { turn?: unknown }).turn);
      const typesRaw = (item as { types?: unknown }).types;
      if (!Number.isFinite(turn) || !Array.isArray(typesRaw)) continue;
      const types = typesRaw.filter(
        (t): t is SceneProgressionType =>
          typeof t === "string" && ALL_TYPES.has(t)
      );
      if (types.length === 0) continue;
      out.push({ turn, types });
    }
    return out
      .sort((a, b) => a.turn - b.turn)
      .slice(-MAX_RECENT);
  } catch {
    return [];
  }
}

export function emptySceneProgressionState(chatId: number): SceneProgressionState {
  return { chatId, lastCommittedTurn: 0, recent: [] };
}

export function loadSceneProgressionState(
  chatId: number,
  db: Database.Database = getDb()
): SceneProgressionState {
  ensureSceneProgressionSchema(db);
  const row = db
    .prepare(
      `SELECT chat_id, last_committed_turn, recent_types_json
       FROM scene_progression_state WHERE chat_id = ?`
    )
    .get(chatId) as
    | {
        chat_id: number;
        last_committed_turn: number;
        recent_types_json: string;
      }
    | undefined;
  if (!row) return emptySceneProgressionState(chatId);
  return {
    chatId: row.chat_id,
    lastCommittedTurn: row.last_committed_turn ?? 0,
    recent: parseRecent(row.recent_types_json ?? "[]"),
  };
}

/**
 * Persist selected types for a completed turn.
 * Idempotent for the same turn (lastCommittedTurn guard).
 * Returns false when skipped (duplicate / invalid).
 */
export function commitSceneProgressionState(input: {
  chatId: number;
  turn: number;
  types: SceneProgressionType[];
  db?: Database.Database;
}): boolean {
  const db = input.db ?? getDb();
  ensureSceneProgressionSchema(db);
  if (!Number.isSafeInteger(input.chatId) || input.chatId <= 0) return false;
  if (!Number.isSafeInteger(input.turn) || input.turn <= 0) return false;
  if (!input.types.length) return false;

  const prev = loadSceneProgressionState(input.chatId, db);
  if (prev.lastCommittedTurn === input.turn) return false;
  if (prev.lastCommittedTurn > input.turn) return false;

  const nextRecent = [
    ...prev.recent.filter((e) => e.turn !== input.turn),
    { turn: input.turn, types: input.types.slice(0, 3) },
  ]
    .sort((a, b) => a.turn - b.turn)
    .slice(-MAX_RECENT);

  db.prepare(
    `INSERT INTO scene_progression_state (chat_id, last_committed_turn, recent_types_json, updated_at)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(chat_id) DO UPDATE SET
       last_committed_turn = excluded.last_committed_turn,
       recent_types_json = excluded.recent_types_json,
       updated_at = excluded.updated_at`
  ).run(input.chatId, input.turn, JSON.stringify(nextRecent));
  return true;
}
