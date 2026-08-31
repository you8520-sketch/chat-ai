/**
 * M1 drop-compatibility — historical #796 rollback safety (memory column absent lifecycle).
 * M2 fresh DB has no memory column; tests use synthetic schemas for FAIL-BEFORE evidence.
 */
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
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { after, before, describe, it } from "node:test";
import { getDb } from "@/lib/db";
import { createChatSession } from "@/lib/chatSessionCreate";
import {
  FORK_CHAT_INSERT_SQL,
  insertForkChatRow,
  type ForkChatInsertParams,
} from "@/lib/chatForkCreate";
import {
  hasChatsMemoryColumn,
} from "@/lib/memory/chats-memory-column-compat";
import { convergeLegacyChatsMemoryIntoCanonical } from "@/lib/memory/chats-memory-convergence";
import { getOrCreateChatMemory } from "@/lib/memory/memory-db";
import { syncChatLongTermMemory } from "@/lib/memory/memory-rolling-summary";
import { executeAtomicMemoryResetCore } from "@/lib/memory/memory-source-boundary";
import { reconcileMemoryAfterVariantSwitch } from "@/lib/memory/memory-variant-switch-reconcile";
import {
  installIsolatedTestDatabase,
  uninstallIsolatedTestDatabase,
} from "@/lib/test/isolatedTestDatabase";

const LEGACY_FORK_CHAT_INSERT_SQL_WITH_MEMORY = `INSERT INTO chats (
  user_id, character_id, mode, memory, memory_pending, memory_meta,
  memory_archived_turns, current_summary, gemini_model, user_note, selected_persona_id,
  user_impersonation, target_response_chars, title, writing_style_override, memory_capacity,
  narrative_pov, pov_character_name
) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`;

const USER_ID = 88001;
const CHARACTER_ID = 88002;
const CHAT_ID = 88003;

const FORK_INSERT_PARAMS: ForkChatInsertParams = {
  userId: USER_ID,
  characterId: CHARACTER_ID,
  mode: "safe",
  memoryPending: "[]",
  memoryMeta: "{}",
  memoryArchivedTurns: 0,
  currentSummary: "",
  geminiModel: "",
  userNote: "",
  selectedPersonaId: null,
  userImpersonation: 0,
  targetResponseChars: 700,
  title: "fork-branch",
  writingStyleOverride: "",
  memoryCapacity: 4000,
  narrativePov: "third_person",
  povCharacterName: "",
};

