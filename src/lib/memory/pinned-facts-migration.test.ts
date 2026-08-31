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
import { calcUsedChars } from "./memory-db";
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

  it("FRESH_DB migration is wired through getDb init", () => {
    getDb();
    const db = getDb();
    db.exec(`
      CREATE TABLE IF NOT EXISTS _schema_flags (
        key TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
    assert.equal(
      Boolean(
        db.prepare(`SELECT 1 AS ok FROM _schema_flags WHERE key=?`).get(PINNED_FACTS_FOLDED_FLAG)
      ),
      true
    );
  });
});

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

  it("INJECTION parity after migration matches lazy fold injection", () => {
    const fixture = {
      pinned_facts: "legacy pinned",
      recent_summary: "current recent",
      archive_summary: "archive",
    };
    const lazy = legacyLazyFoldMeaningful(fixture);
    assert.ok(lazy);

    const lazyInjection = buildMemoryContext({
      memory: {
        recent_summary: lazy.recent_summary,
        archive_summary: lazy.archive_summary,
        membership_tier: "free",
      },
      userMessage: "안녕",
      memoryCapacity: MEMORY_CAPACITY_FIXED,
      includeArchiveAlways: true,
    });

    const migratedInjection = buildMemoryContext({
      memory: {
        recent_summary: lazy.recent_summary,
        archive_summary: lazy.archive_summary,
        membership_tier: "free",
      },
      userMessage: "안녕",
      memoryCapacity: MEMORY_CAPACITY_FIXED,
      includeArchiveAlways: true,
    });

    assert.equal(migratedInjection.text, lazyInjection.text);
    assert.equal(migratedInjection.archiveText, lazyInjection.archiveText);
    assert.equal(migratedInjection.usedChars, lazyInjection.usedChars);
  });
});

describe("getOrCreateChatMemory no longer performs hidden legacy fold", () => {
  it("read path leaves legacy pinned row unchanged", async () => {
    const { getOrCreateChatMemory } = await import("./memory-db");
    const db = getDb();
    createChatMemoriesTable(db);
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
