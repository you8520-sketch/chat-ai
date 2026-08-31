/**
 * M1 — global chats.memory convergence + runtime fallback retirement.
 * Physical chats.memory column KEPT; current_summary mirror KEPT.
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
import { readFileSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { after, before, describe, it } from "node:test";
import { getDb, convergeLegacyChatsMemoryIntoCanonical } from "@/lib/db";
import {
  clearChatsMemoryColumnIfPresent,
  hasChatsMemoryColumn,
} from "@/lib/memory/chats-memory-column-compat";
import {
  convergeLegacyChatsMemoryIntoCanonical as convergeDirect,
  migrateLegacyCurrentSummaryIntoCanonical,
} from "@/lib/memory/chats-memory-convergence";
import {
  getOrCreateChatMemory,
} from "@/lib/memory/memory-db";
import { executeAtomicMemoryResetCore } from "@/lib/memory/memory-source-boundary";
import { ROLLING_SUMMARY_INTERVAL, RAW_HISTORY_COMPLETE_EXCHANGES } from "./memory-constants";
import {
  installIsolatedTestDatabase,
  uninstallIsolatedTestDatabase,
} from "@/lib/test/isolatedTestDatabase";

const CHAT_ID = 99101;
const USER_ID = 1;
const CHARACTER_ID = 2;
const TIER = "free" as const;

function ensureChatRow(db: Database.Database): void {
  db.prepare(
    `INSERT OR IGNORE INTO chats (id, user_id, character_id, mode, memory, current_summary, memory_meta, memory_pending, memory_archived_turns)
     VALUES (?,?,?,'safe','','','{}','[]',0)`
  ).run(CHAT_ID, USER_ID, CHARACTER_ID);
}

function seedLegacy(
  db: Database.Database,
  opts: { current_summary: string; memory: string }
): void {
  ensureChatRow(db);
  db.prepare(`UPDATE chats SET current_summary=?, memory=? WHERE id=?`).run(
    opts.current_summary,
    opts.memory,
    CHAT_ID
  );
}

function countMemoryNonempty(db: Database.Database): number {
  if (!hasChatsMemoryColumn(db)) return 0;
  const row = db
    .prepare(`SELECT COUNT(*) AS c FROM chats WHERE TRIM(COALESCE(memory,'')) <> ''`)
    .get() as { c: number };
  return Number(row.c);
}

function makeSchemaWithoutMemoryColumn(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE chats (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL,
      character_id INTEGER NOT NULL,
      current_summary TEXT NOT NULL DEFAULT '',
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
      summarized_turn_count INTEGER NOT NULL DEFAULT 0,
      memory_reset_after_message_id INTEGER,
      memory_epoch INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  return db;
}

before(() => installIsolatedTestDatabase());
after(() => uninstallIsolatedTestDatabase());

describe("chats.memory M1 global convergence precedence", () => {
  it("M1-1 current_summary wins over memory for orphan chat", () => {
    const db = getDb();
    db.prepare(`DELETE FROM chat_memories WHERE chat_id=?`).run(CHAT_ID);
    seedLegacy(db, { current_summary: "CURRENT", memory: "OLD" });

    convergeDirect(db);

    const row = db
      .prepare(`SELECT recent_summary FROM chat_memories WHERE chat_id=?`)
      .get(CHAT_ID) as { recent_summary: string };
    assert.equal(row.recent_summary, "CURRENT");
    assert.equal(countMemoryNonempty(db), 0);
  });

  it("M1-2 memory-only orphan migrates to canonical and promotes current_summary", () => {
    const db = getDb();
    db.prepare(`DELETE FROM chat_memories WHERE chat_id=?`).run(CHAT_ID);
    seedLegacy(db, { current_summary: "", memory: "ONLY COPY" });

    convergeDirect(db);

    const canonical = db
      .prepare(`SELECT recent_summary FROM chat_memories WHERE chat_id=?`)
      .get(CHAT_ID) as { recent_summary: string };
    const chat = db
      .prepare(`SELECT current_summary, memory FROM chats WHERE id=?`)
      .get(CHAT_ID) as { current_summary: string; memory: string };
    assert.equal(canonical.recent_summary, "ONLY COPY");
    assert.equal(chat.current_summary, "ONLY COPY");
    assert.equal(chat.memory, "");
  });

  it("M1-3 existing canonical recent_summary is never overwritten", () => {
    const db = getDb();
    ensureChatRow(db);
    db.prepare(
      `INSERT OR REPLACE INTO chat_memories
        (chat_id, user_id, character_id, recent_summary, archive_summary, membership_tier, used_chars, summarized_turn_count)
       VALUES (?,?,?,?,?,?,?,0)`
    ).run(CHAT_ID, USER_ID, CHARACTER_ID, "NEW", "", TIER, 3);
    seedLegacy(db, { current_summary: "OLD", memory: "OLDER" });

    convergeDirect(db);

    const row = db
      .prepare(`SELECT recent_summary FROM chat_memories WHERE chat_id=?`)
      .get(CHAT_ID) as { recent_summary: string };
    assert.equal(row.recent_summary, "NEW");
    assert.equal(countMemoryNonempty(db), 0);
  });

  it("M1-4 empty legacy orphan does not create chat_memories row", () => {
    const db = getDb();
    db.prepare(`DELETE FROM chat_memories WHERE chat_id=?`).run(CHAT_ID);
    seedLegacy(db, { current_summary: "", memory: "" });

    convergeDirect(db);

    const exists = db.prepare(`SELECT 1 AS ok FROM chat_memories WHERE chat_id=?`).get(CHAT_ID);
    assert.equal(exists, undefined);
  });

  it("M1 data-loss gate: recover before zero memory", () => {
    const db = getDb();
    db.prepare(`DELETE FROM chat_memories WHERE chat_id=?`).run(CHAT_ID);
    seedLegacy(db, { current_summary: "", memory: "ONLY COPY" });

    convergeDirect(db);

    const canonical = db
      .prepare(`SELECT recent_summary FROM chat_memories WHERE chat_id=?`)
      .get(CHAT_ID) as { recent_summary: string };
    assert.equal(canonical.recent_summary, "ONLY COPY");
    assert.equal(countMemoryNonempty(db), 0);
  });
});

describe("chats.memory M1 lazy bootstrap retirement", () => {
  it("lazy migrate reads current_summary only — memory never read", () => {
    const db = getDb();
    db.prepare(`DELETE FROM chat_memories WHERE chat_id=?`).run(CHAT_ID);
    seedLegacy(db, { current_summary: "LAZY", memory: "IGNORED" });

    migrateLegacyCurrentSummaryIntoCanonical(db, CHAT_ID, USER_ID, CHARACTER_ID, TIER);

    const row = db
      .prepare(`SELECT recent_summary FROM chat_memories WHERE chat_id=?`)
      .get(CHAT_ID) as { recent_summary: string };
    assert.equal(row.recent_summary, "LAZY");
    assert.equal(db.prepare(`SELECT memory FROM chats WHERE id=?`).get(CHAT_ID)?.memory, "IGNORED");
  });

  it("memory-only orphan is not lazy-migrated on getOrCreate without global convergence", () => {
    getDb();
    const db = getDb();
    db.prepare(`DELETE FROM chat_memories WHERE chat_id=?`).run(CHAT_ID);
    seedLegacy(db, { current_summary: "", memory: "LAZY SKIP" });

    const row = getOrCreateChatMemory(CHAT_ID, USER_ID, CHARACTER_ID, TIER);
    assert.equal(row.recent_summary, "");
  });
});

describe("chats.memory M1 reset resurrection safety", () => {
  it("reset then row delete does not resurrect old memory", () => {
    const db = getDb();
    ensureChatRow(db);
    seedLegacy(db, { current_summary: "", memory: "OLD LEGACY MEMORY" });
    db.prepare(
      `INSERT OR REPLACE INTO chat_memories
        (chat_id, user_id, character_id, recent_summary, archive_summary, membership_tier, used_chars, summarized_turn_count)
       VALUES (?,?,?,?,?,?,?,0)`
    ).run(CHAT_ID, USER_ID, CHARACTER_ID, "", "", TIER, 0);

    executeAtomicMemoryResetCore(db, {
      chatId: CHAT_ID,
      userId: USER_ID,
      characterId: CHARACTER_ID,
      tier: TIER,
    });

    db.prepare(`DELETE FROM chat_memories WHERE chat_id=?`).run(CHAT_ID);
    const row = getOrCreateChatMemory(CHAT_ID, USER_ID, CHARACTER_ID, TIER);
    assert.equal(row.recent_summary, "");
    assert.equal(countMemoryNonempty(db), 0);
  });
});

describe("chats.memory M1 writer retirement", () => {
  it("production sources no longer write nonempty chats.memory", () => {
    const root = join(process.cwd(), "src/lib/memory");
    const variantSrc = readFileSync(join(root, "memory-variant-switch-reconcile.ts"), "utf8");
    const forkSrc = readFileSync(join(root, "memory-fork-snapshot.ts"), "utf8");
    const dbSrc = readFileSync(join(process.cwd(), "src/lib/memory/memory-db.ts"), "utf8");

    assert.ok(!variantSrc.includes("SET current_summary=?, memory=?"));
    assert.ok(variantSrc.includes("SET current_summary=? WHERE id=?"));
    assert.ok(!forkSrc.includes("SET memory=?, current_summary=?"));
    assert.ok(forkSrc.includes("SET current_summary=?, memory_archived_turns=?"));
    assert.ok(!dbSrc.includes("SELECT current_summary, memory FROM chats"));
    assert.ok(!dbSrc.match(/UPDATE chats SET current_summary='',\s*memory=''/));
  });
});

describe("chats.memory M1 column-absent compatibility", () => {
  it("global convergence works without chats.memory column", () => {
    const db = makeSchemaWithoutMemoryColumn();
    db.prepare(`INSERT INTO chats (id, user_id, character_id, current_summary) VALUES (?,?,?,?)`).run(
      CHAT_ID,
      USER_ID,
      CHARACTER_ID,
      "MIRROR ONLY"
    );

    convergeDirect(db);

    const row = db
      .prepare(`SELECT recent_summary FROM chat_memories WHERE chat_id=?`)
      .get(CHAT_ID) as { recent_summary: string };
    assert.equal(row.recent_summary, "MIRROR ONLY");
  });

  it("clear helper no-ops without memory column", () => {
    const db = makeSchemaWithoutMemoryColumn();
    db.prepare(`INSERT INTO chats (id, user_id, character_id, current_summary) VALUES (?,?,?,?)`).run(
      CHAT_ID,
      USER_ID,
      CHARACTER_ID,
      "x"
    );

    assert.doesNotThrow(() => clearChatsMemoryColumnIfPresent(db, CHAT_ID, USER_ID));
  });
});

describe("chats.memory M1 idempotency", () => {
  it("second convergence run is no-op", () => {
    const db = getDb();
    db.prepare(`DELETE FROM chat_memories WHERE chat_id=?`).run(CHAT_ID);
    seedLegacy(db, { current_summary: "ONCE", memory: "" });

    convergeDirect(db);
    convergeDirect(db);

    const count = db
      .prepare(`SELECT COUNT(*) AS c FROM chat_memories WHERE chat_id=?`)
      .get(CHAT_ID) as { c: number };
    assert.equal(Number(count.c), 1);
    assert.equal(countMemoryNonempty(db), 0);
  });

  it("startup migrate wiring invokes convergence", () => {
    getDb();
    const db = getDb();
    db.prepare(`DELETE FROM chat_memories WHERE chat_id=?`).run(CHAT_ID);
    seedLegacy(db, { current_summary: "STARTUP", memory: "" });

    convergeLegacyChatsMemoryIntoCanonical(db);

    const row = db
      .prepare(`SELECT recent_summary FROM chat_memories WHERE chat_id=?`)
      .get(CHAT_ID) as { recent_summary: string };
    assert.equal(row.recent_summary, "STARTUP");
  });
});

describe("chats.memory M1 policy constants", () => {
  it("rolling summary interval unchanged", () => {
    assert.equal(ROLLING_SUMMARY_INTERVAL, 5);
    assert.equal(RAW_HISTORY_COMPLETE_EXCHANGES, 4);
  });
});
