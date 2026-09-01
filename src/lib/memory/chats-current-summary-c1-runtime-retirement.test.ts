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
import { after, before, beforeEach, describe, it } from "node:test";
import { getDb, convergeLegacyChatsMemoryIntoCanonical } from "@/lib/db";
import { insertForkChatRow } from "@/lib/chatForkCreate";
import { hasChatsCurrentSummaryColumn, hasChatsMemoryColumn } from "@/lib/memory/chats-memory-column-compat";
import { buildMemoryContext } from "@/lib/memory/memory-injector";
import { initializeForkChatMemory } from "@/lib/memory/memory-fork-snapshot";
import {
  getOrCreateChatMemory,
} from "@/lib/memory/memory-db";
import { executeAtomicMemoryResetCore } from "@/lib/memory/memory-source-boundary";
import { updateLorebookForChat } from "@/lib/memory/memory-manager";
import { persistValidatedSummaryBatch } from "@/lib/memory/memory-summary-persist";
import { reconcileMemoryAfterVariantSwitchCore } from "@/lib/memory/memory-variant-switch-reconcile";
import {
  listVisibleMemoryRecordsForChat,
  rebuildLorebookFromRecords,
} from "@/lib/memory/memory-turn-summary";
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

const VARIANT_SUMMARY_WITH_D =
  "본편에서 분노_D_골목 사건이 발생했다 → 인물이 격하게 반응하며 관계를 흔들었다 → " +
  "거절된 세계선 D의 단서가 요약에 남았다 → 장면을 정리하며 다음 만남을 예고했다.";

const VARIANT_SUMMARY_PRIOR =
  "본편에서 이전 약속이 유지되었다 → 인물이 차분히 대화를 이어갔다 → " +
  "관계 흐름이 안정되며 둘만의 규칙을 확인했다 → 이별 전 장면을 정리했다.";

const PERSIST_FIXTURE =
  "레온은 연회장 테라스에서 렌을 만나 정원을 안내했다 → 렌의 청혼에 흔들리며 감정을 드러냈다 → " +
  "커프링크스를 받으며 둘만의 약속을 나눴다 → 이별 전 심장을 맡긴다고 고백했다.";

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

function dropCurrentSummaryColumnOnProductionDb(): void {
  const db = getDb();
  assert.ok(
    hasChatsCurrentSummaryColumn(db),
    "isolated production DB must include current_summary before synthetic C2 DROP"
  );
  const indexes = db
    .prepare(`SELECT name, sql FROM sqlite_master WHERE type='index' AND tbl_name='chats'`)
    .all() as { name: string; sql: string | null }[];
  for (const idx of indexes) {
    assert.ok(
      !String(idx.sql ?? "").includes("current_summary"),
      `C2 blocker: index ${idx.name} references current_summary`
    );
  }
  db.exec(`ALTER TABLE chats DROP COLUMN current_summary`);
  assert.equal(hasChatsCurrentSummaryColumn(db), false);
}

function cleanupColumnAbsentFixture(): void {
  const db = getDb();
  db.prepare("DELETE FROM chat_turn_summaries WHERE chat_id=?").run(CHAT_ID);
  db.prepare("DELETE FROM chat_memories WHERE chat_id=?").run(CHAT_ID);
  db.prepare("DELETE FROM messages WHERE chat_id=?").run(CHAT_ID);
  db.prepare("DELETE FROM chats WHERE id=?").run(CHAT_ID);
}

function seedChatColumnAbsent(): void {
  cleanupColumnAbsentFixture();
  getDb().prepare(
    `INSERT INTO chats (id, user_id, character_id, mode, memory_meta, memory_pending, memory_archived_turns)
     VALUES (?,?,?,'safe','{}','[]',0)`
  ).run(CHAT_ID, USER_ID, CHARACTER_ID);
}

function forkInsertParams(): Parameters<typeof insertForkChatRow>[1] {
  return {
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
    memoryCapacity: MEMORY_CAPACITY,
    narrativePov: "third",
    povCharacterName: "",
  };
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
});

