/**
 * C1 — chats.current_summary runtime mirror/fallback retirement.
 * Physical column KEPT; V7 unchanged; no mirror parity fixes.
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
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { after, before, describe, it } from "node:test";
import { getDb, convergeLegacyChatsMemoryIntoCanonical } from "@/lib/db";
import { insertForkChatRow } from "@/lib/chatForkCreate";
import { hasChatsCurrentSummaryColumn } from "@/lib/memory/chats-memory-column-compat";
import { buildMemoryContext } from "@/lib/memory/memory-injector";
import {
  getOrCreateChatMemory,
} from "@/lib/memory/memory-db";
import { executeAtomicMemoryResetCore } from "@/lib/memory/memory-source-boundary";
import { updateLorebookForChat } from "@/lib/memory/memory-manager";
import { initializeRemoteSchema, REMOTE_SCHEMA_VERSION } from "@/lib/remoteSchemaBootstrap";
import { hasCurrentRemoteSchemaInvariant } from "@/lib/remoteSchemaCurrentInvariant";
import { ensureChatBillingSettlementSchema } from "@/lib/chatBillingSettlementSchema";
import { ROLLING_SUMMARY_INTERVAL, RAW_HISTORY_COMPLETE_EXCHANGES } from "./memory-constants";
import {
  installIsolatedTestDatabase,
  uninstallIsolatedTestDatabase,
} from "@/lib/test/isolatedTestDatabase";

const CHAT_ID = 99201;
const USER_ID = 1;
const CHARACTER_ID = 2;
const TIER = "free" as const;
const MEMORY_CAPACITY = 10_000;

function cleanup(): void {
  const db = getDb();
  db.prepare("DELETE FROM chat_memories WHERE chat_id=?").run(CHAT_ID);
  db.prepare("DELETE FROM chats WHERE id=?").run(CHAT_ID);
}

function seedChat(currentSummary: string): void {
  const db = getDb();
  cleanup();
  db.prepare(
    `INSERT INTO chats (id, user_id, character_id, mode, current_summary, memory_meta, memory_pending, memory_archived_turns)
     VALUES (?,?,?,'safe',?,'{}','[]',0)`
  ).run(CHAT_ID, USER_ID, CHARACTER_ID, currentSummary);
}

function seedChatWithoutCurrentSummaryColumn(): void {
  const db = getDb();
  cleanup();
  db.exec(`
    CREATE TABLE chats (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL,
      character_id INTEGER NOT NULL,
      mode TEXT NOT NULL DEFAULT 'safe',
      memory_meta TEXT NOT NULL DEFAULT '{}',
      memory_pending TEXT NOT NULL DEFAULT '[]',
      memory_archived_turns INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  db.prepare(
    `INSERT INTO chats (id, user_id, character_id, mode, memory_meta, memory_pending, memory_archived_turns)
     VALUES (?,?,?,'safe','{}','[]',0)`
  ).run(CHAT_ID, USER_ID, CHARACTER_ID);
}

function seedCanonical(recentSummary: string): void {
  getDb().prepare(
    `INSERT INTO chat_memories
      (chat_id, user_id, character_id, recent_summary, archive_summary, membership_tier, used_chars, summarized_turn_count)
     VALUES (?,?,?,?,?,?,?,0)`
  ).run(CHAT_ID, USER_ID, CHARACTER_ID, recentSummary, "", TIER, recentSummary.length);
}

function readCurrentSummary(): string {
  const db = getDb();
  if (!hasChatsCurrentSummaryColumn(db)) return "";
  return (
    db.prepare(`SELECT current_summary FROM chats WHERE id=?`).get(CHAT_ID) as
      | { current_summary: string }
      | undefined
  )?.current_summary ?? "";
}

function readRecentSummary(): string {
  return (
    getDb()
      .prepare(`SELECT recent_summary FROM chat_memories WHERE chat_id=?`)
      .get(CHAT_ID) as { recent_summary: string } | undefined
  )?.recent_summary ?? "";
}

function countNonemptyCurrentSummary(db: Database.Database): number {
  if (!hasChatsCurrentSummaryColumn(db)) return 0;
  return (
    db
      .prepare(`SELECT COUNT(*) AS c FROM chats WHERE TRIM(COALESCE(current_summary,'')) <> ''`)
      .get() as { c: number }
  ).c;
}

function seedProductionRemoteCoreV7(db: Database.Database): void {
  db.exec(`
    CREATE TABLE web_push_outbox (id INTEGER);
    CREATE TABLE create_migration_event_applications (id INTEGER);
    CREATE TABLE beta_free_point_applications (id INTEGER);
    CREATE TABLE portone_checkouts (id INTEGER);
    CREATE TABLE _schema_flags (key TEXT PRIMARY KEY);
    INSERT INTO _schema_flags (key) VALUES
      ('board_posts_dedupe_v1'),
      ('target_response_chars_unified_3200'),
      ('memory_capacity_fixed_10000'),
      ('character_adult_status_metadata_v1');
    CREATE TABLE messages (request_id TEXT, memory_relationship_task_json TEXT);
    CREATE TABLE users (comment_report_restricted_until TEXT);
    CREATE TABLE profile_comments (delete_reason TEXT);
    CREATE TABLE characters (id INTEGER, total_turns INTEGER);
    INSERT INTO characters (id, total_turns) VALUES (1, 0);
    CREATE TABLE chats (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL,
      character_id INTEGER NOT NULL,
      mode TEXT NOT NULL DEFAULT 'safe',
      current_summary TEXT NOT NULL DEFAULT '',
      memory_meta TEXT NOT NULL DEFAULT '{}',
      memory_pending TEXT NOT NULL DEFAULT '[]',
      memory_archived_turns INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE chat_memories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id INTEGER NOT NULL UNIQUE,
      user_id INTEGER NOT NULL,
      character_id INTEGER NOT NULL,
      recent_summary TEXT NOT NULL DEFAULT '',
      archive_summary TEXT NOT NULL DEFAULT '',
      membership_tier TEXT NOT NULL DEFAULT 'free',
      used_chars INTEGER NOT NULL DEFAULT 0,
      message_count INTEGER NOT NULL DEFAULT 0,
      summarized_turn_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS _remote_schema_state (
      version TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    INSERT INTO _remote_schema_state (version) VALUES ('${REMOTE_SCHEMA_VERSION}');
  `);
  ensureChatBillingSettlementSchema(db);
}

function listProductionTsFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (entry === "node_modules" || entry === ".next" || entry === ".next-dev") continue;
      listProductionTsFiles(full, acc);
    } else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.(ts|tsx)$/.test(entry)) {
      acc.push(full);
    }
  }
  return acc;
}

before(() => installIsolatedTestDatabase());
after(() => uninstallIsolatedTestDatabase());

describe("chats.current_summary C1 — deploy convergence reachability", () => {
  it("C1-R1 already-current V7 remote DB reaches convergence without migrate callback", () => {
    const db = new Database(":memory:");
    seedProductionRemoteCoreV7(db);
    db.prepare(
      `INSERT INTO chats (id, user_id, character_id, current_summary) VALUES (1, 1, 2, 'LEGACY MIRROR')`
    ).run();
    db.prepare(
      `INSERT INTO chat_memories (chat_id, user_id, character_id, recent_summary, archive_summary, used_chars)
       VALUES (1, 1, 2, 'CANONICAL', '', 0)`
    ).run();
    assert.equal(hasCurrentRemoteSchemaInvariant(db), true);
    assert.equal(countNonemptyCurrentSummary(db), 1);

    let migrateCalls = 0;
    initializeRemoteSchema(db, () => {
      migrateCalls += 1;
    });
    assert.equal(migrateCalls, 0);

    convergeLegacyChatsMemoryIntoCanonical(db);
    assert.equal(
      (db.prepare(`SELECT recent_summary FROM chat_memories WHERE chat_id=1`).get() as { recent_summary: string })
        .recent_summary,
      "CANONICAL"
    );
    assert.equal(countNonemptyCurrentSummary(db), 0);
    db.close();
  });

  it("C1-R2 db.ts unconditional post-bootstrap convergence call", () => {
    const src = readFileSync(join(process.cwd(), "src/lib/db.ts"), "utf8");
    assert.ok(src.includes("convergeLegacyChatsMemoryIntoCanonical(db)"));
  });
});

describe("chats.current_summary C1 — global convergence", () => {
  it("C1-1 current_summary-only orphan → canonical preserved, current zeroed", () => {
    seedChat("ONLY COPY");
    convergeLegacyChatsMemoryIntoCanonical(getDb());
    assert.equal(readRecentSummary(), "ONLY COPY");
    assert.equal(readCurrentSummary(), "");
  });

  it("C1-2 existing canonical wins — legacy mirror cleared not overwritten", () => {
    seedChat("OLD");
    seedCanonical("NEW");
    convergeLegacyChatsMemoryIntoCanonical(getDb());
    assert.equal(readRecentSummary(), "NEW");
    assert.equal(readCurrentSummary(), "");
  });

  it("C1-3 empty canonical + stale current_summary → both cleared", () => {
    seedChat("OLD");
    seedCanonical("");
    convergeLegacyChatsMemoryIntoCanonical(getDb());
    assert.equal(readRecentSummary(), "");
    assert.equal(readCurrentSummary(), "");
  });
});

describe("chats.current_summary C1 — stale resurrection retirement", () => {
  it("C1-4 deleted canonical does not resurrect stale current_summary", () => {
    seedChat("OLD");
    seedCanonical("NEW");
    getDb().prepare("DELETE FROM chat_memories WHERE chat_id=?").run(CHAT_ID);
    const row = getOrCreateChatMemory(CHAT_ID, USER_ID, CHARACTER_ID, TIER);
    assert.equal(row.recent_summary, "");
    assert.notEqual(row.recent_summary, "OLD");
  });

  it("C1-5 reset then bootstrap does not resurrect stale mirror", () => {
    seedChat("before reset");
    seedCanonical("canonical body");
    executeAtomicMemoryResetCore(getDb(), {
      chatId: CHAT_ID,
      userId: USER_ID,
      characterId: CHARACTER_ID,
      tier: TIER,
    });
    assert.equal(readRecentSummary(), "");
    getDb().prepare("DELETE FROM chat_memories WHERE chat_id=?").run(CHAT_ID);
    const row = getOrCreateChatMemory(CHAT_ID, USER_ID, CHARACTER_ID, TIER);
    assert.equal(row.recent_summary, "");
  });
});

describe("chats.current_summary C1 — runtime owner retirement", () => {
  it("C1-6 manual lorebook edit canonical-only; prompt uses canonical", async () => {
    seedChat("stale mirror");
    seedCanonical("prior");
    await updateLorebookForChat(
      CHAT_ID,
      USER_ID,
      CHARACTER_ID,
      "manual edit body",
      TIER,
      MEMORY_CAPACITY
    );
    assert.equal(readRecentSummary(), "manual edit body");
    assert.equal(readCurrentSummary(), "stale mirror");
    const memory = getOrCreateChatMemory(CHAT_ID, USER_ID, CHARACTER_ID, TIER);
    const injection = buildMemoryContext({
      memory,
      userMessage: "test",
      memoryCapacity: MEMORY_CAPACITY,
    });
    assert.ok(injection.text.includes("manual edit body"));
  });

  it("C1-7 fork insert omits current_summary parameter", () => {
    cleanup();
    const forkId = insertForkChatRow(getDb(), {
      userId: USER_ID,
      characterId: CHARACTER_ID,
      mode: "safe",
      memoryMeta: "{}",
      memoryPending: "[]",
      memoryArchivedTurns: 0,
      geminiModel: "",
      userNote: "",
      selectedPersonaId: null,
      userImpersonation: 0,
      targetResponseChars: 3200,
      title: "",
      writingStyleOverride: "",
      memoryCapacity: 10_000,
      narrativePov: "third",
      povCharacterName: "",
    });
    const row = getDb()
      .prepare(`SELECT current_summary FROM chats WHERE id=?`)
      .get(forkId) as { current_summary: string };
    assert.equal(row.current_summary, "");
  });

  it("C1-8 column-absent runtime: getOrCreateChatMemory on schema without current_summary", () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE chats (
        id INTEGER PRIMARY KEY,
        user_id INTEGER NOT NULL,
        character_id INTEGER NOT NULL,
        mode TEXT NOT NULL DEFAULT 'safe',
        memory_meta TEXT NOT NULL DEFAULT '{}',
        memory_pending TEXT NOT NULL DEFAULT '[]',
        memory_archived_turns INTEGER NOT NULL DEFAULT 0
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
        summarized_turn_count INTEGER NOT NULL DEFAULT 0
      );
    `);
    db.prepare(
      `INSERT INTO chats (id, user_id, character_id) VALUES (?,?,?)`
    ).run(CHAT_ID, USER_ID, CHARACTER_ID);
    db.prepare(
      `INSERT INTO chat_memories
        (chat_id, user_id, character_id, recent_summary, archive_summary, membership_tier, used_chars, summarized_turn_count)
       VALUES (?,?,?,?,?,?,?,0)`
    ).run(CHAT_ID, USER_ID, CHARACTER_ID, "", "", TIER, 0);
    const row = db
      .prepare(
        `SELECT recent_summary FROM chat_memories WHERE chat_id=?`
      )
      .get(CHAT_ID) as { recent_summary: string };
    assert.equal(row.recent_summary, "");
    db.close();
  });
});

describe("chats.current_summary C1 — production dependency inventory", () => {
  it("C1-9 no production runtime mirror writers except historical convergence clear", () => {
    const root = join(process.cwd(), "src");
    const hits: string[] = [];
    for (const file of listProductionTsFiles(root)) {
      const rel = file.replace(process.cwd() + "/", "");
      const src = readFileSync(file, "utf8");
      if (/UPDATE\s+chats\s+SET[\s\S]*?current_summary\s*=/.test(src)) {
        if (rel === "src/lib/memory/chats-memory-convergence.ts") continue;
        hits.push(rel);
      }
    }
    assert.deepEqual(hits, []);
  });

  it("C1-10 resolveLongTermMemory removed from rollingSummary.ts", () => {
    const src = readFileSync(join(process.cwd(), "src/lib/rollingSummary.ts"), "utf8");
    assert.ok(!src.includes("resolveLongTermMemory"));
  });

  it("C1-11 policy constants unchanged", () => {
    assert.equal(ROLLING_SUMMARY_INTERVAL, 5);
    assert.equal(RAW_HISTORY_COMPLETE_EXCHANGES, 4);
  });
});
