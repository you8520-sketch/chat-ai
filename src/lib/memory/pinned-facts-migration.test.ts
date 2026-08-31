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
import { getDb } from "@/lib/db";
import { buildMemoryContext } from "./memory-injector";
import { calcUsedChars } from "./memory-used-chars";
import { MEMORY_CAPACITY_FIXED } from "./memory-capacity-shared";
import {
  computeLegacyPinnedFold,
  type LegacyPinnedFoldInput,
} from "./pinned-facts-fold";
import {
  migrateLegacyPinnedFactsIntoRecentSummary,
  PINNED_FACTS_FOLDED_FLAG,
  pinnedFactsFoldFlagExists,
} from "./pinned-facts-migration";
import {
  installIsolatedTestDatabase,
  uninstallIsolatedTestDatabase,
} from "@/lib/test/isolatedTestDatabase";

function ensureSchemaFlagsTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _schema_flags (
      key TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
}

function createChatMemoriesTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS chat_memories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id INTEGER NOT NULL UNIQUE,
      user_id INTEGER NOT NULL,
      character_id INTEGER NOT NULL,
      pinned_facts TEXT NOT NULL DEFAULT '',
      recent_summary TEXT NOT NULL DEFAULT '',
      archive_summary TEXT NOT NULL DEFAULT '',
      membership_tier TEXT NOT NULL DEFAULT 'free',
      used_chars INTEGER NOT NULL DEFAULT 0,
      message_count INTEGER NOT NULL DEFAULT 0,
      summarized_turn_count INTEGER NOT NULL DEFAULT 0,
      memory_reset_after_message_id INTEGER,
      memory_epoch INTEGER NOT NULL DEFAULT 0,
      last_compressed_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

function insertChatMemory(
  db: Database.Database,
  opts: {
    chatId: number;
    userId?: number;
    characterId?: number;
    pinned_facts?: string;
    recent_summary?: string;
    archive_summary?: string;
    used_chars?: number;
  }
): void {
  db.prepare(
    `INSERT INTO chat_memories
      (chat_id, user_id, character_id, pinned_facts, recent_summary, archive_summary, used_chars)
     VALUES (?,?,?,?,?,?,?)`
  ).run(
    opts.chatId,
    opts.userId ?? 1,
    opts.characterId ?? 2,
    opts.pinned_facts ?? "",
    opts.recent_summary ?? "",
    opts.archive_summary ?? "",
    opts.used_chars ?? 0
  );
}

function readMemory(db: Database.Database, chatId: number) {
  return db
    .prepare(
      `SELECT pinned_facts, recent_summary, archive_summary, used_chars
       FROM chat_memories WHERE chat_id=?`
    )
    .get(chatId) as {
    pinned_facts: string;
    recent_summary: string;
    archive_summary: string;
    used_chars: number;
  };
}

/** Pre-retirement lazy fold semantics for meaningful pinned only (no whitespace-only normalize). */
function legacyLazyFoldMeaningful(input: LegacyPinnedFoldInput) {
  const pinned = input.pinned_facts?.trim();
  if (!pinned) return null;
  const merged = [pinned, input.recent_summary?.trim() ?? ""].filter(Boolean).join("\n\n");
  return {
    pinned_facts: "",
    recent_summary: merged,
    archive_summary: input.archive_summary,
    used_chars: calcUsedChars({
      recent_summary: merged,
      archive_summary: input.archive_summary,
    }),
  };
}

before(() => installIsolatedTestDatabase());
after(() => uninstallIsolatedTestDatabase());