function makeM2LikeChatsSchema(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE chats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      character_id INTEGER NOT NULL,
      mode TEXT NOT NULL DEFAULT 'safe',
      memory_pending TEXT NOT NULL DEFAULT '[]',
      memory_meta TEXT NOT NULL DEFAULT '{}',
      memory_archived_turns INTEGER NOT NULL DEFAULT 0,
      current_summary TEXT NOT NULL DEFAULT '',
      gemini_model TEXT NOT NULL DEFAULT '',
      user_note TEXT NOT NULL DEFAULT '',
      selected_persona_id INTEGER,
      user_impersonation INTEGER NOT NULL DEFAULT 0,
      target_response_chars INTEGER NOT NULL DEFAULT 700,
      title TEXT NOT NULL DEFAULT '',
      writing_style_override TEXT NOT NULL DEFAULT '',
      memory_capacity INTEGER NOT NULL DEFAULT 4000,
      narrative_pov TEXT NOT NULL DEFAULT 'third_person',
      pov_character_name TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE chat_memories (
      chat_id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL,
      character_id INTEGER NOT NULL,
      recent_summary TEXT NOT NULL DEFAULT '',
      archive_summary TEXT NOT NULL DEFAULT '',
      membership_tier TEXT NOT NULL DEFAULT 'free',
      used_chars INTEGER NOT NULL DEFAULT 0,
      message_count INTEGER NOT NULL DEFAULT 0,
      summarized_turn_count INTEGER NOT NULL DEFAULT 0,
      memory_reset_after_message_id INTEGER,
      memory_epoch INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  return db;
}

function makeM1LikeChatsSchemaWithMemory(): Database.Database {
  const db = makeM2LikeChatsSchema();
  db.exec(`ALTER TABLE chats ADD COLUMN memory TEXT NOT NULL DEFAULT ''`);
  return db;
}

function ensureLiveDbWithoutMemoryColumn(db: Database.Database): void {
  if (hasChatsMemoryColumn(db)) {
    db.exec(`ALTER TABLE chats DROP COLUMN memory`);
  }
  assert.ok(!hasChatsMemoryColumn(db));
}

function legacyForkInsertArgs(): unknown[] {
  return [
    USER_ID,
    CHARACTER_ID,
    "safe",
    "",
    "[]",
    "{}",
    0,
    "",
    "",
    "",
    null,
    0,
    700,
    "fork-branch",
    "",
    4000,
    "third_person",
    "",
  ];
}

function forkInsertArgsFromParams(params: ForkChatInsertParams): unknown[] {
  return [
    params.userId,
    params.characterId,
    params.mode,
    params.memoryPending,
    params.memoryMeta,
    params.memoryArchivedTurns,
    params.currentSummary,
    params.geminiModel,
    params.userNote,
    params.selectedPersonaId,
    params.userImpersonation,
    params.targetResponseChars,
    params.title,
    params.writingStyleOverride,
    params.memoryCapacity,
    params.narrativePov,
    params.povCharacterName,
  ];
}

function seedLiveUserCharacterChat(db: Database.Database): void {
  db.prepare(`DELETE FROM chat_memories WHERE chat_id=?`).run(CHAT_ID);
  db.prepare(`DELETE FROM chats WHERE id=?`).run(CHAT_ID);
  db.prepare(`DELETE FROM characters WHERE id=?`).run(CHARACTER_ID);
  db.prepare(`DELETE FROM users WHERE id=?`).run(USER_ID);
  db.prepare(
    `INSERT INTO users (id, email, nickname, pw_hash) VALUES (?,?,?,?)`
  ).run(USER_ID, "dropcompat@test.local", "dropcompat", "x");
  db.prepare(`INSERT INTO characters (id, name) VALUES (?,?)`).run(CHARACTER_ID, "c");
  db.prepare(
    `INSERT INTO chats (id, user_id, character_id, mode, current_summary) VALUES (?,?,?,'safe',?)`
  ).run(CHAT_ID, USER_ID, CHARACTER_ID, "");
}

function collectProductionTsFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (entry === "node_modules" || entry.startsWith(".")) continue;
      collectProductionTsFiles(full, acc);
      continue;
    }
    if (!full.endsWith(".ts") && !full.endsWith(".tsx")) continue;
    if (full.endsWith(".test.ts") || full.endsWith(".test.tsx")) continue;
    acc.push(full);
  }
  return acc;
}

describe("chats.memory M1 drop-compat FAIL-BEFORE", () => {
  it("FORK_INSERT_WITH_MEMORY_COLUMN_ABSENT fails at prepare on legacy INSERT", () => {
    const db = makeM2LikeChatsSchema();
    assert.throws(
      () => db.prepare(LEGACY_FORK_CHAT_INSERT_SQL_WITH_MEMORY),
      /column named memory|no such column: memory/
    );
  });

  it("legacy fork INSERT succeeds only when memory column exists", () => {
    const db = makeM1LikeChatsSchemaWithMemory();
    const info = db.prepare(LEGACY_FORK_CHAT_INSERT_SQL_WITH_MEMORY).run(...legacyForkInsertArgs());
    assert.ok(Number(info.lastInsertRowid) > 0);
    db.close();
  });
});

describe("chats.memory M1 drop-compat fork INSERT correction", () => {
  it("production fork INSERT omits memory column (17 placeholders)", () => {
    const placeholderCount = (FORK_CHAT_INSERT_SQL.match(/\?/g) ?? []).length;
    assert.equal(placeholderCount, 17);
    assert.ok(!/\bmemory,\s*memory_pending\b/.test(FORK_CHAT_INSERT_SQL));
  });

  it("MEMORY_COLUMN_ABSENT_CREATION: insertForkChatRow PASS", () => {
    const db = makeM2LikeChatsSchema();
    const newChatId = insertForkChatRow(db, FORK_INSERT_PARAMS);
    const row = db
      .prepare(`SELECT current_summary, memory_pending FROM chats WHERE id=?`)
      .get(newChatId) as { current_summary: string; memory_pending: string };
    assert.equal(row.current_summary, "");
    assert.equal(row.memory_pending, "[]");
  });

  it("MEMORY_COLUMN_PRESENT_CREATION: omit memory → DEFAULT empty", () => {
    const db = makeM1LikeChatsSchemaWithMemory();
    const newChatId = insertForkChatRow(db, FORK_INSERT_PARAMS);
    const row = db
      .prepare(`SELECT memory, current_summary FROM chats WHERE id=?`)
      .get(newChatId) as { memory: string; current_summary: string };
    assert.equal(row.memory, "");
    assert.equal(row.current_summary, "");
  });

  it("fork INSERT placeholder count matches argument ordering", () => {
    const db = makeM2LikeChatsSchema();
    const args = forkInsertArgsFromParams(FORK_INSERT_PARAMS);
    assert.equal((FORK_CHAT_INSERT_SQL.match(/\?/g) ?? []).length, args.length);
    const info = db.prepare(FORK_CHAT_INSERT_SQL).run(...args);
    assert.ok(Number(info.lastInsertRowid) > 0);
  });
});