describe("C2-like — physical current_summary absent runtime matrix", () => {
  before(() => {
    dropCurrentSummaryColumnOnProductionDb();
  });

  beforeEach(() => {
    cleanupColumnAbsentFixture();
  });

  it("GET_OR_CREATE Case A: existing canonical row returns without SQL error", () => {
    seedChatColumnAbsent();
    seedCanonical("CANONICAL");
    const row = getOrCreateChatMemory(CHAT_ID, USER_ID, CHARACTER_ID, TIER);
    assert.equal(row.recent_summary, "CANONICAL");
  });

  it("GET_OR_CREATE Case B: missing canonical creates empty row without SQL error", () => {
    seedChatColumnAbsent();
    const row = getOrCreateChatMemory(CHAT_ID, USER_ID, CHARACTER_ID, TIER);
    assert.equal(row.recent_summary, "");
    assert.ok(
      getDb().prepare(`SELECT 1 AS ok FROM chat_memories WHERE chat_id=?`).get(CHAT_ID)
    );
  });

  it("RESET: executeAtomicMemoryResetCore clears canonical without current_summary SQL", () => {
    seedChatColumnAbsent();
    const db = getDb();
    db.prepare(
      `INSERT INTO messages (chat_id, role, content, model) VALUES (?,?,?,?)`
    ).run(CHAT_ID, "assistant", "opening", "");
    const userMsgId = Number(
      db.prepare(`INSERT INTO messages (chat_id, role, content, model) VALUES (?,?,?,?)`).run(
        CHAT_ID,
        "user",
        "before",
        ""
      ).lastInsertRowid
    );
    const assistantId = Number(
      db
        .prepare(
          `INSERT INTO messages (chat_id, role, content, model, user_message_id) VALUES (?,?,?,?,?)`
        )
        .run(CHAT_ID, "assistant", "before reply", "model", userMsgId).lastInsertRowid
    );
    db.prepare(
      `INSERT INTO chat_memories
        (chat_id, user_id, character_id, recent_summary, archive_summary, membership_tier, used_chars, message_count, summarized_turn_count)
       VALUES (?,?,?,?,?,?,?,?,?)`
    ).run(CHAT_ID, USER_ID, CHARACTER_ID, "recent", "archive", TIER, 6, 1, 5);
    db.prepare(`INSERT INTO chat_turn_summaries (chat_id, turn_number, summary) VALUES (?,?,?)`).run(
      CHAT_ID,
      1,
      "old"
    );

    const result = executeAtomicMemoryResetCore(db, {
      chatId: CHAT_ID,
      userId: USER_ID,
      characterId: CHARACTER_ID,
      tier: TIER,
    });
    assert.equal(result.boundaryAfter, assistantId);
    assert.equal(result.epochAfter, 1);
    const memory = db
      .prepare(
        `SELECT recent_summary, archive_summary, used_chars, message_count, summarized_turn_count
         FROM chat_memories WHERE chat_id=?`
      )
      .get(CHAT_ID) as {
      recent_summary: string;
      archive_summary: string;
      used_chars: number;
      message_count: number;
      summarized_turn_count: number;
    };
    assert.equal(memory.recent_summary, "");
    assert.equal(memory.archive_summary, "");
    assert.equal(memory.used_chars, 0);
    assert.equal(memory.message_count, 0);
    assert.equal(memory.summarized_turn_count, 0);
    assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM chat_turn_summaries WHERE chat_id=?`).get(CHAT_ID).n, 0);
  });

  it("FORK_CREATE: insertForkChatRow on column-absent production DB", () => {
    const forkId = insertForkChatRow(getDb(), forkInsertParams());
    assert.ok(forkId > 0);
    const chat = getDb().prepare(`SELECT id FROM chats WHERE id=?`).get(forkId);
    assert.ok(chat);
  });

  it("FORK_INIT: initializeForkChatMemory on column-absent production DB", async () => {
    const forkId = insertForkChatRow(getDb(), forkInsertParams());
    const persisted = persistValidatedSummaryBatch({
      chatId: forkId,
      userId: USER_ID,
      characterId: CHARACTER_ID,
      tier: TIER,
      turnStart: 1,
      assistantMessageId: null,
      summary: PERSIST_FIXTURE,
      playableTurnCount: 8,
    });
    assert.equal(persisted.ok, true);

    const result = await initializeForkChatMemory({
      newChatId: forkId,
      userId: USER_ID,
      characterId: CHARACTER_ID,
      forkTurnCount: 5,
      tier: TIER,
      memoryCapacity: MEMORY_CAPACITY,
    });
    assert.ok(result.recentSummary.length > 0);
    const mem = getDb()
      .prepare(`SELECT recent_summary, summarized_turn_count FROM chat_memories WHERE chat_id=?`)
      .get(forkId) as { recent_summary: string; summarized_turn_count: number };
    assert.equal(mem.recent_summary, result.recentSummary);
    assert.equal(mem.summarized_turn_count, result.summarizedTurnCount);
  });

  it("VARIANT_SWITCH: reconcileMemoryAfterVariantSwitchCore on column-absent DB", () => {
    seedChatColumnAbsent();
    getOrCreateChatMemory(CHAT_ID, USER_ID, CHARACTER_ID, TIER);
    const db = getDb();
    for (let i = 1; i <= 2; i++) {
      db.prepare(`INSERT INTO messages (chat_id, role, content, model) VALUES (?,?,?,?)`).run(
        CHAT_ID,
        "user",
        `u${i}`,
        ""
      );
      db.prepare(`INSERT INTO messages (chat_id, role, content, model) VALUES (?,?,?,?)`).run(
        CHAT_ID,
        "assistant",
        i === 2 ? "D prose rejected worldline" : `a${i}`,
        "test"
      );
    }
    const prior = persistValidatedSummaryBatch({
      chatId: CHAT_ID,
      userId: USER_ID,
      characterId: CHARACTER_ID,
      tier: TIER,
      turnStart: 1,
      assistantMessageId: null,
      summary: VARIANT_SUMMARY_PRIOR,
      playableTurnCount: 8,
    });
    assert.equal(prior.ok, true);
    db.prepare(
      `UPDATE chat_turn_summaries SET summary=?, inactive=0, updated_at=datetime('now')
       WHERE chat_id=? AND turn_number=1`
    ).run(VARIANT_SUMMARY_WITH_D, CHAT_ID);
    db.prepare(`UPDATE chat_memories SET recent_summary=?, updated_at=datetime('now') WHERE chat_id=?`).run(
      VARIANT_SUMMARY_WITH_D,
      CHAT_ID
    );
    assert.ok(
      listVisibleMemoryRecordsForChat(CHAT_ID).some((r) => r.summary.includes("분노_D_골목"))
    );

    const result = reconcileMemoryAfterVariantSwitchCore(db, {
      chatId: CHAT_ID,
      userId: USER_ID,
      characterId: CHARACTER_ID,
      tier: TIER,
      memoryCapacity: MEMORY_CAPACITY,
      sourceTurn: 2,
    });
    assert.equal(result.attempted, true);
    const lorebook = rebuildLorebookFromRecords(CHAT_ID);
    assert.ok(!lorebook.includes("분노_D_골목"));
    const recent = db
      .prepare(`SELECT recent_summary FROM chat_memories WHERE chat_id=?`)
      .get(CHAT_ID) as { recent_summary: string };
    assert.ok(!recent.recent_summary.includes("분노_D_골목"));
  });

  it("SUMMARY_PERSIST: persistValidatedSummaryBatch updates canonical on column-absent DB", () => {
    seedChatColumnAbsent();
    const result = persistValidatedSummaryBatch({
      chatId: CHAT_ID,
      userId: USER_ID,
      characterId: CHARACTER_ID,
      tier: TIER,
      turnStart: 1,
      assistantMessageId: null,
      summary: PERSIST_FIXTURE,
      playableTurnCount: 10,
    });
    assert.equal(result.ok, true);
    const recent = getDb()
      .prepare(`SELECT recent_summary FROM chat_memories WHERE chat_id=?`)
      .get(CHAT_ID) as { recent_summary: string };
    assert.ok(recent.recent_summary.includes("레온"));
    assert.equal(hasChatsCurrentSummaryColumn(getDb()), false);
  });

  it("MANUAL_MEMORY_EDIT: updateLorebookForChat on column-absent DB", async () => {
    seedChatColumnAbsent();
    seedCanonical("prior");
    await updateLorebookForChat(
      CHAT_ID,
      USER_ID,
      CHARACTER_ID,
      "manual edit on absent column",
      TIER,
      MEMORY_CAPACITY
    );
    assert.equal(readRecentSummary(), "manual edit on absent column");
  });

  it("PROMPT_INJECTION: getOrCreateChatMemory → buildMemoryContext on column-absent DB", () => {
    seedChatColumnAbsent();
    seedCanonical("injected canonical body");
    const memory = getOrCreateChatMemory(CHAT_ID, USER_ID, CHARACTER_ID, TIER);
    const injection = buildMemoryContext({
      memory,
      userMessage: "test",
      memoryCapacity: MEMORY_CAPACITY,
    });
    assert.ok(injection.text.includes("injected canonical body"));
  });

  it("GLOBAL_CONVERGENCE: both legacy columns absent with existing canonical is no-op", () => {
    seedChatColumnAbsent();
    seedCanonical("KEEP ME");
    convergeLegacyChatsMemoryIntoCanonical(getDb());
    assert.equal(readRecentSummary(), "KEEP ME");
  });

  it("GLOBAL_CONVERGENCE: memory-only orphan preserved when memory column present", () => {
    seedChatColumnAbsent();
    const db = getDb();
    if (!hasChatsMemoryColumn(db)) {
      db.exec(`ALTER TABLE chats ADD COLUMN memory TEXT NOT NULL DEFAULT ''`);
    }
    db.prepare(`DELETE FROM chat_memories WHERE chat_id=?`).run(CHAT_ID);
    db.prepare(`UPDATE chats SET memory=? WHERE id=?`).run("OLD MEMORY ONLY", CHAT_ID);
    convergeLegacyChatsMemoryIntoCanonical(db);
    assert.equal(readRecentSummary(), "OLD MEMORY ONLY");
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
