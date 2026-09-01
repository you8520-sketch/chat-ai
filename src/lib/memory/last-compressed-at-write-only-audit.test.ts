import Module from "module";

const originalLoad = (Module as unknown as { _load: typeof Module._load })._load;
(Module as unknown as { _load: typeof Module._load })._load = function (
  request: string,
  parent: NodeModule,
  isMain: boolean
) {
  if (request === "server-only") return {};
  return originalLoad(request, parent, isMain);
} as typeof Module._load;

import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { after, before, describe, it } from "node:test";
import { getDb, dropLastCompressedAtColumnOnce } from "@/lib/db";
import { ROLLING_SUMMARY_INTERVAL, RAW_HISTORY_COMPLETE_EXCHANGES } from "./memory-constants";
import { buildMemoryContext } from "./memory-injector";
import { getMemorySnapshot, updateLorebookForChat } from "./memory-manager";
import { MEMORY_CAPACITY_FIXED } from "./memory-capacity-shared";
import {
  getOrCreateChatMemory,
  updateChatMemory,
} from "./memory-db";
import {
  getMemorySourceBoundaryCore,
  invalidateDerivedMemoryGenerationCore,
} from "./memory-source-boundary";
import {
  installIsolatedTestDatabase,
  uninstallIsolatedTestDatabase,
} from "@/lib/test/isolatedTestDatabase";

function hasPhysicalLastCompressedAtColumn(db: Database.Database): boolean {
  const cols = db.prepare(`PRAGMA table_info(chat_memories)`).all() as Array<{ name: string }>;
  return cols.some((col) => col.name === "last_compressed_at");
}

function seedChatMemoryRow(db: Database.Database, chatId: number, lastCompressedAt: string | null): void {
  if (!hasPhysicalLastCompressedAtColumn(db)) {
    db.exec(`ALTER TABLE chat_memories ADD COLUMN last_compressed_at TEXT`);
  }
  db.prepare(
    `INSERT OR REPLACE INTO chat_memories
      (chat_id, user_id, character_id, recent_summary, archive_summary, used_chars,
       message_count, summarized_turn_count, last_compressed_at)
     VALUES (?,?,?,?,?,?,?,?,?)`
  ).run(chatId, 1, 2, "canonical recent", "archive body", 20, 5, 5, lastCompressedAt);
}

before(() => installIsolatedTestDatabase());
after(() => uninstallIsolatedTestDatabase());