describe("chats.memory M2 → M1 rollback matrix (synthetic)", () => {
  it("C1 STARTUP_CONVERGENCE: memory absent + current_summary orphan → canonical", () => {
    const db = makeM2LikeChatsSchema();
    db.prepare(
      `INSERT INTO chats (id, user_id, character_id, current_summary) VALUES (?,?,?,?)`
    ).run(CHAT_ID, USER_ID, CHARACTER_ID, "ORPHAN MIRROR");
    convergeLegacyChatsMemoryIntoCanonical(db);
    const row = db
      .prepare(`SELECT recent_summary FROM chat_memories WHERE chat_id=?`)
      .get(CHAT_ID) as { recent_summary: string };
    assert.equal(row.recent_summary, "ORPHAN MIRROR");
  });

  it("C5 FORK_MEMORY_INIT mirror SQL: memory absent → PASS", () => {
    const db = makeM2LikeChatsSchema();
    const forkChatId = insertForkChatRow(db, FORK_INSERT_PARAMS);
    db.prepare(
      `INSERT INTO chat_memories (chat_id, user_id, character_id, recent_summary, archive_summary, membership_tier, used_chars)
       VALUES (?,?,?,?,?,?,?)`
    ).run(forkChatId, USER_ID, CHARACTER_ID, "", "", "free", 0);
    assert.doesNotThrow(() =>
      db
        .prepare(
          `UPDATE chats SET current_summary=?, memory_archived_turns=? WHERE id=? AND user_id=?`
        )
        .run("fork summary", 3, forkChatId, USER_ID)
    );
    const row = db
      .prepare(`SELECT current_summary, memory_archived_turns FROM chats WHERE id=?`)
      .get(forkChatId) as { current_summary: string; memory_archived_turns: number };
    assert.equal(row.current_summary, "fork summary");
    assert.equal(row.memory_archived_turns, 3);
  });

  it("C6 FORK_CHAT_INSERT: memory absent → new row PASS", () => {
    const db = makeM2LikeChatsSchema();
    assert.doesNotThrow(() => insertForkChatRow(db, FORK_INSERT_PARAMS));
  });
});

