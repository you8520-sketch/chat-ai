import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { getDb } from "@/lib/db";
import { ensureObserverSchema } from "@/lib/observerSchema";
import type {
  ChatObserverRow,
  ObserverCanonicalSourceType,
  ObserverEntityScope,
  ObserverType,
} from "@/lib/observerTypes";
import { mainCharacterObserverId } from "@/lib/observerTypes";

export type UpsertChatObserverInput = {
  chatId: number;
  observerType: ObserverType;
  observerId: string;
  canonicalSourceType: ObserverCanonicalSourceType;
  canonicalSourceId?: string | null;
  displayName?: string;
  entityScope?: ObserverEntityScope;
  createdTurn?: number | null;
  metadata?: Record<string, unknown>;
};

export function getChatObserver(opts: {
  chatId: number;
  observerType: ObserverType;
  observerId: string;
  db?: Database.Database;
}): ChatObserverRow | null {
  const db = opts.db ?? getDb();
  ensureObserverSchema(db);
  const row = db
    .prepare(
      `SELECT * FROM chat_observers
       WHERE chat_id=? AND observer_type=? AND observer_id=?`
    )
    .get(opts.chatId, opts.observerType, opts.observerId) as
    | ChatObserverRow
    | undefined;
  return row ?? null;
}

export function listChatObservers(
  chatId: number,
  db: Database.Database = getDb()
): ChatObserverRow[] {
  ensureObserverSchema(db);
  return db
    .prepare(
      `SELECT * FROM chat_observers WHERE chat_id=? ORDER BY created_at ASC`
    )
    .all(chatId) as ChatObserverRow[];
}

/**
 * Idempotent upsert. Never keys observers by display name.
 */
export function upsertChatObserver(
  input: UpsertChatObserverInput,
  db: Database.Database = getDb()
): { row: ChatObserverRow; inserted: boolean } {
  ensureObserverSchema(db);
  const existing = getChatObserver({
    chatId: input.chatId,
    observerType: input.observerType,
    observerId: input.observerId,
    db,
  });
  if (existing) {
    const displayName =
      input.displayName !== undefined
        ? input.displayName.slice(0, 120)
        : existing.display_name;
    db.prepare(
      `UPDATE chat_observers SET
         display_name=?,
         canonical_source_type=?,
         canonical_source_id=?,
         entity_scope=?,
         is_active=1,
         retired_turn=NULL,
         metadata_json=?,
         updated_at=datetime('now')
       WHERE chat_id=? AND observer_type=? AND observer_id=?`
    ).run(
      displayName,
      input.canonicalSourceType,
      input.canonicalSourceId ?? existing.canonical_source_id,
      input.entityScope ?? existing.entity_scope,
      JSON.stringify(input.metadata ?? safeParseMeta(existing.metadata_json)),
      input.chatId,
      input.observerType,
      input.observerId
    );
    return {
      row: getChatObserver({
        chatId: input.chatId,
        observerType: input.observerType,
        observerId: input.observerId,
        db,
      })!,
      inserted: false,
    };
  }

  db.prepare(
    `INSERT INTO chat_observers (
       chat_id, observer_type, observer_id, canonical_source_type, canonical_source_id,
       display_name, entity_scope, is_active, created_turn, metadata_json
     ) VALUES (?,?,?,?,?,?,?,1,?,?)`
  ).run(
    input.chatId,
    input.observerType,
    input.observerId,
    input.canonicalSourceType,
    input.canonicalSourceId ?? null,
    (input.displayName ?? "").slice(0, 120),
    input.entityScope ?? "CHAT",
    input.createdTurn ?? null,
    JSON.stringify(input.metadata ?? {})
  );
  return {
    row: getChatObserver({
      chatId: input.chatId,
      observerType: input.observerType,
      observerId: input.observerId,
      db,
    })!,
    inserted: true,
  };
}

/** Register a new NPC with a fresh UUID — never use display name as id. */
export function registerNpcObserver(opts: {
  chatId: number;
  displayName: string;
  canonicalSourceType: "CREATOR_NPC" | "SERVER_NPC";
  canonicalSourceId?: string | null;
  createdTurn?: number | null;
  observerId?: string;
  db?: Database.Database;
}): ChatObserverRow {
  const id = opts.observerId ?? randomUUID();
  return upsertChatObserver(
    {
      chatId: opts.chatId,
      observerType: "NPC",
      observerId: id,
      canonicalSourceType: opts.canonicalSourceType,
      canonicalSourceId: opts.canonicalSourceId ?? null,
      displayName: opts.displayName,
      createdTurn: opts.createdTurn,
    },
    opts.db
  ).row;
}

/** Rename display label only — observer_id unchanged. */
export function renameChatObserver(opts: {
  chatId: number;
  observerType: ObserverType;
  observerId: string;
  displayName: string;
  db?: Database.Database;
}): ChatObserverRow | null {
  const db = opts.db ?? getDb();
  ensureObserverSchema(db);
  const existing = getChatObserver(opts);
  if (!existing) return null;
  db.prepare(
    `UPDATE chat_observers SET display_name=?, updated_at=datetime('now')
     WHERE chat_id=? AND observer_type=? AND observer_id=?`
  ).run(
    opts.displayName.slice(0, 120),
    opts.chatId,
    opts.observerType,
    opts.observerId
  );
  return getChatObserver(opts);
}

/** Soft-retire: keep row for audit; is_active=0. */
export function retireChatObserver(opts: {
  chatId: number;
  observerType: ObserverType;
  observerId: string;
  retiredTurn: number;
  db?: Database.Database;
}): ChatObserverRow | null {
  const db = opts.db ?? getDb();
  ensureObserverSchema(db);
  const existing = getChatObserver(opts);
  if (!existing) return null;
  db.prepare(
    `UPDATE chat_observers SET
       is_active=0, retired_turn=?, updated_at=datetime('now')
     WHERE chat_id=? AND observer_type=? AND observer_id=?`
  ).run(opts.retiredTurn, opts.chatId, opts.observerType, opts.observerId);
  return getChatObserver(opts);
}

export function ensureMainCharacterObserver(opts: {
  chatId: number;
  characterId: number;
  displayName?: string;
  createdTurn?: number | null;
  db?: Database.Database;
}): { row: ChatObserverRow; inserted: boolean } {
  const observerId = mainCharacterObserverId(opts.characterId);
  return upsertChatObserver(
    {
      chatId: opts.chatId,
      observerType: "CHARACTER",
      observerId,
      canonicalSourceType: "MAIN_CHARACTER",
      canonicalSourceId: observerId,
      displayName: opts.displayName ?? "",
      createdTurn: opts.createdTurn,
    },
    opts.db
  );
}

function safeParseMeta(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