describe("last_compressed_at write-only audit", () => {
  it("L1 getOrCreateChatMemory works without runtime field", () => {
    getDb();
    const row = getOrCreateChatMemory(88001, 1, 2, "free");
    assert.equal(row.recent_summary, "");
    assert.equal("last_compressed_at" in row, false);
  });

  it("L5 updateChatMemory supported patches exclude last_compressed_at", () => {
    getDb();
    const row = updateChatMemory(88002, 1, 2, {
      recent_summary: "patched",
      message_count: 3,
      summarized_turn_count: 2,
      membership_tier: "free",
    });
    assert.equal(row.recent_summary, "patched");
    assert.equal(row.message_count, 3);
    assert.equal(row.summarized_turn_count, 2);
    assert.equal("last_compressed_at" in row, false);
  });

  it("L7 fresh init physically retires last_compressed_at column", () => {
    getDb();
    assert.equal(hasPhysicalLastCompressedAtColumn(getDb()), false);
  });

  it("L8 historical non-null timestamp does not change injection or snapshot decisions", () => {
    const db = getDb();
    seedChatMemoryRow(db, 88003, "2020-01-01T00:00:00.000Z");
    seedChatMemoryRow(db, 88004, null);

    const rowA = getOrCreateChatMemory(88003, 1, 2, "free");
    const rowB = getOrCreateChatMemory(88004, 1, 2, "free");

    rowB.recent_summary = rowA.recent_summary;
    rowB.archive_summary = rowA.archive_summary;
    rowB.used_chars = rowA.used_chars;
    rowB.message_count = rowA.message_count;
    rowB.summarized_turn_count = rowA.summarized_turn_count;

    const injectionA = buildMemoryContext({
      memory: {
        recent_summary: rowA.recent_summary,
        archive_summary: rowA.archive_summary,
        membership_tier: "free",
      },
      userMessage: "hello",
      memoryCapacity: MEMORY_CAPACITY_FIXED,
      includeArchiveAlways: true,
    });
    const injectionB = buildMemoryContext({
      memory: {
        recent_summary: rowB.recent_summary,
        archive_summary: rowB.archive_summary,
        membership_tier: "free",
      },
      userMessage: "hello",
      memoryCapacity: MEMORY_CAPACITY_FIXED,
      includeArchiveAlways: true,
    });

    assert.equal(injectionA.text, injectionB.text);
    assert.equal(injectionA.usedChars, injectionB.usedChars);

    const snapA = getMemorySnapshot(88003, 1, 2, "free", MEMORY_CAPACITY_FIXED);
    const snapB = getMemorySnapshot(88004, 1, 2, "free", MEMORY_CAPACITY_FIXED);
    assert.equal(snapA.messagesUntilCompression, snapB.messagesUntilCompression);
    assert.equal(snapA.lorebook, snapB.lorebook);
  });

  it("L4 global memory reset runtime removed; invalidation preserves canonical text", () => {
    const db = getDb();
    db.exec(`
      CREATE TABLE IF NOT EXISTS chats (
        id INTEGER PRIMARY KEY,
        user_id INTEGER NOT NULL,
        character_id INTEGER NOT NULL,
        current_summary TEXT NOT NULL DEFAULT '',
        memory TEXT NOT NULL DEFAULT '',
        memory_meta TEXT NOT NULL DEFAULT '{}',
        memory_pending TEXT NOT NULL DEFAULT '[]',
        memory_archived_turns INTEGER NOT NULL DEFAULT 0
      );
      INSERT OR IGNORE INTO chats (id, user_id, character_id) VALUES (88005, 1, 2);
      CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY, chat_id INTEGER NOT NULL);
    `);
    seedChatMemoryRow(db, 88005, "stale timestamp");
    db.prepare(`UPDATE chat_memories SET recent_summary='before invalidation' WHERE chat_id=88005`).run();

    invalidateDerivedMemoryGenerationCore(db, 88005);

    const row = getOrCreateChatMemory(88005, 1, 2, "free");
    assert.equal(row.recent_summary, "before invalidation");
    assert.equal(getMemorySourceBoundaryCore(db, 88005).epoch, 1);
  });

  it("L6 no runtime ChatMemoryRow field after lorebook update path", async () => {
    getDb();
    const db = getDb();
    seedChatMemoryRow(db, 88006, null);
    db.prepare(`UPDATE chat_memories SET recent_summary=? WHERE chat_id=88006`).run("x".repeat(12000));

    await updateLorebookForChat(88006, 1, 2, "x".repeat(12000), "free", MEMORY_CAPACITY_FIXED);
    const row = getOrCreateChatMemory(88006, 1, 2, "free");
    assert.equal("last_compressed_at" in row, false);
  });
});

describe("last_compressed_at policy constants unchanged", () => {
  it("rolling summary interval remains 5 and raw history exchanges remain 4", () => {
    assert.equal(ROLLING_SUMMARY_INTERVAL, 5);
    assert.equal(RAW_HISTORY_COMPLETE_EXCHANGES, 4);
  });
});

describe("last_compressed_at V6 physical retirement on init", () => {
  it("migrate drops legacy last_compressed_at carrier without affecting runtime row shape", () => {
    const db = getDb();
    if (!hasPhysicalLastCompressedAtColumn(db)) {
      db.exec(`ALTER TABLE chat_memories ADD COLUMN last_compressed_at TEXT`);
    }
    seedChatMemoryRow(db, 88007, "historical-write-carrier");
    dropLastCompressedAtColumnOnce(db);
    assert.equal(hasPhysicalLastCompressedAtColumn(db), false);
    const row = getOrCreateChatMemory(88007, 1, 2, "free");
    assert.equal("last_compressed_at" in row, false);
  });
});