describe("chats.memory M2 → M1 rollback matrix (live DB column dropped)", () => {
  before(() => {
    installIsolatedTestDatabase();
    getDb();
    ensureLiveDbWithoutMemoryColumn(getDb());
  });

  after(() => {
    uninstallIsolatedTestDatabase();
  });

  it("C2 GET_OR_CREATE: memory absent → PASS", () => {
    const db = getDb();
    seedLiveUserCharacterChat(db);
    db.prepare(`UPDATE chats SET current_summary=? WHERE id=?`).run("LAZY MIRROR", CHAT_ID);
    const row = getOrCreateChatMemory(CHAT_ID, USER_ID, CHARACTER_ID, "free");
    assert.equal(row.recent_summary, "LAZY MIRROR");
  });

  it("C3 RESET: memory absent → PASS", () => {
    const db = getDb();
    seedLiveUserCharacterChat(db);
    db.prepare(`UPDATE chats SET current_summary=? WHERE id=?`).run("before reset", CHAT_ID);
    db.prepare(
      `INSERT OR REPLACE INTO chat_memories
        (chat_id, user_id, character_id, recent_summary, archive_summary, membership_tier, used_chars, summarized_turn_count)
       VALUES (?,?,?,?,?,?,?,0)`
    ).run(CHAT_ID, USER_ID, CHARACTER_ID, "before reset", "", "free", 12);
    assert.doesNotThrow(() =>
      executeAtomicMemoryResetCore(db, {
        chatId: CHAT_ID,
        userId: USER_ID,
        characterId: CHARACTER_ID,
        tier: "free",
      })
    );
    const chat = db
      .prepare(`SELECT current_summary FROM chats WHERE id=?`)
      .get(CHAT_ID) as { current_summary: string };
    assert.equal(chat.current_summary, "");
  });

  it("C4 VARIANT_SWITCH: memory absent → current_summary mirror updated", () => {
    const db = getDb();
    seedLiveUserCharacterChat(db);
    getOrCreateChatMemory(CHAT_ID, USER_ID, CHARACTER_ID, "free");
    db.prepare(`UPDATE chat_memories SET recent_summary=? WHERE chat_id=?`).run("prior", CHAT_ID);
    const result = reconcileMemoryAfterVariantSwitch({
      chatId: CHAT_ID,
      userId: USER_ID,
      characterId: CHARACTER_ID,
      tier: "free",
      memoryCapacity: 4000,
      sourceTurn: 1,
    });
    assert.equal(result.attempted, true);
    const chat = db
      .prepare(`SELECT current_summary FROM chats WHERE id=?`)
      .get(CHAT_ID) as { current_summary: string };
    assert.equal(chat.current_summary, "");
  });

  it("C7 NORMAL_CHAT_CREATE: memory absent → PASS", () => {
    const db = getDb();
    db.prepare(`DELETE FROM users WHERE id=?`).run(USER_ID);
    db.prepare(`DELETE FROM characters WHERE id=?`).run(CHARACTER_ID);
    db.prepare(
      `INSERT INTO users (id, email, nickname, pw_hash) VALUES (?,?,?,?)`
    ).run(USER_ID, "normalcreate@test.local", "nc", "x");
    db.prepare(`INSERT INTO characters (id, name) VALUES (?,?)`).run(CHARACTER_ID, "c");
    const chatId = createChatSession({ userId: USER_ID, characterId: CHARACTER_ID });
    const row = db.prepare(`SELECT id FROM chats WHERE id=?`).get(chatId);
    assert.ok(row);
  });

  it("C8 ROLLING_SUMMARY mirror: memory absent → current_summary updated", () => {
    const db = getDb();
    seedLiveUserCharacterChat(db);
    syncChatLongTermMemory(CHAT_ID, "rolling mirror text");
    const row = db
      .prepare(`SELECT current_summary FROM chats WHERE id=?`)
      .get(CHAT_ID) as { current_summary: string };
    assert.equal(row.current_summary, "rolling mirror text");
  });
});

describe("chats.memory M1 production physical dependency audit", () => {
  it("no unguarded production INSERT/SELECT/UPDATE on chats.memory", () => {
    const srcRoot = join(process.cwd(), "src");
    const files = collectProductionTsFiles(srcRoot);
    const insertHits: string[] = [];
    const selectHits: string[] = [];
    const updateHits: string[] = [];

    const allowedFiles = new Set([
      join(srcRoot, "lib/memory/chats-memory-convergence.ts"),
      join(srcRoot, "lib/memory/chats-memory-column-compat.ts"),
      join(srcRoot, "lib/chatForkCreate.ts"),
    ]);

    for (const file of files) {
      const src = readFileSync(file, "utf8");
      if (allowedFiles.has(file)) continue;
      if (/INSERT INTO chats[\s\S]*?\(\s*[^)]*\bmemory\s*,/.test(src)) insertHits.push(file);
      if (/SELECT[\s\S]*?(\bmemory\s*,|\,\s*memory\b|\bmemory\s+FROM)[\s\S]*?FROM chats/.test(src)) {
        selectHits.push(file);
      }
      if (/UPDATE chats SET[^;]*?\bmemory\s*=/.test(src)) updateHits.push(file);
    }

    assert.deepEqual(insertHits, [], `unguarded INSERT: ${insertHits.join(", ")}`);
    assert.deepEqual(selectHits, [], `unguarded SELECT: ${selectHits.join(", ")}`);
    assert.deepEqual(updateHits, [], `unguarded UPDATE: ${updateHits.join(", ")}`);
  });

  it("fork route uses production insertForkChatRow helper", () => {
    const forkRoute = readFileSync(
      join(process.cwd(), "src/app/api/chat/fork/route.ts"),
      "utf8"
    );
    assert.ok(forkRoute.includes("insertForkChatRow"));
    assert.ok(!/INSERT INTO chats[\s\S]*?\bmemory,\s*memory_pending/.test(forkRoute));
  });
});