describe("computeLegacyPinnedFold fixture matrix", () => {
  it("A pinned + recent merges with blank line", () => {
    const folded = computeLegacyPinnedFold({
      pinned_facts: "A",
      recent_summary: "B",
      archive_summary: "archive",
    });
    assert.ok(folded);
    assert.equal(folded.pinned_facts, "");
    assert.equal(folded.recent_summary, "A\n\nB");
    assert.equal(
      folded.used_chars,
      calcUsedChars({ recent_summary: "A\n\nB", archive_summary: "archive" })
    );
  });

  it("B pinned only", () => {
    const folded = computeLegacyPinnedFold({
      pinned_facts: "A",
      recent_summary: "",
      archive_summary: "archive",
    });
    assert.ok(folded);
    assert.equal(folded.recent_summary, "A");
  });

  it("C trims whitespace around content", () => {
    const folded = computeLegacyPinnedFold({
      pinned_facts: "  A  ",
      recent_summary: "  B  ",
      archive_summary: "",
    });
    assert.ok(folded);
    assert.equal(folded.recent_summary, "A\n\nB");
  });

  it("D whitespace-only pinned normalizes without content growth", () => {
    const folded = computeLegacyPinnedFold({
      pinned_facts: "   ",
      recent_summary: "B",
      archive_summary: "archive",
    });
    assert.ok(folded);
    assert.equal(folded.pinned_facts, "");
    assert.equal(folded.recent_summary, "B");
    assert.equal(
      folded.used_chars,
      calcUsedChars({ recent_summary: "B", archive_summary: "archive" })
    );
  });

  it("returns null when pinned already empty", () => {
    assert.equal(
      computeLegacyPinnedFold({
        pinned_facts: "",
        recent_summary: "B",
        archive_summary: "",
      }),
      null
    );
  });

  it("migration no-op when pinned_facts column is absent", () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE chat_memories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chat_id INTEGER NOT NULL UNIQUE,
        user_id INTEGER NOT NULL,
        character_id INTEGER NOT NULL,
        recent_summary TEXT NOT NULL DEFAULT '',
        archive_summary TEXT NOT NULL DEFAULT '',
        membership_tier TEXT NOT NULL DEFAULT 'free',
        used_chars INTEGER NOT NULL DEFAULT 0
      );
    `);
    assert.doesNotThrow(() => migrateLegacyPinnedFactsIntoRecentSummary(db));
  });
});

describe("pinned_facts global migration lifecycle", () => {
  it("S1 initial migration folds all legacy rows and marks flag", () => {
    const db = new Database(":memory:");
    createChatMemoriesTable(db);
    insertChatMemory(db, { chatId: 1, pinned_facts: "legacy pinned", recent_summary: "current recent", archive_summary: "archive" });
    insertChatMemory(db, { chatId: 2, pinned_facts: "A", recent_summary: "B", archive_summary: "" });
    insertChatMemory(db, { chatId: 3, pinned_facts: "   ", recent_summary: "keep", archive_summary: "" });

    assert.equal(pinnedFactsFoldFlagExists(db), false);

    migrateLegacyPinnedFactsIntoRecentSummary(db);

    assert.equal(pinnedFactsFoldFlagExists(db), true);
    const row1 = readMemory(db, 1);
    assert.equal(row1.pinned_facts, "");
    assert.equal(row1.recent_summary, "legacy pinned\n\ncurrent recent");
    assert.equal(row1.archive_summary, "archive");
    assert.equal(
      row1.used_chars,
      calcUsedChars({
        recent_summary: row1.recent_summary,
        archive_summary: row1.archive_summary,
      })
    );

    const row2 = readMemory(db, 2);
    assert.equal(row2.recent_summary, "A\n\nB");

    const row3 = readMemory(db, 3);
    assert.equal(row3.pinned_facts, "");
    assert.equal(row3.recent_summary, "keep");
  });

  it("S2 idempotent rerun makes no content changes", () => {
    const db = new Database(":memory:");
    createChatMemoriesTable(db);
    insertChatMemory(db, { chatId: 10, pinned_facts: "A", recent_summary: "B", archive_summary: "" });
    migrateLegacyPinnedFactsIntoRecentSummary(db);
    const afterFirst = readMemory(db, 10);

    migrateLegacyPinnedFactsIntoRecentSummary(db);
    const afterSecond = readMemory(db, 10);
    assert.equal(afterSecond.pinned_facts, afterFirst.pinned_facts);
    assert.equal(afterSecond.recent_summary, afterFirst.recent_summary);
    assert.equal(afterSecond.archive_summary, afterFirst.archive_summary);
    assert.equal(afterSecond.used_chars, afterFirst.used_chars);
  });

  it("S3 reintroduced legacy data is repaired despite flag", () => {
    const db = new Database(":memory:");
    createChatMemoriesTable(db);
    insertChatMemory(db, { chatId: 20, pinned_facts: "A", recent_summary: "B", archive_summary: "" });
    migrateLegacyPinnedFactsIntoRecentSummary(db);
    assert.equal(pinnedFactsFoldFlagExists(db), true);

    db.prepare(`UPDATE chat_memories SET pinned_facts=? WHERE chat_id=?`).run("rollback pinned", 20);
    assert.equal(readMemory(db, 20).pinned_facts, "rollback pinned");

    migrateLegacyPinnedFactsIntoRecentSummary(db);
    const repaired = readMemory(db, 20);
    assert.equal(repaired.pinned_facts, "");
    assert.equal(repaired.recent_summary, "rollback pinned\n\nA\n\nB");
    assert.equal(pinnedFactsFoldFlagExists(db), true);
  });

  it("marks flag complete when no legacy rows exist", () => {
    const db = new Database(":memory:");
    createChatMemoriesTable(db);
    insertChatMemory(db, { chatId: 30, recent_summary: "only recent", archive_summary: "" });
    migrateLegacyPinnedFactsIntoRecentSummary(db);
    assert.equal(pinnedFactsFoldFlagExists(db), true);
    assert.equal(readMemory(db, 30).recent_summary, "only recent");
  });

  it("FLAG_ALREADY_EXISTS + DIRTY_DATA repairs without flag conflict", () => {
    const db = new Database(":memory:");
    createChatMemoriesTable(db);
    ensureSchemaFlagsTable(db);
    db.prepare(`INSERT INTO _schema_flags (key) VALUES (?)`).run(PINNED_FACTS_FOLDED_FLAG);
    insertChatMemory(db, {
      chatId: 40,
      pinned_facts: "dirty after flag",
      recent_summary: "recent",
      archive_summary: "arc",
    });
    assert.equal(pinnedFactsFoldFlagExists(db), true);

    migrateLegacyPinnedFactsIntoRecentSummary(db);

    const row = readMemory(db, 40);
    assert.equal(row.pinned_facts, "");
    assert.equal(row.recent_summary, "dirty after flag\n\nrecent");
    assert.equal(row.archive_summary, "arc");
    assert.equal(pinnedFactsFoldFlagExists(db), true);
  });

  it("FRESH_DB init physically retires pinned_facts column", () => {
    getDb();
    const db = getDb();
    const cols = db.prepare(`PRAGMA table_info(chat_memories)`).all() as Array<{ name: string }>;
    assert.equal(
      cols.some((col) => col.name === "pinned_facts"),
      false,
      "fresh schema must not include pinned_facts"
    );
  });
});

/** Pre-retirement injector lorebook merge (pinned + recent before canonical recent_summary). */
function legacyInjectorLorebookRaw(pinned_facts: string, recent_summary: string): string {
  return [pinned_facts.trim(), recent_summary.trim()].filter(Boolean).join("\n\n");
}

describe("pinned_facts parity", () => {
  it("OLD lazy fold vs NEW global migration byte-equivalent for meaningful pinned", () => {
    const fixtures: LegacyPinnedFoldInput[] = [
      { pinned_facts: "legacy pinned", recent_summary: "current recent", archive_summary: "archive" },
      { pinned_facts: "A", recent_summary: "B", archive_summary: "" },
      { pinned_facts: "  A  ", recent_summary: "  B  ", archive_summary: "Z" },
      { pinned_facts: "solo", recent_summary: "", archive_summary: "arc" },
    ];

    for (const fixture of fixtures) {
      const lazy = legacyLazyFoldMeaningful(fixture);
      const migrated = computeLegacyPinnedFold(fixture);
      assert.deepEqual(migrated, lazy);
    }
  });

  it("INJECTION parity: migrated DB row matches pre-retirement lorebook semantics", () => {
    const fixture = {
      pinned_facts: "legacy pinned",
      recent_summary: "current recent",
      archive_summary: "archive",
    };
    const oldLorebookRaw = legacyInjectorLorebookRaw(
      fixture.pinned_facts,
      fixture.recent_summary
    );
    assert.equal(oldLorebookRaw, "legacy pinned\n\ncurrent recent");

    const db = new Database(":memory:");
    createChatMemoriesTable(db);
    insertChatMemory(db, {
      chatId: 100,
      pinned_facts: fixture.pinned_facts,
      recent_summary: fixture.recent_summary,
      archive_summary: fixture.archive_summary,
    });

    migrateLegacyPinnedFactsIntoRecentSummary(db);
    const migrated = readMemory(db, 100);
    assert.equal(migrated.recent_summary, oldLorebookRaw);
    assert.equal(migrated.pinned_facts, "");

    const injection = buildMemoryContext({
      memory: {
        recent_summary: migrated.recent_summary,
        archive_summary: migrated.archive_summary,
        membership_tier: "free",
      },
      userMessage: "안녕",
      memoryCapacity: MEMORY_CAPACITY_FIXED,
      includeArchiveAlways: true,
    });

    assert.match(injection.text, /legacy pinned/);
    assert.match(injection.text, /current recent/);
    assert.ok(
      injection.text.includes(oldLorebookRaw),
      "injected lorebook contains migrated canonical body"
    );
    assert.equal(
      (injection.text.match(/legacy pinned/g) ?? []).length,
      1,
      "legacy pinned content appears exactly once"
    );
    assert.equal(
      (injection.text.match(/current recent/g) ?? []).length,
      1,
      "current recent content appears exactly once"
    );
    assert.ok(
      injection.text.indexOf("legacy pinned") < injection.text.indexOf("current recent"),
      "order preserved: pinned before recent"
    );

    assert.equal(injection.archiveText, fixture.archive_summary);
    assert.equal(
      injection.usedChars,
      calcUsedChars({
        recent_summary: oldLorebookRaw,
        archive_summary: fixture.archive_summary,
      })
    );
  });
});

describe("getOrCreateChatMemory no longer performs hidden legacy fold", () => {
  it("read path leaves legacy pinned row unchanged until global fold runs", async () => {
    const { getOrCreateChatMemory } = await import("./memory-db");
    const db = getDb();
    db.exec(`ALTER TABLE chat_memories ADD COLUMN pinned_facts TEXT NOT NULL DEFAULT ''`);
    insertChatMemory(db, {
      chatId: 9001,
      pinned_facts: "should stay until global migration",
      recent_summary: "recent",
      archive_summary: "",
    });

    getOrCreateChatMemory(9001, 1, 2, "free");
    const row = readMemory(db, 9001);
    assert.equal(row.pinned_facts, "should stay until global migration");
    assert.equal(row.recent_summary, "recent");
  });
});
