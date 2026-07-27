import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { getDb } from "@/lib/db";
import { ensureObserverSchema } from "@/lib/observerSchema";
import type { ChatSceneRow } from "@/lib/observerTypes";

export function getActiveChatScene(
  chatId: number,
  db: Database.Database = getDb()
): ChatSceneRow | null {
  ensureObserverSchema(db);
  const row = db
    .prepare(
      `SELECT * FROM chat_scenes
       WHERE chat_id=? AND status='ACTIVE'
       ORDER BY started_turn DESC, created_at DESC
       LIMIT 1`
    )
    .get(chatId) as ChatSceneRow | undefined;
  return row ?? null;
}

/**
 * Ensure exactly one ACTIVE scene for the chat.
 * Idempotent: returns existing active scene when present.
 */
export function ensureActiveChatScene(opts: {
  chatId: number;
  startedTurn?: number;
  locationKey?: string | null;
  db?: Database.Database;
}): { scene: ChatSceneRow; created: boolean } {
  const db = opts.db ?? getDb();
  ensureObserverSchema(db);
  const existing = getActiveChatScene(opts.chatId, db);
  if (existing) {
    if (
      opts.locationKey !== undefined &&
      opts.locationKey !== existing.location_key
    ) {
      db.prepare(
        `UPDATE chat_scenes SET location_key=?, updated_at=datetime('now') WHERE id=?`
      ).run(opts.locationKey, existing.id);
      return {
        scene: getActiveChatScene(opts.chatId, db)!,
        created: false,
      };
    }
    return { scene: existing, created: false };
  }

  const id = randomUUID();
  const startedTurn = opts.startedTurn ?? 0;
  db.prepare(
    `INSERT INTO chat_scenes (id, chat_id, status, location_key, started_turn)
     VALUES (?,?, 'ACTIVE', ?, ?)`
  ).run(id, opts.chatId, opts.locationKey ?? null, startedTurn);

  return {
    scene: db.prepare(`SELECT * FROM chat_scenes WHERE id=?`).get(id) as ChatSceneRow,
    created: true,
  };
}

/**
 * Close active scene. Does NOT copy participants to a new scene.
 * Caller must bootstrap presence again for the next scene.
 */
export function closeActiveChatScene(opts: {
  chatId: number;
  endedTurn: number;
  db?: Database.Database;
}): ChatSceneRow | null {
  const db = opts.db ?? getDb();
  ensureObserverSchema(db);
  const active = getActiveChatScene(opts.chatId, db);
  if (!active) return null;
  db.prepare(
    `UPDATE chat_scenes SET
       status='CLOSED', ended_turn=?, updated_at=datetime('now')
     WHERE id=?`
  ).run(opts.endedTurn, active.id);
  return db
    .prepare(`SELECT * FROM chat_scenes WHERE id=?`)
    .get(active.id) as ChatSceneRow;
}

export function listChatScenes(
  chatId: number,
  db: Database.Database = getDb()
): ChatSceneRow[] {
  ensureObserverSchema(db);
  return db
    .prepare(
      `SELECT * FROM chat_scenes WHERE chat_id=? ORDER BY started_turn ASC, created_at ASC`
    )
    .all(chatId) as ChatSceneRow[];
}

export function setActiveSceneLocation(opts: {
  chatId: number;
  locationKey: string | null;
  db?: Database.Database;
}): ChatSceneRow | null {
  const db = opts.db ?? getDb();
  const active = getActiveChatScene(opts.chatId, db);
  if (!active) return null;
  db.prepare(
    `UPDATE chat_scenes SET location_key=?, updated_at=datetime('now') WHERE id=?`
  ).run(opts.locationKey, active.id);
  return getActiveChatScene(opts.chatId, db);
}
